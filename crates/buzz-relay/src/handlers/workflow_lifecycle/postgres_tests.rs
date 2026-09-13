//! Real ingest + PostgreSQL lifecycle tests. The nextest wrapper owns a database per test.
use super::super::ingest::ingest_event;
use super::*;
use buzz_auth::Scope;
use buzz_core::{
    channel::{ChannelType, ChannelVisibility},
    kind::KIND_WORKFLOW_DEF,
};
use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};

struct Fixture {
    state: Arc<AppState>,
    pool: sqlx::PgPool,
    tenant: TenantContext,
    keys: Keys,
    channel: Uuid,
    id: Uuid,
    now: u64,
    _cache: tempfile::TempDir,
}
impl Fixture {
    async fn new() -> Self {
        let url =
            std::env::var("BUZZ_TEST_DATABASE_URL").expect("isolated PostgreSQL URL required");
        assert_eq!(
            std::env::var("BUZZ_TEST_SCHEMA_MODE").as_deref(),
            Ok("desired")
        );
        let pool = sqlx::PgPool::connect(&url)
            .await
            .expect("connect isolated database");
        let db = buzz_db::Db::from_pool(pool.clone());
        let host = format!("workflow-{}.example", Uuid::new_v4());
        let community = db
            .ensure_configured_community(&host)
            .await
            .expect("community")
            .id;
        let tenant = TenantContext::resolved(community, host);
        let keys = Keys::generate();
        let channel = db
            .create_channel(
                community,
                "workflow-test",
                ChannelType::Stream,
                ChannelVisibility::Private,
                None,
                keys.public_key().as_bytes(),
                None,
            )
            .await
            .expect("channel")
            .id;
        let mut config = crate::config::Config::from_env().expect("config");
        config.database_url = url;
        // Deliberately no live Redis, relay, S3, subscriber or workflow executor.
        // The post-commit broadcast may fail; durable completion must not depend on it.
        config.redis_url = "redis://127.0.0.1:1".into();
        config.require_relay_membership = false;
        let cache = tempfile::tempdir().expect("cache dir");
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
            config,
            db,
            redis,
            None,
            pubsub,
            auth,
            search,
            engine,
            Keys::generate(),
            media,
        );
        Self {
            state: Arc::new(state),
            pool,
            tenant,
            keys,
            channel,
            id: Uuid::new_v4(),
            now: Timestamp::now().as_secs(),
            _cache: cache,
        }
    }
    fn auth(&self) -> IngestAuth {
        IngestAuth::Nip42 {
            pubkey: self.keys.public_key(),
            scopes: vec![Scope::MessagesWrite],
            channel_ids: None,
            conn_id: Uuid::new_v4(),
        }
    }
    fn save(&self, time: u64, name: &str) -> Event {
        self.sign(Kind::Custom(KIND_WORKFLOW_DEF as u16), time,
            &format!("name: {name}\nenabled: false\ntrigger:\n  on: message_posted\nsteps:\n  - id: wait\n    action: delay\n    duration: 1s\n"),
            vec![vec!["d".into(), self.id.to_string()], vec!["h".into(), self.channel.to_string()]])
    }
    fn delete(&self, time: u64) -> Event {
        self.sign(
            Kind::EventDeletion,
            time,
            "",
            vec![vec![
                "a".into(),
                format!("30620:{}:{}", self.keys.public_key(), self.id),
            ]],
        )
    }
    fn sign(&self, kind: Kind, time: u64, content: &str, tags: Vec<Vec<String>>) -> Event {
        EventBuilder::new(kind, content)
            .tags(tags.into_iter().map(|t| Tag::parse(t).expect("tag")))
            .custom_created_at(Timestamp::from(time))
            .sign_with_keys(&self.keys)
            .expect("signed fixture")
    }
    async fn send(&self, event: &Event) -> Result<IngestResult, IngestError> {
        ingest_event(&self.state, &self.tenant, event.clone(), self.auth()).await
    }
    async fn live(&self) -> (Option<Vec<u8>>, Option<String>, Option<Vec<u8>>) {
        let mut tx = self
            .state
            .db
            .begin_event_write_transaction()
            .await
            .expect("tx");
        let owner = self.keys.public_key().to_bytes();
        let head = lifecycle::head(&mut tx, self.tenant.community(), &owner, self.id)
            .await
            .expect("head");
        let cutoff = lifecycle::deletion(&mut tx, self.tenant.community(), &owner, self.id)
            .await
            .expect("cutoff");
        let runtime =
            match workflow::get_workflow_in_transaction(&mut tx, self.tenant.community(), self.id)
                .await
            {
                Ok(row) => Some(row.name),
                Err(DbError::NotFound(_)) => None,
                Err(e) => panic!("runtime: {e}"),
            };
        (head.map(|h| h.id), runtime, cutoff.map(|d| d.event_id))
    }
    async fn seen(&self, event: &Event) -> bool {
        let mut tx = self
            .state
            .db
            .begin_event_write_transaction()
            .await
            .expect("tx");
        lifecycle::event_seen(&mut tx, self.tenant.community(), event)
            .await
            .expect("seen")
    }
}
fn reject(result: Result<IngestResult, IngestError>, prefix: &str) {
    match result {
        Err(IngestError::Rejected(message) | IngestError::AuthFailed(message)) => {
            assert!(message.starts_with(prefix), "{message}")
        }
        Err(other) => panic!("expected {prefix}, got {other:?}"),
        Ok(result) => panic!("expected {prefix}, got success {}", result.message),
    }
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn ingest_save_projects_enabled_for_creation_updates_and_default() {
    let f = Fixture::new().await;
    let mut previous = None;
    for (index, configured) in [Some(false), Some(true), Some(false), None, Some(false)]
        .into_iter()
        .enumerate()
    {
        let enabled = configured.unwrap_or(true);
        let setting = configured
            .map(|value| format!("enabled: {value}\n"))
            .unwrap_or_default();
        let yaml = format!("name: enabled projection\n{setting}trigger:\n  on: reaction_added\nsteps:\n  - id: wait\n    action: delay\n    duration: 1s\n");
        let mut tags = vec![
            vec!["d".into(), f.id.to_string()],
            vec!["h".into(), f.channel.to_string()],
        ];
        if let Some(revision) = previous {
            tags.push(vec!["expected-revision".into(), revision]);
        }
        let event = f.sign(
            Kind::Custom(KIND_WORKFLOW_DEF as u16),
            f.now + index as u64,
            &yaml,
            tags,
        );
        assert!(
            f.send(&event)
                .await
                .expect("save configured state")
                .accepted
        );
        let row = f
            .state
            .db
            .get_workflow(f.tenant.community(), f.id)
            .await
            .expect("runtime");
        assert_eq!(
            row.definition["enabled"], enabled,
            "canonical definition step {index}"
        );
        assert_eq!(
            row.enabled, enabled,
            "runtime enabled projection step {index}"
        );
        assert_eq!(f.live().await.0, Some(event.id.to_bytes().to_vec()));
        let eligible = f
            .state
            .db
            .list_enabled_channel_workflows(f.tenant.community(), f.channel)
            .await
            .expect("trigger eligibility");
        assert_eq!(
            eligible.iter().any(|row| row.id == f.id),
            enabled,
            "automatic eligibility step {index}"
        );
        if !enabled {
            let trigger = f.sign(
                Kind::Custom(buzz_core::kind::KIND_WORKFLOW_TRIGGER as u16),
                f.now + 20 + index as u64,
                "",
                vec![
                    vec!["d".into(), f.id.to_string()],
                    vec!["h".into(), f.channel.to_string()],
                ],
            );
            reject(f.send(&trigger).await, "forbidden: workflow is disabled");
            assert!(!f.seen(&trigger).await);
        }
        previous = Some(event.id.to_hex());
    }
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn ingest_save_delete_replay_and_both_timestamp_orders() {
    let f = Fixture::new().await;
    let create = f.save(f.now, "first");
    assert!(f.send(&create).await.expect("create").accepted);
    assert_eq!(
        f.live().await,
        (
            Some(create.id.to_bytes().to_vec()),
            Some("first".into()),
            None
        )
    );
    let stale = f.delete(f.now - 1);
    reject(f.send(&stale).await, "conflict:");
    assert!(!f.seen(&stale).await);
    // NIP-09 includes the same second; the arrival-order reversal below must agree.
    let delete = f.delete(f.now);
    let result = f.send(&delete).await.expect("delete");
    assert!(result.message.contains("\"deleted\":true"));
    assert_eq!(
        f.live().await,
        (None, None, Some(delete.id.to_bytes().to_vec()))
    );
    assert!(f
        .send(&delete)
        .await
        .expect("verified replay")
        .message
        .starts_with("duplicate:"));
    assert!(f
        .send(&create)
        .await
        .expect("exact save replay")
        .message
        .starts_with("duplicate:"));
    for time in [f.now - 1, f.now] {
        let delayed = f.save(time, "unseen delayed save");
        reject(f.send(&delayed).await, "conflict:");
        assert!(!f.seen(&delayed).await);
    }
    let newer = f.save(f.now + 1, "newer");
    assert!(
        f.send(&newer)
            .await
            .expect("intentional recreation")
            .accepted
    );
    assert!(f
        .send(&delete)
        .await
        .expect("old delete replay")
        .message
        .starts_with("duplicate:"));
    assert_eq!(
        f.live().await,
        (
            Some(newer.id.to_bytes().to_vec()),
            Some("newer".into()),
            Some(delete.id.to_bytes().to_vec())
        )
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn ingest_rolls_back_both_projections_and_proof_on_commit_failure() {
    let f = Fixture::new().await;
    let create = f.save(f.now, "first");
    f.send(&create).await.expect("create");
    let before = f.live().await;
    // A deferred runtime trigger fails at COMMIT, after the real save upsert.
    // The former pool-based upsert would fail here before the event commit; the
    // delete control additionally catches an event/proof committed before runtime work.
    sqlx::raw_sql("CREATE FUNCTION fail_workflow_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture commit failure'; END $$; CREATE CONSTRAINT TRIGGER fail_workflow_commit AFTER INSERT OR UPDATE OR DELETE ON workflows DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_workflow_commit();")
        .execute(&f.pool).await.expect("fault trigger");
    let update = f.save(f.now + 1, "failed update");
    assert!(matches!(
        f.send(&update).await,
        Err(IngestError::Internal(_))
    ));
    assert_eq!(f.live().await, before);
    assert!(!f.seen(&update).await);
    let delete = f.delete(f.now + 2);
    assert!(matches!(
        f.send(&delete).await,
        Err(IngestError::Internal(_))
    ));
    assert_eq!(f.live().await, before);
    assert!(!f.seen(&delete).await);
    sqlx::raw_sql("DROP TRIGGER fail_workflow_commit ON workflows")
        .execute(&f.pool)
        .await
        .expect("clear fault");
    f.send(&update)
        .await
        .expect("same event retry after rollback");
    f.send(&delete)
        .await
        .expect("same delete retry after rollback");
    assert_eq!(
        f.live().await,
        (None, None, Some(delete.id.to_bytes().to_vec()))
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn ingest_denies_wrong_channel_token_owner_revocation_and_legacy_completion() {
    let f = Fixture::new().await;
    let create = f.save(f.now, "first");
    f.send(&create).await.expect("create");
    let before = f.live().await;
    let delete = f.delete(f.now + 1);
    let mut scoped = f.auth();
    if let IngestAuth::Nip42 { channel_ids, .. } = &mut scoped {
        *channel_ids = Some(vec![Uuid::new_v4()]);
    }
    reject(
        ingest_event(&f.state, &f.tenant, delete.clone(), scoped.clone()).await,
        "restricted:",
    );
    reject(
        ingest_event(&f.state, &f.tenant, f.save(f.now + 1, "restricted"), scoped).await,
        "restricted:",
    );
    let wrong_h = f.sign(
        Kind::EventDeletion,
        f.now + 1,
        "",
        vec![
            vec![
                "a".into(),
                format!("30620:{}:{}", f.keys.public_key(), f.id),
            ],
            vec!["h".into(), Uuid::new_v4().to_string()],
        ],
    );
    reject(f.send(&wrong_h).await, "forbidden:");
    let foreign = Keys::generate();
    let wrong_owner = f.sign(
        Kind::EventDeletion,
        f.now + 1,
        "",
        vec![vec![
            "a".into(),
            format!("30620:{}:{}", foreign.public_key(), f.id),
        ]],
    );
    reject(f.send(&wrong_owner).await, "forbidden:");
    // An old accepted generic tombstone is not a forward completion proof.
    let mut tx = f
        .state
        .db
        .begin_event_write_transaction()
        .await
        .expect("tx");
    buzz_db::event::insert_event_in_transaction(
        &mut tx,
        f.tenant.community(),
        &delete,
        Some(f.channel),
    )
    .await
    .expect("legacy event");
    tx.commit().await.expect("legacy commit");
    reject(f.send(&delete).await, "conflict:");
    assert_eq!(f.live().await, before);
    sqlx::query(
        "UPDATE channel_members SET removed_at=NOW() WHERE community_id=$1 AND channel_id=$2",
    )
    .bind(f.tenant.community().as_uuid())
    .bind(f.channel)
    .execute(&f.pool)
    .await
    .expect("revoke");
    reject(f.send(&f.delete(f.now + 2)).await, "forbidden:");
    reject(f.send(&f.save(f.now + 2, "revoked")).await, "forbidden:");
    assert_eq!(f.live().await, before);
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn ingest_save_event_commit_failure_cannot_leave_pool_runtime_upsert() {
    let f = Fixture::new().await;
    let create = f.save(f.now, "first");
    f.send(&create).await.expect("create");
    let before = f.live().await;
    // Events are partitioned: install the deferred failure on the real partition.
    sqlx::raw_sql("CREATE FUNCTION fail_event_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture event commit failure'; END $$; DO $$ DECLARE partition regclass; BEGIN FOR partition IN SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent='events'::regclass LOOP EXECUTE format('CREATE CONSTRAINT TRIGGER fail_event_commit AFTER INSERT ON %s DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_event_commit()', partition); END LOOP; END $$;")
        .execute(&f.pool).await.expect("event fault trigger");
    let update = f.save(f.now + 1, "must roll back runtime too");
    assert!(matches!(
        f.send(&update).await,
        Err(IngestError::Internal(_))
    ));
    assert_eq!(f.live().await, before);
    assert!(!f.seen(&update).await);
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn ingest_concurrent_save_delete_share_coordinate_lock_and_keep_newer_head() {
    let f = Fixture::new().await;
    f.send(&f.save(f.now, "first")).await.expect("create");
    let mut blocker = f
        .state
        .db
        .begin_event_write_transaction()
        .await
        .expect("blocker");
    lifecycle::lock_coordinate(
        &mut blocker,
        f.tenant.community(),
        f.keys.public_key().as_bytes(),
        f.id,
    )
    .await
    .expect("coordinate lock");
    let save = f.save(f.now + 2, "newer wins");
    let delete = f.delete(f.now + 1);
    let (save_result, delete_result) = tokio::join!(async { f.send(&save).await }, async {
        let delete_future = f.send(&delete);
        let release = async {
            tokio::time::timeout(std::time::Duration::from_secs(5), async {
                    loop {
                        let waiting: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())")
                            .fetch_one(&f.pool).await.expect("lock waiters");
                        if waiting >= 2 { break; }
                        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                    }
                }).await.expect("both production paths must wait on the coordinate lock");
            blocker.commit().await.expect("release lock");
        };
        let (result, ()) = tokio::join!(delete_future, release);
        result
    });
    assert!(save_result.expect("save").accepted);
    match delete_result {
        Ok(r) => assert!(r.accepted),
        Err(IngestError::Rejected(m)) => assert!(m.starts_with("conflict:")),
        other => panic!("unexpected delete: {}", other.is_ok()),
    }
    let (head, runtime, _) = f.live().await;
    assert_eq!(head, Some(save.id.to_bytes().to_vec()));
    assert_eq!(runtime, Some("newer wins".into()));
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn ingest_rejects_legacy_split_missing_archived_and_cross_community_targets() {
    let f = Fixture::new().await;
    reject(f.send(&f.delete(f.now)).await, "invalid:");
    let create = f.save(f.now, "first");
    f.send(&create).await.expect("create");
    let other_host = format!("other-{}.example", Uuid::new_v4());
    let other_community = f
        .state
        .db
        .ensure_configured_community(&other_host)
        .await
        .expect("other")
        .id;
    let other = TenantContext::resolved(other_community, other_host);
    reject(
        ingest_event(&f.state, &other, f.delete(f.now + 1), f.auth()).await,
        "invalid:",
    );
    reject(
        ingest_event(
            &f.state,
            &other,
            f.save(f.now + 1, "wrong tenant"),
            f.auth(),
        )
        .await,
        "forbidden:",
    );
    let before = f.live().await;
    sqlx::query("UPDATE channels SET archived_at=NOW() WHERE community_id=$1 AND id=$2")
        .bind(f.tenant.community().as_uuid())
        .bind(f.channel)
        .execute(&f.pool)
        .await
        .expect("archive");
    reject(f.send(&f.delete(f.now + 1)).await, "forbidden:");
    reject(f.send(&f.save(f.now + 1, "archived")).await, "forbidden:");
    assert_eq!(f.live().await, before);
    sqlx::query("UPDATE channels SET archived_at=NULL WHERE community_id=$1 AND id=$2")
        .bind(f.tenant.community().as_uuid())
        .bind(f.channel)
        .execute(&f.pool)
        .await
        .expect("unarchive");
    sqlx::query("DELETE FROM workflows WHERE community_id=$1 AND id=$2")
        .bind(f.tenant.community().as_uuid())
        .bind(f.id)
        .execute(&f.pool)
        .await
        .expect("legacy split");
    reject(f.send(&f.delete(f.now + 1)).await, "conflict:");
    assert_eq!(
        f.live().await,
        (Some(create.id.to_bytes().to_vec()), None, None)
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn ingest_ban_timeout_and_schema_fence_are_enforced() {
    let f = Fixture::new().await;
    f.send(&f.save(f.now, "first")).await.expect("create");
    for (banned, until) in [
        (true, None),
        (
            false,
            Some(chrono::Utc::now() + chrono::Duration::minutes(5)),
        ),
    ] {
        sqlx::query("INSERT INTO community_bans (community_id,pubkey,banned,muted_until,actor_pubkey) VALUES ($1,$2,$3,$4,$2) ON CONFLICT (community_id,pubkey) DO UPDATE SET banned=$3,muted_until=$4")
            .bind(f.tenant.community().as_uuid()).bind(f.keys.public_key().as_bytes().as_slice()).bind(banned).bind(until).execute(&f.pool).await.expect("restriction");
        let prefix = if banned { "blocked:" } else { "restricted:" };
        reject(f.send(&f.save(f.now + 1, "blocked")).await, prefix);
        reject(f.send(&f.delete(f.now + 1)).await, prefix);
    }
    let attached: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='workflow_deletions'::regclass AND NOT tgisinternal AND tgfoid='enforce_community_write_fence()'::regprocedure)")
        .fetch_one(&f.pool).await.expect("live fence catalog");
    assert!(
        attached,
        "desired-state deletion proof table must have a real write fence"
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn ingest_concurrent_webhook_saves_preserve_one_secret_and_cas_revision() {
    let f = Fixture::new().await;
    f.send(&f.save(f.now, "first")).await.expect("create");
    let webhook = |time, name| {
        let save = f.save(time, name);
        f.sign(
            save.kind,
            time,
            &save.content.replace("on: message_posted", "on: webhook"),
            save.tags.iter().map(|t| t.as_slice().to_vec()).collect(),
        )
    };
    let first = webhook(f.now + 1, "webhook first");
    let second = webhook(f.now + 2, "webhook second");
    let (a, b) = tokio::join!(f.send(&first), f.send(&second));
    let receipts: Vec<serde_json::Value> = [a.expect("first outcome"), b.expect("second outcome")]
        .iter()
        .filter_map(|r| {
            r.message
                .strip_prefix("response:")
                .map(|s| serde_json::from_str(s).expect("receipt"))
        })
        .collect();
    let secrets: Vec<_> = receipts
        .iter()
        .filter_map(|v| v.get("webhook_secret").and_then(|v| v.as_str()))
        .collect();
    assert_eq!(
        secrets.len(),
        1,
        "only the first committed webhook transition gets a secret"
    );
    let row = f
        .state
        .db
        .get_workflow(f.tenant.community(), f.id)
        .await
        .expect("runtime");
    assert_eq!(
        crate::webhook_secret::extract_secret(&row.definition).as_deref(),
        Some(secrets[0])
    );
    assert_eq!(row.name, "webhook second");
    let stale = f.sign(
        first.kind,
        f.now + 3,
        &first.content,
        vec![
            vec!["h".into(), f.channel.to_string()],
            vec!["d".into(), f.id.to_string()],
            vec!["expected-revision".into(), first.id.to_hex()],
        ],
    );
    reject(f.send(&stale).await, "conflict:");
    assert_eq!(f.live().await.0, Some(second.id.to_bytes().to_vec()));
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn ingest_rejects_alternate_workflow_deletion_entrances_before_storage() {
    let f = Fixture::new().await;
    let create = f.save(f.now, "named-helper");
    f.send(&create).await.expect("create");
    let before = f.live().await;
    let owner = f.keys.public_key();
    for address in [
        format!("30620:{owner}:named-helper"),
        format!("030620:{owner}:{}", f.id),
        format!("+30620:{owner}:{}", f.id),
        format!("30620:{owner}:{}", f.id.simple()),
    ] {
        let delete = f.sign(
            Kind::EventDeletion,
            f.now + 1,
            "",
            vec![vec!["a".into(), address]],
        );
        assert!(
            f.send(&delete).await.is_err(),
            "noncanonical workflow delete must reject"
        );
        assert!(
            !f.seen(&delete).await,
            "rejection must precede durable acceptance"
        );
        assert_eq!(f.live().await, before);
    }
    for kind in [Kind::EventDeletion, Kind::Custom(9005)] {
        let delete = f.sign(
            kind,
            f.now + 1,
            "",
            vec![
                vec!["e".into(), create.id.to_hex()],
                vec!["h".into(), f.channel.to_string()],
            ],
        );
        assert!(
            f.send(&delete).await.is_err(),
            "definition-only deletion must reject"
        );
        assert!(!f.seen(&delete).await);
        assert_eq!(f.live().await, before);
    }
    // Generic message deletion still works through each original path.
    for (index, kind) in [Kind::EventDeletion, Kind::Custom(9005)]
        .into_iter()
        .enumerate()
    {
        let message = f.sign(
            Kind::Custom(9),
            f.now + index as u64,
            "ordinary message",
            vec![vec!["h".into(), f.channel.to_string()]],
        );
        f.send(&message).await.expect("message create");
        let delete = f.sign(
            kind,
            f.now + 3,
            "",
            vec![
                vec!["e".into(), message.id.to_hex()],
                vec!["h".into(), f.channel.to_string()],
            ],
        );
        assert!(f.send(&delete).await.expect("ordinary delete").accepted);
        let live: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM events WHERE community_id=$1 AND id=$2 AND deleted_at IS NULL)")
            .bind(f.tenant.community().as_uuid()).bind(message.id.as_bytes().as_slice())
            .fetch_one(&f.pool).await.expect("live message");
        assert!(!live, "ordinary message was deleted");
        assert_eq!(f.live().await, before, "workflow remains untouched");
    }
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL"]
async fn nip11_workflow_contract_requires_bound_host_and_stable_identity() {
    let mut f = Fixture::new().await;
    // No stable key: no forward compatibility promise, even on a mapped host.
    let state = Arc::get_mut(&mut f.state).expect("sole state owner");
    Arc::make_mut(&mut state.config).advertise_workflow_lifecycle = true;
    Arc::make_mut(&mut state.config).relay_private_key = None;
    let info = crate::nip11::nip11_document(&f.state, f.tenant.host()).await;
    assert!(info.workflows.is_none());
    let state = Arc::get_mut(&mut f.state).expect("sole state owner");
    Arc::make_mut(&mut state.config).relay_private_key =
        Some(state.relay_keypair.secret_key().to_secret_hex());
    let info = crate::nip11::nip11_document(&f.state, f.tenant.host()).await;
    let descriptor = info.workflows.expect("mapped stable relay advertises");
    assert_eq!(descriptor.lifecycle, 1);
    assert_eq!(descriptor.host, f.tenant.host());
    assert_eq!(
        info.relay_self,
        Some(f.state.relay_keypair.public_key().to_hex())
    );
    assert!(info
        .supported_extensions
        .expect("extensions")
        .contains(&"buzz-workflows".into()));
    for host in ["", "unmapped-workflow.invalid"] {
        let info = crate::nip11::nip11_document(&f.state, host).await;
        assert!(info.workflows.is_none(), "unmapped host must not advertise");
        assert!(!info
            .supported_extensions
            .expect("extensions")
            .contains(&"buzz-workflows".into()));
    }
    f.pool.close().await;
    let info = crate::nip11::nip11_document(&f.state, f.tenant.host()).await;
    assert!(
        info.workflows.is_none(),
        "failed binding must not advertise"
    );
}

mod report_delete_postgres_tests;

mod stale_execution_postgres_tests;
