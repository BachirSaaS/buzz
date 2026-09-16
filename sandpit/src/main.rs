//! sandpit: sandbox any AI coding agent on macOS.
//!
//! Four enforcement tiers, one config file:
//!   1. DYLD interpose — domain-level network proxy, exec argument inspection, file fence
//!   2. Seatbelt — kernel-enforced network block (IPv4+IPv6), file deny (all syscalls),
//!      works on hardened runtime / SIP / shared cache binaries
//!   3. Adversary review — LLM-based tool call review for anything the above can't enforce
//!   4. Per-agent hooks — installed via `sandpit install <agent>`
//!
//! Configured via --config or ~/.sandpit/config.toml.

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::Layer as _;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

mod adversary;
mod classifier;
mod codex;
pub mod config;
mod egress;
mod hook;
mod otel;
mod proxy_core;
mod seatbelt;
mod shims;
mod sni_proxy;

#[derive(Parser, Debug)]
#[command(
    name = "sandpit",
    about = "Sandbox AI coding agents with transparent network, exec, and file control",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Launch an agent inside the sandbox
    #[command(after_help = r#"CONFIG SEARCH ORDER:
    1. --config <path>        explicit config file
    2. ~/.sandpit/config.toml global default

Project-local files are never trusted automatically. Review one and pass it
explicitly with --config.

EXAMPLES:
    sandpit run -- goose session
    sandpit run --no-shims -- goose session
    sandpit run -- pi
    sandpit run --config strict.toml -- claude"#)]
    Run {
        /// Path to sandpit.toml config file
        #[arg(long, short = 'c')]
        config: Option<PathBuf>,

        /// Verbose logging
        #[arg(long, short = 'v')]
        verbose: bool,

        /// Disable command shims (shims are on by default)
        #[arg(long)]
        no_shims: bool,

        /// Use sandpit's Seatbelt sandbox instead of Codex's inner sandbox
        #[arg(long)]
        codex_external_sandbox: bool,

        /// Disable adversary hooks for this run
        #[arg(long)]
        no_adversary: bool,

        /// Keep the child in the supervising harness process group (noninteractive only).
        #[arg(long)]
        managed: bool,

        /// The agent command to run (everything after --)
        #[arg(trailing_var_arg = true, required = true)]
        command: Vec<String>,
    },

    /// Report the Buzz managed-launch protocol.
    #[command(hide = true)]
    ManagedInfo,

    /// Internal SSH transport through the parent policy broker.
    #[command(hide = true)]
    Tunnel { host: String, port: u16 },

    /// Internal bootstrap, invoked only after sandbox-exec applies the policy.
    #[command(hide = true)]
    KernelExec {
        #[arg(long)]
        library: Option<PathBuf>,
        #[arg(long)]
        verify_denied_write: Option<PathBuf>,
        #[arg(trailing_var_arg = true, required = true)]
        command: Vec<String>,
    },

    /// PreToolUse hook entry point (called by Claude Code, hidden from help)
    #[command(hide = true)]
    Hook,

    /// Show effective config (search, load, display)
    Config {
        /// Path to sandpit.toml config file
        #[arg(long, short = 'c')]
        config: Option<PathBuf>,
    },

    /// Install adversary hooks for a specific agent
    #[command(after_help = r#"SUPPORTED AGENTS:
    pi        LLM reviews every bash tool call (on by default when installed)
    goose     writes rules to ~/.config/goose/adversary.md (built-in inspector)
    claude    PreToolUse prompt hook — haiku reviews bash commands
    amp       delegate permission — rush model reviews bash commands

Rules come from [adversary] in sandpit.toml. Defaults are used if no config found.

EXAMPLES:
    sandpit install pi
    sandpit install goose
    sandpit install --list"#)]
    Install {
        /// Agent to install adversary hooks for
        agent: Option<String>,

        /// List supported agents and their install status
        #[arg(long, short = 'l')]
        list: bool,
    },

    /// Remove adversary hooks for a specific agent
    Uninstall {
        /// Agent to remove adversary hooks for
        agent: String,
    },

    /// Generate a starter sandpit.toml
    Init,

    /// Manage the global file write allowlist
    #[command(
        after_help = r#"Manage directories that agents are always allowed to write to,
regardless of working directory. Stored in ~/.sandpit/config.toml
under [files].allow_write.

Paths support ~ expansion (e.g. ~/src/infra-repo).

EXAMPLES:
    sandpit allow add ~/src/terraform ~/src/argocd
    sandpit allow remove ~/src/terraform
    sandpit allow list"#
    )]
    Allow {
        #[command(subcommand)]
        action: AllowAction,
    },

    /// Check what enforcement is available for a target binary
    #[command(
        after_help = r#"Inspects the target binary and reports which enforcement layers
will work.

EXAMPLES:
    sandpit check -- goose
    sandpit check -- /usr/bin/python3"#
    )]
    Check {
        /// The target binary to check (everything after --)
        #[arg(trailing_var_arg = true, required = true)]
        command: Vec<String>,
    },

    /// Health check: config, agents, enforcement, logs
    #[command(after_help = r#"Checks your sandpit setup and shows what's active.

EXAMPLES:
    sandpit doctor
    sandpit doctor --config strict.toml"#)]
    Doctor {
        /// Path to sandpit.toml config file
        #[arg(long, short = 'c')]
        config: Option<PathBuf>,
    },

    /// Execute a command through sandpit's shim filter (used by shim scripts)
    ///
    /// Checks the command against exec block rules and network policy from
    /// sandpit.toml, then either runs the real binary or blocks it.
    /// Shim scripts in ~/.sandpit/shims/ call this automatically.
    #[command(
        hide = true,  // internal command, not user-facing
    )]
    Exec {
        /// The command to execute (name + arguments)
        #[arg(trailing_var_arg = true, required = true)]
        command: Vec<String>,
    },
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct ClaudeSyncPlan {
    source: PathBuf,
    snapshot: PathBuf,
    overlay: PathBuf,
    sync_settings: bool,
}

impl ClaudeSyncPlan {
    fn for_run(state: &(PathBuf, PathBuf, PathBuf, bool), nested: bool) -> Self {
        let (source, snapshot, overlay, sync_settings) = state;
        if *sync_settings && nested {
            tracing::info!(
                "nested Claude settings changes are session-local and will not be persisted through the outer sandbox"
            );
        }
        Self {
            source: source.clone(),
            snapshot: snapshot.clone(),
            overlay: overlay.clone(),
            sync_settings: *sync_settings && !nested,
        }
    }
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct GooseSyncPlan {
    overlay: PathBuf,
    snapshot: PathBuf,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct AmpSyncPlan {
    source: PathBuf,
    snapshot: PathBuf,
    overlay: PathBuf,
    policy_allows_sync: bool,
}

#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
struct SessionSyncPlan {
    claude: Option<ClaudeSyncPlan>,
    goose: Option<GooseSyncPlan>,
    amp: Option<AmpSyncPlan>,
}

#[derive(Subcommand, Debug)]
enum AllowAction {
    /// Add directories to the global write allowlist
    Add {
        /// Paths to allow (supports ~ expansion)
        #[arg(required = true)]
        paths: Vec<String>,
    },
    /// Remove directories from the global write allowlist
    Remove {
        /// Paths to remove
        #[arg(required = true)]
        paths: Vec<String>,
    },
    /// List the current global write allowlist
    List,
}

/// The dylib is compiled by the sandpit-dylib crate and embedded at build time.
const EMBEDDED_DYLIB: &[u8] = include_bytes!(env!("SANDPIT_DYLIB_PATH"));

fn find_dylib() -> Result<PathBuf> {
    // 1. Check cache — already extracted from a previous run
    let cache_dir =
        PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())).join(".sandpit/lib");
    let cached = cache_dir.join("libsandpit.dylib");

    if cached.exists() {
        // Verify it matches what's embedded (in case of upgrades)
        if let Ok(existing) = std::fs::read(&cached) {
            if existing == EMBEDDED_DYLIB {
                return Ok(cached);
            }
        }
    }

    // 2. Extract the embedded dylib
    std::fs::create_dir_all(&cache_dir)?;
    std::fs::write(&cached, EMBEDDED_DYLIB)?;
    Ok(cached)
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Run {
            config: config_path,
            verbose,
            no_shims,
            codex_external_sandbox,
            no_adversary,
            managed,
            command,
        } => {
            run_sandbox(
                config_path,
                verbose,
                no_shims,
                no_adversary,
                codex_external_sandbox,
                managed,
                command,
            )
            .await
        }
        Commands::ManagedInfo => {
            println!("buzz-sandpit-managed-v1");
            Ok(())
        }
        Commands::Tunnel { host, port } => {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let proxy_port: u16 = std::env::var("SANDPIT_PROXY_PORT")?.parse()?;
            let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", proxy_port)).await?;
            stream
                .write_all(
                    format!("CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n")
                        .as_bytes(),
                )
                .await?;
            let mut response = Vec::new();
            while response.len() < 4096 && !response.ends_with(b"\r\n\r\n") {
                response.push(stream.read_u8().await?);
            }
            if !response.starts_with(b"HTTP/1.1 200 ") {
                bail!("SSH destination denied by network broker");
            }
            let (mut read, mut write) = stream.into_split();
            let upload = async {
                tokio::io::copy(&mut tokio::io::stdin(), &mut write).await?;
                write.shutdown().await
            };
            let download = async {
                tokio::io::copy(&mut read, &mut tokio::io::stdout())
                    .await
                    .map(|_| ())
            };
            tokio::try_join!(upload, download)?;
            Ok(())
        }
        Commands::KernelExec { library, verify_denied_write, command } => {
            if let Some(path) = verify_denied_write {
                match std::fs::OpenOptions::new().write(true).open(&path) {
                    Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {},
                    _ => bail!("kernel confinement verification failed; refusing agent exec"),
                }
            }
            use std::os::unix::process::CommandExt;
            let mut child = std::process::Command::new(&command[0]);
            child.args(&command[1..]);
            // sandbox-exec strips DYLD_*; restore only our trusted library
            // after the irreversible kernel boundary has been established.
            if let Some(library) = library {
                child.env("DYLD_INSERT_LIBRARIES", library);
            }
            Err(child.exec()).context("kernel bootstrap failed to exec agent")
        }
        Commands::Hook => hook::run_hook().await,
        // Interactive commands — user is at the terminal, log to stderr + OTLP
        _ => {
            let otlp_layer = otel::try_init_otlp_logs_layer();
            tracing_subscriber::registry()
                .with(otlp_layer)
                .with(
                    tracing_subscriber::fmt::layer()
                        .with_writer(std::io::stderr)
                        .with_target(false)
                        .with_level(false)
                        .without_time()
                        .with_filter(EnvFilter::new("sandpit=info")),
                )
                .init();

            let result = match cli.command {
                Commands::ManagedInfo | Commands::Run { .. }
                | Commands::Hook
                | Commands::KernelExec { .. }
                | Commands::Tunnel { .. } => unreachable!(),
                Commands::Config {
                    config: config_path,
                } => show_config(config_path),
                Commands::Install { agent, list } => {
                    if list || agent.is_none() {
                        adversary::list_agents();
                        Ok(())
                    } else {
                        adversary::install(&agent.unwrap())
                    }
                }
                Commands::Uninstall { agent } => adversary::uninstall(&agent),
                Commands::Init => init_config(),
                Commands::Allow { action } => manage_allow(action),
                Commands::Check { command } => check_binary(command),
                Commands::Doctor {
                    config: config_path,
                } => doctor(config_path),
                Commands::Exec { command } => shims::exec_command(command),
            };
            otel::shutdown_otlp();
            result
        }
    }
}

