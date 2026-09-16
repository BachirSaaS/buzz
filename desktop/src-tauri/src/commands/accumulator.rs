//! Scoped access to the separately launched, pinned local Accumulator service.
use crate::{app_state::AppState, relay};
use serde::Deserialize;
use serde_json::Value;
use std::{sync::atomic::Ordering, time::Duration};
use tauri::State;

/// Public identity and community expected by the requesting view.
#[derive(Deserialize)]
pub struct Scope {
    relay: String,
    pubkey: String,
}

/// An allowlisted local briefing operation with its expected scope.
#[derive(Deserialize)]
pub struct AccumulatorRequest {
    scope: Scope,
    path: String,
    method: String,
    body: Option<Value>,
}

fn allowed_route(method: &str, path: &str) -> bool {
    let parts: Vec<_> = path.split('/').collect();
    let name = |s: &str| {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    };
    match (method, parts.as_slice()) {
        ("GET", ["", "status" | "channels" | "models" | "folds"]) => true,
        ("GET", ["", "events", id]) => id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit()),
        ("GET" | "PUT", ["", "folds", fold]) => name(fold),
        ("GET", ["", "folds", fold, "artifacts"]) => name(fold),
        ("GET", ["", "folds", fold, "artifacts", version]) => {
            name(fold) && version.len() <= 6 && version.parse::<u32>().is_ok_and(|v| v > 0)
        }
        ("POST", ["", "select", "preview" | "events"]) => true,
        ("POST", ["", "folds", fold, "preflight" | "run"]) => name(fold),
        _ => false,
    }
}

fn normalized_relay(raw: &str) -> Result<String, String> {
    url::Url::parse(&relay::relay_http_base_url(raw))
        .map(|u| u.to_string().trim_end_matches('/').to_string())
        .map_err(|_| "Invalid community URL.".to_string())
}

async fn json_response(mut response: reqwest::Response) -> Result<Value, String> {
    let success = response.status().is_success();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 4_000_000 {
            return Err("Accumulator response is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid Accumulator response.")?;
    if !success {
        return Err(value["error"]
            .as_str()
            .unwrap_or("Accumulator request failed.")
            .to_string());
    }
    Ok(value)
}

/// Access local briefings only when both the app and daemon match the requested scope.
#[tauri::command]
pub async fn accumulator_request(
    input: AccumulatorRequest,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if !allowed_route(&input.method, &input.path) {
        return Err("Unsupported briefing operation.".into());
    }
    if serde_json::to_vec(&input.body)
        .map_err(|e| e.to_string())?
        .len()
        > 64_000
    {
        return Err("Briefing request is too large.".into());
    }
    let generation = state.workspace_apply_generation.load(Ordering::Acquire);
    let check_scope = || -> Result<(), String> {
        if state.workspace_apply_generation.load(Ordering::Acquire) != generation
            || state.signing_keys()?.public_key().to_hex() != input.scope.pubkey
            || normalized_relay(&relay::relay_ws_url_with_override(&state))?
                != normalized_relay(&input.scope.relay)?
        {
            return Err("The active identity or community changed. Reopen saved briefings.".into());
        }
        Ok(())
    };
    check_scope()?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    let status = json_response(
        client
            .get("http://127.0.0.1:4640/status")
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|_| "Local briefings are unavailable. Start the Accumulator and retry.")?,
    )
    .await?;
    if status["pubkey"].as_str() != Some(&input.scope.pubkey)
        || normalized_relay(
            status["relay"]
                .as_str()
                .ok_or("Missing Accumulator community.")?,
        )? != normalized_relay(&input.scope.relay)?
    {
        return Err("The Accumulator is connected to a different identity or community.".into());
    }
    check_scope()?;
    if input.path == "/status" {
        return Ok(status);
    }
    let method = reqwest::Method::from_bytes(input.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut request = client
        .request(method, format!("http://127.0.0.1:4640{}", input.path))
        .timeout(Duration::from_secs(if input.path.ends_with("/run") {
            615
        } else {
            10
        }));
    if input.method != "GET" {
        request = request.json(&input.body.unwrap_or(serde_json::json!({})));
    }
    let result = json_response(request.send().await.map_err(|e| e.to_string())?).await?;
    check_scope()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routes_exclude_publication_and_arbitrary_destinations() {
        for (method, path) in [
            ("GET", "/status"),
            ("PUT", "/folds/chief-123"),
            ("POST", "/folds/chief-123/run"),
            ("GET", "/folds/week/artifacts/2"),
        ] {
            assert!(allowed_route(method, path));
        }
        for (method, path) in [
            ("POST", "/folds/week/artifacts/1/publish"),
            ("DELETE", "/folds/week"),
            ("GET", "//example.com"),
            ("GET", "/folds/../status"),
            ("PUT", "/folds/a%2fb"),
            ("GET", "/folds/week/artifacts/0"),
        ] {
            assert!(!allowed_route(method, path));
        }
    }
}
