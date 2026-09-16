//! Shared proxy logic used by both the standalone proxy binary and the sandpit CLI.

use std::collections::HashSet;
use std::io::Write as IoWrite;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;

/// Lightweight session context for proxy log emissions.
/// Set by the sandpit binary at startup; the standalone proxy binary leaves it unset.
///
/// NOTE: This intentionally duplicates the fields of `otel::SessionContext` because
/// proxy_core lives in the lib crate (used by standalone proxy binaries) while otel
/// is binary-only. If proxy_core ever moves into the binary, consolidate these.
#[derive(Debug, Clone)]
pub struct ProxySessionContext {
    pub session_id: String,
    pub agent_type: String,
    pub user: String,
    pub host: String,
}

static PROXY_SESSION_CTX: Mutex<Option<ProxySessionContext>> = Mutex::new(None);

/// Set the proxy session context (called by sandpit run).
pub fn set_proxy_session_context(ctx: ProxySessionContext) {
    *PROXY_SESSION_CTX.lock().unwrap_or_else(|e| e.into_inner()) = Some(ctx);
}

/// Resolved session fields with "unknown" fallbacks for log call sites.
struct ProxySessionFields {
    session_id: String,
    agent_type: String,
    user: String,
    host: String,
}

impl ProxySessionFields {
    fn session_id(&self) -> &str {
        &self.session_id
    }
    fn agent_type(&self) -> &str {
        &self.agent_type
    }
    fn user(&self) -> &str {
        &self.user
    }
    fn host(&self) -> &str {
        &self.host
    }
}

fn proxy_session_fields() -> ProxySessionFields {
    match PROXY_SESSION_CTX
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
    {
        Some(ctx) => ProxySessionFields {
            session_id: ctx.session_id,
            agent_type: ctx.agent_type,
            user: ctx.user,
            host: ctx.host,
        },
        None => ProxySessionFields {
            session_id: "unknown".to_string(),
            agent_type: "unknown".to_string(),
            user: "unknown".to_string(),
            host: "unknown".to_string(),
        },
    }
}

pub struct Blocklist {
    pub(crate) domains: HashSet<String>,
}

/// Returns true if `host` is an IP literal (v4 or v6), tolerating IPv6
/// bracket form `[::1]`. Used for fail-closed detection of IP-only CONNECT
/// targets that bypass DNS hooks.
fn is_ip_literal(host: &str) -> bool {
    let stripped = host.trim_start_matches('[').trim_end_matches(']');
    stripped.parse::<IpAddr>().is_ok()
}

#[allow(dead_code)]
impl Blocklist {
    pub fn load(path: &str) -> Self {
        let domains = match std::fs::read_to_string(path) {
            Ok(content) => content
                .lines()
                .map(|l| {
                    let l = if let Some(idx) = l.find('#') {
                        &l[..idx]
                    } else {
                        l
                    };
                    l.trim().to_lowercase()
                })
                .filter(|l| !l.is_empty())
                .collect(),
            Err(_) => HashSet::new(),
        };
        if !domains.is_empty() {
            tracing::debug!(count = domains.len(), "loaded blocklist");
        }
        Blocklist { domains }
    }

    pub fn empty() -> Self {
        Blocklist {
            domains: HashSet::new(),
        }
    }

    pub fn from_domains(domains: HashSet<String>) -> Self {
        if !domains.is_empty() {
            tracing::debug!(count = domains.len(), "blocklist from config");
        }
        Blocklist { domains }
    }

    pub fn is_blocked(&self, host: &str) -> bool {
        let h = host.to_lowercase();
        if self.domains.contains(&h) {
            return true;
        }
        let parts: Vec<&str> = h.split('.').collect();
        for i in 1..parts.len() {
            let parent = parts[i..].join(".");
            if parent == h {
                continue;
            }
            if self.domains.contains(&parent) {
                return true;
            }
        }
        false
    }
}

fn reverse_dns(ip: Ipv4Addr) -> String {
    use std::net::IpAddr;
    match dns_lookup::lookup_addr(&IpAddr::V4(ip)) {
        Ok(name) => name,
        Err(_) => ip.to_string(),
    }
}

