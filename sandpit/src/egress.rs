//! Kernel network exceptions and a bounded, parent-owned CONNECT broker.
use crate::config::NetworkConfig;
use anyhow::{Context, Result, bail};
use std::{net::IpAddr, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

pub struct Egress {
    pub port: u16,
    pub ssh_destinations: Vec<String>,
    pub sockets: Vec<std::path::PathBuf>,
}

fn matches(host: &str, rule: &str) -> bool {
    let rule = rule.trim_start_matches("*.").to_ascii_lowercase();
    host == rule || host.ends_with(&format!(".{rule}"))
}

fn allowed(host: &str, cfg: &NetworkConfig) -> bool {
    let host = host.to_ascii_lowercase();
    !cfg.deny_all && !cfg.block.iter().any(|r| matches(&host, r))
        && (cfg.allow.is_empty() || cfg.allow.iter().any(|r| matches(&host, r)))
}

// Conservative public-unicast policy, checked against IANA's special-purpose
// registries (2026-09-14):
// https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/
// Entire protocol/transition ranges are denied, including globally reachable
// special-purpose exceptions; these are not ordinary Internet destinations.
fn public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_multicast()
                || ip.is_documentation()
                || ip.octets()[0] == 0
                || ip.octets()[0] >= 240
                || (ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]))
                || ip.octets()[..3] == [192, 0, 0]
                || ip.octets()[..3] == [192, 88, 99]
                || (ip.octets()[0] == 198 && (18..20).contains(&ip.octets()[1])))
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return public(IpAddr::V4(v4));
            }
            let segments = ip.segments();
            // Only global unicast 2000::/3, excluding IETF protocol assignments,
            // 6to4 (which embeds an unchecked IPv4 destination), and both
            // documentation ranges. Other translation/local ranges are outside
            // 2000::/3 and therefore denied as well.
            (segments[0] & 0xe000) == 0x2000
                && !(segments[0] == 0x2001 && segments[1] < 0x0200)
                && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
                && segments[0] != 0x2002
                && !(segments[0] == 0x3fff && segments[1] < 0x1000)
        }
    }
}

fn target(value: &str) -> Result<(String, u16)> {
    let (host, port) = value.rsplit_once(':').context("expected hostname:port")?;
    let port: u16 = port.parse()?;
    if port == 0
        || host.is_empty()
        || !host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-')
        || host.parse::<IpAddr>().is_ok()
        || host.ends_with('.')
    {
        bail!("expected a DNS hostname and nonzero port");
    }
    Ok((host.to_ascii_lowercase(), port))
}

/// Canonical endpoint shared by trusted preflight and confined SSH authorization.
/// Hostnames are case-insensitive; SSH usernames are not.
pub(crate) fn ssh_destination(effective: &str) -> Result<String> {
    let value = |key: &str| effective.lines().find_map(|line| line.strip_prefix(key));
    let host = value("hostname ").context("SSH configuration has no hostname")?;
    let port = value("port ").context("SSH configuration has no port")?;
    let user = value("user ").context("SSH configuration has no user")?;
    if user.is_empty() || user.chars().any(|c| c.is_whitespace() || c == '@') {
        bail!("SSH configuration has an invalid user");
    }
    let (host, port) = target(&format!("{host}:{port}"))?;
    Ok(format!("{user}@{host}:{port}"))
}

fn authorized_ssh_destination(effective: &str, cfg: &NetworkConfig) -> Result<String> {
    let endpoint = ssh_destination(effective)?;
    let (_, destination) = endpoint.rsplit_once('@').unwrap();
    let (host, _) = target(destination)?;
    if !allowed(&host, cfg) {
        bail!("resolved network.ssh destination conflicts with domain policy: {host}");
    }
    Ok(endpoint)
}

fn selected_agent_socket(
    effective: &str,
    ambient: Option<&std::ffi::OsStr>,
) -> Result<Option<std::path::PathBuf>> {
    use std::os::unix::fs::FileTypeExt;

    let identity_agent = effective
        .lines()
        .find_map(|line| line.strip_prefix("identityagent "));
    let selected = match identity_agent {
        Some("none") => None,
        None | Some("SSH_AUTH_SOCK") => ambient.filter(|path| !path.is_empty()),
        Some(path) => Some(std::ffi::OsStr::new(path)),
    };
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = std::fs::canonicalize(selected)
        .context("cannot resolve selected SSH identity agent socket")?;
    if !std::fs::metadata(&path)?.file_type().is_socket() {
        bail!("selected SSH identity agent is not a Unix socket");
    }
    Ok(Some(path))
}

