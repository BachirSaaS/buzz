//! Private version-1 isolated-turn Unix socket protocol.
//!
//! Each connection carries one frame: a four-byte unsigned big-endian byte
//! length followed by UTF-8 JSON. Frames are capped at 1 MiB. The request is
//! `{version:1,requestId,prompt,deadlineMs}` and the terminal response is one of
//! `completed`, `cancelled`, `failed`, or `busy` (tagged by `kind`).

use serde::{Deserialize, Serialize};
use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{oneshot, Semaphore};

const MAX_FRAME: usize = 1024 * 1024;
const MAX_ERROR_CHARS: usize = 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExecuteRequest {
    version: u8,
    pub(crate) request_id: String,
    pub(crate) prompt: String,
    pub(crate) deadline_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum ExecuteResult {
    Completed {
        #[serde(rename = "stopReason")]
        stop_reason: String,
    },
    Cancelled,
    Failed {
        retryable: bool,
        message: String,
    },
    Busy,
}

/// Bind and secure the endpoint before the caller starts any other service.
pub(crate) async fn bind(path: &Path) -> anyhow::Result<UnixListener> {
    validate_parent(path)?;
    if tokio::fs::symlink_metadata(path).await.is_ok() {
        anyhow::bail!("isolated-turn socket path already exists");
    }
    let listener = UnixListener::bind(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) =
            tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await
        {
            drop(listener);
            let _ = tokio::fs::remove_file(path).await;
            return Err(error.into());
        }
    }
    Ok(listener)
}

pub(crate) async fn serve<F, Fut>(
    listener: UnixListener,
    max_deadline_ms: u64,
    execute: F,
) -> anyhow::Result<()>
where
    F: Fn(ExecuteRequest, oneshot::Receiver<()>) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = anyhow::Result<Option<String>>> + Send + 'static,
{
    let execute = Arc::new(execute);
    let active = Arc::new(Semaphore::new(1));
    tracing::info!("isolated-turn endpoint ready");
    loop {
        let (stream, _) = listener.accept().await?;
        let execute = execute.clone();
        let active = active.clone();
        tokio::spawn(async move {
            if let Err(error) = handle(stream, active, max_deadline_ms, execute).await {
                tracing::warn!("isolated-turn connection failed: {error}");
            }
        });
    }
}

async fn handle<F, Fut>(
    mut stream: UnixStream,
    active: Arc<Semaphore>,
    max_ms: u64,
    execute: Arc<F>,
) -> anyhow::Result<()>
where
    F: Fn(ExecuteRequest, oneshot::Receiver<()>) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = anyhow::Result<Option<String>>> + Send + 'static,
{
    let mut request: ExecuteRequest = read_frame(&mut stream).await?;
    if request.version != 1
        || request.request_id.is_empty()
        || request.prompt.is_empty()
        || request.deadline_ms == 0
    {
        return write_frame(
            &mut stream,
            &ExecuteResult::Failed {
                retryable: false,
                message: "invalid version-1 request".into(),
            },
        )
        .await;
    }
    let Ok(_permit) = active.try_acquire_owned() else {
        return write_frame(&mut stream, &ExecuteResult::Busy).await;
    };
    request.deadline_ms = request.deadline_ms.min(max_ms);
    tracing::info!(request_id = %request.request_id, "isolated turn started");
    let (cancel_tx, cancel_rx) = oneshot::channel();
    let execution = execute(request, cancel_rx);
    tokio::pin!(execution);
    let result = tokio::select! {
        result = &mut execution => result,
        read = stream.read_u8() => {
            let _ = cancel_tx.send(());
            let result = execution.await;
            tracing::debug!(?read, "isolated-turn client disconnected");
            result
        }
    };
    let result = match result {
        Ok(Some(stop_reason)) => ExecuteResult::Completed { stop_reason },
        Ok(None) => ExecuteResult::Cancelled,
        Err(error) => ExecuteResult::Failed {
            retryable: true,
            message: bounded(&error.to_string()),
        },
    };
    // Execution cleanup above is authoritative even when the peer is gone.
    match write_frame(&mut stream, &result).await {
        Err(error) if error.downcast_ref::<std::io::Error>().is_some() => Ok(()),
        other => other,
    }
}

async fn read_frame<T: serde::de::DeserializeOwned>(stream: &mut UnixStream) -> anyhow::Result<T> {
    let len = stream.read_u32().await? as usize;
    if len > MAX_FRAME {
        anyhow::bail!("frame exceeds 1 MiB");
    }
    let mut bytes = vec![0; len];
    stream.read_exact(&mut bytes).await?;
    Ok(serde_json::from_slice(&bytes)?)
}

async fn write_frame<T: Serialize>(stream: &mut UnixStream, value: &T) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec(value)?;
    stream.write_u32(u32::try_from(bytes.len())?).await?;
    stream.write_all(&bytes).await?;
    stream.shutdown().await?;
    Ok(())
}

fn bounded(message: &str) -> String {
    message.chars().take(MAX_ERROR_CHARS).collect()
}

