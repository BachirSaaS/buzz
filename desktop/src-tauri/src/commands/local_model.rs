//! Bounded, text-only structured generation using the local Codex sign-in.
use serde_json::Value;
use std::{
    fs::File,
    io::Write,
    process::{Command, Stdio},
    time::Duration,
};

pub(super) fn generate(
    input: &str,
    instructions: &str,
    schema: &str,
    model: &str,
    timeout: Duration,
) -> Result<Value, String> {
    let binary = crate::managed_agents::resolve_command("codex")
        .ok_or("Install and sign in to Codex to use local AI.")?;
    let directory = tempfile::Builder::new()
        .prefix("buzz-local-model-")
        .tempdir()
        .map_err(|_| "Could not prepare the model request.".to_string())?;
    let prompt_path = directory.path().join("input.json");
    let schema_path = directory.path().join("schema.json");
    let instructions_path = directory.path().join("instructions.md");
    let write = |path: &std::path::Path, bytes: &[u8]| -> Result<(), String> {
        File::create(path)
            .and_then(|mut file| file.write_all(bytes))
            .map_err(|_| "Could not prepare the model request.".to_string())
    };
    write(&prompt_path, input.as_bytes())?;
    write(&schema_path, schema.as_bytes())?;
    write(&instructions_path, instructions.as_bytes())?;
    let input_file = File::open(&prompt_path)
        .map_err(|_| "Could not read the model request input.".to_string())?;
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
            model,
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
                .map_err(|_| "Invalid model request path.".to_string())?
        ))
        .arg("-");
    let output = crate::managed_agents::output_with_timeout_and_stdin(
        command,
        timeout,
        Stdio::from(input_file),
    )
    .ok_or("The model request timed out or exceeded its output limit. Try again.")?;
    if !output.status.success() {
        return Err("The model request failed. Check your Codex sign-in and try again.".into());
    }
    parse_output(&output.stdout)
}

pub(super) fn parse_output(output: &[u8]) -> Result<Value, String> {
    let mut result = None;
    for line in output.split(|byte| *byte == b'\n') {
        let Ok(event) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if event["type"] == "item.completed" && event["item"]["type"] == "agent_message" {
            let text = event["item"]["text"]
                .as_str()
                .ok_or("Missing model request text.")?;
            if text.len() > 16_000 {
                return Err("Model response was too large.".into());
            }
            result = Some(
                serde_json::from_str(text)
                    .map_err(|_| "Invalid model request response.".to_string())?,
            );
        }
    }
    result.ok_or("No model response was returned. Try again.".into())
}
