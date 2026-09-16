use anyhow::{Context, Result};
use std::process::Command;

const ANCHOR_NAME: &str = "com.sandpit.redirect";

pub struct PfRedirect {
    sni_port: u16,
    http_port: u16,
    enabled: bool,
}

impl PfRedirect {
    pub fn new(sni_port: u16, http_port: u16) -> Self {
        Self { sni_port, http_port, enabled: false }
    }

    pub fn enable(&mut self) -> Result<()> {
        let rules = format!(
            concat!(
                "rdr pass proto tcp from any to any port 443 -> 127.0.0.1 port {}\n",
                "rdr pass proto tcp from any to any port 80 -> 127.0.0.1 port {}\n",
            ),
            self.sni_port, self.http_port
        );

        let mut child = Command::new("pfctl")
            .args(["-a", ANCHOR_NAME, "-f", "/dev/stdin"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .context("pfctl not available")?;

        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(rules.as_bytes())?;
        }

        let output = child.wait_with_output()?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::warn!(%stderr, "pf redirect failed (may need root)");
            return Ok(());
        }

        let _ = Command::new("pfctl")
            .args(["-E"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        self.enabled = true;
        tracing::info!(
            sni_port = self.sni_port,
            http_port = self.http_port,
            "pf redirect enabled (port 443 → SNI proxy, port 80 → HTTP proxy)"
        );
        Ok(())
    }

    pub fn disable(&mut self) {
        if !self.enabled {
            return;
        }

        let _ = Command::new("pfctl")
            .args(["-a", ANCHOR_NAME, "-F", "all"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        self.enabled = false;
        tracing::info!("pf redirect disabled");
    }
}

impl Drop for PfRedirect {
    fn drop(&mut self) {
        self.disable();
    }
}
