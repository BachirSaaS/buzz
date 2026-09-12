use super::*;
use crate::active_user_signer::tests::ControlledSigner;

#[tokio::test]
async fn renderer_signing_awaits_backend_and_keeps_requested_fields() {
    let controlled = ControlledSigner::new(false);
    let signer = ActiveUserSigner::new(controlled.clone()).await.unwrap();
    let task = tokio::spawn(async move {
        sign_renderer_event(
            &signer,
            9,
            "hello".into(),
            Some(123456),
            vec![vec!["h".into(), "channel".into()]],
        )
        .await
    });
    controlled.wait_entered().await;
    assert!(!task.is_finished());
    controlled.release.notify_one();
    let event = Event::from_json(task.await.unwrap().unwrap()).unwrap();
    let expected = EventBuilder::new(Kind::Custom(9), "hello")
        .custom_created_at(Timestamp::from(123456))
        .tags([Tag::parse(["h", "channel"]).unwrap()])
        .sign_with_keys(&controlled.keys)
        .unwrap();
    assert_eq!(event.id, expected.id);
    event.verify().unwrap();
}

#[tokio::test]
async fn renderer_auth_keeps_literal_relay_and_challenge_and_propagates_failure() {
    for fail in [false, true] {
        let controlled = ControlledSigner::new(fail);
        let signer = ActiveUserSigner::new(controlled.clone()).await.unwrap();
        let task = tokio::spawn(async move {
            sign_renderer_auth(&signer, "test-challenge", "wss://relay.example/path").await
        });
        controlled.wait_entered().await;
        assert!(!task.is_finished());
        controlled.release.notify_one();
        let result = task.await.unwrap();
        if fail {
            assert!(result.unwrap_err().contains("deliberate signer failure"));
        } else {
            let event = Event::from_json(result.unwrap()).unwrap();
            assert_eq!(event.kind.as_u16(), 22242);
            assert!(event.content.is_empty());
            assert_eq!(
                event.tags.clone().to_vec(),
                vec![
                    Tag::parse(["relay", "wss://relay.example/path"]).unwrap(),
                    Tag::parse(["challenge", "test-challenge"]).unwrap()
                ]
            );
            event.verify().unwrap();
        }
    }
}

#[tokio::test]
async fn observer_control_is_user_authored_and_agent_encrypted() {
    let user = Keys::generate();
    let agent = Keys::generate();
    let signer = ActiveUserSigner::local(user.clone());
    let payload = serde_json::json!({"type": "test-control"});
    let event = Event::from_json(
        build_observer_control_with_signer(&signer, &agent.public_key().to_hex(), &payload)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(event.pubkey, user.public_key());
    assert_ne!(event.pubkey, agent.public_key());
    event.verify().unwrap();
    let decrypted: serde_json::Value =
        buzz_core_pkg::observer::decrypt_observer_payload(&agent, &event).unwrap();
    assert_eq!(decrypted, payload);
    assert_eq!(
        decrypt_observer_event_with_keys(&agent, &event.as_json()).unwrap(),
        payload
    );
    let mut tampered = event;
    tampered.content.push('x');
    assert_eq!(
        decrypt_observer_event_with_keys(&agent, &tampered.as_json()).unwrap_err(),
        "observer event has invalid ID"
    );
}
