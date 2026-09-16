//! Read-only suggestions; this never grants network access or returns credentials.
use crate::{app_state::AppState, managed_agents as agents};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_agent_security_connections(
    pubkey: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let global = agents::load_global_agent_config(&app)?;
    let current_relay = crate::relay::relay_ws_url_with_override(&state);
    if let Some(pubkey) = pubkey {
        let records = agents::load_managed_agents(&app)?;
        let record = records
            .iter()
            .find(|record| record.pubkey == pubkey)
            .ok_or("Agent not found")?;
        let definitions = agents::load_personas(&app)?;
        Ok(agents::security_connections::for_record(
            record,
            &definitions,
            &global,
            &current_relay,
        ))
    } else {
        Ok(agents::security_connections::for_defaults(
            &global,
            &current_relay,
        ))
    }
}
