//! Two independent engine caches over real signed lifecycle ingest and PostgreSQL.
use super::*;
use buzz_db::workflow::RunStatus;
use buzz_workflow::{ActionSink, ActionSinkError, WorkflowConfig, WorkflowEngine};
use std::{
    future::Future,
    pin::Pin,
    sync::Mutex,
    time::{Duration, Instant},
};

#[derive(Default)]
struct RecordingSink(Mutex<Vec<String>>);
impl ActionSink for RecordingSink {
    fn send_message(
        &self,
        _community_id: buzz_core::CommunityId,
        _channel_id: &str,
        text: &str,
        _authored_text: &str,
        _author_pubkey: &str,
        _reply_to: Option<&str>,
    ) -> Pin<Box<dyn Future<Output = Result<String, ActionSinkError>> + Send + '_>> {
        self.0.lock().expect("sink lock").push(text.to_owned());
        Box::pin(async { Ok("ab".repeat(32)) })
    }
}

fn definition(f: &Fixture, time: u64, enabled: bool, text: &str) -> Event {
    f.sign(
        Kind::Custom(KIND_WORKFLOW_DEF as u16), time,
        &format!("name: cache fence\nenabled: {enabled}\ntrigger:\n  on: reaction_added\nsteps:\n  - id: emit\n    action: send_message\n    text: {text}\n"),
        vec![vec!["d".into(), f.id.to_string()], vec!["h".into(), f.channel.to_string()]],
    )
}

fn reaction(f: &Fixture) -> buzz_core::StoredEvent {
    buzz_core::StoredEvent::new(
        f.sign(
            Kind::Reaction,
            f.now,
            "+",
            vec![vec!["h".into(), f.channel.to_string()]],
        ),
        Some(f.channel),
    )
}

async fn runs(f: &Fixture) -> Vec<buzz_db::workflow::WorkflowRunRecord> {
    f.state
        .db
        .list_workflow_runs(f.tenant.community(), f.id, 100)
        .await
        .expect("runs")
}

async fn completed(f: &Fixture, count: usize) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let rows = runs(f).await;
            assert_eq!(rows.len(), count, "unexpected run count");
            assert!(
                rows.iter()
                    .all(|r| !matches!(r.status, RunStatus::Failed | RunStatus::Cancelled)),
                "execution failed: {rows:?}"
            );
            if rows.iter().all(|r| r.status == RunStatus::Completed) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("executions settle");
}

#[derive(Clone, Copy, Debug)]
enum Transition {
    Update,
    Disable,
    Recreate,
    RecreateIdentical,
}

async fn stale_engine_cannot_admit(transition: Transition) {
    let f = Fixture::new().await;
    let accepting = &f.state.workflow_engine;
    let stale = Arc::new(WorkflowEngine::new(
        f.state.db.clone(),
        WorkflowConfig::default(),
    ));
    let accepting_sink = Arc::new(RecordingSink::default());
    let stale_sink = Arc::new(RecordingSink::default());
    accepting.set_action_sink(accepting_sink.clone());
    stale.set_action_sink(stale_sink.clone());
    assert!(
        f.send(&definition(&f, f.now, true, "old-action"))
            .await
            .expect("create")
            .accepted
    );
    let selected = f
        .state
        .db
        .get_workflow(f.tenant.community(), f.id)
        .await
        .expect("selected revision");

    // Prime both *real* caches without creating runs; message != reaction.
    let warm = buzz_core::StoredEvent::new(
        f.sign(Kind::Custom(9), f.now, "warm", vec![]),
        Some(f.channel),
    );
    accepting
        .on_event(f.tenant.community(), &warm)
        .await
        .expect("warm accepting cache");
    let warmed_at = Instant::now();
    stale
        .on_event(f.tenant.community(), &warm)
        .await
        .expect("warm stale cache");
    stale
        .on_event(f.tenant.community(), &reaction(&f))
        .await
        .expect("initial fire");
    completed(&f, 1).await;
    assert_eq!(*stale_sink.0.lock().expect("sink"), ["old-action"]);
    stale_sink.0.lock().expect("sink").clear();

    let recreate = matches!(
        transition,
        Transition::Recreate | Transition::RecreateIdentical
    );
    if recreate {
        assert!(f.send(&f.delete(f.now + 1)).await.expect("delete").accepted);
        assert!(runs(&f).await.is_empty(), "deletion cascades prior runs");
    }
    let enabled = !matches!(transition, Transition::Disable);
    let text = if matches!(transition, Transition::Update | Transition::Recreate) {
        "new-action"
    } else {
        "old-action"
    };
    assert!(
        f.send(&definition(&f, f.now + 2, enabled, text))
            .await
            .expect("acknowledged transition")
            .accepted
    );
    let current = f
        .state
        .db
        .get_workflow(f.tenant.community(), f.id)
        .await
        .expect("current revision");
    assert_eq!(current.enabled, enabled);
    if matches!(transition, Transition::RecreateIdentical) {
        assert_eq!(
            current.definition_hash, selected.definition_hash,
            "exercise incarnation independently of hash"
        );
        assert_ne!(current.created_at, selected.created_at);
    }

    // No TTL sleep or cache injection: lifecycle acknowledgement orders the fire.
    // Fail on a stalled host rather than falsely passing because moka expired.
    assert!(
        warmed_at.elapsed() < Duration::from_secs(5),
        "fixture exceeded cache-freshness budget"
    );
    stale
        .on_event(f.tenant.community(), &reaction(&f))
        .await
        .expect("stale pod fire attempt");
    assert!(
        warmed_at.elapsed() < Duration::from_secs(10),
        "cache TTL elapsed during probe"
    );
    let prior_runs = if recreate { 0 } else { 1 };
    let after = runs(&f).await;
    if after.len() > prior_runs {
        completed(&f, after.len()).await;
    }
    assert_eq!(
        after.len(),
        prior_runs,
        "{transition:?}: stale cache admitted a run; actions={:?}",
        stale_sink.0.lock().expect("sink")
    );
    assert!(
        stale_sink.0.lock().expect("sink").is_empty(),
        "stale action escaped"
    );

    // The accepting pod must use the current definition, not merely suppress all work.
    accepting
        .on_event(f.tenant.community(), &reaction(&f))
        .await
        .expect("accepting pod fire");
    let expected = prior_runs + usize::from(enabled);
    completed(&f, expected).await;
    let actions = accepting_sink.0.lock().expect("sink");
    if enabled {
        assert_eq!(*actions, [text]);
    } else {
        assert!(actions.is_empty());
    }
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn stale_engine_cannot_run_superseded_actions_after_update() {
    stale_engine_cannot_admit(Transition::Update).await;
}
#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn stale_engine_cannot_run_after_acknowledged_disable() {
    stale_engine_cannot_admit(Transition::Disable).await;
}
#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn stale_engine_cannot_bind_old_actions_to_recreated_uuid() {
    stale_engine_cannot_admit(Transition::Recreate).await;
}
#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn stale_engine_cannot_bind_identical_definition_to_new_incarnation() {
    stale_engine_cannot_admit(Transition::RecreateIdentical).await;
}

