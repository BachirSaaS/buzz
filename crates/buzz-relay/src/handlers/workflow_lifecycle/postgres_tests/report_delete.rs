//! Report-resolution and recovery must not split a freshly saved workflow.
use super::*;
use crate::handlers::{admin_action_worker, report_resolution};

async fn report(
    f: &Fixture,
    target: &Event,
    time: u64,
) -> buzz_db::admin_moderation::AdminReportDetail {
    let event = EventBuilder::new(Kind::Custom(1984), "workflow report")
        .tags([
            Tag::parse(vec!["e".into(), target.id.to_hex(), "spam".into()]).expect("e tag"),
            Tag::parse(vec!["p".into(), target.pubkey.to_hex()]).expect("p tag"),
        ])
        .allow_self_tagging()
        .custom_created_at(Timestamp::from(time))
        .sign_with_keys(&f.keys)
        .expect("signed report");
    assert!(f.send(&event).await.expect("ingest report").accepted);
    let id: Uuid = sqlx::query_scalar(
        "SELECT id FROM moderation_reports WHERE community_id = $1 AND report_event_id = $2",
    )
    .bind(f.tenant.community().as_uuid())
    .bind(event.id.as_bytes().as_slice())
    .fetch_one(&f.pool)
    .await
    .expect("stored report");
    f.state
        .db
        .admin_get_report(id)
        .await
        .expect("report lookup")
        .expect("report exists")
}

async fn resolve(
    f: &Fixture,
    report: &buzz_db::admin_moderation::AdminReportDetail,
    recover: bool,
) -> Uuid {
    let actor = Keys::generate().public_key().to_bytes();
    let request_id = Uuid::new_v4();
    if !recover {
        // This is the production orchestration invoked by authorized HTTP report resolution.
        // It is intentionally not a test of HTTP authentication.
        let result = report_resolution::resolve_report_with_enforcement(
            &f.state,
            &f.tenant,
            report,
            "delete",
            None,
            None,
            request_id,
            &actor,
            "operator",
            "relay_operator",
        )
        .await;
        return match result {
            Ok(done) => done.action_id,
            Err(report_resolution::ResolutionError::EnforcementFailed { action_id, .. }) => {
                action_id
            }
            Err(other) => panic!("unexpected resolution failure: {other:?}"),
        };
    }
    // A crash after the durable claim but before mutation must take the same guarded path.
    let (owner, target) = report_resolution::derive_enforcement_target(report).expect("target");
    let claim = f
        .state
        .db
        .claim_report_for_enforcement(
            f.tenant.community(),
            report.report.id,
            request_id,
            &actor,
            "operator",
            "delete",
            None,
            None,
            "resolve:delete",
            "relay_operator",
            owner.as_deref(),
            target.as_deref(),
            report.report.channel_id,
        )
        .await
        .expect("claim before crash");
    let buzz_db::relay_admin_actions::ClaimResult::Claimed(action) = claim else {
        panic!("fresh report must be claimed");
    };
    let mut batch = f
        .state
        .db
        .claim_stranded_admin_action_batch(
            "workflow-report-regression",
            chrono::Utc::now() + chrono::Duration::seconds(120),
            8,
        )
        .await
        .expect("recovery batch");
    assert_eq!(
        batch.len(),
        1,
        "isolated database contains only this stranded action"
    );
    let stranded = batch.remove(0);
    assert_eq!(stranded.record.id, action.id);
    admin_action_worker::recover_one(&f.state, stranded).await;
    action.id
}

async fn assert_workflow_rejected(f: &Fixture, action_id: Uuid) {
    let action = f
        .state
        .db
        .get_admin_action(action_id)
        .await
        .expect("action")
        .expect("exists");
    assert_eq!(
        action.state, "failed",
        "report delete must fail rather than splitting lifecycle"
    );
    assert_eq!(action.step_marker, None, "no successful mutation marker");
    assert!(action
        .error_message
        .as_deref()
        .expect("explicit failure")
        .contains("workflow definitions require canonical author-signed deletion"));
    let outbox: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM relay_admin_outbox WHERE action_id = $1")
            .bind(action_id)
            .fetch_one(&f.pool)
            .await
            .expect("outbox count");
    assert_eq!(
        outbox, 0,
        "do not announce an enforcement that never happened"
    );
}

async fn workflow_report_delete(recover: bool) {
    let f = Fixture::new().await;
    let disabled = f.save(f.now, "report target");
    let saved = f.sign(
        Kind::Custom(KIND_WORKFLOW_DEF as u16),
        f.now,
        &disabled.content.replace("enabled: false", "enabled: true"),
        vec![
            vec!["d".into(), f.id.to_string()],
            vec!["h".into(), f.channel.to_string()],
        ],
    );
    assert!(f.send(&saved).await.expect("atomic save").accepted);
    let before = f.live().await;
    let reported = report(&f, &saved, f.now + 1).await;
    let action_id = resolve(&f, &reported, recover).await;
    assert_workflow_rejected(&f, action_id).await;
    assert_eq!(
        f.live().await,
        before,
        "definition, runtime and cutoff must stay unchanged"
    );
    let enabled = f
        .state
        .db
        .list_enabled_channel_workflows(f.tenant.community(), f.channel)
        .await
        .expect("runtime selection");
    assert!(enabled.iter().any(|row| row.id == f.id));
    // File a second report while the target is live, then resolve it after the
    // owner's canonical deletion. Report ingest correctly rejects hidden targets.
    let pending = report(&f, &saved, f.now + 2).await;
    let deletion = f.delete(f.now + 3);
    assert!(
        f.send(&deletion)
            .await
            .expect("canonical deletion remains usable")
            .accepted
    );
    assert_eq!(
        f.live().await,
        (None, None, Some(deletion.id.to_bytes().to_vec()))
    );
    // A pending report against a tombstoned definition must not acquire a success marker.
    let repeated_id = resolve(&f, &pending, recover).await;
    assert_workflow_rejected(&f, repeated_id).await;
    assert_eq!(
        f.live().await,
        (None, None, Some(deletion.id.to_bytes().to_vec()))
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn report_resolution_rejects_workflow_delete_and_preserves_owner_recovery() {
    workflow_report_delete(false).await;
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn report_recovery_worker_rejects_workflow_delete_and_preserves_owner_recovery() {
    workflow_report_delete(true).await;
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn report_deletion_still_enforces_ordinary_events_through_both_drivers() {
    let f = Fixture::new().await;
    for (i, recover) in [false, true].into_iter().enumerate() {
        let event = f.sign(
            Kind::Custom(9),
            f.now + i as u64,
            "ordinary content",
            vec![vec!["h".into(), f.channel.to_string()]],
        );
        assert!(f.send(&event).await.expect("message").accepted);
        let reported = report(&f, &event, f.now + 10 + i as u64).await;
        let action_id = resolve(&f, &reported, recover).await;
        let action = f
            .state
            .db
            .get_admin_action(action_id)
            .await
            .expect("action")
            .expect("exists");
        assert_eq!(action.state, "succeeded");
        assert_eq!(action.step_marker.as_deref(), Some("artifacts_done"));
        let deleted: bool = sqlx::query_scalar(
            "SELECT deleted_at IS NOT NULL FROM events WHERE community_id = $1 AND id = $2",
        )
        .bind(f.tenant.community().as_uuid())
        .bind(event.id.as_bytes().as_slice())
        .fetch_one(&f.pool)
        .await
        .expect("stored target");
        assert!(deleted, "ordinary event moderation remains effective");
    }
}
