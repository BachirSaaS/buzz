//! Private launch material and trustworthy, generation-scoped local status.
use super::super::{BackendKind, ManagedAgentProcess, ManagedAgentRecord};
use std::path::Path;

pub(super) fn configure(
    command: &mut std::process::Command,
    record: &ManagedAgentRecord,
    agent_command: &str,
    acp: &Path,
) -> Result<Option<tempfile::TempDir>, String> {
    command
        .env_remove("BUZZ_ACP_SECURITY_POLICY")
        .env_remove("BUZZ_ACP_SECURITY_STATUS");
    let Some(mut policy) = record.security_policy.clone() else {
        return Ok(None);
    };
    if !cfg!(target_os = "macos") || record.backend != BackendKind::Local {
        return Err("Sandpit security requires a local macOS agent".into());
    }
    if !super::super::known_acp_runtime(agent_command).is_some_and(|r| r.supports_sandpit()) {
        return Err("This proof of concept supports Sandpit with Buzz Agent only".into());
    }
    if record.acp_command != "buzz-acp" {
        return Err("Security requires the bundled buzz-acp harness".into());
    }
    policy.validate().map_err(|e| e.to_string())?;
    // The bundled harness responds before configuration, credentials, or relay startup.
    let mut probe = std::process::Command::new(acp);
    probe.arg("security-info").env_clear();
    let output = super::super::discovery::bounded_command::output_with_timeout(
        probe,
        std::time::Duration::from_secs(5),
    )
    .ok_or("Security harness check failed or timed out")?;
    if !output.status.success() || output.stdout != b"buzz-acp-security-v1\n" {
        return Err("The selected Buzz harness does not support security; rebuild the demo".into());
    }
    let dir = tempfile::Builder::new()
        .prefix("buzz-desktop-security-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let source = dir.path().join("policy.json");
    std::fs::write(
        &source,
        serde_json::to_vec(&policy).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if let Some(root) = policy
        .writable_roots
        .as_ref()
        .and_then(|roots| roots.first())
    {
        command.current_dir(root);
    }
    command
        .env("BUZZ_ACP_SECURITY_POLICY", source)
        .env("BUZZ_ACP_SECURITY_STATUS", dir.path().join("protected"));
    Ok(Some(dir))
}

pub(super) fn status(record: &ManagedAgentRecord, process: Option<&ManagedAgentProcess>) -> String {
    if record.security_policy.is_none() {
        return "Off".into();
    }
    let Some(process) = process else {
        return "Not running".into();
    };
    let Some(dir) = &process.security_launch else {
        return "Restart required".into();
    };
    use std::io::Read;
    let mut digest = String::new();
    let valid = std::fs::File::open(dir.path().join("protected"))
        .and_then(|f| f.take(65).read_to_string(&mut digest))
        .is_ok()
        && digest.len() == 64
        && digest.bytes().all(|c| c.is_ascii_hexdigit());
    if valid {
        "Protected"
    } else {
        "Waiting for agent"
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record() -> ManagedAgentRecord {
        serde_json::from_value(serde_json::json!({
            "pubkey": "local", "name": "Security test", "relay_url": "", "acp_command": "buzz-acp",
            "agent_command": "buzz-agent", "agent_args": [], "mcp_command": "",
            "turn_timeout_seconds": 0, "system_prompt": null, "created_at": "",
            "updated_at": "", "last_started_at": null, "last_stopped_at": null,
            "last_exit_code": null, "last_error": null
        }))
        .unwrap()
    }
    fn policy(root: &Path) -> buzz_security_policy::SecurityPolicy {
        buzz_security_policy::SecurityPolicy {
            schema_version: 1,
            writable_roots: Some(vec![root.to_path_buf()]),
            denied_reads: vec![],
            denied_writes: vec![],
            network: buzz_security_policy::NetworkPolicy::DenyAll,
            environment: vec![],
        }
    }
    #[test]
    fn off_scrubs_ambient_enforcement_and_does_not_probe() {
        let record = record();
        let mut cmd = std::process::Command::new("unused");
        cmd.env("BUZZ_ACP_SECURITY_POLICY", "untrusted")
            .env("BUZZ_ACP_SECURITY_STATUS", "untrusted");
        assert!(
            configure(&mut cmd, &record, "buzz-agent", Path::new("missing"))
                .unwrap()
                .is_none()
        );
        assert!(cmd
            .get_envs()
            .filter(|(key, _)| key.to_string_lossy().starts_with("BUZZ_ACP_SECURITY_"))
            .all(|(_, value)| value.is_none()));
        assert_eq!(status(&record, None), "Off");
    }
    #[test]
    fn desired_policy_is_never_claimed_as_running_evidence() {
        let root = tempfile::tempdir().unwrap();
        let mut record = record();
        record.security_policy = Some(policy(root.path()));
        assert_eq!(status(&record, None), "Not running");
        let mut cmd = std::process::Command::new("unused");
        assert!(configure(&mut cmd, &record, "codex-acp", Path::new("missing")).is_err());
        record.backend = BackendKind::Provider {
            id: "test".into(),
            config: serde_json::json!({}),
        };
        assert!(configure(&mut cmd, &record, "buzz-agent", Path::new("missing")).is_err());
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn absent_or_custom_harness_cannot_silently_drop_policy() {
        let root = tempfile::tempdir().unwrap();
        let mut record = record();
        record.security_policy = Some(policy(root.path()));
        let mut cmd = std::process::Command::new("unused");
        assert!(configure(
            &mut cmd,
            &record,
            "buzz-agent",
            Path::new("/definitely-missing-buzz-acp")
        )
        .is_err());
        record.acp_command = "custom-harness".into();
        assert!(
            configure(&mut cmd, &record, "buzz-agent", Path::new("/usr/bin/true"))
                .unwrap_err()
                .contains("bundled")
        );
        record.acp_command = "buzz-acp".into();
        assert!(
            configure(&mut cmd, &record, "buzz-agent", Path::new("/usr/bin/true"))
                .unwrap_err()
                .contains("does not support")
        );
    }
}
