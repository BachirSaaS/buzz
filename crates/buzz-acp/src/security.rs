//! Local macOS proof-of-concept policy. One immutable policy per harness process.
//! This is host confinement, not enterprise authority or Buzz publication control.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use anyhow::{bail, ensure, Context, Result};
use sha2::{Digest, Sha256};

pub(crate) use buzz_security_policy::{reserved, NetworkPolicy, SecurityPolicy};

/// Validated policy and private engine snapshot retained for the harness lifetime.
pub(crate) struct LaunchPolicy {
    pub digest: String,
    engine: PathBuf,
    engine_digest: String,
    snapshot: tempfile::TempDir,
    policy: SecurityPolicy,
    status_path: Option<PathBuf>,
    runtime_temp: tempfile::TempDir,
    auth_listener: std::sync::Mutex<Option<std::net::TcpListener>>,
    auth_port: u16,
    auth_broker: tokio::sync::OnceCell<(String, tokio::task::JoinHandle<()>)>,
}

static POLICY: OnceLock<Result<Option<LaunchPolicy>, String>> = OnceLock::new();

/// Load once before any agent or helper executes. Later file/env edits cannot
/// change replacement workers. Invalid input is a sticky error, never an opt-out.
pub(crate) fn configured() -> Result<Option<&'static LaunchPolicy>> {
    match POLICY.get_or_init(|| {
        let Some(path) = std::env::var_os("BUZZ_ACP_SECURITY_POLICY") else {
            return Ok(None);
        };
        (|| {
            let path = PathBuf::from(path);
            let bytes = read_policy(&path)?;
            ensure!(bytes.len() <= 64 * 1024, "security policy exceeds 64 KiB");
            let policy: SecurityPolicy = serde_json::from_slice(&bytes)?;
            LaunchPolicy::resolve(policy, &path).map(Some)
        })()
        .map_err(|e: anyhow::Error| format!("security unavailable: {e:#}"))
    }) {
        Ok(policy) => Ok(policy.as_ref()),
        Err(message) => bail!("{message}"),
    }
}

/// Remove the private launch snapshot on orderly harness exit. A killed process
/// may leave a private temp directory; engine session leases remain separate.
pub(crate) fn cleanup() -> Result<()> {
    if let Some(Ok(Some(policy))) = POLICY.get() {
        if let Some((_, task)) = policy.auth_broker.get() {
            task.abort();
        }
        std::fs::remove_dir_all(policy.snapshot.path())
            .context("cannot remove private launch snapshot")?;
        std::fs::remove_dir_all(policy.runtime_temp.path())
            .context("cannot remove runtime temp directory")?;
    }
    Ok(())
}

/// Configure the local interactive demo without mutating process environment.
pub(crate) fn install_file(path: &Path) -> Result<()> {
    let bytes = read_policy(path)?;
    ensure!(bytes.len() <= 64 * 1024, "security policy exceeds 64 KiB");
    let policy: SecurityPolicy = serde_json::from_slice(&bytes)?;
    let resolved = LaunchPolicy::resolve(policy, path)?;
    POLICY
        .set(Ok(Some(resolved)))
        .map_err(|_| anyhow::anyhow!("security policy already initialized"))
}

fn read_policy(path: &Path) -> Result<Vec<u8>> {
    let file = std::fs::File::open(path).context("cannot read security policy")?;
    let mut bytes = Vec::new();
    file.take(64 * 1024 + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 64 * 1024, "security policy exceeds 64 KiB");
    Ok(bytes)
}

