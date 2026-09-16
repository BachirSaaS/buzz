//! Private, bounded summarization for the local Home prototype. Never publishes relay events.
use serde_json::Value;
use std::{
    fs::File,
    io::Write,
    process::{Command, Stdio},
    time::Duration,
};
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
        let result = generate(&input);
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

fn generate(input: &str) -> Result<Value, String> {
    let binary = crate::managed_agents::resolve_command("codex")
        .ok_or("Install and sign in to Codex to generate highlights.")?;
    let directory = tempfile::Builder::new()
        .prefix("buzz-home-summary-")
        .tempdir()
        .map_err(|_| "Could not prepare the summary.".to_string())?;
    let prompt_path = directory.path().join("input.json");
    let schema_path = directory.path().join("schema.json");
    let instructions_path = directory.path().join("instructions.md");
    let write = |path: &std::path::Path, bytes: &[u8]| -> Result<(), String> {
        File::create(path)
            .and_then(|mut file| file.write_all(bytes))
            .map_err(|_| "Could not prepare the summary.".to_string())
    };
    write(&prompt_path, input.as_bytes())?;
    write(&schema_path, SCHEMA.as_bytes())?;
    write(&instructions_path, INSTRUCTIONS.as_bytes())?;
    let input_file =
        File::open(&prompt_path).map_err(|_| "Could not read the summary input.".to_string())?;
    let mut command = Command::new(binary);
    // Do not pass the Buzz signing key or provider credentials to the subprocess.
    command.env_clear();
    for key in [
        "PATH",
        "HOME",
        "USER",
        "TMPDIR",
        "CODEX_HOME",
        "SYSTEMROOT",
        "APPDATA",
        "LOCALAPPDATA",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "NO_PROXY",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
        .current_dir(directory.path())
        .args([
            "exec",
            "--model",
            "gpt-5.6-terra",
            "--ignore-user-config",
            "--ephemeral",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "--disable",
            "shell_tool",
            "--disable",
            "multi_agent",
            "--disable",
            "apps",
            "--disable",
            "plugins",
            "-c",
            "web_search=\"disabled\"",
            "-c",
            "tools.view_image=false",
            "-c",
            "project_doc_max_bytes=0",
            "-c",
            "model_reasoning_effort=\"low\"",
            "--json",
            "--output-schema",
        ])
        .arg(&schema_path)
        .arg("-c")
        .arg(format!(
            "model_instructions_file={}",
            serde_json::to_string(&instructions_path)
                .map_err(|_| "Invalid summary path.".to_string())?
        ))
        .arg("-");
    let output = crate::managed_agents::output_with_timeout_and_stdin(
        command,
        Duration::from_secs(90),
        Stdio::from(input_file),
    )
    .ok_or("Highlights timed out or exceeded their output limit. Try again.")?;
    if !output.status.success() {
        return Err(
            "Could not generate highlights. Check your Codex sign-in and try again.".into(),
        );
    }
    parse_output(&output.stdout)
}

fn parse_output(output: &[u8]) -> Result<Value, String> {
    let mut result = None;
    for line in output.split(|byte| *byte == b'\n') {
        let Ok(event) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if event["type"] == "item.completed" && event["item"]["type"] == "agent_message" {
            let text = event["item"]["text"]
                .as_str()
                .ok_or("Missing summary text.")?;
            if text.len() > 16_000 {
                return Err("Summary response was too large.".into());
            }
            result = Some(
                serde_json::from_str(text).map_err(|_| "Invalid summary response.".to_string())?,
            );
        }
    }
    result.ok_or("No summary was returned. Try again.".into())
}

#[cfg(test)]
mod tests {
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
