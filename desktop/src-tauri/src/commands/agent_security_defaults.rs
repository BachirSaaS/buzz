use tauri::{AppHandle, State};

use crate::{
    app_state::AppState,
    managed_agents::security_defaults::{self, AgentSecurityDefaults},
};

/// Read the native, machine-local security experiment settings.
#[tauri::command]
pub fn get_agent_security_defaults(app: AppHandle) -> Result<AgentSecurityDefaults, String> {
    security_defaults::load(&app)
}

/// Atomically save defaults for future agents without changing existing policies.
#[tauri::command]
pub fn set_agent_security_defaults(
    settings: AgentSecurityDefaults,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AgentSecurityDefaults, String> {
    let _guard = state
        .managed_agents_store_lock
        .lock()
        .map_err(|e| e.to_string())?;
    security_defaults::save(&app, settings)
}