/// Exercise the production scheduler loop without exposing a test-only tick API.
#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn cluster_global_scheduler_fences_selected_revision_after_writer_settles() {
    let mut f = Fixture::new().await;
    let engine = &f.state.workflow_engine;
    let sink = Arc::new(RecordingSink::default());
    engine.set_action_sink(sink.clone());
    let make_schedule = |id: Uuid, text: &str| {
        f.sign(Kind::Custom(KIND_WORKFLOW_DEF as u16), f.now,
            &format!("name: scheduled fence\ntrigger:\n  on: schedule\n  cron: '* * * * * *'\nsteps:\n  - id: emit\n    action: send_message\n    text: {text}\n"),
            vec![vec!["d".into(), id.to_string()], vec!["h".into(), f.channel.to_string()]])
    };
    let stale_id = f.id;
    assert!(
        f.send(&make_schedule(stale_id, "stale-schedule"))
            .await
            .expect("stale workflow")
            .accepted
    );
    let control_id = Uuid::new_v4();
    assert!(
        f.send(&make_schedule(control_id, "current-schedule"))
            .await
            .expect("control workflow")
            .accepted
    );
    let mut writer = f.pool.begin().await.expect("writer");
    let writer_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *writer)
        .await
        .expect("writer pid");
    // Ordinary MVCC scheduler selection still sees the old enabled revision;
    // the admission fence must wait and recheck after this writer commits.
    sqlx::query(r#"UPDATE workflows SET definition_hash = $3, definition = jsonb_set(definition, '{steps,0,text}', '"new-schedule"'::jsonb) WHERE community_id=$1 AND id=$2"#)
        .bind(f.tenant.community().as_uuid()).bind(stale_id).bind(vec![0x99_u8;32])
        .execute(&mut *writer).await.expect("in-flight revision update");
    let task_engine = Arc::clone(engine);
    let task = tokio::spawn(async move { task_engine.run().await });
    let wait = tokio::time::timeout(Duration::from_secs(75), async {
        loop {
            let blocked: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%WITH eligible AS%' AND $1 = ANY(pg_blocking_pids(pid)))")
                .bind(writer_pid).fetch_one(&f.pool).await.expect("observe scheduler admission wait");
            if blocked { break; }
            // If the caller refreshes and bypasses the fence, the loop reaches
            // the newer control workflow; that is a failed control, not a timeout.
            assert!(sink.0.lock().expect("sink").is_empty(), "scheduler ran before the revision writer settled");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await;
    if wait.is_err() {
        task.abort();
    }
    wait.expect("scheduler must reach the real admission lock");
    writer.commit().await.expect("commit revision update");
    // created_at ordering puts the control after the stale candidate; its
    // completed run proves the scheduler passed the rejected candidate.
    f.id = control_id;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let rows = runs(&f).await;
            if rows.len() == 1 && rows[0].status == RunStatus::Completed {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("current schedule remains runnable");
    task.abort();
    let _ = task.await;
    f.id = stale_id;
    assert!(
        runs(&f).await.is_empty(),
        "scheduler admitted a superseded selection"
    );
    assert_eq!(*sink.0.lock().expect("sink"), ["current-schedule"]);
}