pub async fn start(
    cfg: NetworkConfig,
    audit: Arc<crate::proxy_core::AuditLogger>,
) -> Result<Egress> {
    let mut sockets = Vec::new();
    let mut ssh_destinations = Vec::new();
    for entry in &cfg.ssh {
        let (user, destination) = match entry.rsplit_once('@') {
            Some((user, destination)) => (Some(user), destination),
            None => (None, entry.as_str()),
        };
        let (host, port) = target(destination).context("invalid network.ssh destination")?;
        let mut ssh = std::process::Command::new("/usr/bin/ssh");
        ssh.args(["-G", "-p", &port.to_string()]);
        if let Some(user) = user {
            ssh.args(["-l", user]);
        }
        let output = ssh.arg(&host).output()?;
        if !output.status.success() {
            bail!("cannot resolve SSH configuration for {host}");
        }
        let effective = String::from_utf8(output.stdout)?;
        let endpoint = authorized_ssh_destination(&effective, &cfg)?;
        if !ssh_destinations.contains(&endpoint) {
            ssh_destinations.push(endpoint);
        }
        for line in effective.lines() {
            if line.starts_with("proxycommand ") || line.starts_with("proxyjump ") {
                bail!(
                    "existing SSH ProxyCommand/ProxyJump requires explicit integration; refusing to replace it"
                );
            }
        }
        if let Some(socket) =
            selected_agent_socket(&effective, std::env::var_os("SSH_AUTH_SOCK").as_deref())?
        {
            if !sockets.contains(&socket) {
                sockets.push(socket);
            }
        }
    }
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let cfg = Arc::new(cfg);
    let limit = Arc::new(tokio::sync::Semaphore::new(128));
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let Ok(permit) = limit.clone().try_acquire_owned() else {
                drop(stream);
                continue;
            };
            let cfg = cfg.clone();
            let audit = audit.clone();
            tokio::spawn(async move {
                let _permit = permit;
                if let Err(error) = serve(stream, &cfg, &audit).await {
                    tracing::debug!(%error, "egress request rejected");
                }
            });
        }
    });
    Ok(Egress { port, sockets, ssh_destinations })
}