fn show_config(config_path: Option<PathBuf>) -> Result<()> {
    let config_file = config::find_config(config_path.as_deref());
    let cfg = match config_file {
        Some(ref path) => {
            let c = config::Config::load(path)?;
            eprintln!("📄 Config: {}", path.display());
            c
        }
        None => {
            eprintln!("📄 Config: built-in default (data leak prevention)");
            eprintln!("   create ~/.sandpit/config.toml or pass --config explicitly");
            config::Config::builtin_default()
        }
    };
    eprintln!();

    if cfg.has_network_rules() {
        eprintln!("  [network]");
        if !cfg.network.block.is_empty() {
            eprintln!("    block: {}", cfg.network.block.join(", "));
        }
        if !cfg.network.allow.is_empty() {
            eprintln!("    allow: {}", cfg.network.allow.join(", "));
        }
    } else {
        eprintln!("  [network] (no rules — all traffic allowed)");
    }

    eprintln!();
    if cfg.has_exec_rules() {
        eprintln!("  [exec]");
        eprintln!("    block: {} patterns", cfg.exec.block.len());
        for p in &cfg.exec.block {
            eprintln!("      - {p}");
        }
    } else {
        eprintln!("  [exec] (no rules — all commands allowed)");
    }

    eprintln!();
    if cfg.has_file_rules() {
        eprintln!("  [files]");
        if !cfg.files.allow_write.is_empty() {
            eprintln!("    allow_write: {}", cfg.files.allow_write.join(", "));
        }
        if !cfg.files.block_write.is_empty() {
            eprintln!("    block_write: {}", cfg.files.block_write.join(", "));
        }
        if !cfg.files.block_read.is_empty() {
            eprintln!("    block_read: {}", cfg.files.block_read.join(", "));
        }
    } else {
        eprintln!("  [files] (no rules — all file access allowed)");
    }

    eprintln!();
    eprintln!("  [enforcement]");
    eprintln!(
        "    sandbox-exec: {}",
        if seatbelt::is_available() {
            "✅ available"
        } else {
            "not found"
        }
    );
    eprintln!("    mode detected at launch (use `sandpit check -- <binary>` to preview)");

    // TCC check
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if let Some(tcc_loc) = seatbelt::tcc_protected_dir(&cwd) {
        eprintln!("    TCC: ⚠️  cwd is inside {tcc_loc} — DYLD will be skipped");
        eprintln!("         (move project outside ~/Documents, ~/Desktop, ~/Downloads");
        eprintln!("          to enable supplemental DYLD hooks)");
    } else {
        eprintln!("    TCC: ✅ cwd is not TCC-protected");
    };

    eprintln!();
    eprintln!("  [logs]");
    eprintln!("    sandpit log: {}", cfg.log_path().display());
    eprintln!("    audit log:   {}", cfg.audit_log_path().display());
    eprintln!(
        "    tail -f {} to watch sandpit activity",
        cfg.log_path().display()
    );

    eprintln!();
    if cfg.has_adversary_rules() {
        eprintln!("  [adversary]");
        let rules = cfg.adversary_rules();
        for line in rules.lines().take(3) {
            eprintln!("    {line}");
        }
        let line_count = rules.lines().count();
        if line_count > 3 {
            eprintln!("    ... ({} more lines)", line_count - 3);
        }
    } else {
        eprintln!("  [adversary] (using default rules)");
    }

    Ok(())
}

fn check_binary(command: Vec<String>) -> Result<()> {
    if command.is_empty() {
        bail!("No binary specified. Usage: sandpit check -- <binary>");
    }

    let binary = &command[0];
    let (program, _args) = resolve_shebang(binary, &command[1..]);

    let dyld_ok = seatbelt::supports_dyld(&program);
    let sb_ok = seatbelt::is_available();
    let active_mode = seatbelt::detect_mode(&program);

    // Report
    eprintln!();
    eprintln!("🔍 Binary: {program}");
    eprintln!(
        "   DYLD_INSERT_LIBRARIES: {}",
        if dyld_ok {
            "✅ supported"
        } else {
            "❌ not supported (platform/SIP/hardened)"
        }
    );
    eprintln!(
        "   sandbox-exec:          {}",
        if sb_ok {
            "✅ available"
        } else {
            "❌ not found"
        }
    );
    eprintln!();

    // Check TCC
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let tcc_loc = seatbelt::tcc_protected_dir(&cwd);
    if let Some(ref loc) = tcc_loc {
        eprintln!("   TCC:                    ⚠️  cwd is inside {loc} (protected)");
    } else {
        eprintln!("   TCC:                    ✅ cwd is not TCC-protected");
    }
    eprintln!();

    let effective_mode = seatbelt::resolve_effective_mode(active_mode, &tcc_loc);

    if !sb_ok || effective_mode == seatbelt::ActiveMode::Off {
        eprintln!("❌ Kernel sandbox unavailable; launch will be refused.");
    } else {
        eprintln!("✅ Mandatory kernel sandbox (files and configured network policy)");
        eprintln!(
            "   DYLD hooks: {}",
            effective_mode == seatbelt::ActiveMode::Dyld
        );
        eprintln!("   Command-pattern checks are supplemental.");
    }

    Ok(())
}

fn doctor(config_path: Option<PathBuf>) -> Result<()> {
    eprintln!("🩺 sandpit doctor\n");

    // ── Config ───────────────────────────────────────────────────
    let config_file = config::find_config(config_path.as_deref());
    let cfg = match config_file {
        Some(ref path) => {
            eprintln!("  config: ✅ {}", path.display());
            match config::Config::load(path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("          ❌ failed to parse: {e}");
                    eprintln!("          falling back to built-in default");
                    config::Config::builtin_default()
                }
            }
        }
        None => {
            eprintln!("  config: built-in default (data leak prevention)");
            eprintln!("          create ~/.sandpit/config.toml or pass --config explicitly");
            config::Config::builtin_default()
        }
    };

    // ── Rules summary ────────────────────────────────────────────
    eprintln!();
    if !cfg.network.block.is_empty() {
        eprintln!("  network: {} blocked domains", cfg.network.block.len());
    } else if !cfg.network.allow.is_empty() {
        eprintln!("  network: allowlist ({} domains)", cfg.network.allow.len());
    } else {
        eprintln!("  network: no rules (all traffic allowed)");
    }
    if !cfg.exec.block.is_empty() {
        eprintln!("  exec:    {} block patterns", cfg.exec.block.len());
    } else {
        eprintln!("  exec:    no rules");
    }
    if cfg.has_file_rules() {
        let mut parts = Vec::new();
        if !cfg.files.allow_write.is_empty() {
            parts.push(format!("{} allow_write", cfg.files.allow_write.len()));
        }
        if !cfg.files.block_write.is_empty() {
            parts.push(format!("{} block_write", cfg.files.block_write.len()));
        }
        if !cfg.files.block_read.is_empty() {
            parts.push(format!("{} block_read", cfg.files.block_read.len()));
        }
        eprintln!("  files:   {}", parts.join(", "));
    } else {
        eprintln!("  files:   no rules");
    }
    if cfg.has_adversary_rules() {
        eprintln!("  adversary: custom rules");
    } else {
        eprintln!("  adversary: default rules");
    }

    // ── Enforcement ─────────────────────────────────────────────────────────
    eprintln!();
    eprintln!(
        "  sandbox-exec: {}",
        if seatbelt::is_available() {
            "✅ available"
        } else {
            "❌ not found"
        }
    );

    // TCC check
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if let Some(tcc_loc) = seatbelt::tcc_protected_dir(&cwd) {
        eprintln!("  TCC: ⚠️  cwd is inside {tcc_loc} — DYLD interpose will be skipped");
        eprintln!("       (move project outside ~/Documents, ~/Desktop, ~/Downloads");
        eprintln!("        to enable supplemental DYLD hooks)");
    } else {
        eprintln!("  TCC: ✅ cwd is not TCC-protected");
    }

    // ── Agents ───────────────────────────────────────────────────────────────
    eprintln!();
    eprintln!("  agents:");
    for &name in adversary::SUPPORTED_AGENTS {
        let on_path = which::which(name).is_ok();
        let installed = adversary::is_installed(name);
        let status = match (on_path, installed) {
            (true, true) => "✅ on PATH, hooks installed",
            (true, false) => "⚠️  on PATH, hooks not installed",
            (false, true) => "⚠️  not on PATH, hooks installed",
            (false, false) => "   not found",
        };
        eprintln!("    {:<10} {status}", name);
    }
    for &name in adversary::HOOKLESS_AGENTS {
        let on_path = which::which(name).is_ok();
        if on_path {
            eprintln!("    {:<10} ✅ on PATH (no hooks needed)", name);
        } else {
            eprintln!("    {:<10}    not found (no hooks needed)", name);
        }
    }

    // ── Claude PreToolUse hooks ───────────────────────────────────
    let stale_hooks = adversary::count_stale_claude_hooks();
    if stale_hooks > 0 {
        eprintln!();
        eprintln!("  hooks: {stale_hooks} Claude PreToolUse entry/entries installed");
        eprintln!("    remove explicitly with `sandpit uninstall claude`");
    }

    // ── Suggestions ──────────────────────────────────────────────
    let mut suggestions: Vec<String> = Vec::new();

    for &name in adversary::SUPPORTED_AGENTS {
        let on_path = which::which(name).is_ok();
        let installed = adversary::is_installed(name);
        if on_path && !installed {
            suggestions.push(format!(
                "run `sandpit install {name}` to add adversary hooks"
            ));
        }
    }

    if !suggestions.is_empty() {
        eprintln!();
        eprintln!("  suggestions:");
        for s in &suggestions {
            eprintln!("    → {s}");
        }
    }

    // ── Logs ─────────────────────────────────────────────────────
    let log_path = cfg.log_path();
    let audit_path = cfg.audit_log_path();

    eprintln!();
    eprintln!("  logs:");
    eprintln!(
        "    sandpit: {} {}",
        log_path.display(),
        if log_path.exists() {
            format!("({})", human_size(&log_path))
        } else {
            "(not yet created)".into()
        }
    );
    eprintln!(
        "    audit:   {} {}",
        audit_path.display(),
        if audit_path.exists() {
            format!("({})", human_size(&audit_path))
        } else {
            "(not yet created)".into()
        }
    );
    eprintln!("    tail -f {}", log_path.display());

    eprintln!();
    Ok(())
}

