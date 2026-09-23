//! Feedback attachment fetch (one validated path shared by preview and save)
//! and the native save flow, with the dialog and disk write injected so the
//! save logic is testable without a window.

use std::future::Future;
use std::path::{Path, PathBuf};

use super::helpers::finish_attachment_response;
use super::{client, origin, routes, ATTACHMENT_CAP};

/// Fetch a feedback attachment, enforcing the caller's server-validated
/// `imeta` MIME and size: inputs are checked before any network activity, the
/// relay's `Content-Type` must match, and the body is streamed under the cap
/// and must equal `expected_size`. Errors are stable `admin_attachment_*` codes.
pub(super) async fn fetch_feedback_attachment(
    origin: &str,
    feedback_id: &str,
    sha256: &str,
    expected_mime: &str,
    expected_size: u64,
    keys: &nostr::Keys,
) -> Result<Vec<u8>, String> {
    use crate::relay::build_nip98_auth_header_for_keys;

    let feedback_id = uuid::Uuid::parse_str(feedback_id)
        .map_err(|_| "admin_attachment_invalid_feedback_id".to_string())?;
    let sha256 = routes::AttachmentHash::parse(sha256)
        .map_err(|_| "admin_attachment_invalid_hash".to_string())?;
    if expected_size == 0 {
        return Err("admin_attachment_invalid_size".to_string());
    }
    if expected_size > ATTACHMENT_CAP {
        return Err("admin_attachment_too_large".to_string());
    }
    if expected_mime.is_empty() {
        return Err("admin_attachment_invalid_mime".to_string());
    }

    let origin = origin::AdminOrigin::parse(origin)?;
    let url = origin.route_url(
        &routes::AdminRoute::FeedbackAttachment {
            id: feedback_id,
            sha256,
        },
        &routes::AdminQuery::default(),
    );
    let http_client = client::ADMIN_CLIENT
        .get()
        .ok_or_else(|| "admin client not initialised".to_string())?;

    // One retry on 401 with a fresh NIP-98 event.
    let mut resp = None;
    for _ in 0..2 {
        let auth = build_nip98_auth_header_for_keys(keys, &reqwest::Method::GET, &url, &[])
            .map_err(|e| format!("nip98 build failed: {e}"))?;
        let r = http_client
            .get(&url)
            .header(reqwest::header::AUTHORIZATION, auth)
            .send()
            .await
            .map_err(|e| {
                tracing::debug!(error = %e, "admin attachment fetch failed");
                "admin_attachment_network_error".to_string()
            })?;
        let unauthorized = r.status() == reqwest::StatusCode::UNAUTHORIZED;
        resp = Some(r);
        if !unauthorized {
            break;
        }
    }
    let resp = resp.expect("loop runs at least once");
    finish_attachment_response(resp, expected_mime, expected_size).await
}

/// Suggested filename and dialog-filter extension for an attachment, e.g.
/// `("attachment-a1b2c3d4.docx", "docx")`. Unknown MIME types save as `.bin`.
pub(super) fn attachment_file_name(sha256: &str, mime: &str) -> (String, &'static str) {
    let mime = mime.trim().to_ascii_lowercase();
    let ext = match mime.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/wav" => "wav",
        "application/pdf" => "pdf",
        "application/msword" => "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "application/vnd.ms-excel" => "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        "application/vnd.ms-powerpoint" => "ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
        "application/zip" => "zip",
        "application/gzip" => "gz",
        "application/json" => "json",
        "text/plain" => "txt",
        "text/csv" => "csv",
        "text/markdown" => "md",
        _ => "bin",
    };
    let prefix: String = sha256.chars().take(8).collect();
    (format!("attachment-{prefix}.{ext}"), ext)
}

