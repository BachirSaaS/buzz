use super::*;
use crate::active_user_signer::tests::ControlledSigner;

#[tokio::test]
async fn blossom_auth_uses_async_signer_and_preserves_upload_scope() {
    let controlled = ControlledSigner::new(false);
    let signer = ActiveUserSigner::new(controlled.clone()).await.unwrap();
    let task = tokio::spawn(async move {
        sign_blossom_upload_auth(&signer, "abc123", 300, "https://relay.example:8443").await
    });
    controlled.wait_entered().await;
    assert!(!task.is_finished());
    controlled.release.notify_one();
    let event = task.await.unwrap().unwrap();
    assert_eq!(event.pubkey, controlled.keys.public_key());
    assert_eq!(event.kind.as_u16(), 24242);
    assert_eq!(event.content, "Upload buzz-media");
    assert_eq!(event.tags.len(), 4);
    for tag in [
        ["t", "upload"],
        ["x", "abc123"],
        ["server", "relay.example:8443"],
    ] {
        assert!(event.tags.iter().any(|actual| actual.as_slice() == tag));
    }
    event.verify().unwrap();

    let controlled = ControlledSigner::new(true);
    let signer = ActiveUserSigner::new(controlled.clone()).await.unwrap();
    let task = tokio::spawn(async move {
        sign_blossom_get_auth_header(&signer, "https://relay.example", 600).await
    });
    controlled.wait_entered().await;
    assert!(!task.is_finished());
    controlled.release.notify_one();
    assert!(task
        .await
        .unwrap()
        .unwrap_err()
        .contains("deliberate signer failure"));
}
