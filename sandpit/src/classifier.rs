//! Command injection classifier using the bashcat-distilbert model.
//! Endpoint: opt-in via `SANDPIT_CLASSIFIER_ENDPOINT`
//! Threshold: configurable via `SANDPIT_CLASSIFIER_THRESHOLD` (default: 0.7)

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const DEFAULT_THRESHOLD: f32 = 0.7;
const DEFAULT_TIMEOUT_MS: u64 = 5000;

#[derive(Debug, Serialize)]
struct ClassificationRequest {
    inputs: String,
}

#[derive(Debug, Deserialize, Clone)]
struct ClassificationLabel {
    label: String,
    score: f32,
}

type ClassificationResponse = Vec<Vec<ClassificationLabel>>;

pub struct CommandClassifier {
    endpoint: String,
    threshold: f32,
    client: reqwest::Client,
}

impl CommandClassifier {
    pub fn is_configured() -> bool {
        std::env::var("SANDPIT_CLASSIFIER_ENDPOINT")
            .ok()
            .is_some_and(|endpoint| !endpoint.is_empty())
    }

    pub fn threshold(&self) -> f32 {
        self.threshold
    }

    pub fn new() -> Result<Self> {
        let endpoint = std::env::var("SANDPIT_CLASSIFIER_ENDPOINT")
            .context("SANDPIT_CLASSIFIER_ENDPOINT is not configured")?;

        let threshold: f32 = std::env::var("SANDPIT_CLASSIFIER_THRESHOLD")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_THRESHOLD);

        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
            .build()
            .context("Failed to create HTTP client")?;

        tracing::debug!(
            endpoint = %endpoint,
            threshold = threshold,
            "classifier model initialized"
        );

        Ok(Self {
            endpoint,
            threshold,
            client,
        })
    }

    pub async fn classify(&self, command: &str) -> Result<ClassificationResult> {
        let request = ClassificationRequest {
            inputs: command.to_string(),
        };

        let response = self
            .client
            .post(&self.endpoint)
            .json(&request)
            .send()
            .await
            .context("Failed to send classification request")?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Classifier returned {}: {}", status, body);
        }

        let results: ClassificationResponse = response
            .json()
            .await
            .context("Failed to parse classification response")?;

        let labels = results.first().context("Empty classification response")?;

        let score = self.extract_injection_score(labels);
        let blocked = score >= self.threshold;
        tracing::info!(
            score = score,
            blocked = blocked,
            threshold = self.threshold,
            "classifier result"
        );
        Ok(ClassificationResult { score, blocked })
    }

    fn extract_injection_score(&self, labels: &[ClassificationLabel]) -> f32 {
        let sum: f32 = labels.iter().map(|l| l.score).sum();
        let is_probabilities =
            labels.iter().all(|l| l.score >= 0.0 && l.score <= 1.0) && (sum - 1.0).abs() < 0.1;

        let normalized = if is_probabilities {
            labels.to_vec()
        } else {
            self.softmax(labels)
        };

        let top = normalized.iter().max_by(|a, b| {
            a.score
                .partial_cmp(&b.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        match top {
            Some(label) => match label.label.as_str() {
                "INJECTION" | "LABEL_1" => label.score,
                "SAFE" | "LABEL_0" => 1.0 - label.score,
                _ => 0.0,
            },
            None => 0.0,
        }
    }

    fn softmax(&self, labels: &[ClassificationLabel]) -> Vec<ClassificationLabel> {
        let max = labels
            .iter()
            .map(|l| l.score)
            .fold(f32::NEG_INFINITY, f32::max);
        let exps: Vec<f32> = labels.iter().map(|l| (l.score - max).exp()).collect();
        let sum: f32 = exps.iter().sum();

        labels
            .iter()
            .zip(exps.iter())
            .map(|(l, &e)| ClassificationLabel {
                label: l.label.clone(),
                score: e / sum,
            })
            .collect()
    }
}

#[derive(Debug)]
pub struct ClassificationResult {
    pub score: f32,
    pub blocked: bool,
}