/// Fetch, ask the user where to save, and write. `Ok(false)` means the user
/// cancelled; the fetch completes (and any fetch error surfaces) before the
/// dialog opens, so a failed download never prompts for a path.
pub(super) async fn save_attachment<Pick, PickFut>(
    fetch: impl Future<Output = Result<Vec<u8>, String>>,
    sha256: &str,
    mime: &str,
    pick: Pick,
    write: impl FnOnce(&Path, &[u8]) -> std::io::Result<()>,
) -> Result<bool, String>
where
    Pick: FnOnce(String, &'static str, &'static str) -> PickFut,
    PickFut: Future<Output = Result<Option<PathBuf>, String>>,
{
    let bytes = fetch.await?;
    let (suggested, ext) = attachment_file_name(sha256, mime);
    let filter = if mime.starts_with("image/") {
        "Images"
    } else {
        "Files"
    };
    let Some(dest) = pick(suggested, filter, ext).await? else {
        return Ok(false);
    };
    write(&dest, &bytes).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    const SHA: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    #[test]
    fn file_name_uses_canonical_extensions() {
        let docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        for (mime, want) in [
            ("image/png", "png"),
            ("image/jpeg", "jpg"),
            ("application/gzip", "gz"),
            ("application/octet-stream", "bin"),
            (docx, "docx"),
            ("application/pdf", "pdf"),
            ("Text/Plain", "txt"),
            ("application/x-unknown", "bin"),
        ] {
            let (name, ext) = attachment_file_name(SHA, mime);
            assert_eq!(ext, want, "{mime}");
            assert_eq!(name, format!("attachment-a1b2c3d4.{want}"));
        }
    }

    #[tokio::test]
    async fn save_writes_fetched_bytes_to_the_chosen_path() {
        let offered = RefCell::new(None);
        let written = RefCell::new(None);
        let saved = save_attachment(
            async { Ok(b"PK-bytes".to_vec()) },
            SHA,
            "application/zip",
            |name, filter, ext| {
                *offered.borrow_mut() = Some((name, filter, ext));
                async { Ok(Some(PathBuf::from("/chosen/report.zip"))) }
            },
            |path, bytes| {
                *written.borrow_mut() = Some((path.to_owned(), bytes.to_vec()));
                Ok(())
            },
        )
        .await;
        assert_eq!(saved, Ok(true));
        assert_eq!(
            offered.into_inner(),
            Some(("attachment-a1b2c3d4.zip".to_owned(), "Files", "zip"))
        );
        assert_eq!(
            written.into_inner(),
            Some((PathBuf::from("/chosen/report.zip"), b"PK-bytes".to_vec()))
        );
    }

    #[tokio::test]
    async fn cancelled_dialog_writes_nothing() {
        let saved = save_attachment(
            async { Ok(vec![1]) },
            SHA,
            "application/pdf",
            |_, _, _| async { Ok(None) },
            |_, _| panic!("must not write after cancel"),
        )
        .await;
        assert_eq!(saved, Ok(false));
    }

    #[tokio::test]
    async fn fetch_error_surfaces_before_the_dialog_opens() {
        let saved = save_attachment(
            async { Err("admin_attachment_mime_mismatch".to_string()) },
            SHA,
            "application/pdf",
            |_, _, _| -> std::future::Ready<Result<Option<PathBuf>, String>> {
                panic!("must not prompt after a failed fetch")
            },
            |_, _| panic!("must not write after a failed fetch"),
        )
        .await;
        assert_eq!(saved, Err("admin_attachment_mime_mismatch".to_string()));
    }

    #[tokio::test]
    async fn write_error_is_reported() {
        let saved = save_attachment(
            async { Ok(vec![1]) },
            SHA,
            "application/pdf",
            |_, _, _| async { Ok(Some(PathBuf::from("/read-only/x.pdf"))) },
            |_, _| Err(std::io::Error::other("read-only volume")),
        )
        .await;
        assert_eq!(
            saved,
            Err("Failed to write file: read-only volume".to_string())
        );
    }
}
