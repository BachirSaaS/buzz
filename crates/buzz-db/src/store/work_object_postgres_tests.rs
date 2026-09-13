use super::*;
use buzz_core::work_object::Home;
use nostr::{EventBuilder, Keys, Kind, Tag};

async fn fixture() -> (Db, CommunityId, Uuid, Keys) {
    let pool = sqlx::PgPool::connect(&crate::test_support::database_url())
        .await
        .unwrap();
    let db = Db::from_pool(pool);
    let community = CommunityId::from_uuid(Uuid::new_v4());
    sqlx::query("INSERT INTO communities(id,host) VALUES($1,$2)")
        .bind(community.as_uuid())
        .bind(format!("{}.test", community.as_uuid()))
        .execute(&db.pool)
        .await
        .unwrap();
    let keys = Keys::generate();
    let channel_id = Uuid::new_v4();
    channel(&db, community, channel_id, &keys).await;
    (db, community, channel_id, keys)
}
async fn channel(db: &Db, c: CommunityId, id: Uuid, keys: &Keys) {
    sqlx::query("INSERT INTO channels(community_id,id,name,created_by,visibility) VALUES($1,$2,'room',$3,'private')")
        .bind(c.as_uuid()).bind(id).bind(keys.public_key().to_bytes().as_slice()).execute(&db.pool).await.unwrap();
    sqlx::query(
        "INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,'owner')",
    )
    .bind(c.as_uuid())
    .bind(id)
    .bind(keys.public_key().to_bytes().as_slice())
    .execute(&db.pool)
    .await
    .unwrap();
}
fn revision(channel: Uuid) -> Revision {
    Revision {
        home: Home {
            object: Uuid::new_v4(),
            channel,
            root: None,
            project: None,
            parent: None,
            repository: None,
            git: None,
            branch: None,
        },
        previous: None,
        deleted: false,
        state: serde_json::json!({"title":"private object"}),
    }
}
fn signed(kind: u32, r: &Revision, keys: &Keys) -> Event {
    EventBuilder::new(Kind::Custom(kind as u16), serde_json::to_string(r).unwrap())
        .tags([
            Tag::parse(["h", &r.home.channel.to_string()]).unwrap(),
            Tag::parse(["object", &r.home.object.to_string()]).unwrap(),
        ])
        .sign_with_keys(keys)
        .unwrap()
}
async fn root(db: &Db, c: CommunityId, channel: Uuid, keys: &Keys) -> Event {
    let event = EventBuilder::new(Kind::Custom(9), Uuid::new_v4().to_string())
        .tags([Tag::parse(["h", &channel.to_string()]).unwrap()])
        .sign_with_keys(keys)
        .unwrap();
    db.insert_event(c, &event, Some(channel)).await.unwrap();
    sqlx::query("INSERT INTO thread_metadata(community_id,event_created_at,event_id,channel_id) SELECT community_id,created_at,id,channel_id FROM events WHERE community_id=$1 AND id=$2")
        .bind(c.as_uuid()).bind(event.id.as_bytes().as_slice()).execute(&db.pool).await.unwrap();
    event
}
#[tokio::test]
#[ignore = "requires Postgres"]
async fn claims_cas_authority_and_tombstones_are_atomic() {
    let (db, c, ch, keys) = fixture().await;
    let mut r = revision(ch);
    let first = signed(KIND_WORK_PROJECT, &r, &keys);
    let (stored, inserted) = db.accept_work_object(c, &first).await.unwrap();
    assert!(inserted);
    assert_eq!(stored.channel_id, Some(ch));
    assert!(!db.accept_work_object(c, &first).await.unwrap().1);
    let duplicate = signed(KIND_WORK_PROJECT, &revision(ch), &keys);
    assert!(db.accept_work_object(c, &duplicate).await.is_err());
    assert!(db
        .get_event_by_id(c, duplicate.id.as_bytes())
        .await
        .unwrap()
        .is_none());
    r.previous = Some(first.id.to_hex());
    r.state = serde_json::json!({"title":"second"});
    let a = signed(KIND_WORK_PROJECT, &r, &keys);
    r.state = serde_json::json!({"title":"third"});
    let b = signed(KIND_WORK_PROJECT, &r, &keys);
    let (a_result, b_result) =
        tokio::join!(db.accept_work_object(c, &a), db.accept_work_object(c, &b));
    assert_ne!(a_result.is_ok(), b_result.is_ok());
    let winner = if a_result.is_ok() { &a } else { &b };
    r.previous = Some(winner.id.to_hex());
    let outsider = signed(KIND_WORK_PROJECT, &r, &Keys::generate());
    assert!(db.accept_work_object(c, &outsider).await.is_err());
    let other = Uuid::new_v4();
    channel(&db, c, other, &keys).await;
    r.home.channel = other;
    assert!(db
        .accept_work_object(c, &signed(KIND_WORK_PROJECT, &r, &keys))
        .await
        .is_err());
    r.home.channel = ch;
    r.deleted = true;
    let tombstone = signed(KIND_WORK_PROJECT, &r, &keys);
    db.accept_work_object(c, &tombstone).await.unwrap();
    r.deleted = false;
    r.previous = Some(tombstone.id.to_hex());
    assert!(db
        .accept_work_object(c, &signed(KIND_WORK_PROJECT, &r, &keys))
        .await
        .is_err());
    assert!(db.accept_work_object(c, &duplicate).await.is_err());
}
#[tokio::test]
#[ignore = "requires Postgres"]
async fn task_project_and_cross_type_thread_constraints() {
    let (db, c, ch, keys) = fixture().await;
    let project = revision(ch);
    db.accept_work_object(c, &signed(KIND_WORK_PROJECT, &project, &keys))
        .await
        .unwrap();
    let root = root(&db, c, ch, &keys).await;
    let mut task = revision(ch);
    task.home.root = Some(root.id.to_hex());
    task.home.project = Some(project.home.object);
    db.accept_work_object(c, &signed(KIND_WORK_TASK, &task, &keys))
        .await
        .unwrap();
    let mut document = revision(ch);
    document.home.root = task.home.root.clone();
    assert!(db
        .accept_work_object(c, &signed(KIND_WORK_DOCUMENT, &document, &keys))
        .await
        .is_err());
    let ch2 = Uuid::new_v4();
    channel(&db, c, ch2, &keys).await;
    task.home.object = Uuid::new_v4();
    task.home.channel = ch2;
    assert!(db
        .accept_work_object(c, &signed(KIND_WORK_TASK, &task, &keys))
        .await
        .is_err());
    task.home.root = Some(root.id.to_hex());
    task.home.channel = ch;
    task.home.project = Some(Uuid::new_v4());
    assert!(db
        .accept_work_object(c, &signed(KIND_WORK_TASK, &task, &keys))
        .await
        .is_err());
    // Community-local identity does not resolve in a different tenant.
    let (_, other_c, _, _) = fixture().await;
    assert!(db
        .accept_work_object(other_c, &signed(KIND_WORK_TASK, &task, &keys))
        .await
        .is_err());
}
#[tokio::test]
#[ignore = "requires Postgres"]
async fn adoption_fences_legacy_moves_and_branch_home_is_unique() {
    let (db, c, ch, keys) = fixture().await;
    let announce = |channel: Uuid| {
        EventBuilder::new(Kind::Custom(30617), "repo")
            .tags([
                Tag::parse(["d", "repo"]).unwrap(),
                Tag::parse(["buzz-channel", &channel.to_string()]).unwrap(),
            ])
            .sign_with_keys(&keys)
            .unwrap()
    };
    let announcement = announce(ch);
    db.replace_parameterized_event(c, &announcement, "repo", None)
        .await
        .unwrap();
    let mut repo = revision(ch);
    repo.home.git = Some(format!("30617:{}:repo", keys.public_key().to_hex()));
    db.accept_work_object(c, &signed(KIND_WORK_REPOSITORY, &repo, &keys))
        .await
        .unwrap();
    assert!(db
        .replace_parameterized_event(c, &announce(Uuid::new_v4()), "repo", None)
        .await
        .is_err());
    let r = root(&db, c, ch, &keys).await;
    let mut branch = revision(ch);
    branch.home.root = Some(r.id.to_hex());
    branch.home.repository = Some(repo.home.object);
    branch.home.branch = Some("refs/heads/feature".into());
    db.accept_work_object(c, &signed(KIND_WORK_BRANCH, &branch, &keys))
        .await
        .unwrap();
    branch.home.object = Uuid::new_v4();
    assert!(db
        .accept_work_object(c, &signed(KIND_WORK_BRANCH, &branch, &keys))
        .await
        .is_err());
    branch.home.branch = Some("refs/heads/feature-two".into());
    db.accept_work_object(c, &signed(KIND_WORK_BRANCH, &branch, &keys))
        .await
        .unwrap();
    let mut doc = revision(ch);
    doc.home.root = Some(r.id.to_hex());
    assert!(db
        .accept_work_object(c, &signed(KIND_WORK_DOCUMENT, &doc, &keys))
        .await
        .is_err());
}
