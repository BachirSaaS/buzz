//! Exercise the actual HTTP bridge and shared WS ingress, not only the DB API.
use super::*;
use crate::handlers::{
    ingest::{ingest_event, IngestAuth},
    req::{apply_channel_scope_to_query, build_event_query_from_filter},
};
use buzz_core::{
    kind::KIND_WORK_PROJECT,
    work_object::{Home, Revision},
};
use nostr::{EventBuilder, Kind, Tag};

#[tokio::test]
#[ignore = "requires Postgres"]
async fn canonical_http_ws_ingress_and_private_history_count() {
    let state = bridge_handler_test_state()
        .await
        .expect("isolated services");
    let host = format!("canonical-{}.local", uuid::Uuid::new_v4());
    state.db.ensure_configured_community(&host).await.unwrap();
    let tenant = crate::tenant::bind_community(&state.db, &host)
        .await
        .unwrap();
    let keys = Keys::generate();
    let ch = uuid::Uuid::new_v4();
    state
        .db
        .create_channel_with_id(
            tenant.community(),
            ch,
            "canonical-room",
            buzz_db::channel::ChannelType::Stream,
            buzz_db::channel::ChannelVisibility::Private,
            None,
            keys.public_key().as_bytes(),
            None,
        )
        .await
        .unwrap();
    let mut revision = Revision {
        home: Home {
            object: uuid::Uuid::new_v4(),
            channel: ch,
            root: None,
            project: None,
            parent: None,
            repository: None,
            git: None,
            branch: None,
        },
        previous: None,
        deleted: false,
        state: serde_json::json!({"title":"private canonical"}),
    };
    let sign = |r: &Revision| {
        EventBuilder::new(
            Kind::Custom(KIND_WORK_PROJECT as u16),
            serde_json::to_string(r).unwrap(),
        )
        .tags([
            Tag::parse(["h", &ch.to_string()]).unwrap(),
            Tag::parse(["object", &r.home.object.to_string()]).unwrap(),
        ])
        .sign_with_keys(&keys)
        .unwrap()
    };
    let first = sign(&revision);
    assert_eq!(
        post_events(
            state.clone(),
            &host,
            &keys.public_key().to_hex(),
            &serde_json::to_vec(&first).unwrap()
        )
        .await,
        axum::http::StatusCode::OK
    );
    revision.previous = Some(first.id.to_hex());
    revision.state = serde_json::json!({"title":"updated"});
    let second = sign(&revision);
    let ws_auth = || IngestAuth::Nip42 {
        pubkey: keys.public_key(),
        scopes: buzz_auth::Scope::all_known(),
        channel_ids: None,
        conn_id: uuid::Uuid::new_v4(),
    };
    assert!(
        ingest_event(&state, &tenant, second.clone(), ws_auth())
            .await
            .unwrap()
            .accepted
    );
    revision.state = serde_json::json!({"title":"stale"});
    assert!(ingest_event(&state, &tenant, sign(&revision), ws_auth())
        .await
        .is_err());
    // Production REQ scoping is shared by HTTP query/count and WS history.
    let filter = buzz_core::Filter::new().kind(Kind::Custom(KIND_WORK_PROJECT as u16));
    let mut query = build_event_query_from_filter(
        &filter,
        keys.public_key().as_bytes(),
        &state,
        tenant.community(),
    )
    .await;
    apply_channel_scope_to_query(&mut query, &filter, None, &[]);
    assert!(state.db.query_events(&query).await.unwrap().is_empty());
    assert_eq!(state.db.count_events(&query).await.unwrap(), 0);
    apply_channel_scope_to_query(&mut query, &filter, None, &[ch]);
    assert_eq!(state.db.query_events(&query).await.unwrap().len(), 2);
    assert_eq!(state.db.count_events(&query).await.unwrap(), 2);
    let deletion = EventBuilder::new(Kind::Custom(5), "")
        .tags([Tag::parse(["e", &second.id.to_hex()]).unwrap()])
        .sign_with_keys(&keys)
        .unwrap();
    assert!(ingest_event(&state, &tenant, deletion, ws_auth())
        .await
        .is_err());
    let malformed = EventBuilder::new(
        Kind::Custom(KIND_WORK_PROJECT as u16),
        serde_json::to_string(&revision).unwrap(),
    )
    .sign_with_keys(&keys)
    .unwrap();
    assert_ne!(
        post_events(
            state.clone(),
            &host,
            &keys.public_key().to_hex(),
            &serde_json::to_vec(&malformed).unwrap()
        )
        .await,
        axum::http::StatusCode::OK
    );
}