fn human_size(path: &PathBuf) -> String {
    match std::fs::metadata(path) {
        Ok(m) => {
            let bytes = m.len();
            if bytes < 1024 {
                format!("{bytes} B")
            } else if bytes < 1024 * 1024 {
                format!("{:.1} KB", bytes as f64 / 1024.0)
            } else {
                format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
            }
        }
        Err(_) => "?".into(),
    }
}

fn init_config() -> Result<()> {
    let path = PathBuf::from("sandpit.toml");
    if path.exists() {
        bail!("sandpit.toml already exists in the current directory");
    }

    std::fs::write(&path, STARTER_CONFIG)?;
    eprintln!("✅ Created sandpit.toml");
    eprintln!("   Review it, then run: sandpit run --config ./sandpit.toml -- <your-agent>");
    eprintln!();
    eprintln!("   sandpit looks for config in this order:");
    eprintln!("     1. --config <path>           (explicit)");
    eprintln!("     2. ~/.sandpit/config.toml    (global default)");
    eprintln!();
    eprintln!("   To use as your global default:");
    eprintln!("     mv sandpit.toml ~/.sandpit/config.toml");
    Ok(())
}

const STARTER_CONFIG: &str = include_str!("../examples/default.toml");

fn manage_allow(action: AllowAction) -> Result<()> {
    match action {
        AllowAction::Add { paths } => {
            let added = config::add_allow_write_paths(&paths)?;
            if added.is_empty() {
                eprintln!("ℹ️  All paths already in allowlist");
            } else {
                for p in &added {
                    eprintln!("✅ Added: {p}");
                }
            }
            let config_path = config::global_config_path().unwrap();
            eprintln!("   Config: {}", config_path.display());
            Ok(())
        }
        AllowAction::Remove { paths } => {
            let removed = config::remove_allow_write_paths(&paths)?;
            if removed.is_empty() {
                eprintln!("ℹ️  No matching paths found in allowlist");
            } else {
                for p in &removed {
                    eprintln!("✅ Removed: {p}");
                }
            }
            Ok(())
        }
        AllowAction::List => {
            let paths = config::list_allow_write_paths()?;
            if paths.is_empty() {
                eprintln!("No paths in global write allowlist.");
                eprintln!("  Add one with: sandpit allow add ~/src/my-repo");
            } else {
                eprintln!("Global write allowlist (~/.sandpit/config.toml):");
                for p in &paths {
                    eprintln!("  {p}");
                }
            }
            Ok(())
        }
    }
}

/// Inject tamper-protection paths into block_write that are ALWAYS enforced
/// regardless of user config. Prevents the sandboxed agent from disabling
/// its own sandbox by rewriting config files, the dylib, shims, or hooks.
fn inject_protection_paths(cfg: &mut config::Config, config_file: &Option<PathBuf>) {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let session_root = config::session_root();

    // NOTE: do NOT protect the entire ~/.sandpit prefix — the dylib writes
    // its own logs there and would get EACCES, silently falling back to
    // stderr. Protect specific subpaths (config files, dylib cache, bin)
    // and let the log files through.
    let mut protected = vec![
        format!("{home}/.sandpit/config.toml"),
        format!("{home}/.sandpit/effective-config.toml"),
        config::adversary_lock_path().display().to_string(),
        format!("{home}/.sandpit/claude-config.toml"),
        session_root.join("sandbox-sentinel").display().to_string(),
        format!("{home}/.sandpit/amp-review.sh"),
        format!("{home}/.sandpit/amp-review-settings.json"),
        format!("{home}/.sandpit/amp-adversary.md"),
        session_root.join("sessions").display().to_string(),
        session_root.join("session-state").display().to_string(),
        format!("{home}/.sandpit/lib"),
        format!("{home}/.sandpit/bin"),
        format!("{home}/Library/LaunchAgents"),
    ];

    // The proxy runs in the parent process, so protecting this path prevents
    // sandboxed children from erasing or forging network audit evidence.
    protected.extend(
        cfg.audit_log_protection_paths()
            .into_iter()
            .map(|path| path.to_string_lossy().to_string()),
    );

    // Protect the sandpit binary itself
    if let Ok(exe) = std::env::current_exe() {
        if let Ok(canonical) = std::fs::canonicalize(&exe) {
            protected.push(canonical.to_string_lossy().to_string());
        }
    }

    // Protect the config file in use
    if let Some(cf) = config_file {
        let abs = std::fs::canonicalize(cf).unwrap_or_else(|_| cf.clone());
        protected.push(abs.to_string_lossy().to_string());
    }

    // Protect agent hook config paths — only the files/dirs that load
    // policy or executable code on agent startup, not full state dirs.
    // Blocking e.g. ~/.config/goose wholesale would prevent legit runtime
    // writes (session state, caches, history) and offer no extra safety.
    protected.extend([
        format!("{home}/.claude/settings.json"),
        format!("{home}/.claude/plugins"),
        format!("{home}/.config/goose/config.yaml"),
        format!("{home}/.config/amp/settings.json"),
        format!("{home}/.config/amp/plugins"),
        format!("{home}/.pi/agent/settings.json"),
        format!("{home}/.pi/agent/mcp.json"),
        format!("{home}/.pi/agent/extensions"),
        format!("{home}/.pi/agent/bin"),
    ]);

    // Merge into block_write, deduplicating
    let existing: std::collections::HashSet<String> = cfg
        .files
        .block_write
        .iter()
        .map(|s| config::expand_path(s))
        .collect();
    for path in protected {
        if !existing.contains(&path) {
            cfg.files.block_write.push(path);
        }
    }
}

/// Resolve shebangs to avoid /usr/bin/env (SIP-protected, strips DYLD_*).
/// If the command is a script with `#!/usr/bin/env <interpreter>`, resolve
/// the interpreter via PATH and spawn it directly with the script as arg.
fn resolve_shebang(program: &str, args: &[String]) -> (String, Vec<String>) {
    // Find the actual path of the program
    let program_path = which::which(program).unwrap_or_else(|_| PathBuf::from(program));

    // Try to read the first line for a shebang
    if let Ok(file) = std::fs::File::open(&program_path) {
        use std::io::{BufRead, BufReader};
        let mut reader = BufReader::new(file);
        let mut first_line = String::new();
        if reader.read_line(&mut first_line).is_ok() && first_line.starts_with("#!") {
            let shebang = first_line[2..].trim();
            // Handle #!/usr/bin/env <interpreter> [args...]
            if shebang.starts_with("/usr/bin/env ") {
                let parts: Vec<&str> = shebang.split_whitespace().skip(1).collect();
                if let Some(interpreter) = parts.first() {
                    // Resolve the interpreter via PATH
                    if let Ok(interp_path) = which::which(interpreter) {
                        let interp = interp_path.to_string_lossy().to_string();
                        let mut new_args: Vec<String> =
                            parts[1..].iter().map(|s| s.to_string()).collect();
                        new_args.push(program_path.to_string_lossy().to_string());
                        new_args.extend_from_slice(args);
                        tracing::debug!(
                            original = program,
                            resolved = %interp,
                            "resolved shebang (bypassing /usr/bin/env)"
                        );
                        return (interp, new_args);
                    }
                }
            }
        }
    }

    // No shebang resolution needed
    (program.to_string(), args.to_vec())
}

/// Insert agent CLI options after a shebang script path when the executable
/// was resolved to its interpreter (for example `node <claude-script>`).
fn insert_agent_options(
    program: &str,
    original_program: &str,
    args: &mut Vec<String>,
    options: impl IntoIterator<Item = String>,
) {
    let option_index = if program != original_program {
        which::which(original_program)
            .ok()
            .and_then(|script| {
                let script = script.to_string_lossy();
                args.iter().position(|arg| arg == script.as_ref())
            })
            .map(|index| index + 1)
            .unwrap_or(0)
    } else {
        0
    };
    args.splice(option_index..option_index, options);
}

/// Remove every occurrence of a value-taking CLI option and return its last
/// value. Both `--option value` and `--option=value` forms are supported.
fn take_agent_option(args: &mut Vec<String>, option: &str) -> Option<String> {
    let mut selected = None;
    let with_equals = format!("{option}=");
    let mut index = 0;
    while index < args.len() {
        if args[index] == option {
            args.remove(index);
            if index < args.len() {
                selected = Some(args.remove(index));
            }
        } else if let Some(value) = args[index].strip_prefix(&with_equals) {
            selected = Some(value.to_string());
            args.remove(index);
        } else {
            index += 1;
        }
    }
    selected
}

fn amp_manages_settings(args: &[String]) -> bool {
    if args.iter().any(|arg| {
        arg == "-x"
            || arg == "-ox"
            || arg == "--execute"
            || arg.starts_with("--execute=")
    }) {
        return false;
    }
    let value_options = [
        "--settings-file",
        "--visibility",
        "--log-level",
        "--log-file",
        "--mcp-config",
        "--theme",
        "--model",
        "-m",
        "--mode",
        "--runner-id",
        "--features",
        "--project",
        "--orb-size",
        "--plugin-ready-timeout",
        "--label",
        "-l",
    ];
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if value_options.contains(&arg.as_str()) {
            index += 2;
        } else if arg.starts_with('-') {
            index += 1;
        } else {
            return matches!(
                arg.as_str(),
                "config" | "permissions" | "permission" | "mcp"
            );
        }
    }
    false
}

fn cleanup_inactive_sessions(
    sessions_root: &Path,
    mutable_sessions_root: &Path,
    nested_sessions_root: &Path,
) -> bool {
    match std::fs::symlink_metadata(mutable_sessions_root) {
        Ok(metadata) if metadata.is_dir() => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return true,
        _ => return false,
    }
    let entries = match std::fs::read_dir(mutable_sessions_root) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    let mut succeeded = true;
    for entry in entries {
        let Ok(entry) = entry else {
            succeeded = false;
            continue;
        };
        let name = entry.file_name();
        if !name.to_string_lossy().starts_with("run-") {
            continue;
        }
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            succeeded = false;
            continue;
        }
        if !cleanup_inactive_session(
            &sessions_root.join(&name),
            &entry.path(),
            nested_sessions_root,
        ) {
            succeeded = false;
        }
    }
    succeeded
}

