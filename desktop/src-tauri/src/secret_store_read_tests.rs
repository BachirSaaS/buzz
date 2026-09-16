use super::SecretStore;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Barrier,
};

#[test]
fn concurrent_blob_readers_share_one_permission_request() {
    let store = SecretStore::keyring("buzz-test-single-read");
    let calls = AtomicUsize::new(0);
    let start = Barrier::new(20);
    std::thread::scope(|scope| {
        for _ in 0..20 {
            scope.spawn(|| {
                start.wait();
                let result = store.load_blob_with(|| {
                    calls.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    Ok(Some(br#"{"identity":"test-secret"}"#.to_vec()))
                });
                assert_eq!(result.unwrap().unwrap()["identity"], "test-secret");
            });
        }
    });
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn denied_blob_reads_stay_errors_without_reprompting() {
    let store = SecretStore::keyring("buzz-test-denied-read");
    let calls = AtomicUsize::new(0);
    for _ in 0..20 {
        assert_eq!(
            store.load_blob_with(|| {
                calls.fetch_add(1, Ordering::SeqCst);
                Err("keyring read: access denied".into())
            }),
            Err("keyring read: access denied".into())
        );
    }
    // Exercise public callers too: denial must not become an empty/success result
    // or fall through to legacy migration (which would make another OS request).
    assert!(store.load("identity").is_err());
    assert_eq!(store.probe("identity"), super::KeyringProbe::Unreachable);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn missing_and_malformed_blobs_do_not_reprompt() {
    for raw in [None, Some(b"not-json".to_vec())] {
        let store = SecretStore::keyring("buzz-test-empty-read");
        let first = store.load_blob_with(|| Ok(raw.clone()));
        let second = store.load_blob_with(|| panic!("repeated OS read"));
        assert_eq!(first, second);
        assert_eq!(first.is_err(), raw.is_some());
    }
}