impl LaunchPolicy {
    fn resolve(mut policy: SecurityPolicy, source: &Path) -> Result<Self> {
        ensure!(
            cfg!(target_os = "macos"),
            "Sandpit protection requires local macOS"
        );
        policy.validate()?;
        let exe = std::env::current_exe()?.canonicalize()?;
        let engine = exe
            .parent()
            .context("missing executable directory")?
            .join("buzz-sandpit")
            .canonicalize()
            .context("bundled buzz-sandpit is missing; run just sandpit-poc-build")?;
        let engine_digest = hex::encode(Sha256::digest(std::fs::read(&engine)?));
        let digest = hex::encode(Sha256::digest(serde_json::to_vec(&policy)?));
        let snapshot = tempfile::Builder::new()
            .prefix("buzz-security-")
            .tempdir()?;
        let runtime_temp = tempfile::Builder::new()
            .prefix("buzz-agent-temp-")
            .tempdir()?;
        let runtime_temp_root = runtime_temp.path().canonicalize()?;
        let mut blocked = policy.denied_writes.clone();
        blocked.push(snapshot.path().canonicalize()?);
        blocked.push(engine.clone());
        blocked.push(exe);
        blocked.push(source.canonicalize()?);
        let status_path = std::env::var_os("BUZZ_ACP_SECURITY_STATUS").map(PathBuf::from);
        if let Some(path) = &status_path {
            let parent = path
                .parent()
                .context("missing security status directory")?
                .canonicalize()?;
            ensure!(
                path.is_absolute() && path.file_name().is_some(),
                "invalid security status path"
            );
            blocked.push(parent);
        }
        let auth_listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        auth_listener.set_nonblocking(true)?;
        let auth_port = auth_listener.local_addr()?.port();
        let roots = rustls_native_certs::load_native_certs();
        ensure!(
            !roots.certs.is_empty(),
            "no native TLS trust roots available"
        );
        let roots: Vec<Vec<u8>> = roots
            .certs
            .iter()
            .map(|cert| cert.as_ref().to_vec())
            .collect();
        std::fs::write(
            snapshot.path().join("tls-roots.json"),
            serde_json::to_vec(&roots)?,
        )?;
        let (deny_all, allow, mut local_ports) = match &policy.network {
            NetworkPolicy::Unrestricted => (false, vec![], vec![]),
            NetworkPolicy::DenyAll => (true, vec![], vec![]),
            NetworkPolicy::Allowlist { destinations } => {
                let ports: Vec<_> = destinations
                    .iter()
                    .filter_map(|d| buzz_security_policy::loopback_port(d))
                    .collect();
                let domains: Vec<_> = destinations
                    .iter()
                    .filter(|d| buzz_security_policy::loopback_port(d).is_none())
                    .cloned()
                    .collect();
                (domains.is_empty(), domains, ports)
            }
        };
        // Child-process APIs open /dev/null for disconnected stdin/stdout.
        // This fixed sink grants no ordinary file storage or readable secrets.
        let writable = policy
            .writable_roots
            .as_ref()
            .map(|roots| {
                let mut roots = roots.clone();
                roots.push(PathBuf::from("/dev/null"));
                roots.push(runtime_temp_root.clone());
                roots
            })
            .unwrap_or_default();
        if !deny_all {
            local_ports.push(auth_port);
        }
        let config = serde_json::json!({
            "files": {"allow_write": writable,
                "block_read": policy.denied_reads, "block_write": blocked},
            "network": {"deny_all": deny_all, "allow": allow, "allow_loopback_ports": local_ports},
        });
        std::fs::write(
            snapshot.path().join("policy.toml"),
            toml::to_string(&config)?,
        )?;
        Ok(Self {
            digest,
            engine,
            engine_digest,
            snapshot,
            policy,
            status_path,
            runtime_temp,
            auth_listener: std::sync::Mutex::new(Some(auth_listener)),
            auth_port,
            auth_broker: tokio::sync::OnceCell::new(),
        })
    }

    pub(crate) fn record_protected(&self) -> Result<()> {
        if let Some(path) = &self.status_path {
            use std::io::Write;
            let mut pending =
                tempfile::NamedTempFile::new_in(path.parent().context("missing status parent")?)?;
            pending.write_all(self.digest.as_bytes())?;
            pending.persist(path)?;
        }
        Ok(())
    }

