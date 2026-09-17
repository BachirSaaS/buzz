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
use tokio::sync::Semaphore;

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
    Completed { stop_reason: String },
    Cancelled,
    Failed { retryable: bool, message: String },
    Busy,
}

pub(crate) async fn serve<F, Fut>(
    path: &Path,
    max_deadline_ms: u64,
    execute: F,
) -> anyhow::Result<()>
where
    F: Fn(ExecuteRequest) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = anyhow::Result<String>> + Send + 'static,
{
    validate_parent(path)?;
    if tokio::fs::symlink_metadata(path).await.is_ok() {
        anyhow::bail!("isolated-turn socket path already exists");
    }
    let listener = UnixListener::bind(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await?;
    }
    let execute = Arc::new(execute);
    let active = Arc::new(Semaphore::new(1));
    tracing::info!(socket = %path.display(), "isolated-turn endpoint ready");
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
    F: Fn(ExecuteRequest) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = anyhow::Result<String>> + Send + 'static,
{
    let request: ExecuteRequest = read_frame(&mut stream).await?;
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
    let deadline = std::time::Duration::from_millis(request.deadline_ms.min(max_ms));
    tracing::info!(request_id = %request.request_id, "isolated turn started");
    let result = match tokio::time::timeout(deadline, execute(request)).await {
        Ok(Ok(stop_reason)) => ExecuteResult::Completed { stop_reason },
        Ok(Err(error)) => ExecuteResult::Failed {
            retryable: true,
            message: bounded(&error.to_string()),
        },
        Err(_) => ExecuteResult::Cancelled,
    };
    write_frame(&mut stream, &result).await
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
