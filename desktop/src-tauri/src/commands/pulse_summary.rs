//! Private, bounded summarization for the local Home prototype. Never publishes relay events.
use serde_json::Value;
use std::time::Duration;
use tokio::sync::Semaphore;

static SUMMARY_SLOT: Semaphore = Semaphore::const_new(1);
const INSTRUCTIONS: &str = include_str!("../../../pulse-summary-instructions.md");
const SCHEMA: &str = include_str!("../../../pulse-summary-schema.json");

/// Generate grounded Home highlights with the user's locally authenticated Codex CLI.
#[tauri::command]
pub async fn summarize_pulse_activity(input: String) -> Result<Value, String> {
    validate_input(&input)?;
    let permit = SUMMARY_SLOT
        .try_acquire()
        .map_err(|_| "Highlights are already updating. Try again shortly.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let result = super::local_model::generate(
            &input,
            INSTRUCTIONS,
            SCHEMA,
            "gpt-5.6-terra",
            Duration::from_secs(90),
        );
        if let Err(error) = &result {
            tracing::warn!("Home summary: {error}");
        }
        result
    })
    .await
    .map_err(|_| "The summary task stopped unexpectedly. Try again.".to_string())?
}

fn validate_input(input: &str) -> Result<(), String> {
    if input.len() > 200_000 {
        return Err("Too much activity for one summary.".into());
    }
    let value: Value =
        serde_json::from_str(input).map_err(|_| "Invalid activity input.".to_string())?;
    let conversations = value
        .get("conversations")
        .and_then(Value::as_array)
        .ok_or("Missing conversations.")?;
    if conversations.is_empty() || conversations.len() > 30 {
        return Err("Invalid conversation count.".into());
    }
    for conversation in conversations {
        let messages = conversation
            .get("messages")
            .and_then(Value::as_array)
            .ok_or("Missing source messages.")?;
        if messages.len() > 8 {
            return Err("Too many source messages.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::local_model::parse_output;
    use super::*;
    #[test]
    fn input_and_output_are_bounded() {
        assert!(validate_input(&"x".repeat(200_001)).is_err());
        assert!(validate_input("{}").is_err());
        assert!(validate_input(r#"{"conversations":[{"messages":[]}]}"#).is_ok());
        assert!(parse_output(b"{}").is_err());
        let event = serde_json::json!({"type":"item.completed","item":{"type":"agent_message","text":"{\"highlights\":[]}"}});
        assert_eq!(
            parse_output(event.to_string().as_bytes()).ok(),
            Some(serde_json::json!({"highlights":[]}))
        );
    }
}