fn cleanup_inactive_session(
    session_dir: &Path,
    mutable_session_dir: &Path,
    nested_sessions_root: &Path,
) -> bool {
    if !std::fs::symlink_metadata(session_dir).is_ok_and(|metadata| metadata.is_dir()) {
        return false;
    }
    let recorded_root = std::fs::read(session_dir.join("mutable-root.json"))
        .ok()
        .and_then(|contents| serde_json::from_slice::<PathBuf>(&contents).ok());
    let actual_root = std::fs::canonicalize(mutable_session_dir).ok();
    if recorded_root.is_none() || recorded_root != actual_root {
        tracing::warn!(path = %session_dir.display(), "retaining session without a matching immutable overlay binding");
        return false;
    }
    let Ok(lease) = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(session_dir.join(".active"))
    else {
        return false;
    };
    #[cfg(unix)]
    let inactive = unsafe {
        use std::os::fd::AsRawFd;
        libc::flock(lease.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) == 0
    };
    #[cfg(not(unix))]
    let inactive = false;
    if !inactive || session_process_group_alive(session_dir) {
        return false;
    }
    if !cleanup_inactive_sessions(
        nested_sessions_root,
        &mutable_session_dir.join("nested"),
        nested_sessions_root,
    ) || !reconcile_saved_session(session_dir)
    {
        return false;
    }
    if let Err(error) = std::fs::remove_dir_all(mutable_session_dir) {
        tracing::warn!(%error, path = %mutable_session_dir.display(), "failed to remove reconciled session overlay");
        return false;
    }
    if let Err(error) = std::fs::remove_dir_all(session_dir) {
        tracing::warn!(%error, path = %session_dir.display(), "failed to remove reconciled session plan");
        return false;
    }
    true
}

fn reconcile_session_plan(plan: &SessionSyncPlan, cfg: &config::Config) -> bool {
    let mut paths = Vec::new();
    if let Some(plan) = &plan.claude {
        paths.extend([&plan.source, &plan.overlay, &plan.snapshot]);
    }
    if let Some(plan) = &plan.goose {
        paths.extend([&plan.overlay, &plan.snapshot]);
    }
    if let Some(plan) = &plan.amp {
        paths.extend([&plan.source, &plan.overlay, &plan.snapshot]);
    }
    if paths.iter().any(|path| !path.is_absolute()) {
        tracing::warn!("retaining session with unbound recovery paths instead of resolving against a new working directory");
        return false;
    }
    let mut succeeded = true;
    if let Some(plan) = &plan.claude {
        if let Err(error) = adversary::sync_claude_session(
            &plan.source,
            &plan.overlay,
            &plan.snapshot,
            plan.sync_settings,
            cfg,
        ) {
            succeeded = false;
            tracing::warn!(%error, "failed to persist Claude session state");
        }
    }
    if let Some(plan) = &plan.goose {
        if let Err(error) = adversary::sync_goose_session(&plan.overlay, &plan.snapshot, cfg) {
            succeeded = false;
            tracing::warn!(%error, "failed to persist Goose session config");
        }
    }
    if let Some(plan) = &plan.amp {
        if let Err(error) = adversary::sync_amp_session(
            &plan.source,
            &plan.snapshot,
            &plan.overlay,
            plan.policy_allows_sync,
        ) {
            succeeded = false;
            tracing::warn!(%error, "failed to persist Amp settings changes");
        }
    }
    succeeded
}

fn reconcile_saved_session(session_dir: &Path) -> bool {
    let plan = std::fs::read_to_string(session_dir.join("sync-plan.json"))
        .ok()
        .and_then(|contents| serde_json::from_str::<SessionSyncPlan>(&contents).ok());
    let cfg = config::Config::load(&session_dir.join("config.toml")).ok();
    if let (Some(plan), Some(cfg)) = (plan, cfg) {
        reconcile_session_plan(&plan, &cfg)
    } else {
        false
    }
}

fn session_process_group_alive(session_dir: &Path) -> bool {
    #[cfg(unix)]
    {
        let Ok(contents) = std::fs::read_to_string(session_dir.join(".pgid")) else {
            return false;
        };
        let Ok(group) = contents.trim().parse::<i32>() else {
            return false;
        };
        if group <= 1 {
            return false;
        }
        let result = unsafe { libc::kill(-group, 0) };
        result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(not(unix))]
    false
}

