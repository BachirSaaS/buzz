//! Machine-local, copy-on-create defaults for the Sandpit experiment.
use std::{io::Read, path::Path};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::{AgentDefinition, BackendKind, ManagedAgentRecord};

/// Local experiment preference and policy copied into newly created agents.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentSecurityDefaults {
    /// Show experimental controls and enable assignment of the default.
    #[serde(default)]
    pub experimental_enabled: bool,
    /// Existing agents retain their own policy when this default changes.
    #[serde(default)]
    pub policy: Option<buzz_security_policy::SecurityPolicy>,
}

fn path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(super::storage::managed_agents_base_dir(app)?.join("security-defaults.json"))
}

fn load_path(path: &Path) -> Result<AgentSecurityDefaults, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AgentSecurityDefaults::default());
        }
        Err(error) => return Err(format!("Could not read security defaults: {error}")),
    };
    let mut bytes = Vec::new();
    file.take(131_073)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 131_072 {
        return Err("Security defaults exceed the size limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("Could not parse security defaults: {e}"))
}

pub(crate) fn load(app: &AppHandle) -> Result<AgentSecurityDefaults, String> {
    load_path(&path(app)?)
}

fn save_path(
    path: &Path,
    mut settings: AgentSecurityDefaults,
) -> Result<AgentSecurityDefaults, String> {
    let previous = load_path(path)?;
    let policy_changed = previous.policy != settings.policy;
    // A deleted folder must not trap the user outside the editor: toggle-only
    // saves preserve the draft, while every new instance validates it again.
    if policy_changed {
        if !settings.experimental_enabled {
            return Err("Enable experimental agent security before changing its defaults".into());
        }
        if let Some(policy) = &mut settings.policy {
            policy.validate().map_err(|e| e.to_string())?;
        }
    }
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    super::storage::atomic_write_json_restricted(path, &bytes)?;
    Ok(settings)
}

pub(crate) fn save(
    app: &AppHandle,
    settings: AgentSecurityDefaults,
) -> Result<AgentSecurityDefaults, String> {
    save_path(&path(app)?, settings)
}

fn selected_policy(
    settings: AgentSecurityDefaults,
    record: &ManagedAgentRecord,
    agent_command: &str,
) -> Result<Option<buzz_security_policy::SecurityPolicy>, String> {
    if !settings.experimental_enabled
        || record.backend != BackendKind::Local
        || record.acp_command != super::DEFAULT_ACP_COMMAND
        || !super::known_acp_runtime(agent_command).is_some_and(|r| r.supports_sandpit())
    {
        return Ok(None);
    }
    let mut policy = settings.policy;
    if let Some(policy) = &mut policy {
        policy.validate().map_err(|e| e.to_string())?;
    }
    Ok(policy)
}

/// Assign once at local identity creation; never call on restart or definition storage.
pub(crate) fn apply_to_new(
    app: &AppHandle,
    record: &mut ManagedAgentRecord,
    definitions: &[AgentDefinition],
) -> Result<(), String> {
    if record.security_policy.is_some() {
        return Ok(());
    }
    apply_at_path(&path(app)?, record, definitions)?;
    if let Some(mut policy) = record.security_policy.clone() {
        preserve_connections(app, record, definitions, &mut policy)?;
        record.security_policy = Some(policy);
    }
    Ok(())
}

fn apply_at_path(
    path: &Path,
    record: &mut ManagedAgentRecord,
    definitions: &[AgentDefinition],
) -> Result<(), String> {
    if record.backend != BackendKind::Local || record.security_policy.is_some() {
        return Ok(());
    }
    let command = super::try_record_agent_command(record, definitions)?;
    if record.acp_command != super::DEFAULT_ACP_COMMAND
        || !super::known_acp_runtime(&command).is_some_and(|r| r.supports_sandpit())
    {
        return Ok(());
    }
    record.security_policy = selected_policy(load_path(path)?, record, &command)?;
    Ok(())
}

/// Apply an explicit instance edit only while the experiment is enabled.
pub(crate) fn update_policy(
    app: &AppHandle,
    record: &mut ManagedAgentRecord,
    policy: Option<buzz_security_policy::SecurityPolicy>,
) -> Result<(), String> {
    if record.security_policy == policy {
        return Ok(());
    }
    let mut policy = policy;
    if let Some(value) = &mut policy {
        let definitions = super::load_personas(app)?;
        preserve_connections(app, record, &definitions, value)?;
    }
    update_policy_at_path(&path(app)?, record, policy)
}

fn preserve_connections(
    app: &AppHandle,
    record: &ManagedAgentRecord,
    definitions: &[AgentDefinition],
    policy: &mut buzz_security_policy::SecurityPolicy,
) -> Result<(), String> {
    if matches!(
        policy.network,
        buzz_security_policy::NetworkPolicy::Allowlist { .. }
    ) {
        let global = super::load_global_agent_config(app)?;
        let state = app.state::<crate::app_state::AppState>();
        let relay = crate::relay::relay_ws_url_with_override(&state);
        super::security_connections::preserve_required(
            policy,
            super::security_connections::for_record(record, definitions, &global, &relay),
        );
        policy.validate().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn update_policy_at_path(
    path: &Path,
    record: &mut ManagedAgentRecord,
    mut policy: Option<buzz_security_policy::SecurityPolicy>,
) -> Result<(), String> {
    if record.security_policy == policy {
        return Ok(());
    }
    if !load_path(path)?.experimental_enabled {
        return Err(
            "Enable experimental agent security before changing this agent's protection".into(),
        );
    }
    if record.backend != BackendKind::Local {
        return Err("Security settings are available only for local agents".into());
    }
    if let Some(value) = &mut policy {
        value.validate().map_err(|e| e.to_string())?;
    }
    record.security_policy = policy;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instance() -> ManagedAgentRecord {
        serde_json::from_value(serde_json::json!({
            "pubkey": "test", "name": "test", "relay_url": "", "acp_command": "buzz-acp",
            "agent_command": "buzz-agent", "agent_args": [], "mcp_command": "",
            "turn_timeout_seconds": 0, "system_prompt": null, "created_at": "", "updated_at": "",
            "last_started_at": null, "last_stopped_at": null, "last_exit_code": null, "last_error": null
        })).unwrap()
    }

    fn enabled(root: &Path) -> AgentSecurityDefaults {
        AgentSecurityDefaults {
            experimental_enabled: true,
            policy: Some(buzz_security_policy::SecurityPolicy {
                schema_version: 1,
                writable_roots: Some(vec![root.to_path_buf()]),
                denied_reads: vec![],
                denied_writes: vec![],
                network: buzz_security_policy::NetworkPolicy::DenyAll,
                environment: vec![],
            }),
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn actual_assignment_copies_once_and_corruption_never_mutates_instance() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = save_path(&path, enabled(dir.path())).unwrap();
        let mut record = instance();
        apply_at_path(&path, &mut record, &[]).unwrap();
        assert_eq!(record.security_policy, settings.policy);
        std::fs::write(&path, b"invalid").unwrap();
        apply_at_path(&path, &mut record, &[]).unwrap();
        assert_eq!(record.security_policy, settings.policy);
        let mut new_record = instance();
        assert!(apply_at_path(&path, &mut new_record, &[]).is_err());
        assert!(new_record.security_policy.is_none());
        new_record.agent_command_override = Some("codex-acp".into());
        apply_at_path(&path, &mut new_record, &[]).unwrap();
        assert!(new_record.security_policy.is_none());
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn definition_runtime_controls_new_instance_assignment_without_changing_definition() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = save_path(&path, enabled(dir.path())).unwrap();
        let mut definition: AgentDefinition = serde_json::from_value(serde_json::json!({
            "id": "template", "display_name": "Template", "system_prompt": "test",
            "runtime": "buzz-agent", "created_at": "", "updated_at": ""
        }))
        .unwrap();
        let original = serde_json::to_value(&definition).unwrap();
        let mut record = instance();
        record.persona_id = Some(definition.id.clone());
        apply_at_path(&path, &mut record, std::slice::from_ref(&definition)).unwrap();
        assert_eq!(record.security_policy, settings.policy);
        assert_eq!(serde_json::to_value(&definition).unwrap(), original);
        definition.runtime = Some("codex".into());
        let mut other = instance();
        other.persona_id = Some(definition.id.clone());
        apply_at_path(&path, &mut other, &[definition]).unwrap();
        assert!(other.security_policy.is_none());
    }

    #[test]
    fn stale_default_can_be_disabled_reenabled_and_repaired_but_not_assigned() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("work");
        std::fs::create_dir(&root).unwrap();
        let path = dir.path().join("settings.json");
        let mut settings = save_path(&path, enabled(&root)).unwrap();
        std::fs::remove_dir(&root).unwrap();
        assert_eq!(save_path(&path, settings.clone()).unwrap(), settings);
        settings.experimental_enabled = false;
        assert_eq!(save_path(&path, settings.clone()).unwrap(), settings);
        let mut record = instance();
        apply_at_path(&path, &mut record, &[]).unwrap();
        assert!(record.security_policy.is_none());
        let mut invalid_edit = settings.clone();
        invalid_edit.policy = None;
        assert!(save_path(&path, invalid_edit).is_err());
        settings.experimental_enabled = true;
        assert_eq!(save_path(&path, settings.clone()).unwrap(), settings);
        #[cfg(target_os = "macos")]
        {
            assert!(apply_at_path(&path, &mut record, &[]).is_err());
            assert!(record.security_policy.is_none());
        }
        let repaired = save_path(&path, enabled(dir.path())).unwrap();
        apply_at_path(&path, &mut record, &[]).unwrap();
        #[cfg(target_os = "macos")]
        assert_eq!(record.security_policy, repaired.policy);
        #[cfg(not(target_os = "macos"))]
        assert!(repaired.policy.is_some());
    }

    #[test]
    fn explicit_instance_changes_require_enabled_but_identical_edits_do_not() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = enabled(dir.path());
        let mut record = instance();
        assert!(update_policy_at_path(&path, &mut record, settings.policy.clone()).is_err());
        assert!(record.security_policy.is_none());
        let settings = save_path(&path, settings).unwrap();
        update_policy_at_path(&path, &mut record, settings.policy.clone()).unwrap();
        save_path(
            &path,
            AgentSecurityDefaults {
                experimental_enabled: false,
                ..settings.clone()
            },
        )
        .unwrap();
        assert!(update_policy_at_path(&path, &mut record, None).is_err());
        assert_eq!(record.security_policy, settings.policy);
        std::fs::write(&path, b"invalid").unwrap();
        update_policy_at_path(&path, &mut record, settings.policy).unwrap();
    }

    #[test]
    fn missing_defaults_are_disabled_but_corruption_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        assert_eq!(load_path(&path).unwrap(), AgentSecurityDefaults::default());
        std::fs::write(&path, b"{").unwrap();
        assert!(load_path(&path).is_err());
    }

    #[test]
    fn assignment_requires_experiment_supported_local_runtime_and_bundled_harness() {
        let root = tempfile::tempdir().unwrap();
        let mut record: ManagedAgentRecord = serde_json::from_value(serde_json::json!({
            "pubkey": "test", "name": "test", "relay_url": "", "acp_command": "buzz-acp",
            "agent_command": "buzz-agent", "agent_args": [], "mcp_command": "",
            "turn_timeout_seconds": 0, "system_prompt": null, "created_at": "", "updated_at": "",
            "last_started_at": null, "last_stopped_at": null, "last_exit_code": null, "last_error": null
        })).unwrap();
        let settings = AgentSecurityDefaults {
            experimental_enabled: true,
            policy: Some(buzz_security_policy::SecurityPolicy {
                schema_version: 1,
                writable_roots: Some(vec![root.path().to_path_buf()]),
                denied_reads: vec![],
                denied_writes: vec![],
                network: buzz_security_policy::NetworkPolicy::DenyAll,
                environment: vec![],
            }),
        };
        assert_eq!(
            selected_policy(settings.clone(), &record, "buzz-agent")
                .unwrap()
                .is_some(),
            cfg!(target_os = "macos")
        );
        assert!(selected_policy(settings.clone(), &record, "codex-acp")
            .unwrap()
            .is_none());
        assert!(selected_policy(
            AgentSecurityDefaults {
                experimental_enabled: false,
                ..settings.clone()
            },
            &record,
            "buzz-agent"
        )
        .unwrap()
        .is_none());
        record.acp_command = "custom".into();
        assert!(selected_policy(settings.clone(), &record, "buzz-agent")
            .unwrap()
            .is_none());
        record.acp_command = "buzz-acp".into();
        record.backend = BackendKind::Provider {
            id: "remote".into(),
            config: serde_json::json!({}),
        };
        assert!(selected_policy(settings, &record, "buzz-agent")
            .unwrap()
            .is_none());
    }

    #[test]
    fn save_normalizes_and_invalid_save_preserves_previous_settings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut settings = AgentSecurityDefaults {
            experimental_enabled: true,
            policy: Some(buzz_security_policy::SecurityPolicy {
                schema_version: 1,
                writable_roots: Some(vec![dir.path().to_path_buf()]),
                denied_reads: vec![],
                denied_writes: vec![],
                network: buzz_security_policy::NetworkPolicy::DenyAll,
                environment: vec![],
            }),
        };
        settings = save_path(&path, settings).unwrap();
        let saved = settings.clone();
        settings.policy.as_mut().unwrap().schema_version = 999;
        assert!(save_path(&path, settings).is_err());
        assert_eq!(load_path(&path).unwrap(), saved);
        let disabled = AgentSecurityDefaults {
            experimental_enabled: false,
            ..saved
        };
        assert_eq!(save_path(&path, disabled.clone()).unwrap(), disabled);
        assert!(load_path(&path).unwrap().policy.is_some());
    }
}
