//! Atomic admission of new work against the selected workflow incarnation.

use sqlx::PgPool;
use uuid::Uuid;

use super::WorkflowRecord;
use crate::Result;

/// Insert a pending run only if the selected workflow is still current and eligible.
///
/// The record must be the one used to select/authorize the execution definition;
/// its community is server-resolved provenance, never a client-supplied tenant.
/// Returns `None` if the workflow is missing, inactive, disabled, or no longer
/// matches the selected definition hash, owner, channel or creation incarnation.
/// Database failures remain errors. Callers must not execute without `Some(id)`.
///
/// A SHARE row lock conflicts with updates and deletion until the INSERT commits
/// (unlike the FK's KEY SHARE lock). PostgreSQL rechecks the predicates after a
/// concurrent writer settles; selection and insertion have no unlocked gap.
/// Already admitted runs are intentionally unaffected by this boundary.
///
/// `trigger_context` stores the serialized `TriggerContext` so approval resume
/// can restore the original trigger data and `{{trigger.*}}` template variables.
pub async fn create_workflow_run(
    pool: &PgPool,
    workflow: &WorkflowRecord,
    trigger_event_id: Option<&[u8]>,
    trigger_context: Option<&serde_json::Value>,
) -> Result<Option<Uuid>> {
    Ok(sqlx::query_scalar(
        r#"
        WITH eligible AS (
            SELECT community_id, id FROM workflows
            WHERE community_id = $1 AND id = $2
              AND status = 'active' AND enabled = TRUE
              AND definition_hash = $3 AND owner_pubkey = $4
              AND channel_id IS NOT DISTINCT FROM $5 AND created_at = $6
            FOR SHARE
        )
        INSERT INTO workflow_runs
            (community_id, id, workflow_id, status, trigger_event_id, current_step, execution_trace, trigger_context)
        SELECT community_id, $7, id, 'pending', $8, 0, '[]', $9 FROM eligible
        RETURNING id
        "#,
    )
    .bind(workflow.community_id.as_uuid())
    .bind(workflow.id)
    .bind(&workflow.definition_hash)
    .bind(&workflow.owner_pubkey)
    .bind(workflow.channel_id)
    .bind(workflow.created_at)
    .bind(Uuid::new_v4())
    .bind(trigger_event_id)
    .bind(trigger_context)
    .fetch_optional(pool)
    .await?)
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
    use crate::{workflow, CommunityId};
    use std::time::Duration;

    async fn fixture() -> (PgPool, WorkflowRecord) {
        let pool = PgPool::connect(&crate::test_support::database_url())
            .await
            .expect("test database");
        let community = CommunityId::from_uuid(Uuid::new_v4());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community.as_uuid())
            .bind(format!("admission-{}.example", community.as_uuid()))
            .execute(&pool)
            .await
            .unwrap();
        let owner = [0x31; 32];
        crate::user::ensure_user(&pool, community, &owner)
            .await
            .unwrap();
        let id = workflow::create_workflow(
            &pool,
            community,
            None,
            &owner,
            "admission",
            r#"{"enabled":true}"#,
            &[0x41; 32],
        )
        .await
        .unwrap();
        let selected = workflow::get_workflow(&pool, community, id).await.unwrap();
        (pool, selected)
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn admission_requires_selected_identity_revision_and_eligibility() {
        let (pool, selected) = fixture().await;
        let db = crate::Db::from_pool(pool.clone());
        let trigger = serde_json::json!({"text":"original trigger"});
        let event = [0x51; 32];
        let id = db
            .create_workflow_run(&selected, Some(&event), Some(&trigger))
            .await
            .unwrap()
            .expect("current record admitted");
        let run = db
            .get_workflow_run(selected.community_id, id)
            .await
            .unwrap();
        assert_eq!(run.workflow_id, selected.id);
        assert_eq!(run.community_id, selected.community_id);
        assert_eq!(run.trigger_event_id.as_deref(), Some(event.as_slice()));
        assert_eq!(run.trigger_context, Some(trigger));
        assert_eq!(run.status, workflow::RunStatus::Pending);

        for field in ["community", "id", "owner", "channel", "hash", "incarnation"] {
            let mut stale = selected.clone();
            match field {
                "community" => stale.community_id = CommunityId::from_uuid(Uuid::new_v4()),
                "id" => stale.id = Uuid::new_v4(),
                "owner" => stale.owner_pubkey = vec![0x32; 32],
                "channel" => stale.channel_id = Some(Uuid::new_v4()),
                "hash" => stale.definition_hash = vec![0x42; 32],
                "incarnation" => stale.created_at += chrono::Duration::microseconds(1),
                _ => unreachable!(),
            }
            assert!(
                db.create_workflow_run(&stale, None, None)
                    .await
                    .unwrap()
                    .is_none(),
                "{field}"
            );
        }
        workflow::set_workflow_enabled(&pool, selected.community_id, selected.id, false)
            .await
            .unwrap();
        assert!(db
            .create_workflow_run(&selected, None, None)
            .await
            .unwrap()
            .is_none());
        workflow::set_workflow_enabled(&pool, selected.community_id, selected.id, true)
            .await
            .unwrap();
        for status in [
            workflow::WorkflowStatus::Disabled,
            workflow::WorkflowStatus::Archived,
        ] {
            workflow::update_workflow_status(&pool, selected.community_id, selected.id, status)
                .await
                .unwrap();
            assert!(db
                .create_workflow_run(&selected, None, None)
                .await
                .unwrap()
                .is_none());
        }
        // Rejected attempts left no run rows, and did not alter an admitted run.
        assert_eq!(
            db.list_workflow_runs(selected.community_id, selected.id, 100)
                .await
                .unwrap()
                .len(),
            1
        );
        workflow::delete_workflow(&pool, selected.community_id, selected.id)
            .await
            .unwrap();
        assert!(db
            .create_workflow_run(&selected, None, None)
            .await
            .unwrap()
            .is_none());
    }

    /// Observe a real server lock wait, not a sleep that merely hopes admission ran.
    async fn wait_for_admission_lock(
        pool: &PgPool,
        writer_pid: i32,
        admission: &tokio::task::JoinHandle<crate::Result<Option<Uuid>>>,
    ) {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                assert!(!admission.is_finished(), "admission bypassed the in-flight workflow writer");
                let blocked: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() \
                     AND query LIKE '%WITH eligible AS%' AND $1 = ANY(pg_blocking_pids(pid)))",
                ).bind(writer_pid).fetch_one(pool).await.unwrap();
                if blocked { return; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.expect("admission must wait for the workflow row lock");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn cluster_global_admission_waits_for_update_and_disable_then_rechecks() {
        let (pool, selected) = fixture().await;
        for mutation in [
            "UPDATE workflows SET definition_hash = $3 WHERE community_id = $1 AND id = $2",
            "UPDATE workflows SET enabled = FALSE WHERE community_id = $1 AND id = $2 AND definition_hash <> $3",
        ] {
            let current = workflow::get_workflow(&pool, selected.community_id, selected.id).await.unwrap();
            let mut tx = pool.begin().await.unwrap();
            let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()").fetch_one(&mut *tx).await.unwrap();
            sqlx::query(mutation).bind(selected.community_id.as_uuid()).bind(selected.id).bind(vec![0x42u8; 32])
                .execute(&mut *tx).await.unwrap();
            let db = crate::Db::from_pool(pool.clone());
            let admission = tokio::spawn(async move { db.create_workflow_run(&current, None, None).await });
            wait_for_admission_lock(&pool, pid, &admission).await;
            tx.commit().await.unwrap();
            assert!(tokio::time::timeout(Duration::from_secs(5), admission).await.unwrap().unwrap().unwrap().is_none());
            // Restore eligibility for the next independent in-flight mutation.
            sqlx::query("UPDATE workflows SET definition_hash = $3, enabled = TRUE WHERE community_id = $1 AND id = $2")
                .bind(selected.community_id.as_uuid()).bind(selected.id).bind(&selected.definition_hash)
                .execute(&pool).await.unwrap();
        }
        assert!(
            workflow::list_workflow_runs(&pool, selected.community_id, selected.id, 100)
                .await
                .unwrap()
                .is_empty()
        );

        // A rolled-back disable must release the waiter and admit the unchanged record.
        let mut tx = pool.begin().await.unwrap();
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        sqlx::query("UPDATE workflows SET enabled = FALSE WHERE community_id = $1 AND id = $2")
            .bind(selected.community_id.as_uuid())
            .bind(selected.id)
            .execute(&mut *tx)
            .await
            .unwrap();
        let db = crate::Db::from_pool(pool.clone());
        let admission =
            tokio::spawn(async move { db.create_workflow_run(&selected, None, None).await });
        wait_for_admission_lock(&pool, pid, &admission).await;
        tx.rollback().await.unwrap();
        assert!(tokio::time::timeout(Duration::from_secs(5), admission)
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .is_some());
    }
}
