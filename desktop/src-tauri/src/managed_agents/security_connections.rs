//! Required network destinations resolved independently of security defaults.
use super::{AgentDefinition, GlobalAgentConfig, ManagedAgentRecord};

pub(crate) fn for_record(
    record: &ManagedAgentRecord,
    definitions: &[AgentDefinition],
    global: &GlobalAgentConfig,
    current_relay: &str,
) -> Vec<String> {
    let command = super::record_agent_command(record, definitions);
    let runtime = super::known_acp_runtime(&command);
    if record.backend != super::BackendKind::Local || !runtime.is_some_and(|r| r.supports_sandpit())
    {
        return vec![];
    }
    domains(
        &crate::relay::effective_agent_relay_url(&record.relay_url, current_relay),
        &super::resolve_effective_agent_env(record, definitions, runtime, global).env,
    )
}

pub(crate) fn for_defaults(global: &GlobalAgentConfig, relay: &str) -> Vec<String> {
    let mut env = super::baked_build_env();
    if let Some(provider) = global.provider.as_ref().filter(|p| !p.trim().is_empty()) {
        env.insert("BUZZ_AGENT_PROVIDER".into(), provider.clone());
    }
    env.extend(global.env_vars.clone());
    #[cfg(feature = "mesh-llm")]
    super::apply_relay_mesh_env(
        &mut env,
        global.provider.as_deref(),
        global.model.as_deref(),
    );
    domains(relay, &env)
}

fn domains(relay: &str, env: &std::collections::BTreeMap<String, String>) -> Vec<String> {
    let endpoint =
        buzz_agent_pkg::config::endpoint::configured_endpoint(|key| env.get(key).cloned());
    let mut domains: Vec<_> = std::iter::once(relay)
        .chain(endpoint.as_deref())
        .filter_map(connection_domain)
        .collect();
    domains.sort();
    domains.dedup();
    domains
}

/// Defaults may add optional domains, but cannot subtract required connections.
/// Explicit Blocked and Unrestricted modes keep their original meaning.
pub(crate) fn preserve_required(
    policy: &mut buzz_security_policy::SecurityPolicy,
    required: Vec<String>,
) {
    if let buzz_security_policy::NetworkPolicy::Allowlist { destinations } = &mut policy.network {
        destinations.extend(required);
        destinations.sort();
        destinations.dedup();
    }
}

fn connection_domain(value: &str) -> Option<String> {
    let url = url::Url::parse(value.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https" | "ws" | "wss") {
        return None;
    }
    let host = url.host_str()?;
    if host == "localhost" || host == "127.0.0.1" || host == "[::1]" {
        return Some(format!("localhost:{}", url.port_or_known_default()?));
    }
    // Sandpit's public allowlist accepts DNS names, not arbitrary IP grants.
    if host.parse::<std::net::IpAddr>().is_ok() || !host.contains('.') {
        return None;
    }
    Some(host.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(target_os = "macos")]
    fn connections_use_agent_provider_and_active_workspace_relay() {
        let record: ManagedAgentRecord = serde_json::from_value(serde_json::json!({
            "pubkey": "test", "name": "test", "relay_url": "wss://agent-relay.example.com",
            "acp_command": "buzz-acp", "agent_command": "buzz-agent", "agent_args": [],
            "mcp_command": "", "turn_timeout_seconds": 0, "system_prompt": null,
            "created_at": "", "updated_at": "", "provider": "databricks_v2",
            "env_vars": {"DATABRICKS_HOST": "https://agent-model.example.com"}
        }))
        .unwrap();
        let global = GlobalAgentConfig {
            provider: Some("anthropic".into()),
            env_vars: [(
                "DATABRICKS_HOST".into(),
                "https://global-model.example.com".into(),
            )]
            .into(),
            ..Default::default()
        };
        assert_eq!(
            for_record(&record, &[], &global, "wss://global-relay.example.com"),
            vec!["agent-model.example.com", "global-relay.example.com"]
        );
    }
    #[test]
    fn global_selected_domains_cannot_remove_agent_connections() {
        let mut policy = buzz_security_policy::SecurityPolicy {
            schema_version: 1,
            writable_roots: None,
            denied_reads: vec![],
            denied_writes: vec![],
            environment: vec![],
            network: buzz_security_policy::NetworkPolicy::Allowlist {
                destinations: vec!["tools.example.com".into()],
            },
        };
        let required = vec!["relay.example.com".into(), "model.example.com".into()];
        preserve_required(&mut policy, required.clone());
        preserve_required(&mut policy, required);
        assert_eq!(
            policy.network,
            buzz_security_policy::NetworkPolicy::Allowlist {
                destinations: vec![
                    "model.example.com".into(),
                    "relay.example.com".into(),
                    "tools.example.com".into()
                ]
            }
        );
        policy.network = buzz_security_policy::NetworkPolicy::DenyAll;
        preserve_required(&mut policy, vec!["relay.example.com".into()]);
        assert_eq!(policy.network, buzz_security_policy::NetworkPolicy::DenyAll);
    }
    #[test]
    fn suggestions_strip_secrets_paths_and_keep_local_service_ports() {
        assert_eq!(
            connection_domain("wss://user:secret@Relay.Example.com/path?token=private"),
            Some("relay.example.com".into())
        );
        assert_eq!(
            connection_domain("http://127.0.0.1:1234/v1"),
            Some("localhost:1234".into())
        );
        assert_eq!(
            connection_domain("https://[::1]/v1"),
            Some("localhost:443".into())
        );
        for url in [
            "file:///tmp/test",
            "not a url",
            "http://192.168.1.1",
            "https://intranet",
        ] {
            assert_eq!(connection_domain(url), None);
        }
    }
}