async fn serve(
    mut client: TcpStream,
    cfg: &NetworkConfig,
    audit: &crate::proxy_core::AuditLogger,
) -> Result<()> {
    let header = tokio::time::timeout(Duration::from_secs(10), async {
        let mut bytes = Vec::new();
        while bytes.len() < 16384 {
            bytes.push(client.read_u8().await?);
            if bytes.ends_with(b"\r\n\r\n") {
                return Ok::<_, anyhow::Error>(bytes);
            }
        }
        bail!("proxy header too large")
    })
    .await??;
    let header = std::str::from_utf8(&header)?;
    let parts: Vec<_> = header
        .lines()
        .next()
        .unwrap_or("")
        .split_whitespace()
        .collect();
    if parts.len() != 3 {
        bail!("invalid proxy request");
    }
    let connect = parts[0] == "CONNECT";
    let mut forward = None;
    let destination = if connect {
        target(parts[1])
    } else {
        let url = reqwest::Url::parse(parts[1])?;
        if url.scheme() != "http"
            || !url.username().is_empty()
            || url.password().is_some()
            || !parts[0].bytes().all(|byte| byte.is_ascii_uppercase())
        {
            bail!("invalid HTTP proxy request");
        }
        let host = url.host_str().context("HTTP URL has no host")?;
        let port = url.port().unwrap_or(80);
        let path = match url.query() {
            Some(query) => format!("{}?{query}", url.path()),
            None => url.path().into(),
        };
        let mut request = format!(
            "{} {} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n",
            parts[0], path
        );
        for line in header.lines().skip(1).filter(|line| !line.is_empty()) {
            let (key, _) = line.split_once(':').context("invalid HTTP header")?;
            if !matches!(
                key.to_ascii_lowercase().as_str(),
                "host" | "connection" | "proxy-connection" | "proxy-authorization"
            ) {
                request.push_str(line);
                request.push_str("\r\n");
            }
        }
        request.push_str("\r\n");
        forward = Some(request);
        target(&format!("{host}:{port}"))
    };
    let (host, port) = match destination {
        Ok((host, port)) if allowed(&host, cfg) => (host, port),
        _ => {
            tracing::warn!("egress blocked by domain policy");
            audit
                .log(&crate::proxy_core::ConnectionEntry {
                    timestamp: chrono::Utc::now(),
                    host: "rejected-target".into(),
                    port: 0,
                    method: parts[0].into(),
                    action: "block".into(),
                    reason: "invalid or denied destination".into(),
                    pid: None,
                    command: None,
                })
                .await;
            client
                .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
                .await?;
            return Ok(());
        }
    };
    // Resolve here and connect the checked address, never resolve again after
    // validation. Private/loopback destinations cannot reach a local escape broker.
    let addresses: Vec<_> = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::net::lookup_host((host.as_str(), port)),
    )
    .await??
    .collect();
    if addresses.is_empty() || addresses.iter().any(|a| !public(a.ip())) {
        audit
            .log(&crate::proxy_core::ConnectionEntry {
                timestamp: chrono::Utc::now(),
                host: host.clone(),
                port,
                method: parts[0].into(),
                action: "block".into(),
                reason: "DNS returned an empty or non-public address set".into(),
                pid: None,
                command: None,
            })
            .await;
        client
            .write_all(b"HTTP/1.1 403 Non-public destination\r\nContent-Length: 0\r\n\r\n")
            .await?;
        return Ok(());
    }
    let mut remote = tokio::time::timeout(
        Duration::from_secs(10),
        TcpStream::connect(addresses.as_slice()),
    )
    .await??;
    audit
        .log(&crate::proxy_core::ConnectionEntry {
            timestamp: chrono::Utc::now(),
            host: host.clone(),
            port,
            method: parts[0].into(),
            action: "allow".into(),
            reason: String::new(),
            pid: None,
            command: None,
        })
        .await;
    tracing::info!(destination=%host, port, "egress allowed");
    if let Some(request) = forward {
        remote.write_all(request.as_bytes()).await?;
    } else {
        client
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await?;
    }
    tokio::time::timeout(
        Duration::from_secs(3600),
        tokio::io::copy_bidirectional(&mut client, &mut remote),
    )
    .await??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn non_public_dns_rejections_are_audited() {
        for (method, request) in [
            ("CONNECT", "CONNECT localhost:443 HTTP/1.1\r\n\r\n"),
            ("GET", "GET http://localhost:443/private?token=synthetic HTTP/1.1\r\n\r\n"),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("audit.jsonl");
            let audit = Arc::new(crate::proxy_core::AuditLogger::new(&path).unwrap());
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (client, _) = listener.accept().await.unwrap();
                let cfg = NetworkConfig { allow: vec!["localhost".into()], ..Default::default() };
                serve(client, &cfg, &audit).await.unwrap();
            });
            let mut client = TcpStream::connect(address).await.unwrap();
            client.write_all(request.as_bytes()).await.unwrap();
            let mut response = String::new();
            tokio::time::timeout(Duration::from_secs(15), client.read_to_string(&mut response))
                .await.unwrap().unwrap();
            server.await.unwrap();
            assert!(response.starts_with("HTTP/1.1 403 Non-public destination"));
            let contents = std::fs::read_to_string(path).unwrap();
            let entries: Vec<serde_json::Value> = contents.lines()
                .map(|line| serde_json::from_str(line).unwrap()).collect();
            assert_eq!(entries.len(), 1);
            let entry = &entries[0];
            assert_eq!(entry["host"], "localhost");
            assert_eq!(entry["port"], 443);
            assert_eq!(entry["method"], method);
            assert_eq!(entry["action"], "block");
            assert_eq!(entry["reason"], "DNS returned an empty or non-public address set");
            assert!(!contents.contains("synthetic"));
        }
    }
    #[test]
    fn rejects_unbound_destinations() {
        for value in [
            "127.0.0.1:80",
            "[::1]:80",
            "evil.com.:443",
            "evil.com@allowed.com:443",
            "host:0",
        ] {
            assert!(target(value).is_err());
        }
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!public(ip.parse().unwrap()));
        }
        assert!(public("1.1.1.1".parse().unwrap()));
    }
    #[test]
    fn rejects_special_purpose_destinations_and_prefix_boundaries() {
        for ip in [
            "0.255.255.255",
            "10.255.255.255",
            "100.127.255.255",
            "127.255.255.255",
            "169.254.255.255",
            "172.31.255.255",
            "192.0.0.0",
            "192.0.0.9",
            "192.0.0.255",
            "192.0.2.255",
            "192.88.99.0",
            "192.88.99.255",
            "192.168.255.255",
            "198.18.0.0",
            "198.19.255.255",
            "198.51.100.255",
            "203.0.113.255",
            "224.0.0.0",
            "239.255.255.255",
            "240.0.0.0",
            "255.255.255.255",
            "::",
            "::ffff:198.18.0.1",
            "::ffff:192.0.0.1",
            "64:ff9b::a00:1",
            "64:ff9b:1::1",
            "100::1",
            "100:0:0:1::1",
            "2001::1",
            "2001:2::1",
            "2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff",
            "2001:db8::",
            "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
            "2002::",
            "2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
            "3fff::",
            "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff",
            "5f00::1",
            "fc00::1",
            "fdff::1",
            "fe80::1",
            "ff02::1",
        ] {
            assert!(!public(ip.parse().unwrap()), "accepted {ip}");
        }
        for ip in [
            "1.1.1.1",
            "8.8.8.8",
            "100.63.255.255",
            "100.128.0.0",
            "192.0.1.0",
            "192.88.98.255",
            "192.88.100.0",
            "198.17.255.255",
            "198.20.0.0",
            "::ffff:1.1.1.1",
            "2001:200::",
            "2001:db7:ffff:ffff:ffff:ffff:ffff:ffff",
            "2001:db9::",
            "2003::",
            "2606:4700:4700::1111",
            "3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
            "3fff:1000::",
        ] {
            assert!(public(ip.parse().unwrap()), "rejected {ip}");
        }
    }

    #[test]
    fn ssh_destination_pins_resolved_host_user_and_port() {
        let endpoint = ssh_destination("hostname GitHub.COM\nuser GitUser\nport 0022\n").unwrap();
        assert_eq!(endpoint, "GitUser@github.com:22");
        assert_eq!(endpoint, ssh_destination("hostname github.com\nuser GitUser\nport 22\n").unwrap());
        for changed in [
            "hostname github.com\nuser gituser\nport 22\n",
            "hostname github.com\nuser OtherUser\nport 22\n",
            "hostname github.com\nuser GitUser\nport 2222\n",
            "hostname attacker.example\nuser GitUser\nport 22\n",
        ] {
            assert_ne!(endpoint, ssh_destination(changed).unwrap());
        }
    }

    #[test]
    fn ssh_destination_rejects_incomplete_or_invalid_configuration() {
        for effective in [
            "user git\nport 22\n",
            "hostname github.com\nport 22\n",
            "hostname github.com\nuser git\n",
            "hostname github.com\nuser \nport 22\n",
            "hostname github.com\nuser bad user\nport 22\n",
            "hostname github.com\nuser bad@user\nport 22\n",
            "hostname github.com\nuser git\nport 0\n",
            "hostname github.com\nuser git\nport 65536\n",
            "hostname github.com\nuser git\nport ssh\n",
            "hostname 127.0.0.1\nuser git\nport 22\n",
            "hostname ::1\nuser git\nport 22\n",
            "hostname github.com.\nuser git\nport 22\n",
        ] {
            assert!(ssh_destination(effective).is_err(), "accepted {effective:?}");
        }
    }

    #[test]
    fn ssh_alias_authorization_applies_policy_to_resolved_hostname() {
        let effective = "hostname GitHub.COM\nuser GitUser\nport 22\n";
        let mut cfg = NetworkConfig {
            ssh: vec!["git.corp:22".into()],
            allow: vec!["github.com".into()],
            ..Default::default()
        };
        assert_eq!(authorized_ssh_destination(effective, &cfg).unwrap(), "GitUser@github.com:22");
        cfg.block.push("github.com".into());
        assert!(authorized_ssh_destination(effective, &cfg).is_err());
        cfg.block.clear();
        cfg.allow = vec!["git.corp".into()];
        assert!(authorized_ssh_destination(effective, &cfg).is_err());
        cfg.allow.clear();
        assert!(authorized_ssh_destination(effective, &cfg).is_ok());
    }

    #[test]
    #[ignore = "run separately: spawning a process can inherit concurrent session-test lease descriptors"]
    fn system_ssh_alias_configuration_resolves_and_pins_endpoint() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("ssh config");
        std::fs::write(&config, "Host git.corp\n  HostName GitHub.COM\n  User GitUser\n  Port 2222\n  IdentityAgent none\n").unwrap();
        for (args, expected) in [
            (vec!["git.corp"], "GitUser@github.com:2222"),
            (vec!["-p", "22", "git.corp"], "GitUser@github.com:22"),
            (vec!["-p", "22", "-l", "ExplicitUser", "git.corp"], "ExplicitUser@github.com:22"),
        ] {
            let output = std::process::Command::new("/usr/bin/ssh")
                .args(["-G", "-F"])
                .arg(&config)
                .args(args)
                .output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            let effective = String::from_utf8(output.stdout).unwrap();
            let cfg = NetworkConfig {
                ssh: vec!["git.corp:22".into()],
                allow: vec!["github.com".into()],
                ..Default::default()
            };
            assert_eq!(authorized_ssh_destination(&effective, &cfg).unwrap(), expected);
        }
    }

    #[test]
    fn identity_agent_none_ignores_stale_ambient_socket() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing.sock");
        assert!(
            selected_agent_socket("identityagent none\n", Some(missing.as_os_str()))
                .unwrap()
                .is_none()
        );
        assert!(selected_agent_socket("", Some(missing.as_os_str())).is_err());
        assert!(selected_agent_socket("", None).unwrap().is_none());
        assert!(
            selected_agent_socket("", Some(std::ffi::OsStr::new("")))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn identity_agent_grants_only_the_selected_socket() {
        use std::os::unix::net::UnixListener;
        let dir = tempfile::tempdir().unwrap();
        let ambient = dir.path().join("ambient.sock");
        let explicit = dir.path().join("explicit.sock");
        let _ambient_listener = UnixListener::bind(&ambient).unwrap();
        let _explicit_listener = UnixListener::bind(&explicit).unwrap();
        for effective in ["", "identityagent SSH_AUTH_SOCK\n"] {
            assert_eq!(
                selected_agent_socket(effective, Some(ambient.as_os_str())).unwrap(),
                Some(ambient.canonicalize().unwrap())
            );
        }
        let effective = format!("identityagent {}\n", explicit.display());
        assert_eq!(
            selected_agent_socket(&effective, Some(ambient.as_os_str())).unwrap(),
            Some(explicit.canonicalize().unwrap())
        );
        assert_eq!(
            selected_agent_socket(&effective, None).unwrap(),
            Some(explicit.canonicalize().unwrap())
        );
        let file = dir.path().join("not-a-socket");
        std::fs::write(&file, b"fixture").unwrap();
        assert!(selected_agent_socket("", Some(file.as_os_str())).is_err());
    }
    #[test]
    fn deny_all_wins_over_empty_and_nonempty_grants() {
        for allow in [vec![], vec!["example.com".into()]] {
            let cfg = NetworkConfig { deny_all: true, allow, ..Default::default() };
            assert!(!allowed("example.com", &cfg));
            assert!(!allowed("api.example.com", &cfg));
        }
    }

    #[test]
    fn domain_policy_has_deny_precedence() {
        let cfg = NetworkConfig {
            allow: vec!["example.com".into()],
            block: vec!["bad.example.com".into()],
            ..Default::default()
        };
        assert!(allowed("api.example.com", &cfg));
        assert!(!allowed("bad.example.com", &cfg));
        assert!(!allowed("example.com.attacker.net", &cfg));
    }
}
