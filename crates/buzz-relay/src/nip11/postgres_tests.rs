//! Exercise both served NIP-11 routes; nextest supplies an isolated database.
use std::sync::Arc;

use axum::{body::Body, http::Request};
use serde_json::{json, Value};
use tower::ServiceExt;

use crate::{config::Config, state::AppState};

async fn served_info(state: &Arc<AppState>, path: &str, host: &str) -> Value {
    let response = crate::router::build_router(state.clone())
        .oneshot(
            Request::builder()
                .uri(path)
                .header("host", host)
                .header("accept", "application/nostr+json")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("NIP-11 response");
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("bounded NIP-11 body");
    serde_json::from_slice(&body).expect("NIP-11 JSON")
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL"]
async fn workflow_advertisement_requires_activation_identity_and_host_on_both_routes() {
    let url = std::env::var("BUZZ_TEST_DATABASE_URL").expect("isolated PostgreSQL URL");
    let pool = sqlx::PgPool::connect(&url).await.expect("database");
    let db = buzz_db::Db::from_pool(pool.clone());
    let host = format!("activation-{}.example:8443", uuid::Uuid::new_v4());
    db.ensure_configured_community(&host)
        .await
        .expect("community");
    let keys = nostr::Keys::generate();
    let mut config = Config::from_env().expect("config");
    config.database_url = url;
    config.redis_url = "redis://127.0.0.1:1".into();
    config.admin = None;
    // An unrelated enabled extension must neither bypass nor be hidden by
    // lifecycle activation. No gateway, Redis, or relay process is contacted.
    config.push_enabled = true;
    let cache = tempfile::tempdir().expect("cache directory");
    config.git_pack_cache_path = cache.path().to_path_buf();
    let redis = deadpool_redis::Config::from_url(&config.redis_url)
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("redis pool");
    let pubsub = Arc::new(
        buzz_pubsub::PubSubManager::new(&config.redis_url, redis.clone())
            .await
            .expect("pubsub"),
    );
    let engine = Arc::new(buzz_workflow::WorkflowEngine::new(
        db.clone(),
        buzz_workflow::WorkflowConfig::default(),
    ));
    let auth = buzz_auth::AuthService::new(config.auth.clone());
    let search = buzz_search::SearchService::new(pool.clone());
    let media = buzz_media::MediaStorage::new(&config.media).expect("media config");
    let (state, _) = AppState::new(
        config, db, redis, None, pubsub, auth, search, engine, keys, media,
    );
    let mut state = Arc::new(state);

    for enabled in [false, true] {
        for stable in [false, true] {
            let mutable = Arc::get_mut(&mut state).expect("sole state owner");
            let config = Arc::make_mut(&mut mutable.config);
            config.advertise_workflow_lifecycle = enabled;
            config.relay_private_key =
                stable.then(|| mutable.relay_keypair.secret_key().to_secret_hex());
            for request_host in [
                host.to_uppercase(),
                "unmapped.invalid".into(),
                String::new(),
            ] {
                let bound = request_host.eq_ignore_ascii_case(&host);
                for path in ["/", "/info"] {
                    let info = served_info(&state, path, &request_host).await;
                    let advertised = enabled && stable && bound;
                    assert_eq!(
                        info.get("workflows").is_some(),
                        advertised,
                        "{path} enabled={enabled} stable={stable} host={request_host}"
                    );
                    let extensions = info["supported_extensions"].as_array().expect("extensions");
                    assert_eq!(extensions.contains(&json!("buzz-workflows")), advertised);
                    if advertised {
                        assert_eq!(info["workflows"], json!({"lifecycle": 1, "host": host}));
                    }
                    assert_eq!(
                        info.get("self").is_some(),
                        stable,
                        "identity is independent of activation"
                    );
                    assert_eq!(
                        info.get("push").is_some(),
                        bound,
                        "push is independent of activation"
                    );
                    assert_eq!(extensions.contains(&json!("nip-pl")), bound);
                }
            }
        }
    }
    // Enabled + stable still fails closed if host resolution fails at runtime.
    pool.close().await;
    for path in ["/", "/info"] {
        let info = served_info(&state, path, &host).await;
        assert!(info.get("workflows").is_none());
        assert!(!info["supported_extensions"]
            .as_array()
            .expect("extensions")
            .contains(&json!("buzz-workflows")));
    }
}
