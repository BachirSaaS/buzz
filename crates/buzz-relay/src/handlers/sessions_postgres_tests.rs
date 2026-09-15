//! Signed session creation and messaging through the shared relay ingest path.
use crate::handlers::ingest::{ingest_event, HttpAuthMethod, IngestAuth};
use buzz_auth::Scope;
use buzz_core::{tenant::TenantContext, CommunityId};
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use std::sync::Arc;
use uuid::Uuid;

async fn test_state(sessions_enabled: bool) -> Arc<crate::state::AppState> {
    let mut config = crate::config::Config::from_env().unwrap();
    config.sessions_enabled = sessions_enabled;
    config.database_url = crate::test_support::database_url();
    config.redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    config.require_auth_token = false;
    config.require_relay_membership = false;
    let pool = sqlx::PgPool::connect(&config.database_url).await.unwrap();
    let db = buzz_db::Db::from_pool(pool.clone());
    if std::env::var("BUZZ_TEST_SCHEMA_MODE").as_deref() != Ok("desired") {
        db.migrate().await.unwrap();
    }
    let redis = deadpool_redis::Config::from_url(&config.redis_url)
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .unwrap();
    let pubsub = Arc::new(
        buzz_pubsub::PubSubManager::new(&config.redis_url, redis.clone())
            .await
            .unwrap(),
    );
    let auth = buzz_auth::AuthService::new(config.auth.clone());
    let media = buzz_media::MediaStorage::new(&config.media).unwrap();
    let workflow = Arc::new(buzz_workflow::WorkflowEngine::new(
        db.clone(),
        Default::default(),
    ));
    let (state, _) = crate::state::AppState::new(
        config,
        db,
        redis,
        buzz_audit::AuditService::new(pool.clone()),
        pubsub,
        auth,
        buzz_search::SearchService::new(pool),
        workflow,
        Keys::generate(),
        media,
    );
    Arc::new(state)
}

fn auth(keys: &Keys) -> IngestAuth {
    IngestAuth::Http {
        pubkey: keys.public_key(),
        scopes: vec![
            Scope::ChannelsWrite,
            Scope::AdminChannels,
            Scope::ChannelsRead,
            Scope::MessagesWrite,
        ],
        auth_method: HttpAuthMethod::Nip98,
    }
}

fn event(keys: &Keys, kind: u16, channel: Uuid, content: &str, extra: Vec<Tag>) -> Event {
    let mut tags = vec![Tag::parse(["h", &channel.to_string()]).unwrap()];
    tags.extend(extra);
    EventBuilder::new(Kind::Custom(kind), content)
        .tags(tags)
        .sign_with_keys(keys)
        .unwrap()
}

