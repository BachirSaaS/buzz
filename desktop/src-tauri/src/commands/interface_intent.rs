//! Bounded Jev choice transport. The UI owns the action registry and executes only validated choices.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::LazyLock, time::Duration};
use tokio::sync::Semaphore;

static REQUESTS: Semaphore = Semaphore::const_new(1);
// Cosmetic enrichment must never occupy the live-command lane.
static ICON_REQUESTS: Semaphore = Semaphore::const_new(1);
// Reuse connections during live listening. Credentials remain request-scoped.
static CLIENT: LazyLock<Result<reqwest::Client, reqwest::Error>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(15))
        .build()
});
const INVALID: &str = "Jev returned an invalid decision. Please try again.";

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Question {
    instructions: String,
    criteria: BTreeMap<String, String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Input {
    request: String,
    context: String,
    questions: BTreeMap<String, Question>,
}

fn parse_input(raw: &str) -> Result<Input, String> {
    if raw.len() > 160_000 {
        return Err("Voice command context is too large.".into());
    }
    let input: Input = serde_json::from_str(raw).map_err(|_| INVALID)?;
    if input.request.trim().is_empty()
        || input.request.len() > 4_000
        || input.context.len() > 40_000
        || input.questions.is_empty()
        || input.questions.len() > 12
        || input.questions.iter().any(|(id, q)| {
            id.len() > 80
                || q.instructions.len() > 4_000
                || q.criteria.len() < 2
                || q.criteria.len() > 128
                || q.criteria
                    .iter()
                    .any(|(k, v)| k.len() > 512 || v.len() > 1_000)
        })
    {
        return Err("Voice command is too long or has invalid choices.".into());
    }
    Ok(input)
}

fn decode(value: Value, input: &Input) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    for (id, question) in &input.questions {
        let answer = &value["answers"][id];
        let choice = answer["choice"].as_str().ok_or(INVALID)?;
        let probabilities = answer["probabilities"].as_object().ok_or(INVALID)?;
        if answer["type"] != "choice"
            || !question.criteria.contains_key(choice)
            || probabilities.len() != question.criteria.len()
        {
            return Err(INVALID.into());
        }
        let mut sum = 0.0;
        let mut winner = 0.0;
        let mut runner_up: f64 = 0.0;
        for option in question.criteria.keys() {
            let p = probabilities
                .get(option)
                .and_then(Value::as_f64)
                .filter(|p| p.is_finite() && (0.0..=1.0).contains(p))
                .ok_or(INVALID)?;
            sum += p;
            if option == choice {
                winner = p;
            } else {
                runner_up = runner_up.max(p);
            }
        }
        // Jev rounds individual probabilities to two decimals. Their sum may
        // differ from one by up to half a rounding unit per choice.
        if (sum - 1.0).abs() > 0.005 * probabilities.len() as f64 + 1e-9 || winner < runner_up {
            return Err(INVALID.into());
        }
        result.insert(
            id.clone(),
            json!({"choice":choice,"probability":winner,"margin":winner-runner_up}),
        );
    }
    Ok(Value::Object(result))
}

/// Resolve typed interface decisions using the native-only TypeSafe credential.
#[tauri::command]
pub async fn resolve_interface_intent(input: String) -> Result<Value, String> {
    let input = parse_input(&input)?;
    let lane = if input
        .questions
        .keys()
        .all(|id| id.starts_with("workspace_icon_"))
    {
        &ICON_REQUESTS
    } else {
        &REQUESTS
    };
    let _permit = lane
        .try_acquire()
        .map_err(|_| "Jev is finishing another command. Try again.")?;
    let key = std::env::var("TYPESAFE_API_KEY")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or("Add TYPESAFE_API_KEY to .env and restart Buzz to use interface commands.")?;
    let questions: serde_json::Map<String, Value> = input
        .questions
        .iter()
        .map(|(id, q)| {
            (
                id.clone(),
                json!({"type":"choice", "instructions":q.instructions,"criteria":q.criteria}),
            )
        })
        .collect();
    let deadline = Duration::from_secs(15);
    tokio::time::timeout(deadline, async {
        let client = CLIENT.as_ref().map_err(|_| INVALID)?;
        let mut response = client.post("https://api.typesafe.ai/v1/systemone").bearer_auth(key.trim())
            .json(&json!({"model":"jev-latest","state":{"request":input.request,"context":input.context},"questions":questions}))
            .send().await.map_err(|_| "Couldn't reach Jev. Your command is still here; try again.")?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                401 | 403 => "Check TYPESAFE_API_KEY and restart Buzz.",
                429 | 529 => "Jev is busy. Try again in a moment.",
                _ => "Jev couldn't interpret that command. Try again.",
            }.to_string());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| INVALID)? {
            if bytes.len() + chunk.len() > 256_000 { return Err(INVALID.into()); }
            bytes.extend_from_slice(&chunk);
        }
        decode(serde_json::from_slice(&bytes).map_err(|_| INVALID)?, &input)
    }).await.map_err(|_| "Jev took too long. Your command is still here; try again.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Uses the configured TypeSafe key and frontend-generated fixtures"]
    async fn live_interface_intents() {
        let path = std::env::var("BUZZ_INTERFACE_FIXTURES_PATH").unwrap();
        let fixtures: Vec<Value> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        for fixture in fixtures {
            let answers = resolve_interface_intent(fixture["input"].to_string())
                .await
                .unwrap();
            for (id, expected) in fixture["expected"].as_object().unwrap() {
                assert_eq!(
                    &answers[id]["choice"], expected,
                    "{}: {id}: {answers}",
                    fixture["input"]["request"]
                );
                assert!(
                    answers[id]["probability"].as_f64().unwrap() >= 0.5,
                    "{answers}"
                );
                assert!(answers[id]["margin"].as_f64().unwrap() >= 0.15, "{answers}");
            }
            eprintln!("Live intent passed: {}", fixture["input"]["request"]);
        }
    }
    fn input() -> Input {
        parse_input(r#"{"request":"open music","context":"","questions":{"action":{"instructions":"Choose","criteria":{"open":"Open","none":"None"}}}}"#).unwrap()
    }
    #[test]
    fn decisions_require_known_choices_and_complete_honest_probabilities() {
        let valid = json!({"answers":{"action":{"type":"choice","choice":"open","probabilities":{"open":0.85,"none":0.15}}}});
        assert_eq!(
            decode(valid.clone(), &input()).unwrap()["action"]["choice"],
            "open"
        );
        for bad in [
            json!({"open":1.0}),
            json!({"open":0.3,"none":0.7}),
            json!({"open":0.8,"none":0.8}),
            json!({"open":-0.1,"none":1.1}),
        ] {
            let mut value = valid.clone();
            value["answers"]["action"]["probabilities"] = bad;
            assert!(decode(value, &input()).is_err());
        }
        let mut value = valid;
        value["answers"]["action"]["choice"] = json!("send");
        assert!(decode(value, &input()).is_err());
    }
    #[test]
    fn rejects_unbounded_and_unexpected_input() {
        assert!(parse_input(&"x".repeat(160_001)).is_err());
        let mut value = serde_json::to_value(input()).unwrap();
        value["endpoint"] = json!("https://example.com");
        assert!(parse_input(&value.to_string()).is_err());
    }
}