async fn send_response(stream: &mut TcpStream, code: u16, reason: &str) {
    use tokio::io::AsyncWriteExt;
    let resp = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        code, reason
    );
    let _ = stream.write_all(resp.as_bytes()).await;
}

fn parse_connect_target(target: &str) -> Option<(String, u16)> {
    let colon = target.rfind(':')?;
    let host = &target[..colon];
    if host.is_empty() {
        return None;
    }
    let port: u16 = target[colon + 1..].parse().ok()?;
    Some((host.to_string(), port))
}

fn resolve_host(host: &str) -> String {
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        reverse_dns(ip)
    } else {
        host.to_string()
    }
}

/// CONNECT to a raw IP succeeded, but we have no domain context. Send the
/// 200 response, peek the client's first bytes for a TLS ClientHello SNI,
/// apply blocklist rules against that hostname, then either forward or drop.
async fn sni_inspect_and_proxy(
    buf_reader: tokio::io::BufReader<TcpStream>,
    raw_host: String,
    port: u16,
    blocklist: &Blocklist,
    audit: Option<&AuditLogger>,
) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // Tunnel is established as far as the client knows.
    let prebuf = buf_reader.buffer().to_vec();
    let mut stream = buf_reader.into_inner();
    if stream
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await
        .is_err()
    {
        return;
    }

    // Collect bytes until we can extract SNI (or give up). A TLS ClientHello
    // is small (typically < 1KB); 4KB is plenty.
    let mut buf: Vec<u8> = prebuf;
    let mut tmp = [0u8; 1024];
    let sni = loop {
        if let Some(s) = crate::sni_proxy::extract_sni(&buf) {
            break Some(s);
        }
        if buf.len() >= 4096 {
            break None;
        }
        match tokio::time::timeout(std::time::Duration::from_secs(5), stream.read(&mut tmp)).await {
            Ok(Ok(n)) if n > 0 => buf.extend_from_slice(&tmp[..n]),
            _ => break crate::sni_proxy::extract_sni(&buf),
        }
    };

    let hostname = match sni {
        Some(h) if !h.is_empty() => h,
        _ => {
            if let Some(audit) = audit {
                audit
                    .log(&ConnectionEntry {
                        timestamp: Utc::now(),
                        host: raw_host.clone(),
                        port,
                        method: "CONNECT+SNI".into(),
                        action: "block".into(),
                        reason: "ip-only-no-sni".into(),
                        pid: None,
                        command: None,
                    })
                    .await;
            }
            {
                let sf = proxy_session_fields();
                tracing::warn!(
                    security.event_type = "egress",
                    security.action = "BLOCK",
                    security.threat_type = "data_exfiltration",
                    network.destination = %format!("{raw_host}:{port}"),
                    network.domain = %raw_host,
                    network.egress_kind = "ip",
                    enforcement.rule = "ip-only-no-sni",
                    enforcement.source = "network_proxy",
                    enforcement.mode = "block",
                    session.id = sf.session_id(),
                    session.agent_type = sf.agent_type(),
                    session.user = sf.user(),
                    session.host = sf.host(),
                    "egress blocked: IP-only, no SNI, fail-closed"
                );
            }
            return;
        }
    };

    if blocklist.is_blocked(&hostname) {
        if let Some(audit) = audit {
            audit
                .log(&ConnectionEntry {
                    timestamp: Utc::now(),
                    host: hostname.clone(),
                    port,
                    method: "CONNECT+SNI".into(),
                    action: "block".into(),
                    reason: "blocklist".into(),
                    pid: None,
                    command: None,
                })
                .await;
        }
        {
            let sf = proxy_session_fields();
            tracing::warn!(
                security.event_type = "egress",
                security.action = "BLOCK",
                security.threat_type = "data_exfiltration",
                network.destination = %format!("{hostname}:{port}"),
                network.domain = %hostname,
                network.egress_kind = "sni",
                enforcement.rule = "blocklist",
                enforcement.source = "network_proxy",
                enforcement.mode = "block",
                session.id = sf.session_id(),
                session.agent_type = sf.agent_type(),
                session.user = sf.user(),
                session.host = sf.host(),
                "egress blocked by SNI inspection"
            );
        }
        return;
    }

    if let Some(audit) = audit {
        audit
            .log(&ConnectionEntry {
                timestamp: Utc::now(),
                host: hostname.clone(),
                port,
                method: "CONNECT+SNI".into(),
                action: "allow".into(),
                reason: String::new(),
                pid: None,
                command: None,
            })
            .await;
    }
    {
        let sf = proxy_session_fields();
        tracing::info!(
            security.event_type = "egress",
            security.action = "ALLOW",
            network.destination = %format!("{hostname}:{port}"),
            network.domain = %hostname,
            network.egress_kind = "sni",
            session.id = sf.session_id(),
            session.agent_type = sf.agent_type(),
            session.user = sf.user(),
            session.host = sf.host(),
            "egress allowed"
        );
    }

    let mut remote = match TcpStream::connect((&*raw_host, port)).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(dest = %format!("{raw_host}:{port}"), %e, "connect to origin failed");
            return;
        }
    };
    if !buf.is_empty() && remote.write_all(&buf).await.is_err() {
        return;
    }
    let _ = tokio::io::copy_bidirectional(&mut stream, &mut remote).await;
}