async fn http(
    state: Arc<crate::state::AppState>,
    tenant: &TenantContext,
    keys: &Keys,
    path: &str,
    body: serde_json::Value,
) -> (axum::http::StatusCode, serde_json::Value) {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    use tower::ServiceExt;
    let body = serde_json::to_vec(&body).unwrap();
    let url = crate::api::bridge::nip98_expected_url(&state.config.relay_url, tenant, path);
    let proof = EventBuilder::new(Kind::Custom(27235), "")
        .tags([
            Tag::parse(["u", &url]).unwrap(),
            Tag::parse(["method", "POST"]).unwrap(),
            Tag::parse(["payload", &hex::encode(Sha256::digest(&body))]).unwrap(),
            Tag::parse(["nonce", &Uuid::new_v4().to_string()]).unwrap(),
        ])
        .sign_with_keys(keys)
        .unwrap();
    let header = format!(
        "Nostr {}",
        base64::engine::general_purpose::STANDARD.encode(serde_json::to_vec(&proof).unwrap())
    );
    let response = crate::router::build_router(state)
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri(path)
                .header("Host", tenant.host())
                .header("Content-Type", "application/json")
                .header("Authorization", header)
                .body(axum::body::Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn child_session_signed_create_send_reply_and_revoke() {
    let state = test_state(true).await;
    let pool = sqlx::PgPool::connect(&crate::test_support::database_url())
        .await
        .unwrap();
    let community = CommunityId::from_uuid(Uuid::new_v4());
    let host = format!("sessions-{}.test", community.as_uuid());
    sqlx::query("INSERT INTO communities(id,host) VALUES ($1,$2)")
        .bind(community.as_uuid())
        .bind(&host)
        .execute(&pool)
        .await
        .unwrap();
    let tenant = TenantContext::resolved(community, host);
    let owner = Keys::generate();
    let agent = Keys::generate();
    let outsider = Keys::generate();
    for keys in [&owner, &agent, &outsider] {
        state
            .db
            .ensure_user(community, &keys.public_key().to_bytes())
            .await
            .unwrap();
    }
    let parent = state
        .db
        .create_channel(
            community,
            "Session parent",
            buzz_db::channel::ChannelType::Stream,
            buzz_db::channel::ChannelVisibility::Private,
            None,
            &owner.public_key().to_bytes(),
            None,
        )
        .await
        .unwrap();
    // This is the normal invitation the frontend sends before creating a child.
    let invite = event(
        &owner,
        9000,
        parent.id,
        "",
        vec![Tag::parse(["p", &agent.public_key().to_hex()]).unwrap()],
    );
    assert!(
        ingest_event(&state, &tenant, invite, auth(&owner))
            .await
            .unwrap()
            .accepted
    );
    let child = Uuid::new_v4();
    let body = serde_json::json!({"action":"create", "title":"Real work", "parent_id":parent.id})
        .to_string();
    let create = event(
        &owner,
        9050,
        child,
        &body,
        vec![Tag::parse(["client-id", &Uuid::new_v4().to_string()]).unwrap()],
    );
    let unauthorized = event(&outsider, 9050, Uuid::new_v4(), &body, vec![]);
    assert!(ingest_event(&state, &tenant, unauthorized, auth(&outsider))
        .await
        .is_err());
    let mut limited = auth(&owner);
    if let IngestAuth::Http { scopes, .. } = &mut limited {
        scopes.clear();
    }
    assert!(ingest_event(&state, &tenant, create.clone(), limited)
        .await
        .is_err());
    let (status, response) = http(
        state.clone(),
        &tenant,
        &owner,
        "/events",
        serde_json::to_value(&create).unwrap(),
    )
    .await;
    assert!(status.is_success(), "{response}");
    assert_eq!(response["accepted"], true);

    assert!(ingest_event(&state, &tenant, create, auth(&owner))
        .await
        .unwrap()
        .message
        .starts_with("duplicate:"));
    let kinds: Vec<i32> = sqlx::query_scalar("SELECT DISTINCT kind FROM events WHERE community_id=$1 AND channel_id=$2 AND kind IN (39000,39001,39002) AND deleted_at IS NULL ORDER BY kind")
        .bind(community.as_uuid()).bind(child).fetch_all(&pool).await.unwrap();
    assert_eq!(kinds, vec![39000, 39001, 39002]);
    assert!(state
        .db
        .is_member(community, child, &agent.public_key().to_bytes())
        .await
        .unwrap());
    let prompt = event(
        &owner,
        9,
        child,
        "Check the layout",
        vec![Tag::parse(["p", &agent.public_key().to_hex()]).unwrap()],
    );
    assert!(
        ingest_event(&state, &tenant, prompt.clone(), auth(&owner))
            .await
            .unwrap()
            .accepted
    );
    let reply = event(
        &agent,
        9,
        child,
        "Layout checked",
        vec![Tag::parse(["e", &prompt.id.to_hex(), "", "root"]).unwrap()],
    );
    assert!(
        ingest_event(&state, &tenant, reply, auth(&agent))
            .await
            .unwrap()
            .accepted
    );
    assert_eq!(
        state
            .db
            .session_window(community, child, 20, None, Some(&[9]))
            .await
            .unwrap()
            .0
            .rows
            .len(),
        2
    );
    // An upgraded pod with creation disabled must still serve sessions created
    // by an enabled pod during phase two of the rolling deployment.
    let reader_pod = test_state(false).await;
    let query = serde_json::json!([{"kinds":[9],"#h":[child.to_string()],"session_timeline":true,"include_aux":true,"limit":20}]);
    let (status, response) =
        http(reader_pod.clone(), &tenant, &agent, "/query", query.clone()).await;
    assert!(status.is_success(), "{response}");
    assert_eq!(
        response
            .as_array()
            .unwrap()
            .iter()
            .filter(|event| event["kind"] == 9)
            .count(),
        2
    );
    assert!(response
        .as_array()
        .unwrap()
        .iter()
        .any(|event| event["kind"] == 39006));
    assert!(reader_pod
        .is_member_cached(community, child, &agent.public_key().to_bytes())
        .await
        .unwrap());
    let mut invalidations = reader_pod.pubsub.subscribe_cache_invalidations();
    let pubsub = reader_pod.pubsub.clone();
    let subscriber = tokio::spawn(async move { pubsub.run_cache_invalidation_subscriber().await });
    // Establish readiness via a unique round trip before making the removal.
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            state
                .pubsub
                .publish_cache_invalidation(
                    &tenant,
                    &buzz_pubsub::cache_invalidation::CacheInvalidation::Visibility {
                        channel_id: child,
                    },
                )
                .await
                .unwrap();
            if let Ok(Ok(scoped)) =
                tokio::time::timeout(std::time::Duration::from_millis(50), invalidations.recv())
                    .await
            {
                if scoped.community_id == community {
                    break;
                }
            }
        }
    })
    .await
    .unwrap();
    let remove = event(
        &owner,
        9001,
        parent.id,
        "",
        vec![Tag::parse(["p", &agent.public_key().to_hex()]).unwrap()],
    );
    assert!(
        ingest_event(&state, &tenant, remove, auth(&owner))
            .await
            .unwrap()
            .accepted
    );
    assert!(!state
        .db
        .is_member(community, child, &agent.public_key().to_bytes())
        .await
        .unwrap());
    let denied = event(&agent, 9, child, "Must be denied", vec![]);
    assert!(ingest_event(&state, &tenant, denied, auth(&agent))
        .await
        .is_err());
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let scoped = invalidations.recv().await.unwrap();
            let target_removed = scoped.community_id == community && matches!(&scoped.invalidation,
                buzz_pubsub::cache_invalidation::CacheInvalidation::Membership { pubkey, .. } if pubkey == &agent.public_key().to_bytes());
            reader_pod.apply_cache_invalidation(scoped.community_id, scoped.invalidation);
            if target_removed { break; }
        }
    }).await.unwrap();
    assert!(!reader_pod
        .is_member_cached(community, child, &agent.public_key().to_bytes())
        .await
        .unwrap());
    let (status, response) = http(reader_pod.clone(), &tenant, &agent, "/query", query).await;
    assert!(
        status == axum::http::StatusCode::FORBIDDEN
            || (status.is_success() && response.as_array().is_some_and(Vec::is_empty)),
        "{status}: {response}"
    );
    subscriber.abort();
    // Administrative kicks use the durable outbox and must also invalidate a
    // warm child cache and publish the child's removal notification.
    let target = outsider.public_key().to_bytes();
    let invite = event(
        &owner,
        9000,
        parent.id,
        "",
        vec![Tag::parse(["p", &outsider.public_key().to_hex()]).unwrap()],
    );
    assert!(
        ingest_event(&state, &tenant, invite, auth(&owner))
            .await
            .unwrap()
            .accepted
    );
    assert!(state
        .is_member_cached(community, child, &target)
        .await
        .unwrap());
    let report: Uuid = sqlx::query_scalar("INSERT INTO moderation_reports (community_id, report_event_id, reporter_pubkey, target_kind, target_pubkey, channel_id, report_type) VALUES ($1,$2,$3,'pubkey',$4,$5,'harassment') RETURNING id")
        .bind(community.as_uuid()).bind(prompt.id.as_bytes().as_slice())
        .bind(owner.public_key().to_bytes().as_slice()).bind(target.as_slice()).bind(parent.id)
        .fetch_one(&pool).await.unwrap();
    let action: Uuid = sqlx::query_scalar("INSERT INTO relay_admin_actions (report_id, report_community_id, request_id, actor_pubkey, actor_role, action, state) VALUES ($1,$2,$3,$4,'operator','kick','succeeded') RETURNING id")
        .bind(report).bind(community.as_uuid()).bind(Uuid::new_v4())
        .bind(owner.public_key().to_bytes().as_slice()).fetch_one(&pool).await.unwrap();
    state
        .db
        .deploy_kick_member(
            community,
            parent.id,
            &target,
            &owner.public_key().to_bytes(),
        )
        .await
        .unwrap();
    state.db.enqueue_admin_outbox(action, "system_message", serde_json::json!({
        "community_id":community.as_uuid(), "channel_id":parent.id, "target":hex::encode(target),
    }), &action.to_string()).await.unwrap();
    let rows = state
        .db
        .claim_pending_admin_outbox_batch(
            "sessions-test",
            chrono::Utc::now() + chrono::Duration::seconds(60),
            10,
        )
        .await
        .unwrap();
    let row = rows.iter().find(|row| row.action_id == action).unwrap();
    crate::handlers::admin_outbox_worker::deliver_one(&state, row).await;
    let delivered: String = sqlx::query_scalar("SELECT state FROM relay_admin_outbox WHERE id=$1")
        .bind(row.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(delivered, "delivered");
    assert!(!state
        .is_member_cached(community, child, &target)
        .await
        .unwrap());
    let notified: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM events WHERE community_id=$1 AND kind=$2 AND tags @> $3)",
    )
    .bind(community.as_uuid())
    .bind(buzz_core::kind::KIND_MEMBER_REMOVED_NOTIFICATION as i32)
    .bind(serde_json::json!([
        ["h", child.to_string()],
        ["p", hex::encode(target)]
    ]))
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        notified,
        "child agents must receive the parent kick notification"
    );
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn session_rollout_switch_gates_advertisement_and_signed_writes() {
    for enabled in [false, true] {
        let state = test_state(enabled).await;
        let community = CommunityId::from_uuid(Uuid::new_v4());
        let host = format!("sessions-rollout-{}.test", community.as_uuid());
        let pool = sqlx::PgPool::connect(&crate::test_support::database_url())
            .await
            .unwrap();
        sqlx::query("INSERT INTO communities(id,host) VALUES ($1,$2)")
            .bind(community.as_uuid())
            .bind(&host)
            .execute(&pool)
            .await
            .unwrap();
        let tenant = TenantContext::resolved(community, host.clone());
        let owner = Keys::generate();
        state
            .db
            .ensure_user(community, &owner.public_key().to_bytes())
            .await
            .unwrap();
        let info = crate::nip11::nip11_document(&state, &host).await;
        assert_eq!(
            info.supported_extensions
                .unwrap_or_default()
                .iter()
                .any(|extension| extension == "buzz-sessions-v1"),
            enabled
        );
        let id = Uuid::new_v4();
        let create = event(
            &owner,
            9050,
            id,
            r#"{"action":"create","title":"Rollout"}"#,
            vec![],
        );
        let result = ingest_event(&state, &tenant, create, auth(&owner)).await;
        if enabled {
            assert!(result.unwrap().accepted);
        } else {
            assert!(
                matches!(result, Err(crate::handlers::ingest::IngestError::Rejected(message)) if message.contains("sessions are not enabled"))
            );
        }
        assert_eq!(
            state
                .db
                .session_info(community, id)
                .await
                .unwrap()
                .is_some(),
            enabled
        );
    }
}
