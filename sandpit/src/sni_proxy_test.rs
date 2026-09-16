//! Standalone test for the SNI-inspecting transparent proxy.
//!
//! Usage:
//!   cargo run --bin sni-proxy-test
//!
//! Then in another terminal, redirect a connection through it:
//!   curl --connect-to example.com:443:127.0.0.1:8443 https://example.com
//!
//! The proxy will peek at the SNI, log the domain, and forward the raw
//! TLS connection without breaking it.

use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::net::TcpListener;

use sandpit::{proxy_core, sni_proxy};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let port: u16 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(8443);

    let blocklist_arg = std::env::args().nth(2);
    let blocklist = Arc::new(match blocklist_arg.as_deref() {
        Some(domains) => {
            let set = domains.split(',').map(|s| s.trim().to_string()).collect();
            proxy_core::Blocklist::from_domains(set)
        }
        None => proxy_core::Blocklist::empty(),
    });

    let audit_path = proxy_core::default_audit_log_path();
    let audit: Option<Arc<proxy_core::AuditLogger>> =
        match proxy_core::AuditLogger::new(&audit_path) {
            Ok(logger) => {
                println!("Audit log: {}", audit_path.display());
                Some(Arc::new(logger))
            }
            Err(e) => {
                eprintln!("Warning: no audit log: {e}");
                None
            }
        };

    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))
        .await
        .context("bind")?;

    println!("SNI proxy listening on 127.0.0.1:{port}");
    println!();
    println!("Test with:");
    println!("  curl --connect-to example.com:443:127.0.0.1:{port} https://example.com");
    println!();
    println!("Test blocking:");
    println!("  cargo run --bin sni-proxy-test -- {port} evil.com");
    println!("  curl --connect-to evil.com:443:127.0.0.1:{port} https://evil.com");

    loop {
        let (stream, addr) = listener.accept().await?;
        let bl = blocklist.clone();
        let al = audit.clone();
        tokio::spawn(async move {
            // No original_dest — the proxy will use SNI + DNS to find the real server.
            sni_proxy::handle_sni_connection(stream, addr, None, &bl, al.as_deref()).await;
        });
    }
}
