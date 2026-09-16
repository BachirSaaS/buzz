#![deny(unsafe_code)]
//! Private host-local confinement policy shared by Desktop and the ACP harness.
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

/// Private, host-local policy input; never publish this in a persona.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SecurityPolicy {
    /// Currently only version 1 is supported.
    pub schema_version: u32,
    /// Absolute directory roots writable by the agent. None means unrestricted;
    /// an empty list is rejected rather than interpreted as unrestricted.
    pub writable_roots: Option<Vec<PathBuf>>,
    /// Absolute file or directory paths denied for reads.
    #[serde(default)]
    pub denied_reads: Vec<PathBuf>,
    /// Absolute file or directory paths denied for writes.
    #[serde(default)]
    pub denied_writes: Vec<PathBuf>,
    /// Explicit destination policy.
    pub network: NetworkPolicy,
    /// Extra environment names to deliver to the agent, including provider keys.
    /// HOME, PATH, TMPDIR, LANG and locale variables are always passed.
    #[serde(default)]
    pub environment: Vec<String>,
}

/// Domain grants include the named domain and its subdomains.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum NetworkPolicy {
    /// No network confinement requested.
    Unrestricted,
    /// No network destinations permitted.
    DenyAll,
    /// Public HTTP(S) destinations only. Private IPs and local services fail closed.
    Allowlist { destinations: Vec<String> },
}

fn canonical_policy_path(path: &Path) -> Result<PathBuf> {
    ensure!(
        path.is_absolute(),
        "security paths must be absolute: {}",
        path.display()
    );
    ensure!(
        !path.components().any(|p| matches!(p, Component::ParentDir)),
        "security paths cannot contain '..'"
    );
    // Restrict the PoC to existing paths: no ambiguous missing-prefix grants.
    path.canonicalize()
        .with_context(|| format!("security path must exist: {}", path.display()))
}

impl SecurityPolicy {
    /// Normalize existing paths and reject ambiguous or unsupported grants.
    pub fn validate(&mut self) -> Result<()> {
        ensure!(
            serde_json::to_vec(self)?.len() <= 64 * 1024,
            "security policy exceeds 64 KiB"
        );
        ensure!(
            self.schema_version == 1,
            "unsupported security schema version"
        );
        if let Some(roots) = &mut self.writable_roots {
            ensure!(!roots.is_empty(), "empty writable_roots means deny-all, which this PoC cannot yet represent; refusing launch");
            for root in roots {
                *root = canonical_policy_path(root)?;
                ensure!(root.is_dir(), "writable roots must be directories");
            }
        }
        for path in self.denied_reads.iter_mut().chain(&mut self.denied_writes) {
            *path = canonical_policy_path(path)?;
        }
        if let NetworkPolicy::Allowlist { destinations } = &mut self.network {
            for host in destinations.iter_mut() {
                *host = host.to_ascii_lowercase();
                if loopback_port(host).is_some() {
                    continue;
                }
                ensure!(
                    host.len() <= 253
                        && host.contains('.')
                        && host.parse::<std::net::IpAddr>().is_err()
                        && host.split('.').all(|label| !label.is_empty()
                            && label.len() <= 63
                            && !label.starts_with('-')
                            && !label.ends_with('-')
                            && label
                                .bytes()
                                .all(|c| c.is_ascii_alphanumeric() || c == b'-')),
                    "destinations must be DNS names or explicit localhost:port endpoints"
                );
            }
            destinations.sort();
            destinations.dedup();
            if destinations.is_empty() {
                self.network = NetworkPolicy::DenyAll;
            }
        }
        for key in &self.environment {
            ensure!(
                !reserved(key)
                    && key
                        .as_bytes()
                        .first()
                        .is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_')
                    && key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_'),
                "reserved or invalid security environment name: {key}"
            );
        }
        Ok(())
    }
}

/// Whether an environment key controls enforcement rather than the agent.
pub fn reserved(key: &str) -> bool {
    key.starts_with("SANDPIT_")
        || key.starts_with("DYLD_")
        || key.starts_with("BUZZ_ACP_SECURITY_")
        || matches!(key, "LD_PRELOAD" | "LD_LIBRARY_PATH")
}

/// Parse an explicitly granted local TCP service; no wildcard or port-zero grant.
pub fn loopback_port(value: &str) -> Option<u16> {
    value
        .strip_prefix("localhost:")?
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
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
            network: NetworkPolicy::DenyAll,
            environment: vec![],
        }
    }
    #[test]
    fn local_services_require_a_specific_nonzero_port() {
        for endpoint in [
            "localhost:0",
            "localhost:*",
            "localhost:65536",
            "127.0.0.1",
            "http://localhost:3000",
        ] {
            let mut p = policy();
            p.network = NetworkPolicy::Allowlist {
                destinations: vec![endpoint.into()],
            };
            assert!(p.validate().is_err(), "{endpoint}");
        }
        let mut p = policy();
        p.network = NetworkPolicy::Allowlist {
            destinations: vec!["localhost:3000".into(), "EXAMPLE.COM".into()],
        };
        p.validate().unwrap();
        assert_eq!(loopback_port("localhost:3000"), Some(3000));
    }
    #[test]
    fn oversized_and_reserved_environment_grants_are_rejected() {
        let mut p = policy();
        p.environment = vec!["x".repeat(65536)];
        assert!(p.validate().is_err());
        for name in [
            "BUZZ_ACP_SECURITY_STATUS",
            "DYLD_INSERT_LIBRARIES",
            "9INVALID",
        ] {
            p.environment = vec![name.into()];
            assert!(p.validate().is_err());
        }
    }
}
