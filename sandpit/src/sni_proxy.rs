//! Transparent SNI-inspecting proxy. Peeks at the TLS ClientHello to extract
//! the domain via SNI, checks the blocklist, logs the connection, and forwards
//! raw bytes without breaking TLS.

use std::net::SocketAddr;

use tokio::net::TcpStream;

use crate::proxy_core::{AuditLogger, Blocklist, ConnectionEntry};

pub fn extract_sni(buf: &[u8]) -> Option<String> {
    if buf.len() < 5 || buf[0] != 22 {
        return None;
    }

    let record_len = u16::from_be_bytes([buf[3], buf[4]]) as usize;
    if buf.len() < 5 + record_len {
        return None;
    }

    let hs = &buf[5..5 + record_len];
    if hs.len() < 4 || hs[0] != 1 {
        return None;
    }

    let hs_len = ((hs[1] as usize) << 16) | ((hs[2] as usize) << 8) | (hs[3] as usize);
    if hs.len() < 4 + hs_len {
        return None;
    }

    let ch = &hs[4..4 + hs_len];
    if ch.len() < 35 {
        return None;
    }
    let mut pos = 2 + 32;
    let session_id_len = ch[pos] as usize;
    pos += 1 + session_id_len;

    if pos + 2 > ch.len() {
        return None;
    }
    let cs_len = u16::from_be_bytes([ch[pos], ch[pos + 1]]) as usize;
    pos += 2 + cs_len;

    if pos + 1 > ch.len() {
        return None;
    }
    let cm_len = ch[pos] as usize;
    pos += 1 + cm_len;

    if pos + 2 > ch.len() {
        return None;
    }
    let ext_len = u16::from_be_bytes([ch[pos], ch[pos + 1]]) as usize;
    pos += 2;

    let ext_end = pos + ext_len;
    if ext_end > ch.len() {
        return None;
    }

    while pos + 4 <= ext_end {
        let ext_type = u16::from_be_bytes([ch[pos], ch[pos + 1]]);
        let ext_data_len = u16::from_be_bytes([ch[pos + 2], ch[pos + 3]]) as usize;
        pos += 4;

        if ext_type == 0 && ext_data_len > 0 {
            if pos + 2 > ch.len() {
                return None;
            }
            let mut sni_pos = pos + 2;

            if sni_pos + 3 > ch.len() {
                return None;
            }
            let name_type = ch[sni_pos];
            let name_len = u16::from_be_bytes([ch[sni_pos + 1], ch[sni_pos + 2]]) as usize;
            sni_pos += 3;

            if name_type == 0 && sni_pos + name_len <= ch.len() {
                return String::from_utf8(ch[sni_pos..sni_pos + name_len].to_vec()).ok();
            }
        }

        pos += ext_data_len;
    }

    None
}

pub async fn handle_sni_connection(
    mut client: TcpStream,
    _client_addr: SocketAddr,
    original_dest: Option<SocketAddr>,
    blocklist: &Blocklist,
    audit: Option<&AuditLogger>,
) {
    // Step 1: Peek at the first bytes to try to extract SNI.
    // We use peek() so the data stays in the socket buffer for the real TLS handshake.
    let mut peek_buf = vec![0u8; 4096];
    let n = match client.peek(&mut peek_buf).await {
        Ok(n) if n > 0 => n,
        Ok(_) => {
            tracing::debug!("client sent no data");
            return;
        }
        Err(e) => {
            tracing::debug!(%e, "peek failed");
            return;
        }
    };

    let sni = extract_sni(&peek_buf[..n]);

    // Determine the hostname for logging and blocklist checking.
    let hostname = sni.clone().unwrap_or_else(|| {
        original_dest
            .map(|d| d.ip().to_string())
            .unwrap_or_else(|| "unknown".to_string())
    });

    // Determine the destination to connect to.
    let dest_addr = match original_dest {
        Some(addr) => addr,
        None => {
            // No original destination info — try to resolve the SNI hostname.
            match &sni {
                Some(host) => {
                    let port = 443; // Assume HTTPS
                    match tokio::net::lookup_host(format!("{host}:{port}")).await {
                        Ok(mut addrs) => match addrs.next() {
                            Some(addr) => addr,
                            None => {
                                tracing::warn!(host = %hostname, "DNS resolution returned no addresses");
                                return;
                            }
                        },
                        Err(e) => {
                            tracing::warn!(host = %hostname, %e, "DNS resolution failed");
                            return;
                        }
                    }
                }
                None => {
                    tracing::debug!("no SNI and no original dest, dropping");
                    return;
                }
            }
        }
    };

    let port = dest_addr.port();

    // Step 2: Check blocklist.
    if blocklist.is_blocked(&hostname) {
        if let Some(audit) = audit {
            audit
                .log(&ConnectionEntry {
                    timestamp: chrono::Utc::now(),
                    host: hostname.clone(),
                    port,
                    method: "SNI".to_string(),
                    action: "block".to_string(),
                    reason: "blocklist".to_string(),
                    pid: None,
                    command: None,
                })
                .await;
        }
        tracing::warn!(host = %hostname, port, "SNI BLOCK");
        // Drop the connection — client sees a reset.
        return;
    }

    // Step 3: Log the allowed connection.
    if let Some(audit) = audit {
        audit
            .log(&ConnectionEntry {
                timestamp: chrono::Utc::now(),
                host: hostname.clone(),
                port,
                method: "SNI".to_string(),
                action: "allow".to_string(),
                reason: String::new(),
                pid: None,
                command: None,
            })
            .await;
    }
    tracing::info!(host = %hostname, port, "SNI ALLOW");

    // Step 4: Connect to the real destination.
    let mut server = match TcpStream::connect(dest_addr).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(host = %hostname, %e, "failed to connect to origin");
            return;
        }
    };

    // Step 5: Bidirectional forwarding of raw bytes.
    // The TLS handshake happens through us transparently — we don't
    // decrypt anything, just pipe bytes between client and server.
    match tokio::io::copy_bidirectional(&mut client, &mut server).await {
        Ok((c2s, s2c)) => {
            tracing::debug!(host = %hostname, up = c2s, down = s2c, "connection closed");
        }
        Err(e) => {
            tracing::debug!(host = %hostname, %e, "pipe error");
        }
    }
}

