//! Plan local window arrangements. This command has no relay write capability.
use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashSet, time::Duration};
use tokio::sync::Semaphore;

static PLANNER_SLOT: Semaphore = Semaphore::const_new(1);
const INSTRUCTIONS: &str = include_str!("../../../workspace-plan-instructions.md");
const SCHEMA: &str = include_str!("../../../workspace-plan-schema.json");
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    request: String,
    catalog: Vec<Entry>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    id: String,
    kind: String,
    title: String,
    aliases: Vec<String>,
    description: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Plan {
    name: String,
    layout: String,
    window_ids: Vec<String>,
    unresolved: Vec<String>,
}
fn validate_input(raw: &str) -> Result<Input, String> {
    if raw.len() > 64_000 {
        return Err("Workspace request is too large.".into());
    }
    let input: Input = serde_json::from_str(raw).map_err(|_| "Invalid window catalog.")?;
    let unique: HashSet<_> = input.catalog.iter().map(|item| &item.id).collect();
    if input.request.trim().is_empty()
        || input.request.len() > 4000
        || input.catalog.is_empty()
        || input.catalog.len() > 80
        || unique.len() != input.catalog.len()
        || input.catalog.iter().any(|item| {
            item.id.is_empty()
                || item.id.len() > 512
                || item.title.chars().count() > 160
                || item.description.chars().count() > 240
                || item.aliases.len() > 12
                || item.aliases.iter().any(|name| name.chars().count() > 120)
                || !["app", "channel", "dm", "project", "agents", "widget"]
                    .contains(&item.kind.as_str())
        })
    {
        return Err("Invalid workspace request or window catalog.".into());
    }
    Ok(input)
}
fn validate_plan(value: Value, input: &Input) -> Result<Value, String> {
    let plan: Plan = serde_json::from_value(value.clone())
        .map_err(|_| "The model returned an invalid workspace. Try again.")?;
    let unique: HashSet<_> = plan.window_ids.iter().collect();
    if plan.name.trim().is_empty()
        || plan.name.chars().count() > 48
        || !["focus", "columns", "grid"].contains(&plan.layout.as_str())
        || plan.window_ids.len() > 4
        || (plan.window_ids.is_empty() && plan.unresolved.is_empty())
        || unique.len() != plan.window_ids.len()
        || plan
            .window_ids
            .iter()
            .any(|id| !input.catalog.iter().any(|entry| &entry.id == id))
        || plan.unresolved.len() > 8
        || plan.unresolved.iter().any(|item| item.len() > 400)
    {
        return Err(
            "The model selected unavailable windows. Try describing your workspace again.".into(),
        );
    }
    Ok(value)
}
/// Resolve a bounded request into existing window IDs with the user's local model sign-in.
#[tauri::command]
pub async fn plan_workspace(input: String) -> Result<Value, String> {
    let catalog = validate_input(&input)?;
    let permit = PLANNER_SLOT
        .try_acquire()
        .map_err(|_| "The previous workspace request is still finishing. Try again shortly.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let result = super::local_model::generate(
            &input,
            INSTRUCTIONS,
            SCHEMA,
            "gpt-5.6-luna",
            Duration::from_secs(35),
        )?;
        validate_plan(result, &catalog)
    })
    .await
    .map_err(|_| "Workspace planning stopped. Please try again.".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> Input {
        Input {
            request: "weather".into(),
            catalog: vec![Entry {
                id: "widget:weather".into(),
                kind: "widget".into(),
                title: "Weather".into(),
                aliases: vec![],
                description: "Weather widget".into(),
            }],
        }
    }
    #[test]
    fn rejects_unknown_duplicate_and_oversized_plans() {
        let good = serde_json::json!({"name":"Weather","layout":"focus","windowIds":["widget:weather"],"unresolved":[]});
        assert!(validate_plan(good.clone(), &input()).is_ok());
        for ids in [
            serde_json::json!(["invented"]),
            serde_json::json!(["widget:weather", "widget:weather"]),
            serde_json::json!([]),
        ] {
            let mut bad = good.clone();
            bad["windowIds"] = ids;
            assert!(validate_plan(bad, &input()).is_err());
        }
        let mut bad = good;
        bad["name"] = Value::String("x".repeat(49));
        assert!(validate_plan(bad, &input()).is_err());
        assert!(validate_input(&"x".repeat(64_001)).is_err());
        assert!(validate_input(r#"{"request":"","catalog":[]}"#).is_err());
    }
    #[tokio::test]
    #[ignore = "Requires local Codex sign-in and calls the configured model"]
    async fn live_workspace_plan() {
        let input = serde_json::json!({
            "request": "I want to message jmarr and mattkursmark, check the weather, and have a view of my projects",
            "catalog": [
                {"id":"dm:jmarr","kind":"dm","title":"John Marr","aliases":["jmarr"],"description":"Existing one-to-one direct message."},
                {"id":"dm:matt","kind":"dm","title":"Matt","aliases":["mattkursmark"],"description":"Existing one-to-one direct message."},
                {"id":"widget:weather","kind":"widget","title":"Weather","aliases":["forecast"],"description":"Weather widget."},
                {"id":"app:projects","kind":"app","title":"Projects","aliases":["my projects"],"description":"Full Projects app."},
                {"id":"app:messages","kind":"app","title":"Messages","aliases":[],"description":"Full Messages app."}
            ]
        });
        let start = std::time::Instant::now();
        let result = plan_workspace(input.to_string()).await;
        assert!(result.is_ok(), "Live model failed: {result:?}");
        if let Ok(value) = result {
            assert_eq!(value["unresolved"], serde_json::json!([]));
            let ids = value["windowIds"].as_array().map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<HashSet<_>>()
            });
            assert_eq!(
                ids,
                Some(HashSet::from([
                    "dm:jmarr",
                    "dm:matt",
                    "widget:weather",
                    "app:projects"
                ]))
            );
            println!("Workspace plan completed in {:?}", start.elapsed());
        }
    }
}