fn validate_parent(path: &Path) -> anyhow::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("socket needs a parent directory"))?;
    let metadata = std::fs::symlink_metadata(parent)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("runtime directory must be a real directory");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.uid() != nix::unistd::Uid::effective().as_raw()
            || metadata.permissions().mode() & 0o077 != 0
        {
            anyhow::bail!("runtime directory must be owned by this user with mode 0700");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_one_request_rejects_configuration_fields() {
        let valid = br#"{"version":1,"requestId":"r1","prompt":"work\nnow","deadlineMs":5000}"#;
        let request: ExecuteRequest = serde_json::from_slice(valid).expect("valid v1 request");
        assert_eq!(request.request_id, "r1");
        assert_eq!(request.prompt, "work\nnow");
        let selected_process =
            br#"{"version":1,"requestId":"r1","prompt":"work","deadlineMs":5000,"command":"sh"}"#;
        assert!(serde_json::from_slice::<ExecuteRequest>(selected_process).is_err());
    }

    #[test]
    fn terminal_result_has_fixed_tagged_shape() {
        assert_eq!(
            serde_json::to_value(ExecuteResult::Completed {
                stop_reason: "end_turn".into()
            })
            .expect("serialize result"),
            serde_json::json!({"kind":"completed","stopReason":"end_turn"})
        );
        assert_eq!(
            serde_json::to_value(ExecuteResult::Failed {
                retryable: true,
                message: "provider unavailable".into()
            })
            .expect("serialize result"),
            serde_json::json!({"kind":"failed","retryable":true,"message":"provider unavailable"})
        );
    }

    #[test]
    fn error_text_is_bounded_by_characters() {
        let message = "é".repeat(MAX_ERROR_CHARS + 1);
        assert_eq!(bounded(&message).chars().count(), MAX_ERROR_CHARS);
    }

    #[tokio::test]
    async fn oversized_frame_is_rejected_before_allocation() {
        let (mut client, mut server) = UnixStream::pair().expect("socket pair");
        client
            .write_u32((MAX_FRAME + 1) as u32)
            .await
            .expect("write length");
        let error = read_frame::<ExecuteRequest>(&mut server)
            .await
            .expect_err("oversized frame must fail");
        assert!(error.to_string().contains("exceeds 1 MiB"));
    }

    #[tokio::test]
    async fn disconnect_cancels_and_waits_for_execution_cleanup() {
        let (mut client, server) = UnixStream::pair().expect("socket pair");
        let active = Arc::new(Semaphore::new(1));
        let (cleaned_tx, cleaned_rx) = oneshot::channel();
        let cleaned_tx = Arc::new(std::sync::Mutex::new(Some(cleaned_tx)));
        let task = tokio::spawn(handle(
            server,
            active,
            60_000,
            Arc::new(move |_request, cancel: oneshot::Receiver<()>| {
                let cleaned_tx = cleaned_tx.clone();
                async move {
                    cancel.await.expect("disconnect signal");
                    if let Some(tx) = cleaned_tx.lock().expect("sender lock").take() {
                        tx.send(()).ok();
                    }
                    Ok(None)
                }
            }),
        ));
        write_frame(
            &mut client,
            &serde_json::json!({
                "version": 1, "requestId": "r1", "prompt": "work", "deadlineMs": 60_000
            }),
        )
        .await
        .expect("write request");
        drop(client);
        tokio::time::timeout(std::time::Duration::from_secs(1), cleaned_rx)
            .await
            .expect("cleanup did not await deadline")
            .expect("cleanup sender");
        task.await.expect("handler join").expect("handler result");
    }

    #[tokio::test]
    async fn concurrent_request_gets_busy_without_execution() {
        let active = Arc::new(Semaphore::new(1));
        let permit = active.clone().acquire_owned().await.expect("active permit");
        let (mut client, server) = UnixStream::pair().expect("socket pair");
        let task = tokio::spawn(handle(
            server,
            active,
            60_000,
            Arc::new(|_request, _cancel| async {
                panic!("busy request must not execute");
                #[allow(unreachable_code)]
                Ok(None)
            }),
        ));
        write_frame(
            &mut client,
            &serde_json::json!({
                "version": 1, "requestId": "r2", "prompt": "work", "deadlineMs": 60_000
            }),
        )
        .await
        .expect("write request");
        let response: serde_json::Value = read_frame(&mut client).await.expect("busy response");
        assert_eq!(response, serde_json::json!({"kind":"busy"}));
        task.await.expect("handler join").expect("handler result");
        drop(permit);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn bound_socket_is_private_and_existing_path_is_fatal() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("buzz-acp-isolated-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir(&dir).expect("create runtime dir");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
            .expect("secure runtime dir");
        let path = dir.join("turn.sock");
        let listener = bind(&path).await.expect("bind endpoint");
        assert_eq!(
            std::fs::metadata(&path)
                .expect("socket metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert!(
            bind(&path).await.is_err(),
            "existing endpoint must fail startup"
        );
        drop(listener);
        std::fs::remove_dir_all(dir).expect("remove runtime dir");
    }
}