fn session_has_lease_holders(session_dir: &Path) -> Result<bool> {
    use std::os::fd::AsRawFd;
    // Open a separate file description: the inherited lease shares its lock
    // with descendants, so testing or unlocking that description is unsafe.
    let lease = match std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(session_dir.join(".active"))
    {
        Ok(lease) => lease,
        // Another launcher may already have reclaimed this inactive session.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error).context("cannot open descendant session lease"),
    };
    if unsafe { libc::flock(lease.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(false);
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::WouldBlock {
        Ok(true)
    } else {
        Err(error).context("cannot inspect descendant session lease")
    }
}

fn create_session_lease(session_dir: &Path) -> Result<std::fs::File> {
    let pending_path = session_dir.join(format!(
        ".active-initializing-{}",
        std::process::id()
    ));
    let active_path = session_dir.join(".active");
    let lease = std::fs::OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(&pending_path)?;
    #[cfg(unix)]
    unsafe {
        use std::os::fd::AsRawFd;
        let fd = lease.as_raw_fd();
        let flags = libc::fcntl(fd, libc::F_GETFD);
        if flags == -1 || libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) == -1 {
            let error = std::io::Error::last_os_error();
            drop(lease);
            let _ = std::fs::remove_file(&pending_path);
            return Err(error.into());
        }
        if libc::flock(fd, libc::LOCK_SH) != 0 {
            let error = std::io::Error::last_os_error();
            drop(lease);
            let _ = std::fs::remove_file(&pending_path);
            return Err(error.into());
        }
    }
    if let Err(error) = std::fs::rename(&pending_path, &active_path) {
        drop(lease);
        let _ = std::fs::remove_file(&pending_path);
        return Err(error.into());
    }
    Ok(lease)
}

#[cfg(unix)]
fn enable_trusted_session_writes(immutable: &Path, mutable: &Path) {
    unsafe {
        let symbol = libc::dlsym(
            libc::RTLD_DEFAULT,
            c"sandpit_enable_trusted_session_writes".as_ptr(),
        );
        if !symbol.is_null() {
            let Ok(immutable) = std::ffi::CString::new(immutable.to_string_lossy().as_bytes()) else {
                return;
            };
            let Ok(mutable) = std::ffi::CString::new(mutable.to_string_lossy().as_bytes()) else {
                return;
            };
            let enable: unsafe extern "C" fn(*const libc::c_char, *const libc::c_char) =
                std::mem::transmute(symbol);
            enable(immutable.as_ptr(), mutable.as_ptr());
        }
    }
}

#[cfg(not(unix))]
fn enable_trusted_session_writes(_immutable: &Path, _mutable: &Path) {}

#[cfg(unix)]
fn stdin_is_terminal() -> bool {
    unsafe { libc::isatty(libc::STDIN_FILENO) == 1 }
}

async fn run_sandbox(
    config_path: Option<PathBuf>,
    verbose: bool,
    no_shims: bool,
    no_adversary: bool,
    codex_external_sandbox: bool,
    managed: bool,
    command: Vec<String>,
) -> Result<()> {
    if command.is_empty() {
        bail!("No command specified. Usage: sandpit run [OPTIONS] -- <command>");
    }

    // Load config first — we need it to resolve the log path.
    let config_file = config::find_config(config_path.as_deref());
    let (mut cfg, config_source) = match config_file {
        Some(ref path) => {
            let c = config::Config::load(path)
                .with_context(|| format!("failed to load {}", path.display()))?;
            (c, format!("{}", path.display()))
        }
        None => (
            config::Config::builtin_default(),
            "built-in default".to_string(),
        ),
    };
    cfg.resolve_file_rules();

    let inherited_config = match std::env::var_os("SANDPIT_CONFIG").map(PathBuf::from) {
        Some(path) => match std::fs::canonicalize(&path) {
            Ok(path) if config::is_session_snapshot(&path) => Some((
                config::Config::load(&path).with_context(|| {
                    format!("failed to load inherited session policy: {}", path.display())
                })?,
                path,
            )),
            Ok(_) => None,
            Err(error) if config::is_session_snapshot(&path) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to resolve inherited session policy: {}",
                        path.display()
                    )
                });
            }
            Err(_) => None,
        },
        None => None,
    };
    if let Some((outer, _)) = &inherited_config {
        cfg.inherit_outer_policy(outer);
    }
    let reconciliation_policy = cfg.clone();
    let inherited_adversary_disabled = inherited_config.as_ref().is_some_and(|(_, path)| {
        path.parent()
            .and_then(|parent| std::fs::read_to_string(parent.join("adversary-disabled")).ok())
            .is_some_and(|value| value.trim() == "1")
    });
    let no_adversary = no_adversary
        && (inherited_config.is_none() || inherited_adversary_disabled);

    // Inject tamper-protection paths — always enforced regardless of user config
    inject_protection_paths(&mut cfg, &config_file);
    adversary::set_active_config(cfg.clone());

    // Log to file, never to stdout/stderr — the agent owns the terminal.
    // User can `tail -f` the log to watch what sandpit is doing.
    let log_path = cfg.log_path();
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("failed to open log file: {}", log_path.display()))?;

    let filter = if verbose {
        EnvFilter::new("sandpit=debug,info")
    } else {
        EnvFilter::new("sandpit=info,warn")
    };

    let otlp_layer = otel::try_init_otlp_logs_layer();

    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::sync::Mutex::new(log_file))
        .with_ansi(false);

    tracing_subscriber::registry()
        .with(file_layer.with_filter(filter))
        .with(otlp_layer)
        .init();

    if otel::is_otlp_initialized() {
        tracing::debug!("OTLP log export enabled");
    }

    tracing::debug!(config = %config_source, "loaded config");

    // ── Detect enforcement mode ────────────────────────────────
    // Inspect the target binary: if it supports DYLD_INSERT_LIBRARIES,
    // use supplemental DYLD hooks. Kernel policy is mandatory in every mode.
    //
    // TCC override: if the working directory is inside a TCC-protected
    // path (~/Documents, ~/Desktop, ~/Downloads), DYLD interpose breaks
    // the macOS attribution chain because the injected dylib is adhoc-signed.
    // This causes the kernel to deny ALL file access to the TCC directory
    // for the entire process tree. Fall back to seatbelt + shims instead.
    let (program, mut args) = resolve_shebang(&command[0], &command[1..]);
    let binary_mode = seatbelt::detect_mode(&program);
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let tcc_loc = seatbelt::tcc_protected_dir(&cwd);
    let active_mode = seatbelt::resolve_effective_mode(binary_mode, &tcc_loc);
    if inherited_config.is_some()
        && std::env::var_os("DYLD_INSERT_LIBRARIES").is_some()
        && active_mode != seatbelt::ActiveMode::Dyld
    {
        bail!(
            "nested Sandpit cannot downgrade the outer DYLD policy for {}; choose a DYLD-compatible command",
            command[0]
        );
    }
    if active_mode != binary_mode {
        let loc = tcc_loc.as_ref().unwrap();
        tracing::warn!(
            "working directory is inside {loc} (TCC-protected). \
             DYLD interpose would break the macOS attribution chain, \
             causing kernel-level file access denials. \
             Falling back to seatbelt + shims."
        );
        tracing::debug!(
            "hint: move your project outside ~/Documents, ~/Desktop, \
             or ~/Downloads to use full DYLD enforcement. \
             For example: ~/Development or ~/code"
        );
    }
    let use_dyld = active_mode == seatbelt::ActiveMode::Dyld;
    if !seatbelt::is_available() || active_mode == seatbelt::ActiveMode::Off {
        bail!("kernel sandbox unavailable; refusing to launch an uncontained agent");
    }
    if inherited_config.is_some() {
        bail!(
            "nested sandpit run is unsupported inside an existing kernel policy; run tools directly within the current sandbox"
        );
    }
    if codex_external_sandbox {
        // Every launch mode now installs the outer kernel sandbox.
        codex::validate_external_sandbox(&command, true)?;
        eprintln!(
            "sandpit: Codex will use sandpit's Seatbelt sandbox; Codex's approval policy is unchanged."
        );
        eprintln!(
            "sandpit: File restrictions and configured network policy are kernel-enforced; command-pattern checks are supplemental."
        );
    } else if command[0].rsplit('/').next() == Some("codex") {
        bail!(
            "Codex's inner sandbox cannot be composed with sandpit's Seatbelt file restrictions. Use `sandpit run --codex-external-sandbox -- codex ...` to explicitly use sandpit's policy, or run Codex directly to retain its native sandbox. No agent was launched."
        );
    }

    // ── Build env vars ───────────────────────────────────────────
    let mut env_vars: Vec<(String, String)> = Vec::new();

    // Establish per-run identity before finalizing the effective policy so its
    // immutable session state can protect itself from the sandboxed process.
    let session_ctx = otel::SessionContext::from_env(&command[0]);
    otel::set_session_context(session_ctx.clone());
    proxy_core::set_proxy_session_context(proxy_core::ProxySessionContext {
        session_id: session_ctx.session_id.clone(),
        agent_type: session_ctx.agent_type.clone(),
        user: session_ctx.user.clone(),
        host: session_ctx.host.clone(),
    });
    let sandpit_root = config::session_root();
    let mutable_sessions_root = sandpit_root.join("session-state");
    if inherited_config.is_none() {
        std::fs::create_dir_all(&sandpit_root)?;
        let sandbox_sentinel = sandpit_root.join("sandbox-sentinel");
        std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(&sandbox_sentinel)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&sandbox_sentinel, std::fs::Permissions::from_mode(0o600))?;
        }
    }
    env_vars.push((
        "SANDPIT_SESSION_ROOT".into(),
        sandpit_root.to_string_lossy().to_string(),
    ));
    if let Ok(executable) = std::env::current_exe().and_then(std::fs::canonicalize) {
        env_vars.push((
            "SANDPIT_LAUNCHER_EXE".into(),
            executable.to_string_lossy().to_string(),
        ));
    }
    let sessions_root = if inherited_config.is_some() {
        mutable_sessions_root.join("nested-sessions")
    } else {
        sandpit_root.join("sessions")
    };
    let session_name = format!(
        "run-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let session_dir = sessions_root.join(&session_name);
    let mutable_root_for_sessions = if inherited_config.is_some() {
        std::env::var_os("SANDPIT_MUTABLE_SESSION_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| mutable_sessions_root.clone())
            .join("nested")
    } else {
        mutable_sessions_root.clone()
    };
    let mutable_session_dir = mutable_root_for_sessions.join(&session_name);
    if inherited_config.is_some() {
        enable_trusted_session_writes(&session_dir, &mutable_session_dir);
    }
    if inherited_config.is_some() {
        cfg.files
            .block_write
            .push(session_dir.display().to_string());
    }
    match command[0].rsplit('/').next() {
        Some("claude" | "claude-code") => {
            if let Some(source) = std::env::var_os("CLAUDE_CONFIG_DIR")
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
            {
                let default =
                    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()))
                        .join(".claude");
                if source != default {
                    let source = std::fs::canonicalize(&source).unwrap_or(source);
                    cfg.files.block_write.extend([
                        source.join("settings.json").display().to_string(),
                        source.join("plugins").display().to_string(),
                    ]);
                }
            }
        }
        Some("goose") => {
            let root = std::env::var_os("GOOSE_PATH_ROOT")
                .map(PathBuf::from)
                .filter(|path| path.is_absolute());
            let config = adversary::goose_config_source(root.as_deref()).join("config.yaml");
            cfg.files.block_write.push(
                std::fs::canonicalize(&config)
                    .unwrap_or(config)
                    .display()
                    .to_string(),
            );
        }
        _ => {}
    }
    if !no_adversary {
        // Mutable agent roots contain symlinks to immutable policy. Protect
        // the link paths too, so a child cannot replace one and make a
        // nested agent load attacker-controlled policy from the overlay.
        cfg.files.block_write.extend([
            mutable_session_dir
                .join("goose/config/adversary.md")
                .display()
                .to_string(),
            mutable_session_dir
                .join("claude-config/settings.json")
                .display()
                .to_string(),
        ]);
    }
    if command[0].rsplit('/').next() == Some("amp")
        && !amp_manages_settings(&command[1..])
    {
        let mut amp_args = command[1..].to_vec();
        let explicit_settings =
            take_agent_option(&mut amp_args, "--settings-file").map(PathBuf::from);
        cfg.files.block_write.push(
            adversary::amp_settings_source(explicit_settings.as_deref())?
                .display()
                .to_string(),
        );
    }
    // Tell the dylib where to log (instead of stderr)
    env_vars.push((
        "SANDPIT_LOG_FILE".into(),
        log_path.to_string_lossy().to_string(),
    ));

    let egress = if cfg.has_network_rules() || !cfg.network.ssh.is_empty() {
        let audit = std::sync::Arc::new(
            proxy_core::AuditLogger::new(&cfg.audit_log_path())
                .context("cannot open parent-owned network audit log")?,
        );
        let egress = egress::start(cfg.network.clone(), audit).await?;
        cfg.network.ssh = egress.ssh_destinations.clone();
        let proxy = format!("http://127.0.0.1:{}", egress.port);
        for key in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            env_vars.push((key.into(), proxy.clone()));
        }
        for key in ["NO_PROXY", "no_proxy"] {
            env_vars.push((key.into(), if cfg.network.allow_loopback_ports.is_empty() { String::new() } else { "localhost,127.0.0.1,::1".into() }));
        }
        env_vars.push(("SANDPIT_PROXY_PORT".into(), egress.port.to_string()));
        Some(egress)
    } else {
        None
    };
    if use_dyld {
        env_vars.extend(config::config_to_env_vars(&cfg));
    }

    // ── Command shims ─────────────────────────────────────────────
    // Generate PATH-based shims that shadow dangerous commands.
    // Works on every binary — no DYLD, no seatbelt needed.
    // On by default; disable with --no-shims.
    let mut use_shims = false;
    if !no_shims {
        if cfg.has_exec_rules() || cfg.has_network_rules() {
            match shims::generate_shims(&cfg) {
                Ok(shims_dir) => {
                    let current_path = std::env::var("PATH").unwrap_or_default();
                    let new_path = format!("{}:{}", shims_dir.display(), current_path);
                    env_vars.push(("PATH".into(), new_path));
                    env_vars.push((
                        "SANDPIT_SSH_WRAPPER".into(),
                        shims_dir.join("ssh").display().to_string(),
                    ));
                    use_shims = true;
                }
                Err(e) => {
                    tracing::warn!(%e, "failed to generate shims, continuing without");
                }
            }
        }
    }

    // ── Status banner (to log file) ─────────────────────────────
    let cmd_str = command.join(" ");
    // Pass agent type + session id to subprocesses (hooks, shims) via env vars
    // so all events from this run share one correlation key.
    env_vars.push(("SANDPIT_AGENT_TYPE".into(), session_ctx.agent_type.clone()));
    env_vars.push(("SANDPIT_SESSION_ID".into(), session_ctx.session_id.clone()));

    // Snapshot the effective config for this session. Hooks and shims inherit
    // this unique path, so concurrent runs cannot overwrite each other's
    // policy and config edits only affect sessions started after the edit.
    std::fs::create_dir_all(&sessions_root)?;
    cleanup_inactive_sessions(
        &sessions_root,
        &mutable_root_for_sessions,
        &mutable_sessions_root.join("nested-sessions"),
    );
    std::fs::create_dir_all(mutable_sessions_root.join("nested-sessions"))?;
    std::fs::create_dir_all(&session_dir)?;
    std::fs::create_dir_all(&mutable_session_dir)?;
    std::fs::create_dir_all(mutable_session_dir.join("nested"))?;
    let mutable_session_dir =
        std::fs::canonicalize(&mutable_session_dir).unwrap_or(mutable_session_dir);
    std::fs::write(
        session_dir.join("mutable-root.json"),
        serde_json::to_vec(&mutable_session_dir)?,
    )?;
    env_vars.push((
        "SANDPIT_MUTABLE_SESSION_DIR".into(),
        mutable_session_dir.to_string_lossy().to_string(),
    ));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&session_dir, std::fs::Permissions::from_mode(0o700))?;
        std::fs::set_permissions(&mutable_session_dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let session_config = session_dir.join("config.toml");
    std::fs::write(&session_config, toml::to_string_pretty(&cfg)?)?;
    std::fs::write(
        session_dir.join("adversary-disabled"),
        if no_adversary { "1\n" } else { "0\n" },
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&session_config, std::fs::Permissions::from_mode(0o600))?;
    }
    let session_lease = create_session_lease(&session_dir)?;
    env_vars.push((
        "SANDPIT_CONFIG".into(),
        session_config.to_string_lossy().to_string(),
    ));
    env_vars.push((
        "SANDPIT_ADVERSARY_RULES".into(),
        adversary::rules_from(Some(&cfg)),
    ));
    env_vars.push((
        "SANDPIT_ADVERSARY_DISABLED".into(),
        if no_adversary { "1" } else { "0" }.into(),
    ));

    tracing::info!("launching `{cmd_str}` (config: {config_source})");

    tracing::debug!("mode: mandatory kernel file policy, optional DYLD hooks and command shims");
    let fallback_note = " (kernel-confined broker)";
    if !cfg.network.block.is_empty() {
        tracing::debug!(
            "network: blocking {} domains{}",
            cfg.network.block.len(),
            fallback_note
        );
    } else if !cfg.network.allow.is_empty() {
        tracing::debug!(
            "network: allowlist mode ({} domains){}",
            cfg.network.allow.len(),
            fallback_note
        );
    }
    if !cfg.exec.block.is_empty() {
        tracing::debug!(
            "exec: {} block patterns{}",
            cfg.exec.block.len(),
            fallback_note
        );
    }
    if cfg.has_file_rules() {
        let mut parts = Vec::new();
        if !cfg.files.allow_write.is_empty() {
            parts.push(format!(
                "write allowed: {}",
                cfg.files.allow_write.join(", ")
            ));
        }
        if !cfg.files.block_write.is_empty() {
            parts.push(format!(
                "write blocked: {}",
                cfg.files.block_write.join(", ")
            ));
        }
        if !cfg.files.block_read.is_empty() {
            parts.push(format!("read blocked: {}", cfg.files.block_read.join(", ")));
        }
        tracing::debug!("files: {}", parts.join("; "));
    }
    if use_shims {
        let count = std::fs::read_dir(shims::shims_dir_path())
            .map(|d| d.count())
            .unwrap_or(0);
        tracing::debug!("{count} commands shimmed");
    }

    // ── Auto-install adversary hooks ──────────────────────────────
    // Refresh persistent hook scaffolding on every run so upgrades repair stale
    // binary paths. The active policy itself comes from session-specific state.
    let agent_bin = command[0].rsplit('/').next().unwrap_or(&command[0]);
    let agent_name = match agent_bin {
        "claude" | "claude-code" => Some("claude"),
        "goose" => Some("goose"),
        "pi" => Some("pi"),
        "amp" => Some("amp"),
        _ => {
            // Check if the binary name matches a supported agent
            if adversary::SUPPORTED_AGENTS.contains(&agent_bin) {
                Some(agent_bin)
            } else {
                None
            }
        }
    };
    let mut claude_state_sync: Option<(PathBuf, PathBuf, PathBuf, bool)> = None;
    let mut goose_state_sync: Option<(PathBuf, PathBuf)> = None;
    let mut amp_state_sync: Option<(PathBuf, PathBuf, PathBuf, bool)> = None;

    // Stage Amp's inert reviewer executable before entering Seatbelt. Nested
    // runs can then use it without granting Sandpit process-wide write access
    // to protected executable artifacts inside the inherited profile.
    if inherited_config.is_none() {
        if let Err(error) = adversary::refresh_for_run("pi", &cfg) {
            tracing::warn!(%error, "failed to stage nested Pi reviewer scaffold");
        }
        if let Err(error) = adversary::refresh_for_run("amp", &cfg) {
            tracing::warn!(%error, "failed to stage nested Amp reviewer scaffold");
        }
    }

    if !no_adversary {
        if let Some(name) = agent_name {
            let refresh = if inherited_config.is_some() {
                if matches!(name, "claude" | "goose")
                    || adversary::is_installed(name)
                    || (name == "amp" && adversary::amp_scaffold_installed())
                {
                    Ok(())
                } else {
                    adversary::refresh_for_nested_run(name, &cfg)
                }
            } else {
                adversary::refresh_for_run(name, &cfg)
            };
            match refresh {
                Ok(()) => {
                    tracing::debug!("adversary hooks: refreshed for {name}");
                }
                Err(e) => {
                    if inherited_config.is_some() {
                        return Err(e).with_context(|| {
                            format!("nested {name} adversary hooks are not installed")
                        });
                    }
                    tracing::warn!("adversary hooks: failed to install for {name}: {e}");
                }
            }

            // Claude's LLM hook prompt is supplied as a per-session settings
            // layer. This guarantees the active config participates even when
            // another run refreshes the persistent global entry concurrently.
            if name == "claude" {
                let source = std::env::var_os("CLAUDE_CONFIG_DIR")
                    .map(PathBuf::from)
                    .filter(|path| path.is_absolute())
                    .unwrap_or_else(|| {
                        PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()))
                            .join(".claude")
                    });
                let claude_root = mutable_session_dir.join("claude-config");
                let snapshot = session_dir.join("claude-user-settings.json");
                let settings = session_dir.join("claude-active-settings.json");
                let mut source_args = args.clone();
                let include_user_settings =
                    take_agent_option(&mut source_args, "--setting-sources")
                        .map(|sources| sources.split(',').any(|source| source.trim() == "user"))
                        .unwrap_or(true);
                let existing_settings = if include_user_settings {
                    None
                } else {
                    take_agent_option(&mut args, "--settings")
                };
                adversary::prepare_claude_session_with_adversary(
                    &source,
                    &claude_root,
                    &snapshot,
                    &settings,
                    existing_settings.as_deref(),
                    include_user_settings,
                    &cfg,
                )?;
                if !include_user_settings {
                    insert_agent_options(
                        &program,
                        &command[0],
                        &mut args,
                        ["--settings".to_string(), settings.display().to_string()],
                    );
                }
                env_vars.push((
                    "CLAUDE_CONFIG_DIR".into(),
                    claude_root.to_string_lossy().to_string(),
                ));
                claude_state_sync = Some((source, snapshot, claude_root, false));
            } else if name == "goose" {
                let goose_root = mutable_session_dir.join("goose");
                let existing_root = std::env::var_os("GOOSE_PATH_ROOT")
                    .map(PathBuf::from)
                    .filter(|path| path.is_absolute());
                let snapshot = session_dir.join("goose-entries.json");
                adversary::prepare_goose_session(
                    Some(&adversary::rules_from(Some(&cfg))),
                    &goose_root,
                    &snapshot,
                    &session_dir.join("goose-adversary.md"),
                    existing_root.as_deref(),
                )?;
                env_vars.push((
                    "GOOSE_PATH_ROOT".into(),
                    goose_root.to_string_lossy().to_string(),
                ));
                goose_state_sync = Some((goose_root, snapshot));
            } else if name == "amp" && !amp_manages_settings(&command[1..]) {
                let settings = session_dir.join("amp-settings.json");
                let snapshot = session_dir.join("amp-source-settings.json");
                let source = take_agent_option(&mut args, "--settings-file").map(PathBuf::from);
                let persistent_settings = adversary::amp_settings_source(source.as_deref())?;
                adversary::snapshot_amp_settings(Some(&persistent_settings), &snapshot)?;
                adversary::write_amp_session_settings_with_adversary(
                    Some(&persistent_settings),
                    &settings,
                )?;
                insert_agent_options(
                    &program,
                    &command[0],
                    &mut args,
                    [
                        "--settings-file".to_string(),
                        settings.display().to_string(),
                    ],
                );
                env_vars.push((
                    "AMP_SETTINGS_FILE".into(),
                    settings.to_string_lossy().to_string(),
                ));
                let policy_allows_sync =
                    reconciliation_policy.allows_write_to(&persistent_settings);
                amp_state_sync =
                    Some((persistent_settings, snapshot, settings, policy_allows_sync));
            }
        } else if adversary::HOOKLESS_AGENTS.contains(&agent_bin) {
            tracing::debug!(
                "adversary hooks: {agent_bin} has no hook API — deterministic layers only"
            );
        }
    } else if let Some(name) = agent_name {
        match name {
            "claude" => {
                let source = std::env::var_os("CLAUDE_CONFIG_DIR")
                    .map(PathBuf::from)
                    .filter(|path| path.is_absolute())
                    .unwrap_or_else(|| {
                        PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()))
                            .join(".claude")
                    });
                let claude_root = mutable_session_dir.join("claude-config");
                let snapshot = session_dir.join("claude-user-settings.json");
                adversary::prepare_claude_session_without_adversary(
                    &source,
                    &claude_root,
                    &snapshot,
                )?;
                if let Some(existing_settings) = take_agent_option(&mut args, "--settings") {
                    let filtered_settings = session_dir.join("claude-cli-settings.json");
                    adversary::write_claude_session_settings(
                        None,
                        Some(&existing_settings),
                        false,
                        &filtered_settings,
                    )?;
                    insert_agent_options(
                        &program,
                        &command[0],
                        &mut args,
                        [
                            "--settings".to_string(),
                            filtered_settings.display().to_string(),
                        ],
                    );
                }
                env_vars.push((
                    "CLAUDE_CONFIG_DIR".into(),
                    claude_root.to_string_lossy().to_string(),
                ));
                claude_state_sync = Some((source, snapshot, claude_root, true));
            }
            "goose" => {
                let goose_root = mutable_session_dir.join("goose");
                let existing_root = std::env::var_os("GOOSE_PATH_ROOT")
                    .map(PathBuf::from)
                    .filter(|path| path.is_absolute());
                let snapshot = session_dir.join("goose-entries.json");
                adversary::prepare_goose_session(
                    None,
                    &goose_root,
                    &snapshot,
                    &session_dir.join("goose-adversary.md"),
                    existing_root.as_deref(),
                )?;
                env_vars.push((
                    "GOOSE_PATH_ROOT".into(),
                    goose_root.to_string_lossy().to_string(),
                ));
                goose_state_sync = Some((goose_root, snapshot));
            }
            // The session environment marker disables any discovered or
            // explicitly loaded Sandpit extension without adding a Pi flag.
            "pi" => {
                let extension =
                    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()))
                        .join(".pi/agent/extensions/adversary.ts");
                if extension.exists() {
                    if let Err(error) = adversary::refresh_for_run("pi", &cfg) {
                        tracing::warn!(
                            "adversary hooks: failed to refresh existing Pi extension: {error}"
                        );
                    }
                }
            }
            "amp" if !amp_manages_settings(&command[1..]) => {
                let settings = session_dir.join("amp-settings.json");
                let snapshot = session_dir.join("amp-source-settings.json");
                let source = take_agent_option(&mut args, "--settings-file").map(PathBuf::from);
                let persistent_settings = adversary::amp_settings_source(source.as_deref())?;
                adversary::snapshot_amp_settings(Some(&persistent_settings), &snapshot)?;
                adversary::write_amp_session_settings_without_adversary(
                    Some(&persistent_settings),
                    &settings,
                )?;
                insert_agent_options(
                    &program,
                    &command[0],
                    &mut args,
                    [
                        "--settings-file".to_string(),
                        settings.display().to_string(),
                    ],
                );
                env_vars.push((
                    "AMP_SETTINGS_FILE".into(),
                    settings.to_string_lossy().to_string(),
                ));
                let policy_allows_sync =
                    reconciliation_policy.allows_write_to(&persistent_settings);
                amp_state_sync =
                    Some((persistent_settings, snapshot, settings, policy_allows_sync));
            }
            _ => {}
        }
        tracing::debug!("adversary hooks: skipped (--no-adversary)");
    }

    // Wrappers may hide nested agent launches from basename detection. Supply
    // filtered roots that descendants inherit so native prompt/policy hooks do
    // not survive an explicit opt-out.
    if no_adversary && claude_state_sync.is_none() {
        let source = std::env::var_os("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()))
                    .join(".claude")
            });
        let claude_root = mutable_session_dir.join("claude-disabled");
        adversary::prepare_claude_session_without_adversary(
            &source,
            &claude_root,
            &session_dir.join("claude-disabled-settings.json"),
        )?;
        env_vars.push((
            "CLAUDE_CONFIG_DIR".into(),
            claude_root.to_string_lossy().to_string(),
        ));
        claude_state_sync = Some((
            source,
            session_dir.join("claude-disabled-settings.json"),
            claude_root,
            true,
        ));
    }
    if no_adversary && goose_state_sync.is_none() {
        let goose_root = mutable_session_dir.join("goose-disabled");
        let existing_root = std::env::var_os("GOOSE_PATH_ROOT")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute());
        let snapshot = session_dir.join("goose-disabled-entries.json");
        adversary::prepare_goose_session(
            None,
            &goose_root,
            &snapshot,
            &session_dir.join("goose-disabled-adversary.md"),
            existing_root.as_deref(),
        )?;
        env_vars.push((
            "GOOSE_PATH_ROOT".into(),
            goose_root.to_string_lossy().to_string(),
        ));
        goose_state_sync = Some((goose_root, snapshot));
    }

    let sync_plan = SessionSyncPlan {
        claude: claude_state_sync
            .as_ref()
            .map(|state| ClaudeSyncPlan::for_run(state, inherited_config.is_some())),
        goose: goose_state_sync
            .as_ref()
            .map(|(overlay, snapshot)| GooseSyncPlan {
                overlay: overlay.clone(),
                snapshot: snapshot.clone(),
            }),
        amp: amp_state_sync
            .as_ref()
            .map(
                |(source, snapshot, overlay, policy_allows_sync)| AmpSyncPlan {
                    source: source.clone(),
                    snapshot: snapshot.clone(),
                    overlay: overlay.clone(),
                    policy_allows_sync: *policy_allows_sync,
                },
            ),
    };
    std::fs::write(
        session_dir.join("sync-plan.json"),
        serde_json::to_vec(&sync_plan)?,
    )?;

    // The kernel sandbox is installed before the bootstrap, the agent, or
    // any agent-controlled dynamic initializer can run. Hooks are supplemental.
    let kernel_cfg = seatbelt::validate_file_aliases(&cfg, Some(&mutable_session_dir))?;
    let mut profile = seatbelt::generate_profile(&kernel_cfg, Some(&mutable_session_dir));
    if let Some(egress) = &egress {
        profile.push_str(&seatbelt::network_profile(egress.port, &egress.sockets, &cfg.network.allow_loopback_ports));
    }
    let profile_path = session_dir.join("kernel.sb");
    std::fs::write(&profile_path, profile)?;
    if codex_external_sandbox {
        let options = codex::external_sandbox_options(&env_vars);
        insert_agent_options(&program, &command[0], &mut args, options);
    }
    let bootstrap = std::env::current_exe()?;
    let mut bootstrap_args = vec!["kernel-exec".to_string()];
    if managed {
        bootstrap_args.extend(["--verify-denied-write".into(),
            sandpit_root.join("sandbox-sentinel").display().to_string()]);
    }
    if use_dyld {
        bootstrap_args.extend(["--library".into(), find_dylib()?.display().to_string()]);
    }
    bootstrap_args.push("--".into());
    bootstrap_args.push(program.clone());
    bootstrap_args.extend(args);
    let (final_program, final_args) = seatbelt::wrap_command(
        &profile_path,
        bootstrap.to_str().context("invalid bootstrap path")?,
        &bootstrap_args,
    );

    #[cfg(unix)]
    let isolate_child_group = !managed && !stdin_is_terminal();
    let mut child_command = tokio::process::Command::new(&final_program);
    child_command
        .args(&final_args)
        .envs(env_vars.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    #[cfg(unix)]
    if isolate_child_group {
        child_command.process_group(0);
    }
    // Preserve the session lease across exec so detached descendants keep their
    // policy alive. All other nonstandard inherited descriptors must close.
    // New Rust/Tokio descriptors are created CLOEXEC already. Do not close the
    // child-side error pipe from pre_exec (that would hide exec failures).
    use std::os::fd::AsRawFd;
    let lease_fd = session_lease.as_raw_fd();
    for entry in std::fs::read_dir("/dev/fd")? {
        if let Ok(fd) = entry?.file_name().to_string_lossy().parse::<i32>() {
            if fd > 2
                && fd != lease_fd
                && unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0
            {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() != Some(libc::EBADF) {
                    return Err(error).context("cannot seal inherited descriptor");
                }
            }
        }
    }
    let mut child = child_command
        .spawn()
        .with_context(|| format!("failed to spawn: {cmd_str}"))?;

    #[cfg(unix)]
    let child_group = isolate_child_group
        .then(|| child.id())
        .flatten()
        .map(|id| id as i32);
    #[cfg(not(unix))]
    let child_group = child.id().map(|id| id as i32);
    if let Some(group) = child_group {
        if let Err(error) = std::fs::write(session_dir.join(".pgid"), format!("{group}\n")) {
            #[cfg(unix)]
            unsafe {
                libc::kill(-group, libc::SIGTERM);
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(error).context("failed to record child process group");
        }
    }
    let child_wait = child.wait();
    tokio::pin!(child_wait);
    let status = loop {
        tokio::select! {
            result = &mut child_wait => break result,
            interrupt = tokio::signal::ctrl_c() => {
                match interrupt {
                    Ok(()) => tracing::debug!(
                        "interrupt received; forwarding to child group before reconciling state"
                    ),
                    Err(error) => {
                        tracing::warn!(%error, "failed to listen for interrupts");
                        break child_wait.await;
                    }
                }
                #[cfg(unix)]
                if let Some(group) = child_group {
                    unsafe { libc::kill(-group, libc::SIGINT); }
                }
            }
        }
    };
    let status = status?;

    drop(session_lease);
    // Descendants depend on the parent-owned broker even after the initial
    // agent exits. Keep serving until both the inherited lease and any tracked
    // process group are gone; retain the initial agent's exit status throughout.
    if egress.is_some() {
        while session_has_lease_holders(&session_dir)?
            || session_process_group_alive(&session_dir)
        {
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {},
                interrupt = tokio::signal::ctrl_c() => {
                    interrupt.context("failed to listen for interrupts while serving descendants")?;
                    #[cfg(unix)]
                    if let Some(group) = child_group {
                        unsafe { libc::kill(-group, libc::SIGINT); }
                    }
                }
            }
        }
    }
    cleanup_inactive_sessions(
        &sessions_root,
        &mutable_root_for_sessions,
        &mutable_sessions_root.join("nested-sessions"),
    );

    // Persistent hook scaffolding remains until an explicit uninstall. Active
    // background descendants retain the session lease and its immutable policy.

    otel::shutdown_otlp();

    if status.success() {
        std::process::exit(0);
    } else {
        std::process::exit(status.code().unwrap_or(1));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recovery_fixture(
        sessions_root: &Path,
        mutable_root: &Path,
        name: &str,
        source: Option<&Path>,
    ) -> (PathBuf, PathBuf, std::fs::File) {
        let session = sessions_root.join(name);
        let mutable = mutable_root.join(name);
        std::fs::create_dir_all(&session).unwrap();
        std::fs::create_dir_all(mutable.join("nested")).unwrap();
        std::fs::write(
            session.join("mutable-root.json"),
            serde_json::to_vec(&std::fs::canonicalize(&mutable).unwrap()).unwrap(),
        )
        .unwrap();
        let mut plan = SessionSyncPlan::default();
        if let Some(source) = source {
            let overlay = mutable.join("settings.json");
            let snapshot = session.join("settings-snapshot.json");
            adversary::snapshot_amp_settings(Some(source), &snapshot).unwrap();
            std::fs::copy(source, &overlay).unwrap();
            plan.amp = Some(AmpSyncPlan {
                source: source.to_path_buf(),
                snapshot,
                overlay,
                policy_allows_sync: true,
            });
        }
        std::fs::write(
            session.join("sync-plan.json"),
            serde_json::to_vec(&plan).unwrap(),
        )
        .unwrap();
        std::fs::write(session.join("config.toml"), "").unwrap();
        let lease = create_session_lease(&session).unwrap();
        (session, mutable, lease)
    }

    #[test]
    fn session_lease_probe_does_not_release_inherited_lock() {
        let temp = tempfile::tempdir().unwrap();
        let lease = create_session_lease(temp.path()).unwrap();
        let inherited = lease.try_clone().unwrap();
        assert!(session_has_lease_holders(temp.path()).unwrap());
        drop(lease);
        assert!(session_has_lease_holders(temp.path()).unwrap());
        drop(inherited);
        assert!(!session_has_lease_holders(temp.path()).unwrap());
        assert!(!session_has_lease_holders(temp.path()).unwrap());
        std::fs::remove_file(temp.path().join(".active")).unwrap();
        assert!(!session_has_lease_holders(temp.path()).unwrap());
    }

    #[test]
    fn cleanup_recovers_nested_state_deepest_first() {
        let temp = tempfile::tempdir().unwrap();
        let sessions = temp.path().join("sessions");
        let mutable = temp.path().join("mutable");
        let nested = mutable.join("nested-sessions");
        let persistent = temp.path().join("settings.json");
        std::fs::write(&persistent, r#"{"state":"initial"}"#).unwrap();
        let (outer_session, outer, outer_lease) =
            recovery_fixture(&sessions, &mutable, "run-outer", Some(&persistent));
        let (child_session, child, child_lease) = recovery_fixture(
            &nested,
            &outer.join("nested"),
            "run-child",
            Some(&outer.join("settings.json")),
        );
        let (grandchild_session, grandchild, grandchild_lease) = recovery_fixture(
            &nested,
            &child.join("nested"),
            "run-grandchild",
            Some(&child.join("settings.json")),
        );
        std::fs::write(grandchild.join("settings.json"), r#"{"state":"recovered"}"#).unwrap();
        drop((outer_lease, child_lease, grandchild_lease));
        assert!(cleanup_inactive_sessions(&sessions, &mutable, &nested));
        let recovered: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(persistent).unwrap()).unwrap();
        assert_eq!(recovered["state"], "recovered");
        for path in [
            outer_session,
            outer,
            child_session,
            child,
            grandchild_session,
            grandchild,
        ] {
            assert!(!path.exists(), "{}", path.display());
        }
    }

    #[test]
    fn cleanup_retains_parents_with_live_failed_or_incomplete_children() {
        for state in ["live", "failed", "incomplete"] {
            let temp = tempfile::tempdir().unwrap();
            let sessions = temp.path().join("sessions");
            let mutable = temp.path().join("mutable");
            let nested = mutable.join("nested-sessions");
            let (outer_session, outer, lease) =
                recovery_fixture(&sessions, &mutable, "run-outer", None);
            drop(lease);
            let (child_session, child, child_lease) =
                recovery_fixture(&nested, &outer.join("nested"), "run-child", None);
            std::fs::write(child.join("important"), "keep").unwrap();
            let live_lease = if state == "live" {
                Some(child_lease)
            } else {
                drop(child_lease);
                if state == "failed" {
                    std::fs::write(child_session.join("sync-plan.json"), "invalid").unwrap();
                } else {
                    std::fs::remove_file(child_session.join(".active")).unwrap();
                }
                None
            };
            assert!(
                !cleanup_inactive_sessions(&sessions, &mutable, &nested),
                "{state}"
            );
            assert!(outer_session.exists());
            assert!(child_session.exists());
            assert_eq!(
                std::fs::read_to_string(child.join("important")).unwrap(),
                "keep"
            );
            drop(live_lease);
        }
    }

    #[test]
    fn nested_cleanup_only_removes_its_own_overlays() {
        let temp = tempfile::tempdir().unwrap();
        let nested = temp.path().join("nested-sessions");
        let own_root = temp.path().join("own/nested");
        let other_root = temp.path().join("other/nested");
        let (own_session, own, own_lease) = recovery_fixture(&nested, &own_root, "run-own", None);
        let (other_session, other, other_lease) =
            recovery_fixture(&nested, &other_root, "run-other", None);
        drop((own_lease, other_lease));
        assert!(cleanup_inactive_sessions(&nested, &own_root, &nested));
        assert!(!own_session.exists());
        assert!(!own.exists());
        assert!(other_session.exists());
        assert!(other.exists());
    }

    #[test]
    fn nested_cleanup_rejects_other_parents_session_names() {
        let temp = tempfile::tempdir().unwrap();
        let nested = temp.path().join("nested-sessions");
        let own_root = temp.path().join("own/nested");
        let other_root = temp.path().join("other/nested");
        let (other_session, other, lease) =
            recovery_fixture(&nested, &other_root, "run-other", None);
        let borrowed_name = own_root.join("run-other");
        std::fs::create_dir_all(&borrowed_name).unwrap();
        drop(lease);
        assert!(!cleanup_inactive_sessions(&nested, &own_root, &nested));
        assert!(other_session.exists());
        assert!(other.exists());
        assert!(borrowed_name.exists());
    }

    #[test]
    fn recovery_keeps_launch_directory_and_environment() {
        const CHILD: &str = "SANDPIT_RECOVERY_TEST_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "tests::recovery_keeps_launch_directory_and_environment",
                    "--nocapture",
                ])
                .env(CHILD, "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        let original_cwd = std::env::current_dir().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let launch = temp.path().join("launch");
        let recovery = temp.path().join("recovery");
        std::fs::create_dir_all(&launch).unwrap();
        std::fs::create_dir_all(&recovery).unwrap();
        std::fs::write(launch.join("settings.json"), r#"{"theme":"old"}"#).unwrap();
        std::fs::write(recovery.join("settings.json"), r#"{"theme":"unrelated"}"#).unwrap();
        std::env::set_current_dir(&launch).unwrap();
        let source = adversary::amp_settings_source(Some(Path::new("settings.json"))).unwrap();
        assert!(source.is_absolute());
        unsafe {
            std::env::set_var("AMP_SETTINGS_FILE", "settings.json");
        }
        assert_eq!(adversary::amp_settings_source(None).unwrap(), source);
        let snapshot = temp.path().join("snapshot.json");
        let overlay = temp.path().join("overlay.json");
        adversary::snapshot_amp_settings(Some(&source), &snapshot).unwrap();
        std::fs::write(&overlay, r#"{"theme":"updated"}"#).unwrap();
        for home in [&launch, &recovery] {
            std::fs::create_dir_all(home.join(".claude")).unwrap();
            std::fs::create_dir_all(home.join("xdg/goose")).unwrap();
            std::fs::write(home.join(".claude.json"), "old state").unwrap();
            std::fs::write(home.join("xdg/goose/preferences"), "old preferences").unwrap();
        }
        unsafe {
            std::env::set_var("HOME", &launch);
            std::env::set_var("XDG_CONFIG_HOME", launch.join("xdg"));
            std::env::set_var("XDG_DATA_HOME", launch.join("data"));
            std::env::set_var("XDG_STATE_HOME", launch.join("state"));
        }
        let claude = ClaudeSyncPlan {
            source: launch.join(".claude"),
            overlay: temp.path().join("claude"),
            snapshot: temp.path().join("claude-snapshot.json"),
            sync_settings: false,
        };
        adversary::prepare_claude_session_without_adversary(
            &claude.source,
            &claude.overlay,
            &claude.snapshot,
        )
        .unwrap();
        std::fs::remove_file(claude.overlay.join(".claude.json")).unwrap();
        std::fs::write(claude.overlay.join(".claude.json"), "updated state").unwrap();
        let goose = GooseSyncPlan {
            overlay: temp.path().join("goose"),
            snapshot: temp.path().join("goose-snapshot.json"),
        };
        adversary::prepare_goose_session(
            None,
            &goose.overlay,
            &goose.snapshot,
            &temp.path().join("rules"),
            None,
        )
        .unwrap();
        std::fs::remove_file(goose.overlay.join("config/preferences")).unwrap();
        std::fs::write(
            goose.overlay.join("config/preferences"),
            "updated preferences",
        )
        .unwrap();
        let plan = SessionSyncPlan {
            amp: Some(AmpSyncPlan {
                source,
                snapshot,
                overlay,
                policy_allows_sync: true,
            }),
            claude: Some(claude),
            goose: Some(goose),
        };
        let encoded = serde_json::to_string(&plan).unwrap();
        std::env::set_current_dir(&recovery).unwrap();
        unsafe {
            std::env::set_var("HOME", &recovery);
            std::env::set_var("XDG_CONFIG_HOME", recovery.join("xdg"));
        }
        let mut unbound: SessionSyncPlan = serde_json::from_str(&encoded).unwrap();
        unbound.amp.as_mut().unwrap().source = PathBuf::from("settings.json");
        assert!(!reconcile_session_plan(
            &unbound,
            &config::Config::default()
        ));
        let decoded = serde_json::from_str(&encoded).unwrap();
        assert!(reconcile_session_plan(&decoded, &config::Config::default()));
        let changed: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(launch.join("settings.json")).unwrap())
                .unwrap();
        assert_eq!(changed["theme"], "updated");
        assert_eq!(
            std::fs::read_to_string(recovery.join("settings.json")).unwrap(),
            r#"{"theme":"unrelated"}"#
        );
        assert_eq!(
            std::fs::read_to_string(launch.join(".claude.json")).unwrap(),
            "updated state"
        );
        assert_eq!(
            std::fs::read_to_string(recovery.join(".claude.json")).unwrap(),
            "old state"
        );
        assert!(!launch.join(".claude/.claude.json").exists());
        assert_eq!(
            std::fs::read_to_string(launch.join("xdg/goose/preferences")).unwrap(),
            "updated preferences"
        );
        assert_eq!(
            std::fs::read_to_string(recovery.join("xdg/goose/preferences")).unwrap(),
            "old preferences"
        );
        std::env::set_current_dir(original_cwd).unwrap();
    }

    #[test]
    fn protection_paths_cover_the_shared_adversary_lock() {
        let mut cfg = config::Config::default();
        inject_protection_paths(&mut cfg, &None);
        assert!(
            cfg.files
                .block_write
                .contains(&config::adversary_lock_path().display().to_string())
        );
        assert!(!cfg.allows_write_to(&config::adversary_lock_path()));
    }

    #[test]
    fn nested_claude_reconciliation_keeps_settings_local_and_syncs_other_state() {
        for nested in [true, false] {
            let temp = tempfile::tempdir().unwrap();
            let source = temp.path().join("source");
            let snapshot = temp.path().join("snapshot.json");
            let overlay = temp.path().join("overlay");
            std::fs::create_dir_all(&source).unwrap();
            std::fs::write(source.join("settings.json"), r#"{"theme":"dark"}"#).unwrap();
            adversary::prepare_claude_session_without_adversary(&source, &overlay, &snapshot)
                .unwrap();
            std::fs::write(overlay.join("settings.json"), r#"{"theme":"light"}"#).unwrap();
            std::fs::write(overlay.join("normal-state.json"), "{}").unwrap();
            let state = (source.clone(), snapshot, overlay, true);
            let claude = ClaudeSyncPlan::for_run(&state, nested);
            assert_eq!(claude.sync_settings, !nested);
            let encoded = serde_json::to_string(&claude).unwrap();
            let plan = SessionSyncPlan {
                claude: Some(serde_json::from_str(&encoded).unwrap()),
                ..Default::default()
            };
            let mut cfg = config::Config::default();
            cfg.files
                .block_write
                .push(source.join("settings.json").display().to_string());
            assert!(reconcile_session_plan(&plan, &cfg));
            let settings: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(source.join("settings.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(settings["theme"], if nested { "dark" } else { "light" });
            assert!(source.join("normal-state.json").is_file());
        }
    }

    #[test]
    fn amp_settings_subcommands_skip_global_option_values() {
        assert!(amp_manages_settings(&[
            "--log-file".into(),
            "/tmp/amp.log".into(),
            "config".into(),
            "edit".into(),
        ]));
        assert!(amp_manages_settings(&[
            "--mcp-config".into(),
            "config.json".into(),
            "permissions".into(),
            "list".into(),
        ]));
        assert!(amp_manages_settings(&[
            "mcp".into(),
            "add".into(),
            "example".into(),
        ]));
        assert!(!amp_manages_settings(&[
            "--execute".into(),
            "config".into(),
        ]));
    }
}
