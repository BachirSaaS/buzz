//! OTLP log export for sandpit.
//!
//! Log export is opt-in. Controlled by:
//!   - `SANDPIT_OTLP_ENDPOINT` — collector endpoint
//!   - `OTEL_SDK_DISABLED=true` — disables all telemetry
//!   - `OTEL_LOGS_EXPORTER=none` — disables log export
//!   - `OTEL_LOG_LEVEL` — minimum level to export (default: info)

use opentelemetry::KeyValue;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::logs::{SdkLogger, SdkLoggerProvider};
use opentelemetry_sdk::resource::{EnvResourceDetector, TelemetryResourceDetector};
use std::env;
use std::sync::Mutex;
use tracing::{Level, Metadata};
use tracing_subscriber::Layer as _;
use tracing_subscriber::filter::FilterFn;

/// Session context for unified schema attributes.
/// Populated once at startup and reused across all log emissions.
#[derive(Debug, Clone)]
pub struct SessionContext {
    pub host: String,
    pub user: String,
    pub agent_type: String,
    pub session_id: String,
}

impl SessionContext {
    /// Create session context from the current environment and agent command.
    pub fn from_env(agent_command: &str) -> Self {
        let host = hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string());

        let user = env::var("USER")
            .or_else(|_| env::var("LOGNAME"))
            .unwrap_or_else(|_| "unknown".to_string());

        let agent_type = match agent_command.rsplit('/').next().unwrap_or(agent_command) {
            "claude" | "claude-code" => "claude-code",
            "goose" => "goose",
            "amp" => "amp",
            "pi" => "pi",
            "cursor" => "cursor",
            other => other,
        }
        .to_string();

        // Prefer a session id propagated from the parent `sandpit run` so that
        // the run, proxy, hooks, and shims all share one correlation key.
        // Only the top-level `sandpit run` (where the var is unset) mints a new one.
        let session_id = env::var("SANDPIT_SESSION_ID")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                format!(
                    "sandpit-{}-{}",
                    std::process::id(),
                    chrono::Utc::now().format("%Y%m%d%H%M%S")
                )
            });

        Self {
            host,
            user,
            agent_type,
            session_id,
        }
    }
}

/// Resolved session fields with "unknown" fallbacks, suitable for log emission.
/// Avoids the repeated `ctx.as_ref().map(|c| c.field.as_str()).unwrap_or("unknown")` pattern.
pub struct SessionFields {
    session_id: String,
    agent_type: String,
    user: String,
    host: String,
}

impl SessionFields {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }
    pub fn agent_type(&self) -> &str {
        &self.agent_type
    }
    pub fn user(&self) -> &str {
        &self.user
    }
    pub fn host(&self) -> &str {
        &self.host
    }
}

/// Get session fields with "unknown" fallbacks. Use this in log call sites.
pub fn session_fields() -> SessionFields {
    match session_context() {
        Some(ctx) => SessionFields {
            session_id: ctx.session_id,
            agent_type: ctx.agent_type,
            user: ctx.user,
            host: ctx.host,
        },
        None => SessionFields {
            session_id: "unknown".to_string(),
            agent_type: "unknown".to_string(),
            user: "unknown".to_string(),
            host: "unknown".to_string(),
        },
    }
}

/// Global session context — set once by `sandpit run` or `sandpit hook`.
static SESSION_CTX: Mutex<Option<SessionContext>> = Mutex::new(None);

/// Set the global session context. Call once at startup.
pub fn set_session_context(ctx: SessionContext) {
    *SESSION_CTX.lock().unwrap_or_else(|e| e.into_inner()) = Some(ctx);
}

/// Get a clone of the global session context.
pub fn session_context() -> Option<SessionContext> {
    SESSION_CTX
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

type LogsBridge = OpenTelemetryTracingBridge<SdkLoggerProvider, SdkLogger>;

static LOGGER_PROVIDER: Mutex<Option<SdkLoggerProvider>> = Mutex::new(None);

fn is_logs_enabled() -> bool {
    if env::var("OTEL_SDK_DISABLED")
        .ok()
        .is_some_and(|v| v.eq_ignore_ascii_case("true"))
    {
        return false;
    }

    if let Ok(val) = env::var("OTEL_LOGS_EXPORTER") {
        return !val.eq_ignore_ascii_case("none") && !val.is_empty();
    }

    env::var("SANDPIT_OTLP_ENDPOINT")
        .ok()
        .is_some_and(|endpoint| !endpoint.is_empty())
}

fn get_endpoint() -> Option<String> {
    env::var("SANDPIT_OTLP_ENDPOINT")
        .ok()
        .filter(|endpoint| !endpoint.is_empty())
}

fn create_resource() -> Resource {
    let host = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    let mut builder = Resource::builder_empty()
        .with_attributes([
            KeyValue::new("service.name", "sandpit"),
            KeyValue::new("service.version", env!("CARGO_PKG_VERSION")),
            KeyValue::new("service.namespace", "sandpit"),
            KeyValue::new("host.name", host),
        ])
        .with_detector(Box::new(EnvResourceDetector::new()))
        .with_detector(Box::new(TelemetryResourceDetector));

    if let Ok(name) = env::var("OTEL_SERVICE_NAME") {
        if !name.is_empty() {
            builder = builder.with_service_name(name);
        }
    }
    builder.build()
}

fn otel_logs_level() -> Level {
    env::var("OTEL_LOG_LEVEL")
        .ok()
        .and_then(|s| match s.to_lowercase().as_str() {
            "trace" => Some(Level::TRACE),
            "debug" => Some(Level::DEBUG),
            "info" => Some(Level::INFO),
            "warn" => Some(Level::WARN),
            "error" => Some(Level::ERROR),
            _ => None,
        })
        .unwrap_or(Level::INFO)
}

pub fn try_init_otlp_logs_layer<S>() -> Option<
    tracing_subscriber::filter::Filtered<LogsBridge, FilterFn<impl Fn(&Metadata<'_>) -> bool>, S>,
>
where
    S: tracing::Subscriber + for<'span> tracing_subscriber::registry::LookupSpan<'span>,
{
    if !is_logs_enabled() {
        return None;
    }

    let resource = create_resource();
    let endpoint = format!("{}/v1/logs", get_endpoint()?.trim_end_matches('/'));

    let exporter = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .with_endpoint(endpoint)
        .build()
        .ok()?;

    let logger_provider = SdkLoggerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(resource)
        .build();

    let bridge = OpenTelemetryTracingBridge::new(&logger_provider);
    *LOGGER_PROVIDER.lock().unwrap_or_else(|e| e.into_inner()) = Some(logger_provider);

    let min_level = otel_logs_level();
    let filter = FilterFn::new(move |metadata: &Metadata<'_>| metadata.level() <= &min_level);

    Some(bridge.with_filter(filter))
}

pub fn is_otlp_initialized() -> bool {
    LOGGER_PROVIDER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
}

/// Flush pending logs. Call before process exit.
pub fn shutdown_otlp() {
    if let Some(provider) = LOGGER_PROVIDER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        if let Err(e) = provider.shutdown() {
            eprintln!("OTLP shutdown error: {e}");
        }
    }
}
