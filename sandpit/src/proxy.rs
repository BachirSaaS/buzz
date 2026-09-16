//! sandpit-proxy: standalone transparent proxy binary
//!
//! Can be used independently of the main sandpit CLI for manual testing.
//! Reads a 6-byte header from each incoming connection:
//!   [4 bytes: original IPv4 addr][2 bytes: original port]
//! Then connects to the real destination and pipes bidirectionally.

use anyhow::{Context, Result};
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

#[path = "sni_proxy.rs"]
mod sni_proxy;

#[path = "proxy_core.rs"]
mod proxy_core;

#[path = "otel.rs"]
mod otel;

#[tokio::main]
async fn main() -> Result<()> {
    let otlp_layer = otel::try_init_otlp_logs_layer();
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(otlp_layer)
        .init();

    let port: u16 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let blocklist_path = std::env::args().nth(2);
    let blocklist = Arc::new(match blocklist_path.as_deref() {
        Some(p) => proxy_core::Blocklist::load(p),
        None => proxy_core::Blocklist::empty(),
    });

    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))
        .await
        .context("failed to bind")?;

    let actual_port = listener.local_addr()?.port();

    // Print port on stdout so the parent can read it
    println!("{actual_port}");
    tracing::info!(port = actual_port, "proxy listening");

    let shutdown = tokio::signal::ctrl_c();
    tokio::pin!(shutdown);

    loop {
        tokio::select! {
            result = listener.accept() => {
                let (stream, addr) = match result {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!(error = %e, "accept failed");
                        continue;
                    }
                };
                let bl = blocklist.clone();
                tokio::spawn(async move {
                    proxy_core::handle_connection(stream, addr, &bl, None).await;
                });
            }
            _ = &mut shutdown => {
                tracing::info!("shutting down");
                break;
            }
        }
    }

    otel::shutdown_otlp();
    Ok(())
}
