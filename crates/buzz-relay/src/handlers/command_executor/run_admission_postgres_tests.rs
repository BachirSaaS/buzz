//! Production manual/webhook admission after a concurrent definition update.
use super::*;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use buzz_core::channel::{ChannelType, ChannelVisibility};
use nostr::{EventBuilder, Keys, Kind, Tag};
use std::{future::Future, pin::Pin, sync::Mutex, time::Duration};

#[derive(Default)]
struct Sink(Mutex<Vec<String>>);
impl buzz_workflow::ActionSink for Sink {
    fn send_message(
        &self,
        _: CommunityId,
        _: &str,
        text: &str,
        _: &str,
        _: &str,
        _: Option<&str>,
    ) -> Pin<Box<dyn Future<Output = Result<String, buzz_workflow::ActionSinkError>> + Send + '_>>
    {
        self.0.lock().unwrap().push(text.into());
        Box::pin(async { Ok("ab".repeat(32)) })
    }
}

async fn admission_race(webhook: bool) {
    let state = crate::state::tests::test_state().await;
    assert_eq!(
        state.config.database_url,
        std::env::var("BUZZ_TEST_DATABASE_URL").unwrap()
    );
    let pool = sqlx::PgPool::connect(&state.config.database_url)
        .await
        .unwrap();
    let host = format!("admit-{}.example", Uuid::new_v4());
    let community = state
        .db
        .ensure_configured_community(&host)
        .await
        .unwrap()
        .id;
    let tenant = TenantContext::resolved(community, host.clone());
    let keys = Keys::generate();
    state
        .db
        .ensure_user(community, keys.public_key().as_bytes())
        .await
        .unwrap();
    let channel = state
        .db
        .create_channel(
            community,
            "admit",
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            keys.public_key().as_bytes(),
            None,
        )
        .await
        .unwrap()
        .id;
    let id = Uuid::new_v4();
    let mut definition = serde_json::json!({"name":"admit", "enabled":true,
        "trigger":{"on":"webhook"}, "steps":[{"id":"emit","action":"send_message","text":"old-action"}]});
    webhook_secret::inject_secret(&mut definition, "test-secret");
    let json = definition.to_string();
    state
        .db
        .upsert_workflow(
            community,
            id,
            Some(channel),
            keys.public_key().as_bytes(),
            "admit",
            &json,
            &Sha256::digest(json.as_bytes()),
        )
        .await
        .unwrap();
    let sink = Arc::new(Sink::default());
    state.workflow_engine.set_action_sink(sink.clone());

    for commit_update in [true, false] {
        // Block the real authority SELECT after the caller selected its definition.
        // Only then update: a caller that refreshes the record but executes the
        // original definition will now incorrectly admit old-action.
        let mut tx = pool.begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        sqlx::query("LOCK TABLE channel_members IN ACCESS EXCLUSIVE MODE")
            .execute(&mut *tx)
            .await
            .unwrap();
        let event = EventBuilder::new(
            Kind::Custom(KIND_WORKFLOW_TRIGGER as u16),
            Uuid::new_v4().to_string(),
        )
        .tags([Tag::parse(["d", &id.to_string()]).unwrap()])
        .sign_with_keys(&keys)
        .unwrap();
        let event_id = event.id;
        let call_state = state.clone();
        let call_host = host.clone();
        let call_tenant = tenant.clone();
        let auth = IngestAuth::Nip42 {
            pubkey: keys.public_key(),
            scopes: vec![buzz_auth::Scope::MessagesWrite],
            channel_ids: None,
            conn_id: Uuid::new_v4(),
        };
        let call = tokio::spawn(async move {
            if webhook {
                let mut headers = HeaderMap::new();
                headers.insert("host", call_host.parse().unwrap());
                headers.insert("x-webhook-secret", "test-secret".parse().unwrap());
                match crate::api::bridge::workflow_webhook(
                    State(call_state),
                    Path(id.to_string()),
                    Query(crate::api::bridge::WebhookQuery { secret: None }),
                    headers,
                    axum::body::Bytes::new(),
                )
                .await
                {
                    Ok((code, _)) => {
                        assert_eq!(code, StatusCode::ACCEPTED);
                        true
                    }
                    Err((code, _)) => {
                        assert_eq!(code, StatusCode::NOT_FOUND);
                        false
                    }
                }
            } else {
                match handle_workflow_trigger(&call_tenant, &call_state, &event, &auth).await {
                    Ok(result) => {
                        assert!(result.accepted);
                        true
                    }
                    Err(IngestError::Rejected(reason)) => {
                        assert_eq!(reason, "forbidden: workflow changed or is no longer active");
                        false
                    }
                    Err(e) => panic!("unexpected manual result: {e:?}"),
                }
            }
        });
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                assert!(!call.is_finished(), "caller did not reach authority gate");
                let waiting: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM pg_stat_activity \
                    WHERE datname=current_database() AND query LIKE '%channel_members%' \
                    AND $1=ANY(pg_blocking_pids(pid)))",
                )
                .bind(pid)
                .fetch_one(&pool)
                .await
                .unwrap();
                if waiting {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("authority SELECT must block");
        definition["steps"][0]["text"] = serde_json::json!(if commit_update {
            "new-action"
        } else {
            "rolled-back-action"
        });
        let json = definition.to_string();
        buzz_db::workflow::upsert_workflow_in_transaction(
            &mut tx,
            community,
            id,
            Some(channel),
            keys.public_key().as_bytes(),
            "admit",
            &json,
            &Sha256::digest(json.as_bytes()),
        )
        .await
        .unwrap();
        if commit_update {
            tx.commit().await.unwrap();
        } else {
            tx.rollback().await.unwrap();
        }
        let accepted = tokio::time::timeout(Duration::from_secs(5), call)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            accepted, !commit_update,
            "stale selection must not admit; rollback must admit"
        );
        if commit_update {
            assert!(state
                .db
                .list_workflow_runs(community, id, 100)
                .await
                .unwrap()
                .is_empty());
            assert!(sink.0.lock().unwrap().is_empty());
            if !webhook {
                let seen: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM events WHERE community_id=$1 AND id=$2)",
                )
                .bind(community.as_uuid())
                .bind(event_id.as_bytes().as_slice())
                .fetch_one(&pool)
                .await
                .unwrap();
                assert!(!seen, "rejected manual command must roll back");
            }
        } else {
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let runs = state
                        .db
                        .list_workflow_runs(community, id, 100)
                        .await
                        .unwrap();
                    assert_eq!(runs.len(), 1);
                    if runs[0].status == RunStatus::Completed {
                        break;
                    }
                    assert!(!matches!(
                        runs[0].status,
                        RunStatus::Failed | RunStatus::Cancelled
                    ));
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("positive execution");
            assert_eq!(*sink.0.lock().unwrap(), ["new-action"]);
        }
    }
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn cluster_global_manual_admission_keeps_selected_revision_and_rejects_none() {
    admission_race(false).await;
}
#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn cluster_global_webhook_admission_keeps_selected_revision_and_rejects_none() {
    admission_race(true).await;
}