pub async fn handle_connection(
    stream: TcpStream,
    client_addr: SocketAddr,
    blocklist: &Blocklist,
    audit: Option<&AuditLogger>,
) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let mut buf_reader = BufReader::new(stream);

    let mut request_line = String::new();
    if let Err(e) = buf_reader.read_line(&mut request_line).await {
        tracing::warn!(%client_addr, %e, "failed to read request line");
        return;
    }
    let request_line = request_line.trim_end().to_string();
    if request_line.is_empty() {
        return;
    }

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        let mut stream = buf_reader.into_inner();
        send_response(&mut stream, 400, "Bad Request").await;
        return;
    }

    let method = parts[0];
    let target = parts[1];

    // Consume remaining headers
    loop {
        let mut line = String::new();
        if buf_reader.read_line(&mut line).await.is_err() {
            return;
        }
        if line.trim_end().is_empty() {
            break;
        }
    }

    if !method.eq_ignore_ascii_case("CONNECT") {
        let mut stream = buf_reader.into_inner();
        send_response(&mut stream, 405, "Method Not Allowed").await;
        return;
    }

    let (raw_host, port) = match parse_connect_target(target) {
        Some(hp) => hp,
        None => {
            let mut stream = buf_reader.into_inner();
            send_response(&mut stream, 400, "Bad Request").await;
            return;
        }
    };

    let hostname = resolve_host(&raw_host);

    if blocklist.is_blocked(&hostname) || blocklist.is_blocked(&raw_host) {
        if let Some(audit) = audit {
            audit
                .log(&ConnectionEntry {
                    timestamp: Utc::now(),
                    host: hostname.clone(),
                    port,
                    method: "CONNECT".into(),
                    action: "block".into(),
                    reason: "blocklist".into(),
                    pid: None,
                    command: None,
                })
                .await;
        }
        {
            let sf = proxy_session_fields();
            tracing::warn!(
                security.event_type = "egress",
                security.action = "BLOCK",
                security.threat_type = "data_exfiltration",
                network.destination = %format!("{hostname}:{port}"),
                network.domain = %hostname,
                network.egress_kind = "connect",
                enforcement.rule = "blocklist",
                enforcement.source = "network_proxy",
                enforcement.mode = "block",
                session.id = sf.session_id(),
                session.agent_type = sf.agent_type(),
                session.user = sf.user(),
                session.host = sf.host(),
                "egress blocked by proxy"
            );
        }
        let mut stream = buf_reader.into_inner();
        send_response(&mut stream, 403, "Forbidden").await;
        return;
    }

    // IP-only CONNECT: client resolved DNS through a path our hooks can't see
    // (e.g. Bun talks to mDNSResponder via Mach IPC, never touching libc DNS).
    // Fall back to TLS SNI inspection — peek the ClientHello, extract the
    // hostname the client *thinks* it's talking to, and apply blocklist rules
    // against that. If we can't extract SNI (non-TLS, or TLS without SNI),
    // fail closed.
    //
    // Security note: SNI is set by the client, so an attacker could in
    // principle send a fake SNI to bypass a blocklist. But the IP is
    // attacker-controlled too, and the eventual TLS handshake will still
    // be against whatever cert the destination presents — so an attacker
    // can't reach a non-allowed origin by lying about SNI without already
    // having the target's private key.
    if !blocklist.domains.is_empty() && is_ip_literal(&raw_host) {
        sni_inspect_and_proxy(buf_reader, raw_host, port, blocklist, audit).await;
        return;
    }

    if let Some(audit) = audit {
        audit
            .log(&ConnectionEntry {
                timestamp: Utc::now(),
                host: hostname.clone(),
                port,
                method: "CONNECT".into(),
                action: "allow".into(),
                reason: String::new(),
                pid: None,
                command: None,
            })
            .await;
    }
    {
        let sf = proxy_session_fields();
        tracing::info!(
            security.event_type = "egress",
            security.action = "ALLOW",
            network.destination = %format!("{hostname}:{port}"),
            network.domain = %hostname,
            network.egress_kind = "connect",
            session.id = sf.session_id(),
            session.agent_type = sf.agent_type(),
            session.user = sf.user(),
            session.host = sf.host(),
            "egress allowed"
        );
    }

    let mut remote = match TcpStream::connect((&*raw_host, port)).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(dest = %format!("{raw_host}:{port}"), %e, "connect to origin failed");
            let mut stream = buf_reader.into_inner();
            send_response(&mut stream, 502, "Bad Gateway").await;
            return;
        }
    };

    let buffered = buf_reader.buffer().to_vec();
    let mut stream = buf_reader.into_inner();
    if stream
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await
        .is_err()
    {
        return;
    }
    if !buffered.is_empty() {
        if remote.write_all(&buffered).await.is_err() {
            return;
        }
    }

    match tokio::io::copy_bidirectional(&mut stream, &mut remote).await {
        Ok((c2r, r2c)) => {
            tracing::debug!(dest = %format!("{hostname}:{port}"), up = c2r, down = r2c, "closed");
        }
        Err(e) => {
            tracing::debug!(dest = %format!("{hostname}:{port}"), %e, "pipe error");
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionEntry {
    pub timestamp: chrono::DateTime<Utc>,
    pub host: String,
    pub port: u16,
    pub method: String,
    pub action: String,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

#[allow(dead_code)] // used by sni-proxy-test binary
pub struct AuditLogger {
    file: tokio::sync::Mutex<std::fs::File>,
}

impl AuditLogger {
    #[allow(dead_code)] // used by sandpit + sni-proxy-test binaries
    pub fn new(path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        Ok(Self {
            file: tokio::sync::Mutex::new(file),
        })
    }

    pub async fn log(&self, entry: &ConnectionEntry) {
        let mut line = match serde_json::to_string(entry) {
            Ok(l) => l,
            Err(e) => {
                tracing::warn!(%e, "failed to serialize audit entry");
                return;
            }
        };
        line.push('\n');

        let mut f = self.file.lock().await;
        if let Err(e) = f.write_all(line.as_bytes()).and_then(|_| f.flush()) {
            tracing::warn!(%e, "failed to write audit log");
        }
    }
}

#[allow(dead_code)] // used by sni-proxy-test binary
pub fn default_audit_log_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sandpit")
        .join("connections.jsonl")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ip_literal_ipv4() {
        assert!(is_ip_literal("93.184.216.34"));
        assert!(is_ip_literal("127.0.0.1"));
        assert!(is_ip_literal("0.0.0.0"));
    }

    #[test]
    fn ip_literal_ipv6() {
        assert!(is_ip_literal("::1"));
        assert!(is_ip_literal("2001:db8::1"));
        assert!(is_ip_literal("[::1]"));
        assert!(is_ip_literal("[2001:db8::1]"));
    }

    #[test]
    fn ip_literal_hostname_rejected() {
        assert!(!is_ip_literal("example.com"));
        assert!(!is_ip_literal("evil.com"));
        assert!(!is_ip_literal("api.service.internal"));
        assert!(!is_ip_literal(""));
    }
}