#[allow(dead_code)]
pub async fn handle_plain_connection(
    mut client: TcpStream,
    _client_addr: SocketAddr,
    original_dest: SocketAddr,
    blocklist: &Blocklist,
    audit: Option<&AuditLogger>,
) {
    let hostname = original_dest.ip().to_string();
    let port = original_dest.port();

    if blocklist.is_blocked(&hostname) {
        if let Some(audit) = audit {
            audit
                .log(&ConnectionEntry {
                    timestamp: chrono::Utc::now(),
                    host: hostname.clone(),
                    port,
                    method: "TCP".to_string(),
                    action: "block".to_string(),
                    reason: "blocklist".to_string(),
                    pid: None,
                    command: None,
                })
                .await;
        }
        tracing::warn!(host = %hostname, port, "TCP BLOCK");
        return;
    }

    if let Some(audit) = audit {
        audit
            .log(&ConnectionEntry {
                timestamp: chrono::Utc::now(),
                host: hostname.clone(),
                port,
                method: "TCP".to_string(),
                action: "allow".to_string(),
                reason: String::new(),
                pid: None,
                command: None,
            })
            .await;
    }
    tracing::info!(host = %hostname, port, "TCP ALLOW");

    let mut server = match TcpStream::connect(original_dest).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(host = %hostname, %e, "failed to connect to origin");
            return;
        }
    };

    match tokio::io::copy_bidirectional(&mut client, &mut server).await {
        Ok((c2s, s2c)) => {
            tracing::debug!(host = %hostname, up = c2s, down = s2c, "connection closed");
        }
        Err(e) => {
            tracing::debug!(host = %hostname, %e, "pipe error");
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn test_sni_proxy_blocks_domain() {
        // Set up a listener to act as the "proxy"
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_addr = listener.local_addr().unwrap();

        let mut domains = HashSet::new();
        domains.insert("evil.com".to_string());
        let blocklist = Arc::new(Blocklist::from_domains(domains));

        // Spawn the proxy handler
        let bl = blocklist.clone();
        let handle = tokio::spawn(async move {
            let (stream, addr) = listener.accept().await.unwrap();
            handle_sni_connection(stream, addr, None, &bl, None).await;
        });

        // Connect and send a ClientHello with SNI = "evil.com"
        let mut client = TcpStream::connect(proxy_addr).await.unwrap();

        // Build a minimal ClientHello with SNI
        let hello = build_test_client_hello("evil.com");
        client.write_all(&hello).await.unwrap();

        // The proxy should drop the connection (blocked).
        let mut buf = vec![0u8; 1024];
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(2), client.read(&mut buf)).await;

        // Either timeout (connection dropped) or read 0 bytes (connection closed) = blocked
        match result {
            Ok(Ok(0)) => {}  // Connection closed — blocked as expected
            Ok(Err(_)) => {} // Connection error — blocked as expected
            Err(_) => {}     // Timeout — also fine, connection was dropped
            Ok(Ok(n)) => panic!("expected connection to be dropped, got {n} bytes"),
        }

        let _ = handle.await;
    }

    /// Build a minimal TLS ClientHello with the given SNI hostname.
    fn build_test_client_hello(hostname: &str) -> Vec<u8> {
        let sni_bytes = hostname.as_bytes();
        let sni_len = sni_bytes.len() as u16;

        let sni_ext_data_len = 2 + 1 + 2 + sni_len;
        let extensions_len = 4 + sni_ext_data_len;

        let cipher_suites = [0x00, 0x02, 0x00, 0x9C];
        let compression = [0x01, 0x00];

        let mut ch = Vec::new();
        ch.extend_from_slice(&[0x03, 0x03]); // TLS 1.2
        ch.extend_from_slice(&[0u8; 32]); // random
        ch.push(0); // session_id length
        ch.extend_from_slice(&cipher_suites);
        ch.extend_from_slice(&compression);
        ch.extend_from_slice(&(extensions_len as u16).to_be_bytes());
        ch.extend_from_slice(&[0x00, 0x00]); // SNI type
        ch.extend_from_slice(&sni_ext_data_len.to_be_bytes());
        ch.extend_from_slice(&(sni_ext_data_len - 2).to_be_bytes());
        ch.push(0x00); // hostname type
        ch.extend_from_slice(&sni_len.to_be_bytes());
        ch.extend_from_slice(sni_bytes);

        let ch_len = ch.len();
        let mut hs = Vec::new();
        hs.push(0x01);
        hs.push(((ch_len >> 16) & 0xFF) as u8);
        hs.push(((ch_len >> 8) & 0xFF) as u8);
        hs.push((ch_len & 0xFF) as u8);
        hs.extend_from_slice(&ch);

        let hs_len = hs.len();
        let mut record = Vec::new();
        record.push(22);
        record.extend_from_slice(&[0x03, 0x01]);
        record.extend_from_slice(&(hs_len as u16).to_be_bytes());
        record.extend_from_slice(&hs);

        record
    }
}