    pub(crate) async fn command(
        &self,
        original: &str,
        extra_env: &[(String, String)],
    ) -> Result<tokio::process::Command> {
        let identity = crate::config::normalize_agent_command_identity(original);
        ensure!(
            !matches!(identity.as_str(), "codex" | "codex-acp"),
            "Codex ACP external-sandbox compatibility is not validated; refusing protected launch"
        );
        ensure!(
            hex::encode(Sha256::digest(std::fs::read(&self.engine)?)) == self.engine_digest,
            "bundled security engine changed; restart the harness"
        );
        let mut probe = tokio::process::Command::new(&self.engine);
        probe.arg("managed-info").kill_on_drop(true).env_clear();
        let output =
            tokio::time::timeout(std::time::Duration::from_secs(5), probe.output()).await??;
        ensure!(
            output.status.success() && output.stdout == b"buzz-sandpit-managed-v1\n",
            "incompatible bundled security engine"
        );
        let mut cmd = tokio::process::Command::new(&self.engine);
        cmd.args([
            "run",
            "--managed",
            "--no-adversary",
            "--no-shims",
            "--config",
        ])
        .arg(self.snapshot.path().join("policy.toml"))
        .arg("--")
        .arg(original);
        cmd.env_clear();
        for (key, value) in std::env::vars_os() {
            if self.allows_env(&key.to_string_lossy()) {
                cmd.env(key, value);
            }
        }
        cmd.env("TMPDIR", self.runtime_temp.path());
        if identity == "buzz-agent" {
            cmd.env(
                buzz_agent::sandbox_runtime::ROOTS_ENV,
                self.snapshot.path().join("tls-roots.json"),
            );
            let value = |key: &str| -> Option<String> {
                if !self.allows_env(key) {
                    return None;
                }
                std::env::var(key).ok().or_else(|| {
                    extra_env
                        .iter()
                        .find(|(k, _)| k == key)
                        .map(|(_, v)| v.clone())
                })
            };
            let provider = value("BUZZ_AGENT_PROVIDER").unwrap_or_default();
            if matches!(
                provider.as_str(),
                "databricks" | "databricks_v2" | "databricks-v2"
            ) && value("DATABRICKS_TOKEN").is_none_or(|v| v.is_empty())
                && !matches!(self.policy.network, NetworkPolicy::DenyAll)
            {
                let host = value("DATABRICKS_HOST").context("missing Databricks workspace")?;
                let parsed = url::Url::parse(&host)?;
                let domain = parsed.host_str().context("missing workspace hostname")?;
                ensure!(
                    parsed.scheme() == "https"
                        && parsed.username().is_empty()
                        && parsed.password().is_none(),
                    "invalid workspace URL"
                );
                if let NetworkPolicy::Allowlist { destinations } = &self.policy.network {
                    ensure!(
                        destinations
                            .iter()
                            .any(|d| domain == d || domain.ends_with(&format!(".{d}"))),
                        "workspace excluded by security policy"
                    );
                }
                let (serialized, _) = self
                    .auth_broker
                    .get_or_try_init(|| async {
                        let listener = self
                            .auth_listener
                            .lock()
                            .map_err(|_| anyhow::anyhow!("auth listener poisoned"))?
                            .take()
                            .context("auth listener already consumed")?;
                        let listener = tokio::net::TcpListener::from_std(listener)?;
                        let secret = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
                        let task =
                            buzz_agent::sandbox_runtime::serve(listener, &host, secret.clone())?;
                        let config = buzz_agent::sandbox_runtime::BrokerConfig {
                            port: self.auth_port,
                            secret,
                            host: host.clone(),
                        };
                        Ok::<_, anyhow::Error>((serde_json::to_string(&config)?, task))
                    })
                    .await?;
                let broker: buzz_agent::sandbox_runtime::BrokerConfig =
                    serde_json::from_str(serialized)?;
                ensure!(
                    broker.host == host,
                    "provider changed; restart protected harness"
                );
                cmd.env(buzz_agent::sandbox_runtime::BROKER_ENV, serialized);
            }
        }
        Ok(cmd)
    }

    pub(crate) fn allows_env(&self, key: &str) -> bool {
        !reserved(key)
            && (matches!(
                key,
                "HOME"
                    | "PATH"
                    | "TMPDIR"
                    | "LANG"
                    | "LC_ALL"
                    | "LC_CTYPE"
                    | "BUZZ_AGENT_CONFIG_DIR"
            ) || self.policy.environment.iter().any(|name| name == key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn policy() -> SecurityPolicy {
        SecurityPolicy {
            schema_version: 1,
            writable_roots: None,
            denied_reads: vec![],
            denied_writes: vec![],
            network: NetworkPolicy::Unrestricted,
            environment: vec![],
        }
    }
    #[test]
    fn empty_network_grant_stays_deny_all() {
        let mut p = policy();
        p.network = NetworkPolicy::Allowlist {
            destinations: vec![],
        };
        p.validate().unwrap();
        assert!(matches!(p.network, NetworkPolicy::DenyAll));
    }
    #[test]
    fn reject_unrepresentable_or_ambiguous_policy() {
        let mut p = policy();
        p.writable_roots = Some(vec![]);
        assert!(p.validate().is_err());
        for name in [
            "DYLD_INSERT_LIBRARIES",
            "SANDPIT_CONFIG",
            "BUZZ_ACP_SECURITY_POLICY",
            "BUZZ_SANDBOX_AUTH_BROKER",
            "BUZZ_SANDBOX_TLS_ROOTS",
        ] {
            let mut p = policy();
            p.environment.push(name.into());
            assert!(p.validate().is_err());
        }
        for host in [
            "https://example.com",
            "*.example.com",
            "127.0.0.1",
            "example.com/repo",
            "example.com:443",
        ] {
            let mut p = policy();
            p.network = NetworkPolicy::Allowlist {
                destinations: vec![host.into()],
            };
            assert!(p.validate().is_err(), "{host}");
        }
    }
    #[test]
    fn strict_schema_roundtrip_and_version() {
        let p = policy();
        let encoded = serde_json::to_value(&p).unwrap();
        let mut decoded: SecurityPolicy = serde_json::from_value(encoded.clone()).unwrap();
        decoded.validate().unwrap();
        decoded.schema_version = 2;
        assert!(decoded.validate().is_err());
        let mut unknown = encoded;
        unknown["required"] = true.into();
        assert!(serde_json::from_value::<SecurityPolicy>(unknown).is_err());
    }
}
