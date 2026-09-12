//! The forward workflow proof is tenant data, including during whole-community purge.
use super::*;
use buzz_core::channel::{ChannelType, ChannelVisibility};

#[tokio::test]
#[ignore = "requires Postgres"]
async fn desired_workflow_deletion_proofs_are_fenced_and_purged() {
    check_workflow_deletion_proofs("desired").await;
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn migration_schema_workflow_deletion_proofs_are_fenced_and_purged() {
    check_workflow_deletion_proofs("migration").await;
}

async fn check_workflow_deletion_proofs(mode: &str) {
    assert_eq!(std::env::var("BUZZ_TEST_SCHEMA_MODE").as_deref(), Ok(mode));
    let pool = PgPool::connect(&crate::test_support::database_url())
        .await
        .expect("isolated database");
    let db = Db::from_pool(pool.clone());
    if mode == "migration" {
        db.migrate().await.expect("all migrations");
    }
    let store = db.deletion_store();
    let mut tenants = Vec::new();
    for label in ["target", "control"] {
        let host = format!("workflow-purge-{label}-{}.example", Uuid::new_v4());
        let community = db
            .ensure_configured_community(&host)
            .await
            .expect("community")
            .id;
        let channel = db
            .create_channel(
                community,
                "workflows",
                ChannelType::Stream,
                ChannelVisibility::Private,
                None,
                &[7; 32],
                None,
            )
            .await
            .expect("channel")
            .id;
        sqlx::query(
            "INSERT INTO workflow_deletions \
            (community_id, owner_pubkey, workflow_id, channel_id, deleted_through, event_id) \
            VALUES ($1, $2, $3, $4, now(), $5)",
        )
        .bind(community.as_uuid())
        .bind(vec![7_u8; 32])
        .bind(Uuid::new_v4())
        .bind(channel)
        .bind(vec![8_u8; 32])
        .execute(&pool)
        .await
        .expect("proof");
        tenants.push((community, host));
    }
    let (target, host) = &tenants[0];
    let schema = store
        .inventory_schema(*target)
        .await
        .expect("catalog includes proof");
    assert_eq!(schema.row_counts["workflow_deletions"], 1);
    assert!(schema
        .fenced_tables
        .contains(&"workflow_deletions".to_string()));
    let storage = StorageManifest {
        version: 5,
        prefixes: ["_meta", "_uploads", "repos"]
            .into_iter()
            .map(|prefix| {
                let (keys_digest, object_count) = KeyStreamDigest::new().finish();
                PrefixManifest {
                    prefix: format!("{prefix}/{target}/"),
                    keys_digest,
                    object_count,
                    total_bytes: 0,
                }
            })
            .collect(),
    };
    let request = store
        .submit(host, "test-operator", None)
        .await
        .expect("request");
    store
        .freeze_inventory(
            request.id,
            &FrozenInventory {
                schema,
                storage: storage.clone(),
            },
        )
        .await
        .expect("freeze");
    store
        .approve(request.id, "test-approver", None)
        .await
        .expect("approve");
    let claim = store
        .claim_specific(request.id, "test-executor", DEFAULT_LEASE_DURATION)
        .await
        .expect("claim")
        .expect("won claim");
    store.begin_quiescing(&claim.lease).await.expect("quiesce");
    let generation = store.fence(&claim.lease).await.expect("fence");
    let token = LeaseToken {
        fence_generation: Some(generation),
        ..claim.lease
    };
    let error = sqlx::query(
        "UPDATE workflow_deletions SET deleted_through = now() WHERE community_id = $1",
    )
    .bind(target.as_uuid())
    .execute(&pool)
    .await
    .expect_err("proof updates must be fenced");
    assert!(
        error.to_string().contains("community write fenced"),
        "{error}"
    );
    store
        .freeze_destructive_storage_manifest(&token, &storage)
        .await
        .expect("storage");
    store.mark_drained(&token).await.expect("drain");
    store
        .mark_bindings_removed(&token, serde_json::json!({"keys": 0}))
        .await
        .expect("bindings");
    let counts = store
        .purge_postgres(&token)
        .await
        .expect("purge child before channel");
    assert_eq!(counts["workflow_deletions"], 1);
    store
        .mark_cache_purged(&token, serde_json::json!({"keys": 0}))
        .await
        .expect("cache");
    store
        .verify_postgres_logically_deleted(&token)
        .await
        .expect("logical absence");
    let remaining: Vec<Uuid> = sqlx::query_scalar("SELECT community_id FROM workflow_deletions")
        .fetch_all(&pool)
        .await
        .expect("remaining proofs");
    assert_eq!(
        remaining,
        vec![*tenants[1].0.as_uuid()],
        "control tenant stays intact"
    );
}
