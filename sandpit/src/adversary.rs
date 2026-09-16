//! Per-agent adversary hook installation.
//!
//! Each agent has its own hook mechanism for reviewing tool calls.
//! Rules come from [adversary] in sandpit.toml. This module writes
//! them to each agent's native config location.

use anyhow::{Result, bail};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::fd::AsRawFd;
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::sync::OnceLock;

use crate::config;

static ACTIVE_CONFIG: OnceLock<config::Config> = OnceLock::new();

pub fn set_active_config(config: config::Config) {
    let _ = ACTIVE_CONFIG.set(config);
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
}

fn sandpit_dir() -> PathBuf {
    home().join(".sandpit")
}

struct InstallLock {
    file: fs::File,
}

#[cfg(unix)]
impl Drop for InstallLock {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

fn acquire_install_lock() -> Result<InstallLock> {
    let path = config::adversary_lock_path();
    let dir = path.parent().expect("adversary lock has a parent directory");
    if !dir.is_dir() {
        fs::create_dir_all(dir)?;
    }
    let file = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path)?;
    #[cfg(unix)]
    unsafe {
        if libc::fcntl(file.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) == -1 {
            return Err(std::io::Error::last_os_error().into());
        }
        if libc::flock(file.as_raw_fd(), libc::LOCK_EX) != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    Ok(InstallLock { file })
}

fn write_atomic(path: &Path, contents: impl AsRef<[u8]>) -> Result<()> {
    // Preserve user-managed symlinks (for example dotfiles repositories):
    // atomically replace the target rather than the link itself.
    let destination = if path.is_symlink() {
        fs::canonicalize(path).or_else(|_| {
            let target = fs::read_link(path)?;
            Ok::<PathBuf, std::io::Error>(if target.is_absolute() {
                target
            } else {
                path.parent().unwrap_or_else(|| Path::new(".")).join(target)
            })
        })?
    } else {
        path.to_path_buf()
    };
    let parent = destination
        .parent()
        .ok_or_else(|| anyhow::anyhow!("path has no parent: {}", destination.display()))?;
    fs::create_dir_all(parent)?;
    let file_name = destination
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("hook");
    let temp = parent.join(format!(
        ".{file_name}.sandpit-{}-{}.tmp",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let write_result = options
        .open(&temp)
        .and_then(|mut file| file.write_all(contents.as_ref()));
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    if let Ok(metadata) = fs::metadata(&destination) {
        if let Err(error) = fs::set_permissions(&temp, metadata.permissions()) {
            let _ = fs::remove_file(&temp);
            return Err(error.into());
        }
    }
    if let Err(error) = fs::rename(&temp, &destination) {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    Ok(())
}

pub fn rules_from(cfg: Option<&config::Config>) -> String {
    match cfg {
        Some(cfg) => format!(
            "{}\n\nDeterministic policy is also mandatory:\n- blocked network domains: {}\n- allowed network domains: {}\n- blocked commands: {}\n- blocked reads: {}\n- blocked writes: {}\n- allowed write roots: {}",
            cfg.adversary_rules(),
            cfg.network.block.join(", "),
            cfg.network.allow.join(", "),
            cfg.exec.block.join(", "),
            cfg.files.block_read.join(", "),
            cfg.files.block_write.join(", "),
            cfg.files.allow_write.join(", "),
        ),
        None => config::DEFAULT_ADVERSARY_RULES.to_string(),
    }
}

/// Load the active config (file or built-in default), or None if a config file
/// exists but failed to parse.
fn load_config() -> Option<config::Config> {
    if let Some(config) = ACTIVE_CONFIG.get() {
        return Some(config.clone());
    }
    match config::find_config(None) {
        Some(path) => config::Config::load(&path).ok(),
        None => Some(config::Config::builtin_default()),
    }
}

// ── Agent registry ───────────────────────────────────────────────────

struct AgentInfo {
    name: &'static str,
    description: &'static str,
    installed_files: Vec<PathBuf>,
}

fn agent_info(name: &str) -> Option<AgentInfo> {
    match name {
        "pi" => Some(AgentInfo {
            name: "pi",
            description: "LLM reviews every bash tool call",
            installed_files: vec![
                home().join(".pi/agent/extensions/adversary.ts"),
                home().join(".pi/agent/adversary.md"),
            ],
        }),
        "goose" => Some(AgentInfo {
            name: "goose",
            description: "LLM reviews shell + automation tool calls",
            installed_files: vec![home().join(".config/goose/adversary.md")],
        }),
        "claude" => Some(AgentInfo {
            name: "claude",
            description: "LLM reviews bash commands with session context",
            installed_files: vec![home().join(".claude/settings.json")],
        }),
        "amp" => Some(AgentInfo {
            name: "amp",
            description: "LLM reviews bash commands via delegate permission",
            installed_files: vec![
                sandpit_dir().join("amp-review.sh"),
                sandpit_dir().join("amp-review-settings.json"),
                home().join(".config/amp/settings.json"),
            ],
        }),
        _ => None,
    }
}

pub const SUPPORTED_AGENTS: &[&str] = &["pi", "goose", "claude", "amp"];
pub const HOOKLESS_AGENTS: &[&str] = &["codex"];

pub fn is_installed(name: &str) -> bool {
    match name {
        "pi" => home().join(".pi/agent/extensions/adversary.ts").exists(),
        "goose" => goose_config_dir().join("adversary.md").exists(),
        "claude" => claude_hook_installed(),
        "amp" => amp_hook_installed(),
        _ => false,
    }
}

// ── List ─────────────────────────────────────────────────────────────

pub fn list_agents() {
    tracing::info!("Supported agents:\n");
    for name in SUPPORTED_AGENTS {
        let info = agent_info(name).unwrap();
        let status = if is_installed(name) {
            "✅ installed"
        } else {
            "  not installed"
        };
        tracing::info!("  {:<10} {}  — {}", info.name, status, info.description);
        for f in &info.installed_files {
            tracing::info!("  {:<10}   → {}", "", f.display());
        }
        tracing::info!("");
    }
    tracing::info!("No hook support:");
    tracing::info!("  codex      deterministic layers only (no hook API)");
    tracing::info!("");
    tracing::info!("Rules come from [adversary] in sandpit.toml.");
    tracing::info!("Install:   sandpit install <agent>");
    tracing::info!("Uninstall: sandpit uninstall <agent>");
}

// ── Install ──────────────────────────────────────────────────────────

pub fn install(agent: &str) -> Result<()> {
    let _lock = acquire_install_lock()?;
    let cfg = load_config();
    install_with_config(agent, cfg.as_ref())
}

/// Idempotently refresh hook artifacts using the already-resolved config for
/// a `sandpit run`, including an explicit `--config` path.
pub fn refresh_for_run(agent: &str, cfg: &config::Config) -> Result<()> {
    let _lock = acquire_install_lock()?;
    refresh_for_run_unlocked(agent, cfg)
}

/// A nested Sandpit already runs beneath an outer policy that protects the
/// global install lock. Its trusted session boundary may refresh any missing
/// scaffold directly; writes remain atomic.
pub fn refresh_for_nested_run(agent: &str, cfg: &config::Config) -> Result<()> {
    refresh_for_run_unlocked(agent, cfg)
}

pub fn amp_scaffold_installed() -> bool {
    sandpit_dir().join("amp-review.sh").is_file()
        && sandpit_dir().join("amp-review-settings.json").is_file()
}

fn refresh_for_run_unlocked(agent: &str, cfg: &config::Config) -> Result<()> {
    match agent {
        "pi" => install_pi_scaffold(),
        "claude" => install_claude(Some(cfg), false),
        "amp" => install_amp(Some(cfg), false),
        // Goose receives its policy through its isolated GOOSE_PATH_ROOT and
        // has no separate hook code that needs refreshing.
        "goose" => Ok(()),
        "codex" | "cursor" | "opencode" | "gemini" => Ok(()),
        _ => bail!("Unknown agent: {agent}. Run `sandpit install --list` to see supported agents."),
    }
}

fn install_with_config(agent: &str, cfg: Option<&config::Config>) -> Result<()> {
    match agent {
        "pi" => install_pi(cfg),
        "claude" => install_claude(cfg, true),
        "amp" => install_amp(cfg, true),
        "goose" => install_goose(cfg),
        "codex" => {
            tracing::info!(
                "⚠️  Codex has no pre-execution hooks — sandpit's deterministic layers are the only defense."
            );
            tracing::info!("   Just run: sandpit run -- codex");
            Ok(())
        }
        _ => bail!("Unknown agent: {agent}. Run `sandpit install --list` to see supported agents."),
    }
}

// ── Uninstall ────────────────────────────────────────────────────────

pub fn uninstall(agent: &str) -> Result<()> {
    let _lock = acquire_install_lock()?;
    match agent {
        "pi" => uninstall_pi(),
        "claude" => uninstall_claude(),
        "amp" => uninstall_amp(),
        "goose" => uninstall_goose(),
        _ => bail!("Unknown agent: {agent}"),
    }
}

// ── pi ───────────────────────────────────────────────────────────────

fn install_pi(cfg: Option<&config::Config>) -> Result<()> {
    install_pi_scaffold()?;

    // Explicit installs own the persistent policy used by direct Pi launches.
    let rules_dir = home().join(".pi/agent");
    fs::create_dir_all(&rules_dir)?;
    let rules_path = rules_dir.join("adversary.md");
    write_atomic(&rules_path, rules_from(cfg))?;

    tracing::info!(
        "   → {} (rules from [adversary] in config)",
        rules_path.display()
    );
    tracing::info!("   Usage: sandpit run -- pi");
    Ok(())
}

fn install_pi_scaffold() -> Result<()> {
    let ext_dir = home().join(".pi/agent/extensions");
    fs::create_dir_all(&ext_dir)?;

    let dest = ext_dir.join("adversary.ts");
    write_atomic(&dest, include_str!("../agents/pi/adversary.ts"))?;

    tracing::info!("✅ pi adversary extension installed");
    tracing::info!("   → {}", dest.display());
    Ok(())
}

fn uninstall_pi() -> Result<()> {
    let dest = home().join(".pi/agent/extensions/adversary.ts");
    let rules = home().join(".pi/agent/adversary.md");
    if dest.exists() {
        fs::remove_file(&dest)?;
    }
    if rules.exists() {
        fs::remove_file(&rules)?;
    }
    if !dest.exists() {
        tracing::info!("✅ pi adversary extension removed");
    } else {
        tracing::info!("ℹ️  pi adversary extension not installed");
    }
    Ok(())
}

// ── Goose ────────────────────────────────────────────────────────────

fn goose_config_dir() -> PathBuf {
    if let Some(path) = absolute_env_path("XDG_CONFIG_HOME") {
        return path.join("goose");
    }
    home().join(".config/goose")
}

pub fn goose_config_source(existing_root: Option<&Path>) -> PathBuf {
    existing_root
        .map(|path| path.join("config"))
        .unwrap_or_else(goose_config_dir)
}

fn goose_data_dir() -> PathBuf {
    if let Some(path) = absolute_env_path("XDG_DATA_HOME") {
        return path.join("goose");
    }
    #[cfg(target_os = "macos")]
    {
        home().join("Library/Application Support/Block/goose")
    }
    #[cfg(not(target_os = "macos"))]
    {
        home().join(".local/share/goose")
    }
}

fn goose_state_dir() -> PathBuf {
    if let Some(path) = absolute_env_path("XDG_STATE_HOME") {
        return path.join("goose");
    }
    #[cfg(target_os = "macos")]
    {
        goose_data_dir()
    }
    #[cfg(not(target_os = "macos"))]
    {
        home().join(".local/state/goose")
    }
}

fn absolute_env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

#[cfg(unix)]
fn symlink_dir(target: &Path, link: &Path) -> Result<()> {
    fs::create_dir_all(target)?;
    std::os::unix::fs::symlink(target, link)?;
    Ok(())
}

/// Build an isolated Goose path root for one run. Goose caches adversary.md at
/// startup, so giving each process its own config directory binds the policy
/// without changing the user's data, state, or shared agent plugins.
pub fn prepare_goose_session(
    rules: Option<&str>,
    root: &Path,
    snapshot: &Path,
    protected_rules_path: &Path,
    existing_root: Option<&Path>,
) -> Result<()> {
    let _lock = acquire_install_lock()?;
    let config_dir = root.join("config");
    fs::create_dir_all(&config_dir)?;

    let global_config = std::path::absolute(goose_config_source(existing_root))?;
    let initial_entries = snapshot_overlay_entries(&global_config, &["adversary.md"])?;
    if let Ok(entries) = fs::read_dir(&global_config) {
        for entry in entries.flatten() {
            if entry.file_name() == "adversary.md" {
                continue;
            }
            #[cfg(unix)]
            std::os::unix::fs::symlink(entry.path(), config_dir.join(entry.file_name()))?;
        }
    }
    write_atomic(
        snapshot,
        serde_json::to_string(&GooseSnapshot {
            source: global_config,
            entries: initial_entries,
        })?,
    )?;
    if let Some(rules) = rules {
        write_atomic(protected_rules_path, rules)?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            protected_rules_path,
            config_dir.join("adversary.md"),
        )?;
    }

    #[cfg(unix)]
    {
        let data = existing_root
            .map(|path| path.join("data"))
            .unwrap_or_else(goose_data_dir);
        let state = existing_root
            .map(|path| path.join("state"))
            .unwrap_or_else(goose_state_dir);
        let agents = existing_root
            .map(|path| path.join(".agents"))
            .unwrap_or_else(|| home().join(".agents"));
        symlink_dir(&data, &root.join("data"))?;
        symlink_dir(&state, &root.join("state"))?;
        symlink_dir(&agents, &root.join(".agents"))?;
    }

    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct OverlaySnapshot {
    stamp: FileStamp,
    target: Option<FileStamp>,
    children: Option<BTreeMap<String, OverlaySnapshot>>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct GooseSnapshot {
    source: PathBuf,
    entries: BTreeMap<String, OverlaySnapshot>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ClaudeStateSnapshot {
    source: PathBuf,
    entry: Option<OverlaySnapshot>,
}

type FileStamp = (u64, u64, u32, u64, i64, i64, i64, i64);

fn file_stamp(metadata: &fs::Metadata) -> FileStamp {
    (
        metadata.dev(),
        metadata.ino(),
        metadata.mode(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec(),
    )
}

fn snapshot_overlay_entry(path: &Path) -> Result<Option<OverlaySnapshot>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let children = if metadata.is_dir() {
        Some(snapshot_overlay_entries(path, &[])?)
    } else {
        None
    };
    let target = if metadata.is_symlink() {
        match fs::metadata(path) {
            Ok(metadata) => Some(file_stamp(&metadata)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        }
    } else {
        None
    };
    Ok(Some(OverlaySnapshot {
        stamp: file_stamp(&metadata),
        target,
        children,
    }))
}

fn snapshot_overlay_entries(
    source: &Path,
    excluded: &[&str],
) -> Result<BTreeMap<String, OverlaySnapshot>> {
    let mut snapshots = BTreeMap::new();
    let entries = match fs::read_dir(source) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(snapshots),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            bail!(
                "cannot snapshot non-UTF-8 overlay name: {}",
                entry.path().display()
            );
        };
        if excluded.contains(&name) {
            continue;
        }
        if let Some(snapshot) = snapshot_overlay_entry(&entry.path())? {
            snapshots.insert(name.to_string(), snapshot);
        }
    }
    Ok(snapshots)
}

fn overlay_source_unchanged(path: &Path, base: Option<&OverlaySnapshot>) -> Result<bool> {
    let unchanged = snapshot_overlay_entry(path)?.as_ref() == base;
    if !unchanged {
        tracing::warn!(path = %path.display(), "preserving concurrent agent state; skipping conflicting session change");
    }
    Ok(unchanged)
}

fn sync_overlay(
    source: &Path,
    overlay: &Path,
    excluded: &[&str],
    initial_entries: &BTreeMap<String, OverlaySnapshot>,
    cfg: &config::Config,
) -> Result<()> {
    let entries = match fs::read_dir(overlay) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    sync_initial_overlay_entries(source, overlay, excluded, initial_entries, cfg)?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if excluded.contains(&name) {
            continue;
        }
        let file_type = entry.file_type()?;
        // Unchanged entries still point at persistent state and need no sync.
        if file_type.is_symlink() {
            continue;
        }
        let destination = source.join(name);
        if !cfg.allows_write_to(&destination) {
            continue;
        }
        if file_type.is_dir() {
            if fs::symlink_metadata(&destination).is_ok_and(|metadata| !metadata.is_dir()) {
                tracing::warn!(path = %destination.display(), "skipping overlay directory over non-directory state");
                continue;
            }
            if !destination.exists() && initial_entries.contains_key(name) {
                tracing::warn!(path = %destination.display(), "preserving concurrently deleted agent directory");
                continue;
            }
            fs::create_dir_all(&destination)?;
            let empty = BTreeMap::new();
            let base = initial_entries
                .get(name)
                .and_then(|entry| entry.children.as_ref());
            sync_overlay(
                &destination,
                &entry.path(),
                &[],
                base.unwrap_or(&empty),
                cfg,
            )?;
        } else if file_type.is_file() {
            let contents = read_regular_file_nofollow(&entry.path())?;
            if overlay_source_unchanged(&destination, initial_entries.get(name))? {
                write_atomic(&destination, contents)?;
            }
        }
    }
    Ok(())
}

fn read_regular_file_nofollow(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    let mut file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "overlay entry is not a regular file",
        ));
    }
    let mut contents = Vec::new();
    file.read_to_end(&mut contents)?;
    Ok(contents)
}

pub fn sync_goose_session(root: &Path, snapshot: &Path, cfg: &config::Config) -> Result<()> {
    let _lock = acquire_install_lock()?;
    let snapshot: GooseSnapshot = serde_json::from_str(&fs::read_to_string(snapshot)?)?;
    if !snapshot.source.is_absolute() {
        bail!("Goose snapshot source must be absolute");
    }
    sync_overlay(
        &snapshot.source,
        &root.join("config"),
        &["adversary.md"],
        &snapshot.entries,
        cfg,
    )
}

fn install_goose(cfg: Option<&config::Config>) -> Result<()> {
    let config_dir = goose_config_dir();
    fs::create_dir_all(&config_dir)?;

    let rules_path = config_dir.join("adversary.md");
    write_atomic(&rules_path, rules_from(cfg))?;

    tracing::info!("✅ Goose adversary inspector enabled");
    tracing::info!(
        "   → {} (rules from [adversary] in config)",
        rules_path.display()
    );
    tracing::info!("   Goose's built-in AdversaryInspector reads this file.");
    tracing::info!("   Delete it to disable.");
    Ok(())
}

fn sync_initial_overlay_entries(
    source: &Path,
    overlay: &Path,
    excluded: &[&str],
    initial_entries: &BTreeMap<String, OverlaySnapshot>,
    cfg: &config::Config,
) -> Result<()> {
    let mut renamed_entries = Vec::new();
    if let Ok(entries) = fs::read_dir(overlay) {
        for entry in entries.flatten() {
            if !entry
                .file_type()
                .map(|kind| kind.is_symlink())
                .unwrap_or(false)
            {
                continue;
            }
            let destination_name = entry.file_name().to_string_lossy().to_string();
            let Ok(target) = fs::read_link(entry.path()) else {
                continue;
            };
            let target = if target.is_absolute() {
                target
            } else {
                entry.path().parent().unwrap_or(overlay).join(target)
            };
            for (original_name, snapshot) in initial_entries {
                if !is_plain_file_name(original_name) {
                    continue;
                }
                if destination_name == *original_name
                    || fs::symlink_metadata(overlay.join(original_name)).is_ok()
                {
                    continue;
                }
                let original = source.join(original_name);
                let destination = source.join(&destination_name);
                let same_target = target == original
                    || match (fs::canonicalize(&target), fs::canonicalize(&original)) {
                        (Ok(target), Ok(original)) => target == original,
                        _ => false,
                    };
                if same_target {
                    renamed_entries.push(original_name);
                    if !excluded.contains(&destination_name.as_str())
                        && tree_allows_write(&original, cfg)
                        && tree_allows_write(&destination, cfg)
                        && overlay_source_unchanged(&original, Some(snapshot))?
                        && overlay_source_unchanged(
                            &destination,
                            initial_entries.get(&destination_name),
                        )?
                    {
                        fs::rename(original, destination)?;
                    }
                    break;
                }
            }
        }
    }
    for (name, snapshot) in initial_entries {
        if renamed_entries.contains(&name) {
            continue;
        }
        if !is_plain_file_name(name) {
            continue;
        }
        if fs::symlink_metadata(overlay.join(name)).is_ok() {
            continue;
        }
        let source_entry = source.join(name);
        if !tree_allows_write(&source_entry, cfg) {
            continue;
        }
        if !overlay_source_unchanged(&source_entry, Some(snapshot))? {
            continue;
        }
        if fs::symlink_metadata(&source_entry).is_ok_and(|metadata| metadata.is_dir()) {
            fs::remove_dir_all(source_entry)?;
        } else if source_entry.exists() || source_entry.is_symlink() {
            fs::remove_file(source_entry)?;
        }
    }
    Ok(())
}

fn is_plain_file_name(name: &str) -> bool {
    let mut components = Path::new(name).components();
    matches!(components.next(), Some(std::path::Component::Normal(_)))
        && components.next().is_none()
}

fn tree_allows_write(path: &Path, cfg: &config::Config) -> bool {
    if !cfg.allows_write_to(path) {
        return false;
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => return error.kind() == std::io::ErrorKind::NotFound,
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return true;
    }
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return false,
    };
    for entry in entries {
        let Ok(entry) = entry else {
            return false;
        };
        if !tree_allows_write(&entry.path(), cfg) {
            return false;
        }
    }
    true
}

fn uninstall_goose() -> Result<()> {
    let rules_path = goose_config_dir().join("adversary.md");
    if rules_path.exists() {
        fs::remove_file(&rules_path)?;
        tracing::info!("✅ Goose adversary inspector disabled (adversary.md removed)");
    } else {
        tracing::info!("ℹ️  Goose adversary.md not found — already disabled");
    }
    Ok(())
}

// ── Claude Code ──────────────────────────────────────────────────────

/// Render the corporate allowlist section that gets appended to the LLM
/// reviewer prompt. Returns an empty string if both lists are empty so
/// the prompt stays clean for users who haven't configured anything.
fn build_corporate_allow_block(
    corporate_domains: &[String],
    pre_approved_cmds: &[String],
) -> String {
    if corporate_domains.is_empty() && pre_approved_cmds.is_empty() {
        return String::new();
    }
    let mut s = String::from(
        "\nCORPORATE ALLOWLIST — these are sanctioned internal destinations and tools. \
         A tool call targeting any of these is part of normal corporate workflow, \
         NEVER data exfiltration. ALLOW them unless they clearly violate another rule.\n",
    );
    if !corporate_domains.is_empty() {
        s.push_str("\nSanctioned destinations (domain globs and org-scoped paths — interpret naturally):\n");
        for d in corporate_domains {
            s.push_str(&format!("  - {d}\n"));
        }
    }
    if !pre_approved_cmds.is_empty() {
        s.push_str("\nSanctioned command prefixes (always ALLOW):\n");
        for c in pre_approved_cmds {
            s.push_str(&format!("  - {c}\n"));
        }
    }
    s
}

fn build_claude_prompt(cfg: Option<&config::Config>) -> String {
    let rules = cfg
        .map(|c| c.adversary_rules().to_string())
        .unwrap_or_else(|| config::DEFAULT_ADVERSARY_RULES.to_string());

    let corporate_block = cfg
        .map(|c| build_corporate_allow_block(&c.network.corporate_allow, &c.exec.allow))
        .unwrap_or_default();

    format!(
        "You are a security reviewer. An AI coding agent is about to execute a tool call. \
         Decide if it is safe given these rules:\n\n{rules}\n{corporate_block}\n\
         If the tool call violates a rule, return 'deny' with a brief reason. \
         Otherwise return 'allow'."
    )
}

fn claude_prompt_hook(prompt: String) -> serde_json::Value {
    serde_json::json!({
        "type": "prompt",
        "prompt": prompt,
        "timeout": 10
    })
}

fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn read_json_setting(value: &str) -> serde_json::Value {
    serde_json::from_str(value)
        .ok()
        .or_else(|| {
            fs::read_to_string(value)
                .ok()
                .and_then(|content| serde_json::from_str(&content).ok())
        })
        .unwrap_or_else(|| serde_json::json!({}))
}

fn merge_settings(base: &mut serde_json::Value, overlay: serde_json::Value) {
    match (base, overlay) {
        (serde_json::Value::Object(base), serde_json::Value::Object(overlay)) => {
            for (key, value) in overlay {
                if let Some(existing) = base.get_mut(&key) {
                    merge_settings(existing, value);
                } else {
                    base.insert(key, value);
                }
            }
        }
        (serde_json::Value::Array(base), serde_json::Value::Array(mut overlay)) => {
            base.append(&mut overlay);
        }
        (base, overlay) => *base = overlay,
    }
}

/// Write a Claude settings layer containing this run's immutable adversary
/// policy. `sandpit run` passes it via `--settings`, keeping concurrent
/// sessions independent even while the persistent global hook is refreshed.
pub fn write_claude_session_settings(
    cfg: Option<&config::Config>,
    existing: Option<&str>,
    include_user_settings: bool,
    path: &Path,
) -> Result<()> {
    let mut settings = if include_user_settings {
        // Replace the user settings scope with a filtered copy via
        // `--settings`. This removes Sandpit's persistent hook while retaining
        // unrelated user hooks and settings.
        let settings_path = home().join(".claude/settings.json");
        fs::read_to_string(&settings_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if let Some(existing) = existing {
        merge_settings(&mut settings, read_json_setting(existing));
    }

    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    let hooks = settings
        .as_object_mut()
        .expect("settings was normalized to an object")
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    if !hooks.is_object() {
        *hooks = serde_json::json!({});
    }
    let pre_tool_use = hooks
        .as_object_mut()
        .expect("hooks was normalized to an object")
        .entry("PreToolUse")
        .or_insert_with(|| serde_json::json!([]));
    if !pre_tool_use.is_array() {
        *pre_tool_use = serde_json::json!([]);
    }
    let pre_tool_use = pre_tool_use
        .as_array_mut()
        .expect("PreToolUse was normalized to an array");
    pre_tool_use.retain(|hook| {
        !is_session_sandpit_hook_entry(hook) && hook.get("_sandpit_session").is_none()
    });
    if let Some(cfg) = cfg {
        pre_tool_use.push(serde_json::json!({
            "matcher": "",
            "hooks": [claude_prompt_hook(build_claude_prompt(Some(cfg)))],
            "_sandpit_session": true
        }));
        let sandpit_bin = std::env::current_exe()
            .unwrap_or_else(|_| PathBuf::from("sandpit"))
            .to_string_lossy()
            .to_string();
        pre_tool_use.push(serde_json::json!({
            "matcher": "Bash|WebFetch|WebSearch",
            "hooks": [{
                "type": "command",
                "command": format!("{} hook", shell_escape(&sandpit_bin)),
                "timeout": 10
            }],
            "_sandpit_session": true
        }));
    }

    write_atomic(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(())
}

/// Mirror Claude's user config for one run while removing only Sandpit's
/// persistent hook entries. Other user resources remain available through
/// symlinks, and the caller can keep its original `--setting-sources` value.
pub fn prepare_claude_session_without_adversary(
    source: &Path,
    root: &Path,
    snapshot: &Path,
) -> Result<()> {
    let _lock = acquire_install_lock()?;
    let source = fs::canonicalize(source).unwrap_or_else(|_| source.to_path_buf());
    let source_state = std::path::absolute(claude_state_path(&source))?;
    fs::create_dir_all(root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))?;
    }

    let initial_entries = snapshot_overlay_entries(&source, &["settings.json", ".claude.json"])?;
    if let Ok(entries) = fs::read_dir(&source) {
        for entry in entries.flatten() {
            if entry.file_name() == "settings.json" || entry.path() == source_state {
                continue;
            }
            #[cfg(unix)]
            std::os::unix::fs::symlink(entry.path(), root.join(entry.file_name()))?;
        }
    }
    write_atomic(
        &snapshot.with_extension("entries.json"),
        serde_json::to_string(&initial_entries)?,
    )?;
    write_atomic(
        &snapshot.with_extension("state.json"),
        serde_json::to_string(&ClaudeStateSnapshot {
            source: source_state.clone(),
            entry: snapshot_overlay_entry(&source_state)?,
        })?,
    )?;

    let mut settings: serde_json::Value = fs::read_to_string(source.join("settings.json"))
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    write_atomic(snapshot, serde_json::to_string_pretty(&settings)?)?;
    remove_claude_adversary_hooks(&mut settings);
    write_atomic(
        &root.join("settings.json"),
        serde_json::to_string_pretty(&settings)?,
    )?;
    let overlay_state = root.join(".claude.json");
    if source_state.exists() {
        #[cfg(unix)]
        std::os::unix::fs::symlink(source_state, overlay_state)?;
    }
    Ok(())
}

pub fn prepare_claude_session_with_adversary(
    source: &Path,
    root: &Path,
    snapshot: &Path,
    active_settings: &Path,
    existing_settings: Option<&str>,
    include_user_settings: bool,
    cfg: &config::Config,
) -> Result<()> {
    prepare_claude_session_without_adversary(source, root, snapshot)?;
    if !include_user_settings {
        write_atomic(&root.join("settings.json"), "{}\n")?;
    }
    let filtered_user_settings = root.join("settings.json");
    if let Some(existing) = existing_settings {
        let mut combined = read_json_setting(filtered_user_settings.to_string_lossy().as_ref());
        merge_settings(&mut combined, read_json_setting(existing));
        remove_claude_adversary_hooks(&mut combined);
        write_atomic(
            &filtered_user_settings,
            serde_json::to_string_pretty(&combined)?,
        )?;
    }
    write_claude_session_settings(
        Some(cfg),
        filtered_user_settings.to_str(),
        false,
        active_settings,
    )?;
    fs::remove_file(&filtered_user_settings)?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(active_settings, filtered_user_settings)?;
    Ok(())
}

pub fn sync_claude_session(
    source: &Path,
    root: &Path,
    snapshot: &Path,
    sync_settings: bool,
    cfg: &config::Config,
) -> Result<()> {
    let _lock = acquire_install_lock()?;
    let source = fs::canonicalize(source).unwrap_or_else(|_| source.to_path_buf());
    let initial_entries = serde_json::from_str(&fs::read_to_string(
        snapshot.with_extension("entries.json"),
    )?)?;
    // Initial overlay entries are symlinks into persistent config. Reconcile
    // their renames and deletions before copying newly materialized entries.
    sync_overlay(
        &source,
        root,
        &["settings.json", ".claude.json"],
        &initial_entries,
        cfg,
    )?;

    let settings_path = source.join("settings.json");
    if sync_settings {
        let mut base: serde_json::Value = serde_json::from_str(&fs::read_to_string(snapshot)?)?;
        let mut current: serde_json::Value = fs::read_to_string(&settings_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        let mut updated: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(root.join("settings.json"))?)?;
        remove_claude_adversary_hooks(&mut base);
        let persistent_hooks = remove_claude_adversary_hooks(&mut current);
        remove_claude_adversary_hooks(&mut updated);
        retain_syncable_claude_settings(&base, &mut updated);
        // The overlay is intentionally writable for normal Claude state, but hook
        // configuration remains security-sensitive. Ignore every hook edit made
        // by the child and let the three-way merge retain concurrent source hooks.
        // This controlled reconciliation intentionally runs outside block_write:
        // the real settings file is always protected from direct child writes.
        if let Some(base_hooks) = base.get("hooks").cloned() {
            updated["hooks"] = base_hooks;
        } else if let Some(updated) = updated.as_object_mut() {
            updated.remove("hooks");
        }
        if updated != base {
            let mut merged = merge_session_changes(&base, &current, &updated);
            append_claude_hooks(&mut merged, persistent_hooks);
            write_atomic(&settings_path, serde_json::to_string_pretty(&merged)?)?;
        }
    }

    let overlay_state = root.join(".claude.json");
    if overlay_state.is_file() && !overlay_state.is_symlink() {
        let base: ClaudeStateSnapshot =
            serde_json::from_str(&fs::read_to_string(snapshot.with_extension("state.json"))?)?;
        if !base.source.is_absolute() {
            bail!("Claude state snapshot source must be absolute");
        }
        if cfg.allows_write_to(&base.source) {
            let contents = read_regular_file_nofollow(&overlay_state)?;
            if overlay_source_unchanged(&base.source, base.entry.as_ref())? {
                write_atomic(&base.source, contents)?;
            }
        }
    }
    Ok(())
}

fn retain_syncable_claude_settings(base: &serde_json::Value, updated: &mut serde_json::Value) {
    const SYNCABLE: &[&str] = &[
        "theme",
        "model",
        "effortLevel",
        "language",
        "outputStyle",
        "cleanupPeriodDays",
        "spinnerTipsEnabled",
        "prefersReducedMotion",
    ];
    let Some(updated_object) = updated.as_object_mut() else {
        *updated = base.clone();
        return;
    };
    let keys: Vec<String> = updated_object.keys().cloned().collect();
    for key in keys {
        if !SYNCABLE.contains(&key.as_str()) {
            if let Some(value) = base.get(&key) {
                updated_object.insert(key, value.clone());
            } else {
                updated_object.remove(&key);
            }
        }
    }
    if let Some(base) = base.as_object() {
        for (key, value) in base {
            if !SYNCABLE.contains(&key.as_str()) && !updated_object.contains_key(key) {
                updated_object.insert(key.clone(), value.clone());
            }
        }
    }
}

fn claude_state_path(source: &Path) -> PathBuf {
    let default_root = home().join(".claude");
    let is_default = source == default_root
        || match (
            fs::canonicalize(source),
            fs::canonicalize(&default_root),
        ) {
            (Ok(source), Ok(default_root)) => source == default_root,
            _ => false,
        };
    if is_default {
        default_root.with_extension("json")
    } else {
        source.join(".claude.json")
    }
}

fn remove_claude_adversary_hooks(settings: &mut serde_json::Value) -> Vec<serde_json::Value> {
    let mut removed = Vec::new();
    if let Some(pre_tool_use) = settings
        .pointer_mut("/hooks/PreToolUse")
        .and_then(|value| value.as_array_mut())
    {
        pre_tool_use.retain(|hook| {
            if is_session_sandpit_hook_entry(hook) {
                removed.push(hook.clone());
                false
            } else {
                true
            }
        });
    }
    removed
}

fn append_claude_hooks(settings: &mut serde_json::Value, hooks: Vec<serde_json::Value>) {
    if hooks.is_empty() {
        return;
    }
    if !settings.is_object() {
        *settings = serde_json::json!({});
    }
    let object = settings.as_object_mut().unwrap();
    if !object.get("hooks").is_some_and(|hooks| hooks.is_object()) {
        object.insert("hooks".into(), serde_json::json!({}));
    }
    let hooks_object = object.get_mut("hooks").unwrap().as_object_mut().unwrap();
    if !hooks_object
        .get("PreToolUse")
        .is_some_and(|pre_tool_use| pre_tool_use.is_array())
    {
        hooks_object.insert("PreToolUse".into(), serde_json::json!([]));
    }
    hooks_object
        .get_mut("PreToolUse")
        .unwrap()
        .as_array_mut()
        .unwrap()
        .extend(hooks);
}

/// Write an Amp settings copy for a run that explicitly disables adversary
/// review, without removing the persistent global delegate used by other runs.
pub fn write_amp_session_settings_without_adversary(
    source: Option<&Path>,
    path: &Path,
) -> Result<()> {
    let mut settings = read_amp_settings(source);
    if let Some(permissions) = settings
        .get_mut("amp.permissions")
        .and_then(|value| value.as_array_mut())
    {
        permissions.retain(|permission| permission.get("_sandpit").is_none());
    }
    write_atomic(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(())
}

pub fn amp_settings_source(source: Option<&Path>) -> Result<PathBuf> {
    Ok(std::path::absolute(amp_settings_path(source))?)
}

pub fn snapshot_amp_settings(source: Option<&Path>, snapshot: &Path) -> Result<()> {
    write_atomic(
        snapshot,
        serde_json::to_string_pretty(&read_amp_settings(source))?,
    )
}

fn merge_session_changes(
    base: &serde_json::Value,
    current: &serde_json::Value,
    updated: &serde_json::Value,
) -> serde_json::Value {
    if updated == base {
        return current.clone();
    }
    if current == base {
        return updated.clone();
    }
    match (base, current, updated) {
        (
            serde_json::Value::Object(base),
            serde_json::Value::Object(current),
            serde_json::Value::Object(updated),
        ) => {
            let mut merged = current.clone();
            for key in base.keys().chain(updated.keys()) {
                match (base.get(key), current.get(key), updated.get(key)) {
                    (Some(base), Some(current), Some(updated)) => {
                        merged.insert(
                            key.clone(),
                            merge_session_changes(base, current, updated),
                        );
                    }
                    (Some(base), Some(current), None) if base == current => {
                        merged.remove(key);
                    }
                    (None, None, Some(updated)) => {
                        merged.insert(key.clone(), updated.clone());
                    }
                    _ => {}
                }
            }
            serde_json::Value::Object(merged)
        }
        _ => current.clone(),
    }
}

pub fn sync_amp_session(
    source: &Path,
    snapshot: &Path,
    overlay: &Path,
    policy_allows_sync: bool,
) -> Result<()> {
    if !policy_allows_sync {
        return Ok(());
    }
    // The persistent file is blocked from direct child writes. Reconcile the
    // session copy here, after stripping and restoring Sandpit permissions.
    let _lock = acquire_install_lock()?;
    let mut base: serde_json::Value = serde_json::from_str(&fs::read_to_string(snapshot)?)?;
    let mut current = read_amp_settings(Some(source));
    let current_sandpit: Vec<serde_json::Value> = current
        .get("amp.permissions")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter(|permission| permission.get("_sandpit").is_some())
        .cloned()
        .collect();
    let mut updated: serde_json::Value = serde_json::from_str(&fs::read_to_string(overlay)?)?;
    remove_amp_adversary_permissions(&mut base);
    remove_amp_adversary_permissions(&mut current);
    remove_amp_adversary_permissions(&mut updated);
    if updated == base {
        return Ok(());
    }

    let mut merged = merge_session_changes(&base, &current, &updated);
    if !current_sandpit.is_empty() {
        let mut permissions = merged
            .get("amp.permissions")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        for permission in current_sandpit.into_iter().rev() {
            permissions.insert(0, permission);
        }
        merged["amp.permissions"] = serde_json::Value::Array(permissions);
    }
    write_atomic(source, serde_json::to_string_pretty(&merged)?)
}

fn remove_amp_adversary_permissions(settings: &mut serde_json::Value) {
    let mut empty = false;
    if let Some(permissions) = settings
        .get_mut("amp.permissions")
        .and_then(|value| value.as_array_mut())
    {
        permissions.retain(|permission| permission.get("_sandpit").is_none());
        empty = permissions.is_empty();
    }
    if empty {
        if let Some(settings) = settings.as_object_mut() {
            settings.remove("amp.permissions");
        }
    }
}

/// Write an Amp settings copy containing the session's delegate permission.
/// This keeps review enabled when Amp was launched with a custom settings file.
pub fn write_amp_session_settings_with_adversary(
    source: Option<&Path>,
    path: &Path,
) -> Result<()> {
    let mut settings = read_amp_settings(source);
    let mut permissions = settings
        .get("amp.permissions")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    permissions.retain(|permission| permission.get("_sandpit").is_none());
    permissions.insert(
        0,
        serde_json::json!({
            "tool": "Bash",
            "action": "delegate",
            "to": sandpit_dir().join("amp-review.sh").to_string_lossy(),
            "_sandpit": true
        }),
    );
    settings["amp.permissions"] = serde_json::Value::Array(permissions);
    write_atomic(path, serde_json::to_string_pretty(&settings)?)?;
    Ok(())
}

fn read_amp_settings(source: Option<&Path>) -> serde_json::Value {
    fs::read_to_string(amp_settings_path(source))
        .ok()
        .and_then(|content| parse_jsonc(&content))
        .unwrap_or_else(|| serde_json::json!({}))
}

fn amp_settings_path(source: Option<&Path>) -> PathBuf {
    source
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("AMP_SETTINGS_FILE").map(PathBuf::from))
        .unwrap_or_else(|| {
            let json = home().join(".config/amp/settings.json");
            let jsonc = home().join(".config/amp/settings.jsonc");
            if json.exists() || !jsonc.exists() {
                json
            } else {
                jsonc
            }
        })
}

fn parse_jsonc(content: &str) -> Option<serde_json::Value> {
    if let Ok(value) = serde_json::from_str(content.trim_start_matches('\u{feff}')) {
        return Some(value);
    }

    let mut without_comments = String::with_capacity(content.len());
    let mut chars = content.trim_start_matches('\u{feff}').chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(ch) = chars.next() {
        if in_string {
            without_comments.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        if ch == '"' {
            in_string = true;
            without_comments.push(ch);
        } else if ch == '/' && chars.peek() == Some(&'/') {
            chars.next();
            for comment in chars.by_ref() {
                if comment == '\n' {
                    without_comments.push('\n');
                    break;
                }
            }
        } else if ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            let mut previous = '\0';
            for comment in chars.by_ref() {
                if comment == '\n' {
                    without_comments.push('\n');
                }
                if previous == '*' && comment == '/' {
                    break;
                }
                previous = comment;
            }
        } else {
            without_comments.push(ch);
        }
    }

    let chars: Vec<char> = without_comments.chars().collect();
    let mut without_trailing_commas = String::with_capacity(without_comments.len());
    let mut in_string = false;
    let mut escaped = false;
    for (index, ch) in chars.iter().copied().enumerate() {
        if in_string {
            without_trailing_commas.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        if ch == '"' {
            in_string = true;
        }
        if ch == ','
            && matches!(
                chars[index + 1..]
                .iter()
                .find(|next| !next.is_whitespace())
                .copied(),
                Some('}' | ']')
            )
        {
            continue;
        }
        without_trailing_commas.push(ch);
    }
    serde_json::from_str(&without_trailing_commas).ok()
}

fn install_claude(cfg: Option<&config::Config>, include_prompt: bool) -> Result<()> {
    let prompt = build_claude_prompt(cfg);
    let persistent_config = sandpit_dir().join("claude-config.toml");
    if include_prompt {
        let serialized = if let Some(config) = cfg {
            toml::to_string_pretty(config)?
        } else {
            toml::to_string_pretty(&config::Config::builtin_default())?
        };
        write_atomic(&persistent_config, serialized)?;
    }

    let settings_path = home().join(".claude/settings.json");
    fs::create_dir_all(settings_path.parent().unwrap())?;

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if settings.get("hooks").is_none() {
        settings["hooks"] = serde_json::json!({});
    }
    // Find the sandpit binary for the hook subcommand
    let sandpit_bin =
        std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("sandpit"));

    // `sandpit install claude` is an explicit request for a persistent prompt.
    // A later auto-refresh must update its command handler without deleting
    // that manually installed review layer.
    let preserved_prompt = if include_prompt {
        None
    } else {
        settings["hooks"]["PreToolUse"]
            .as_array()
            .and_then(|entries| {
                entries
                    .iter()
                    .filter(|entry| is_sandpit_hook_entry(entry))
                    .filter_map(|entry| entry.get("hooks").and_then(|hooks| hooks.as_array()))
                    .flatten()
                    .find(|handler| {
                        handler.get("type").and_then(|kind| kind.as_str()) == Some("prompt")
                    })
                    .cloned()
            })
    };

    let sandpit_command = if persistent_config.exists() {
        format!(
            "if [ -z \"${{SANDPIT_CONFIG+x}}\" ]; then export SANDPIT_CONFIG={}; fi; {} hook",
            shell_escape(persistent_config.to_string_lossy().as_ref()),
            shell_escape(sandpit_bin.to_string_lossy().as_ref())
        )
    } else {
        format!("{} hook", shell_escape(sandpit_bin.to_string_lossy().as_ref()))
    };
    let mut handlers = vec![serde_json::json!({
        "type": "command",
        "command": sandpit_command,
        "statusMessage": "Checking sandpit rules..."
    })];
    if include_prompt {
        handlers.push(claude_prompt_hook(prompt));
    } else if let Some(prompt) = preserved_prompt {
        handlers.push(prompt);
    }

    let our_entry = serde_json::json!({
        "matcher": "",
        "hooks": handlers
    });

    let mut expected_entry = our_entry;
    expected_entry["_sandpit"] = serde_json::json!(true);
    let hook_is_current = settings["hooks"]["PreToolUse"]
        .as_array()
        .map(|entries| {
            let owned: Vec<&serde_json::Value> = entries
                .iter()
                .filter(|entry| entry.get("_sandpit") == Some(&serde_json::json!(true)))
                .collect();
            owned.len() == 1 && owned[0] == &expected_entry
        })
        .unwrap_or(false);
    if !hook_is_current {
        match settings["hooks"]["PreToolUse"].as_array_mut() {
            Some(arr) => {
                arr.retain(|entry| !is_sandpit_hook_entry(entry));
                arr.push(expected_entry);
            }
            None => {
                settings["hooks"]["PreToolUse"] = serde_json::json!([expected_entry]);
            }
        }
        write_atomic(&settings_path, serde_json::to_string_pretty(&settings)?)?;
    }

    tracing::info!("✅ Claude Code hooks installed");
    tracing::info!("   → {} (PreToolUse hooks)", settings_path.display());
    tracing::info!("   → egress logging");
    if include_prompt {
        tracing::info!("   → adversary review (inline prompt)");
    } else {
        tracing::info!("   → adversary review (per-session prompt)");
    }
    Ok(())
}

fn claude_hook_installed() -> bool {
    let settings_path = home().join(".claude/settings.json");
    if let Ok(content) = fs::read_to_string(&settings_path) {
        if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&content) {
            return settings
                .pointer("/hooks/PreToolUse")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().any(is_sandpit_hook_entry))
                .unwrap_or(false);
        }
    }
    false
}

fn uninstall_claude() -> Result<()> {
    // Clean up old script files from previous installs
    for name in &["claude-review.py", "claude-review.sh"] {
        let old = sandpit_dir().join(name);
        if old.exists() {
            let _ = fs::remove_file(&old);
        }
    }
    let persistent_config = sandpit_dir().join("claude-config.toml");
    if persistent_config.exists() {
        fs::remove_file(persistent_config)?;
    }

    let removed = sweep_claude_sandpit_hooks()?;
    if removed > 0 {
        tracing::info!("✅ Claude Code adversary hook removed ({removed} entries)");
    } else {
        tracing::info!("✅ Claude Code adversary hook removed");
    }
    Ok(())
}

/// Returns true if `entry` looks like a sandpit-installed PreToolUse hook.
/// Checked sources, in order:
///   1. The explicit `_sandpit: true` marker (current installs).
///   2. An inner `sandpit hook` command (legacy installs predating the marker).
///   3. The exact opening of the legacy reviewer prompt or status message.
fn is_sandpit_hook_entry(entry: &serde_json::Value) -> bool {
    if entry.get("_sandpit") == Some(&serde_json::json!(true)) {
        return true;
    }
    let inner = match entry.get("hooks").and_then(|h| h.as_array()) {
        Some(a) => a,
        None => return false,
    };
    inner.iter().any(|h| {
        let cmd_match = h
            .get("command")
            .and_then(|v| v.as_str())
            .map(|s| s.contains("sandpit") && s.contains("hook"))
            .unwrap_or(false);
        let prompt_match = h
            .get("prompt")
            .and_then(|v| v.as_str())
            .map(|s| {
                s.starts_with(
                    "You are a security reviewer. An AI coding agent is about to execute a tool call.",
                )
            })
            .unwrap_or(false);
        let status_match = h
            .get("statusMessage")
            .and_then(|v| v.as_str())
            .map(|s| s == "Checking sandpit rules...")
            .unwrap_or(false);
        cmd_match || prompt_match || status_match
    })
}

fn is_session_sandpit_hook_entry(entry: &serde_json::Value) -> bool {
    if entry.get("_sandpit") == Some(&serde_json::json!(true))
        || entry.get("_sandpit_session") == Some(&serde_json::json!(true))
    {
        return true;
    }
    entry
        .get("hooks")
        .and_then(|hooks| hooks.as_array())
        .into_iter()
        .flatten()
        .any(|hook| {
            let command = hook
                .get("command")
                .and_then(|value| value.as_str())
                .map(|command| command.contains("sandpit") && command.contains("hook"))
                .unwrap_or(false);
            let legacy_prompt = hook
                .get("prompt")
                .and_then(|value| value.as_str())
                .map(|prompt| {
                    prompt.starts_with(
                        "You are a security reviewer. An AI coding agent is about to execute a tool call.",
                    )
                })
                .unwrap_or(false);
            command || legacy_prompt
        })
}

/// Remove every sandpit-installed PreToolUse hook from `~/.claude/settings.json`.
/// Returns the number of entries removed. Used by both uninstall and doctor —
/// uninstall always runs, doctor only runs when no agent session is active.
fn sweep_claude_sandpit_hooks() -> Result<usize> {
    let settings_path = home().join(".claude/settings.json");
    if !settings_path.exists() {
        return Ok(0);
    }

    let content = fs::read_to_string(&settings_path)?;
    let mut settings: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return Ok(0),
    };

    let mut removed = 0usize;
    if let Some(hooks) = settings.pointer_mut("/hooks/PreToolUse") {
        if let Some(arr) = hooks.as_array_mut() {
            let before = arr.len();
            arr.retain(|h| !is_sandpit_hook_entry(h));
            removed = before.saturating_sub(arr.len());
        }
    }

    // Drop empty PreToolUse and empty hooks objects so we don't leave noise.
    let mut drop_pretool = false;
    if let Some(pre) = settings.pointer("/hooks/PreToolUse") {
        if pre.as_array().map(|a| a.is_empty()).unwrap_or(false) {
            drop_pretool = true;
        }
    }
    if drop_pretool {
        if let Some(hooks_obj) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
            hooks_obj.remove("PreToolUse");
            if hooks_obj.is_empty() {
                if let Some(root) = settings.as_object_mut() {
                    root.remove("hooks");
                }
            }
        }
    }

    if removed > 0 {
        write_atomic(&settings_path, serde_json::to_string_pretty(&settings)?)?;
    }
    Ok(removed)
}

/// Detect stale sandpit hooks without modifying anything. Used by `sandpit doctor`
/// to report state. Counts the same entries that `sweep_claude_sandpit_hooks`
/// would remove.
pub fn count_stale_claude_hooks() -> usize {
    let settings_path = home().join(".claude/settings.json");
    let content = match fs::read_to_string(&settings_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };
    let settings: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return 0,
    };
    settings
        .pointer("/hooks/PreToolUse")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter(|h| is_sandpit_hook_entry(h)).count())
        .unwrap_or(0)
}

/// Public entrypoint for `sandpit doctor` to clean stale Claude hooks.
/// Returns the number of entries removed.
pub fn clean_stale_claude_hooks() -> Result<usize> {
    sweep_claude_sandpit_hooks()
}

// ── Amp ──────────────────────────────────────────────────────────────

fn install_amp(cfg: Option<&config::Config>, install_global_policy: bool) -> Result<()> {
    let rules = rules_from(cfg);

    // Write the delegate script that amp's permission system calls
    let script_dir = sandpit_dir();
    fs::create_dir_all(&script_dir)?;
    let script_path = script_dir.join("amp-review.sh");

    // Also generate a minimal settings file for the review amp instance
    // so it has no sandpit permissions (avoids infinite recursion)
    let review_settings_path = script_dir.join("amp-review-settings.json");
    write_atomic(&review_settings_path, "{}\n")?;
    let persistent_rules_path = script_dir.join("amp-adversary.md");
    if install_global_policy {
        write_atomic(&persistent_rules_path, &rules)?;
    }

    // The review script uses python3 to assemble the prompt and pipe it to
    // amp via stdin.  This is critical for security: the command being reviewed
    // must never be interpolated into a bash string where $() or backticks
    // would be expanded — that would let the reviewed command execute before
    // the reviewer even sees it.
    let script = format!(
        r#"#!/usr/bin/env python3
"""sandpit adversary delegate for amp.

Called by amp's permission system: stdin = JSON with a 'cmd' field.
Exit 0 = allow, exit 2 = deny.
"""
import json, os, subprocess, sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(2)  # fail closed

if os.environ.get("SANDPIT_ADVERSARY_DISABLED") == "1":
    sys.exit(0)

cmd = data.get("cmd", "")
if not cmd:
    sys.exit(2)

# Strip bash comments before LLM review — comments are attacker-controlled
# text that the shell ignores but the LLM reads. An adversarial agent can
# add misleading comments to fool the reviewer.
# Only strip full-line comments (lines starting with #). Inline # is too
# risky — it appears legitimately in quoted strings like "Fix #123" and
# stripping it corrupts the command the reviewer sees.
stripped_lines = []
for line in cmd.split('\n'):
    if line.lstrip().startswith('#'):
        continue
    stripped_lines.append(line)
cmd_for_review = '\n'.join(stripped_lines) if stripped_lines else cmd

rules = os.environ.get("SANDPIT_ADVERSARY_RULES")
if rules is None:
    try:
        with open({rules_path_json}, encoding="utf-8") as rules_file:
            rules = rules_file.read()
    except Exception:
        rules = {default_rules_json}

prompt = (
    "You are a security reviewer. A coding agent wants to run this bash command:\n\n"
    + cmd_for_review
    + "\n\nRules:\n"
    + rules
    + "\n\nReply with ONLY the word ALLOW or DENY."
)

settings = os.path.expanduser("~/.sandpit/amp-review-settings.json")
try:
    result = subprocess.run(
        ["amp", "--settings-file", settings, "-m", "rush", "-x"],
        input=prompt,
        capture_output=True,
        text=True,
        timeout=15,
    )
    verdict = result.stdout.strip()
except Exception as e:
    print(f"sandpit: amp review failed ({{e}}), blocking", file=sys.stderr)
    sys.exit(2)

if verdict.upper().strip() == "ALLOW":
    sys.exit(0)
print("sandpit: blocked by adversary review", file=sys.stderr)
sys.exit(2)
"#,
        rules_path_json = serde_json::to_string(&persistent_rules_path.to_string_lossy())
            .unwrap_or_else(|_| "\"\"".into()),
        default_rules_json = serde_json::to_string(config::DEFAULT_ADVERSARY_RULES)
            .unwrap_or_else(|_| "\"\"".into()),
    );

    write_atomic(&script_path, &script)?;

    // Make executable
    #[cfg(unix)]
    {
        {
            // Double braces `{{ }}` escape literal braces inside format!()
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755))?;
        }
    }

    if !install_global_policy {
        tracing::info!("✅ Amp adversary delegate refreshed");
        return Ok(());
    }

    // Explicit installs add the persistent delegate permission used by direct
    // Amp launches. Session refresh never changes this settings file.
    let settings_path = amp_settings_path(None);
    fs::create_dir_all(settings_path.parent().unwrap())?;
    let mut settings = read_amp_settings(None);

    // Add sandpit delegate permission at the start of the list
    let sandpit_perm = serde_json::json!({
        "tool": "Bash",
        "action": "delegate",
        "to": script_path.to_string_lossy(),
        "_sandpit": true
    });

    let mut perms: Vec<serde_json::Value> = settings
        .get("amp.permissions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    // Remove any existing sandpit permissions
    perms.retain(|p| p.get("_sandpit").is_none());
    // Insert at start so it runs first
    perms.insert(0, sandpit_perm);
    settings["amp.permissions"] = serde_json::Value::Array(perms);

    write_atomic(&settings_path, serde_json::to_string_pretty(&settings)?)?;

    tracing::info!("✅ Amp adversary delegate installed");
    tracing::info!("   → {} (review script)", script_path.display());
    tracing::info!("   → {} (delegate permission)", settings_path.display());
    tracing::info!(
        "   → {} (clean settings for review instance)",
        review_settings_path.display()
    );
    tracing::info!("   Uses `amp -m rush -x` for LLM review (fast model).");
    Ok(())
}

fn amp_hook_installed() -> bool {
    let settings_path = amp_settings_path(None);
    if let Ok(content) = fs::read_to_string(&settings_path) {
        if let Some(settings) = parse_jsonc(&content) {
            return settings
                .get("amp.permissions")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().any(|p| p.get("_sandpit").is_some()))
                .unwrap_or(false);
        }
    }
    false
}

fn uninstall_amp() -> Result<()> {
    // Remove delegate script
    let script_path = sandpit_dir().join("amp-review.sh");
    if script_path.exists() {
        fs::remove_file(&script_path)?;
    }

    // Remove review settings file
    let review_settings_path = sandpit_dir().join("amp-review-settings.json");
    if review_settings_path.exists() {
        fs::remove_file(&review_settings_path)?;
    }
    let rules_path = sandpit_dir().join("amp-adversary.md");
    if rules_path.exists() {
        fs::remove_file(&rules_path)?;
    }

    // Remove sandpit permission from settings
    let settings_path = amp_settings_path(None);
    if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)?;
        if let Some(mut settings) = parse_jsonc(&content) {
            if let Some(perms) = settings
                .get_mut("amp.permissions")
                .and_then(|v| v.as_array_mut())
            {
                perms.retain(|p| p.get("_sandpit").is_none());
            }
            write_atomic(&settings_path, serde_json::to_string_pretty(&settings)?)?;
        }
    }

    tracing::info!("✅ Amp adversary delegate removed");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::Mutex;
    use tempfile::TempDir;

    // Serialize HOME mutation across tests: cargo runs tests in parallel
    // threads and env vars are process-global.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_temp_home(f: impl FnOnce()) {
        let guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let tmp = TempDir::new().unwrap();
        let prev = env::var("HOME").ok();
        let prev_amp_settings = env::var_os("AMP_SETTINGS_FILE");
        // SAFETY: ENV_LOCK serializes env mutation across our tests, and
        // the test binary does not otherwise mutate HOME concurrently.
        unsafe {
            env::set_var("HOME", tmp.path());
            env::remove_var("AMP_SETTINGS_FILE");
        }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
        unsafe {
            match prev {
                Some(v) => env::set_var("HOME", v),
                None => env::remove_var("HOME"),
            }
            match prev_amp_settings {
                Some(value) => env::set_var("AMP_SETTINGS_FILE", value),
                None => env::remove_var("AMP_SETTINGS_FILE"),
            }
        }
        drop(guard);
        if let Err(e) = result {
            std::panic::resume_unwind(e);
        }
    }

    #[test]
    fn install_then_uninstall_round_trip() {
        for agent in SUPPORTED_AGENTS {
            with_temp_home(|| {
                assert!(
                    !is_installed(agent),
                    "{agent} should not be installed initially"
                );
                install(agent).expect("install should succeed");
                assert!(
                    is_installed(agent),
                    "{agent} should be installed after install()"
                );
                uninstall(agent).expect("uninstall should succeed");
                assert!(
                    !is_installed(agent),
                    "{agent} should not be installed after uninstall()"
                );
            });
        }
    }

    #[test]
    fn uninstall_when_not_installed_is_ok() {
        for agent in SUPPORTED_AGENTS {
            with_temp_home(|| {
                uninstall(agent).expect("uninstall of non-installed agent should not error");
            });
        }
    }

    #[test]
    fn double_install_is_idempotent() {
        for agent in SUPPORTED_AGENTS {
            with_temp_home(|| {
                install(agent).unwrap();
                install(agent).unwrap();
                assert!(is_installed(agent));
                uninstall(agent).unwrap();
                assert!(!is_installed(agent));
            });
        }
    }

    /// Older sandpit installs (or hooks left from a dirty exit) may not have
    /// the `_sandpit: true` marker. Uninstall must still find them via the
    /// command path, prompt content, or status message.
    #[test]
    fn uninstall_claude_sweeps_legacy_unmarked_hooks() {
        with_temp_home(|| {
            let settings_path = home().join(".claude/settings.json");
            fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
            // Three legacy entries with no _sandpit marker — one matches via
            // command path, one via prompt content, one via statusMessage.
            // A fourth entry is a real user hook that must NOT be removed.
            let legacy = serde_json::json!({
                "hooks": {
                    "PreToolUse": [
                        {
                            "matcher": "",
                            "hooks": [{ "type": "command", "command": "/usr/local/bin/sandpit hook" }]
                        },
                        {
                            "matcher": "",
                            "hooks": [{ "type": "prompt", "prompt": "You are a security reviewer. An AI coding agent is about to execute a tool call. Decide carefully." }]
                        },
                        {
                            "matcher": "",
                            "hooks": [{ "type": "command", "command": "echo hi", "statusMessage": "Checking sandpit rules..." }]
                        },
                        {
                            "matcher": "",
                            "hooks": [{ "type": "command", "command": "/opt/userhook.sh" }]
                        }
                    ]
                }
            });
            fs::write(
                &settings_path,
                serde_json::to_string_pretty(&legacy).unwrap(),
            )
            .unwrap();

            assert_eq!(count_stale_claude_hooks(), 3);
            uninstall("claude").unwrap();

            let after: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
            let arr = after
                .pointer("/hooks/PreToolUse")
                .and_then(|v| v.as_array());
            assert_eq!(arr.map(|a| a.len()), Some(1), "should keep the user hook");
            // The remaining hook is the user one
            let cmd = arr.unwrap()[0]
                .pointer("/hooks/0/command")
                .and_then(|v| v.as_str())
                .unwrap();
            assert_eq!(cmd, "/opt/userhook.sh");
        });
    }

    /// `clean_stale_claude_hooks` is idempotent — running it twice should
    /// drop entries the first time and leave the file alone the second.
    #[test]
    fn clean_stale_claude_hooks_is_idempotent() {
        with_temp_home(|| {
            install("claude").unwrap();
            assert!(count_stale_claude_hooks() >= 1);
            let removed = clean_stale_claude_hooks().unwrap();
            assert!(removed >= 1);
            assert_eq!(count_stale_claude_hooks(), 0);
            // Second pass: nothing to remove.
            assert_eq!(clean_stale_claude_hooks().unwrap(), 0);
        });
    }

    #[test]
    fn corporate_allow_block_is_empty_when_lists_are_empty() {
        assert!(build_corporate_allow_block(&[], &[]).is_empty());
    }

    #[test]
    fn corporate_allow_block_includes_both_lists() {
        let s = build_corporate_allow_block(
            &["*.example.com".into(), "github.com/example-org".into()],
            &["example-tool inspect".into()],
        );
        assert!(s.contains("CORPORATE ALLOWLIST"));
        assert!(s.contains("*.example.com"));
        assert!(s.contains("github.com/example-org"));
        assert!(s.contains("example-tool inspect"));
    }

    #[test]
    fn claude_hook_shell_quotes_executable_paths() {
        assert_eq!(
            shell_escape("/tmp/My Build/it's/sandpit"),
            "'/tmp/My Build/it'\\''s/sandpit'"
        );
    }

    #[test]
    fn refresh_for_run_preserves_manually_installed_pi_policy() {
        with_temp_home(|| {
            let manual_cfg: config::Config = toml::from_str(
                "[adversary]\nrules = \"BLOCK manual-pi-rule\"\n",
            )
            .unwrap();
            let session_cfg: config::Config = toml::from_str(
                "[adversary]\nrules = \"BLOCK resolved-session-rule\"\n",
            )
            .unwrap();

            install_pi(Some(&manual_cfg)).unwrap();
            refresh_for_run("pi", &session_cfg).unwrap();

            let rules = fs::read_to_string(home().join(".pi/agent/adversary.md")).unwrap();
            assert_eq!(rules, rules_from(Some(&manual_cfg)));
            let extension =
                fs::read_to_string(home().join(".pi/agent/extensions/adversary.ts")).unwrap();
            assert!(extension.contains("SANDPIT_ADVERSARY_RULES"));
            assert!(extension.contains("SANDPIT_ADVERSARY_DISABLED"));
            assert!(extension.contains("sessionSentinelIsProtected"));
        });
    }

    #[test]
    fn refresh_for_run_preserves_goose_and_amp_policies() {
        with_temp_home(|| {
            let manual_cfg: config::Config = toml::from_str(
                "[adversary]\nrules = \"BLOCK manual-policy\"\n",
            )
            .unwrap();
            let session_cfg: config::Config = toml::from_str(
                "[adversary]\nrules = \"BLOCK session-policy\"\n",
            )
            .unwrap();

            install_goose(Some(&manual_cfg)).unwrap();
            install_amp(Some(&manual_cfg), true).unwrap();
            let amp_settings = fs::read_to_string(amp_settings_path(None)).unwrap();

            refresh_for_run("goose", &session_cfg).unwrap();
            refresh_for_run("amp", &session_cfg).unwrap();

            assert_eq!(
                fs::read_to_string(goose_config_dir().join("adversary.md")).unwrap(),
                rules_from(Some(&manual_cfg))
            );
            assert_eq!(
                fs::read_to_string(sandpit_dir().join("amp-adversary.md")).unwrap(),
                rules_from(Some(&manual_cfg))
            );
            assert_eq!(
                fs::read_to_string(amp_settings_path(None)).unwrap(),
                amp_settings
            );
        });
    }

    #[cfg(unix)]
    #[test]
    fn install_lock_uses_the_trusted_session_root_with_overridden_home() {
        with_temp_home(|| {
            let expected = config::session_root().join("adversary.lock");
            assert_ne!(expected, home().join(".sandpit/adversary.lock"));
            let lock = acquire_install_lock().unwrap();
            let actual = lock.file.metadata().unwrap();
            let expected = fs::metadata(expected).unwrap();
            assert_eq!(
                (actual.dev(), actual.ino()),
                (expected.dev(), expected.ino())
            );
            assert!(!home().join(".sandpit/adversary.lock").exists());
        });
    }

    #[cfg(unix)]
    #[test]
    fn install_lock_is_close_on_exec() {
        with_temp_home(|| {
            let lock = acquire_install_lock().unwrap();
            let flags = unsafe { libc::fcntl(lock.file.as_raw_fd(), libc::F_GETFD) };
            assert_ne!(flags, -1);
            assert_ne!(flags & libc::FD_CLOEXEC, 0);
        });
    }

    #[test]
    fn claude_session_settings_embed_only_active_policy() {
        with_temp_home(|| {
            let cfg: config::Config = toml::from_str(
                "[adversary]\nrules = \"BLOCK active-claude-rule\"\n",
            )
            .unwrap();
            let path = home().join("claude-session.json");
            let global_path = home().join(".claude/settings.json");
            fs::create_dir_all(global_path.parent().unwrap()).unwrap();
            fs::write(
                &global_path,
                r#"{"theme":"dark","hooks":{"PreToolUse":[{"matcher":"Read","hooks":[{"type":"command","command":"echo user-hook"}]}]}}"#,
            )
            .unwrap();
            refresh_for_run("claude", &cfg).unwrap();
            let compact = serde_json::to_string(
                &serde_json::from_str::<serde_json::Value>(
                    &fs::read_to_string(&global_path).unwrap(),
                )
                .unwrap(),
            )
            .unwrap();
            fs::write(&global_path, &compact).unwrap();
            refresh_for_run("claude", &cfg).unwrap();
            assert_eq!(fs::read_to_string(&global_path).unwrap(), compact);
            write_claude_session_settings(Some(&cfg), None, false, &path).unwrap();

            let settings = fs::read_to_string(path).unwrap();
            assert!(settings.contains("active-claude-rule"));
            assert!(settings.contains("_sandpit_session"));
            assert!(!settings.contains("\"theme\": \"dark\""));
            let global = fs::read_to_string(home().join(".claude/settings.json")).unwrap();
            assert!(!global.contains("\"type\": \"prompt\""));
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&global).unwrap()["theme"],
                "dark"
            );
            assert!(global.contains("user-hook"));
        });
    }

    #[test]
    fn claude_session_settings_merge_existing_cli_settings() {
        with_temp_home(|| {
            let cfg: config::Config = toml::from_str(
                "[adversary]\nrules = \"BLOCK active-claude-rule\"\n",
            )
            .unwrap();
            let existing = home().join("existing-claude-settings.json");
            fs::write(
                &existing,
                r#"{"model":"sonnet","hooks":{"PreToolUse":[{"matcher":"Read","hooks":[{"type":"command","command":"echo cli-hook"}]}]}}"#,
            )
            .unwrap();
            let path = home().join("claude-session.json");

            write_claude_session_settings(Some(&cfg), existing.to_str(), false, &path).unwrap();

            let settings = fs::read_to_string(path).unwrap();
            assert!(settings.contains("active-claude-rule"));
            assert!(settings.contains("cli-hook"));
            assert!(settings.contains("\"model\": \"sonnet\""));
        });
    }

    #[test]
    fn claude_state_follows_custom_config_root() {
        with_temp_home(|| {
            assert_eq!(
                claude_state_path(&home().join(".claude")),
                home().join(".claude.json")
            );
            let custom = home().join("custom-claude");
            assert_eq!(claude_state_path(&custom), custom.join(".claude.json"));
        });
    }

    #[test]
    fn claude_session_can_disable_persistent_hooks() {
        with_temp_home(|| {
            let path = home().join("claude-disabled.json");
            let global_path = home().join(".claude/settings.json");
            fs::create_dir_all(global_path.parent().unwrap()).unwrap();
            fs::write(
                &global_path,
                r#"{
                    "theme": "dark",
                    "hooks": {"PreToolUse": [
                        {"matcher": "", "hooks": [{"type": "command", "command": "sandpit hook"}], "_sandpit": true},
                        {"matcher": "Read", "hooks": [{"type": "command", "command": "echo user-hook"}]},
                        {"matcher": "Write", "hooks": [{"type": "prompt", "prompt": "Ask my security reviewer"}]},
                        {"matcher": "Bash", "hooks": [{"type": "prompt", "prompt": "You are a security reviewer. An AI coding agent is about to execute a tool call. Decide carefully."}]}
                    ]}
                }"#,
            )
            .unwrap();
            fs::write(home().join(".claude/CLAUDE.md"), "user instructions").unwrap();
            fs::create_dir_all(home().join(".claude/skills/example")).unwrap();
            fs::write(
                home().join(".claude/skills/example/SKILL.md"),
                "user skill",
            )
            .unwrap();
            fs::create_dir_all(home().join(".claude/plugins/example")).unwrap();
            fs::write(
                home().join(".claude/plugins/example/plugin.json"),
                "trusted\n",
            )
            .unwrap();
            fs::write(home().join(".claude.json"), r#"{"mcp":"global"}"#).unwrap();
            fs::write(home().join(".claude/delete-me.json"), "{}\n").unwrap();
            fs::write(home().join(".claude/rename-me.json"), "renamed\n").unwrap();

            write_claude_session_settings(None, None, true, &path).unwrap();

            let settings = fs::read_to_string(path).unwrap();
            assert!(!settings.contains("_sandpit"));
            assert!(settings.contains("user-hook"));
            assert!(settings.contains("Ask my security reviewer"));
            assert!(!settings.contains("An AI coding agent is about to execute"));
            assert!(settings.contains("\"theme\": \"dark\""));
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = fs::metadata(home().join("claude-disabled.json"))
                    .unwrap()
                    .permissions()
                    .mode();
                assert_eq!(mode & 0o777, 0o600);
            }

            let excluded = home().join("claude-user-excluded.json");
            write_claude_session_settings(None, None, false, &excluded).unwrap();
            let settings = fs::read_to_string(excluded).unwrap();
            assert!(!settings.contains("user-hook"));
            assert!(!settings.contains("Ask my security reviewer"));
            assert!(!settings.contains("\"theme\": \"dark\""));

            let cli_filtered = home().join("claude-cli-filtered.json");
            write_claude_session_settings(
                None,
                global_path.to_str(),
                false,
                &cli_filtered,
            )
            .unwrap();
            let settings = fs::read_to_string(cli_filtered).unwrap();
            assert!(!settings.contains("_sandpit"));
            assert!(settings.contains("user-hook"));
            assert!(settings.contains("Ask my security reviewer"));
            assert!(!settings.contains("An AI coding agent is about to execute"));

            let root = home().join("claude-config-overlay");
            let snapshot = home().join("claude-settings-snapshot.json");
            prepare_claude_session_without_adversary(
                &home().join(".claude"),
                &root,
                &snapshot,
            )
            .unwrap();
            let settings = fs::read_to_string(root.join("settings.json")).unwrap();
            assert!(!settings.contains("_sandpit"));
            assert!(settings.contains("user-hook"));
            assert_eq!(
                fs::read_to_string(root.join("CLAUDE.md")).unwrap(),
                "user instructions"
            );
            assert_eq!(
                fs::read_to_string(root.join("skills/example/SKILL.md")).unwrap(),
                "user skill"
            );
            assert_eq!(
                fs::read_to_string(root.join(".claude.json")).unwrap(),
                r#"{"mcp":"global"}"#
            );
            fs::remove_file(root.join("CLAUDE.md")).unwrap();
            fs::write(root.join("CLAUDE.md"), "updated instructions").unwrap();
            fs::write(root.join("new-state.json"), "{}\n").unwrap();
            fs::remove_file(root.join("delete-me.json")).unwrap();
            fs::remove_file(root.join("skills")).unwrap();
            fs::rename(
                root.join("rename-me.json"),
                root.join("renamed-state.json"),
            )
            .unwrap();
            fs::remove_file(root.join("plugins")).unwrap();
            fs::create_dir_all(root.join("plugins/example")).unwrap();
            fs::write(root.join("plugins/example/plugin.json"), "attacker\n").unwrap();
            fs::remove_file(root.join(".claude.json")).unwrap();
            fs::write(root.join(".claude.json"), r#"{"mcp":"updated"}"#).unwrap();
            let mut overlay_settings: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(root.join("settings.json")).unwrap())
                    .unwrap();
            overlay_settings["theme"] = serde_json::json!("light");
            overlay_settings["disableAllHooks"] = serde_json::json!(true);
            overlay_settings["statusLine"] =
                serde_json::json!({"type": "command", "command": "echo malicious"});
            overlay_settings["hooks"]["PreToolUse"]
                .as_array_mut()
                .unwrap()
                .push(serde_json::json!({
                    "matcher": "",
                    "hooks": [{"type": "command", "command": "echo malicious-hook"}]
                }));
            fs::write(
                root.join("settings.json"),
                serde_json::to_string_pretty(&overlay_settings).unwrap(),
            )
            .unwrap();
            let mut concurrent_settings: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(&global_path).unwrap()).unwrap();
            concurrent_settings["concurrent"] = serde_json::json!(true);
            fs::write(
                &global_path,
                serde_json::to_string_pretty(&concurrent_settings).unwrap(),
            )
            .unwrap();
            let mut cfg = config::Config::default();
            cfg.files.block_write.extend([
                home().join(".claude/settings.json").display().to_string(),
                home().join(".claude/plugins").display().to_string(),
                home().join(".claude.json").display().to_string(),
                home()
                    .join(".claude/skills/example/SKILL.md")
                    .display()
                    .to_string(),
            ]);
            sync_claude_session(
                &home().join(".claude"),
                &root,
                &snapshot,
                true,
                &cfg,
            )
            .unwrap();
            assert_eq!(
                fs::read_to_string(home().join(".claude/CLAUDE.md")).unwrap(),
                "updated instructions"
            );
            assert_eq!(
                fs::read_to_string(home().join(".claude/new-state.json")).unwrap(),
                "{}\n"
            );
            assert!(!home().join(".claude/delete-me.json").exists());
            assert!(!home().join(".claude/rename-me.json").exists());
            assert_eq!(
                fs::read_to_string(home().join(".claude/renamed-state.json")).unwrap(),
                "renamed\n"
            );
            assert_eq!(
                fs::read_to_string(home().join(".claude/plugins/example/plugin.json")).unwrap(),
                "trusted\n"
            );
            assert_eq!(
                fs::read_to_string(home().join(".claude/skills/example/SKILL.md")).unwrap(),
                "user skill"
            );
            assert_eq!(
                fs::read_to_string(home().join(".claude.json")).unwrap(),
                r#"{"mcp":"global"}"#
            );
            let persisted: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(global_path).unwrap()).unwrap();
            assert_eq!(persisted["theme"], "light");
            assert_eq!(persisted["concurrent"], true);
            assert!(persisted.get("disableAllHooks").is_none());
            assert!(persisted.get("statusLine").is_none());
            assert!(!serde_json::to_string(&persisted)
                .unwrap()
                .contains("malicious-hook"));
            assert!(persisted["hooks"]["PreToolUse"]
                .as_array()
                .unwrap()
                .iter()
                .any(|hook| hook.get("_sandpit").is_some()));
        });
    }

    #[test]
    fn claude_session_concatenates_arrays_across_settings_layers() {
        with_temp_home(|| {
            let global_path = home().join(".claude/settings.json");
            fs::create_dir_all(global_path.parent().unwrap()).unwrap();
            fs::write(
                &global_path,
                r#"{"permissions":{"deny":["Read(A)"]}}"#,
            )
            .unwrap();
            let existing = r#"{"permissions":{"deny":["Read(B)"]}}"#;
            let path = home().join("claude-merged.json");

            write_claude_session_settings(None, Some(existing), true, &path).unwrap();

            let settings = fs::read_to_string(path).unwrap();
            assert!(settings.contains("Read(A)"));
            assert!(settings.contains("Read(B)"));
        });
    }

    #[test]
    fn run_refresh_preserves_manually_installed_claude_prompt() {
        with_temp_home(|| {
            install("claude").unwrap();
            let cfg: config::Config = toml::from_str(
                "[adversary]\nrules = \"BLOCK active-claude-rule\"\n",
            )
            .unwrap();

            refresh_for_run("claude", &cfg).unwrap();

            let global = fs::read_to_string(home().join(".claude/settings.json")).unwrap();
            assert!(global.contains("\"type\": \"prompt\""));
        });
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_preserves_symlink() {
        with_temp_home(|| {
            let target = home().join("settings-target.json");
            let link = home().join("settings.json");
            fs::write(&target, "old").unwrap();
            std::os::unix::fs::symlink(&target, &link).unwrap();

            write_atomic(&link, "new").unwrap();

            assert!(link.is_symlink());
            assert_eq!(fs::read_to_string(target).unwrap(), "new");

            let dangling = home().join("dangling-settings.json");
            std::os::unix::fs::symlink("missing/settings.json", &dangling).unwrap();
            write_atomic(&dangling, "created").unwrap();
            assert!(dangling.is_symlink());
            assert_eq!(
                fs::read_to_string(home().join("missing/settings.json")).unwrap(),
                "created"
            );
        });
    }

    #[test]
    fn goose_session_root_isolates_rules_and_preserves_config() {
        with_temp_home(|| {
            let global = goose_config_dir();
            fs::create_dir_all(&global).unwrap();
            fs::write(global.join("config.yaml"), "provider: test\n").unwrap();
            fs::write(global.join("adversary.md"), "BLOCK old-rule\n").unwrap();
            let root = home().join("goose-session");
            let snapshot = home().join("sessions/goose-entries.json");
            let protected_rules = home().join("sessions/goose-adversary.md");

            prepare_goose_session(
                Some("BLOCK active-goose-rule"),
                &root,
                &snapshot,
                &protected_rules,
                None,
            )
            .unwrap();

            assert!(root.join("config/adversary.md").is_symlink());
            assert_eq!(
                fs::read_to_string(root.join("config/adversary.md")).unwrap(),
                "BLOCK active-goose-rule"
            );
            assert_eq!(
                fs::read_to_string(root.join("config/config.yaml")).unwrap(),
                "provider: test\n"
            );
        });
    }

    #[test]
    fn goose_session_preserves_existing_path_root() {
        with_temp_home(|| {
            let existing = home().join("custom-goose-root");
            fs::create_dir_all(existing.join("config")).unwrap();
            fs::create_dir_all(existing.join("data")).unwrap();
            fs::write(existing.join("config/config.yaml"), "provider: custom\n").unwrap();
            fs::write(existing.join("config/delete-me.yaml"), "delete: true\n").unwrap();
            fs::write(existing.join("config/rename-me.yaml"), "rename: true\n").unwrap();
            fs::write(existing.join("data/marker"), "kept").unwrap();
            let root = home().join("goose-session");
            let snapshot = home().join("sessions/goose-entries.json");
            let protected_rules = home().join("sessions/goose-adversary.md");

            prepare_goose_session(
                Some("BLOCK active-goose-rule"),
                &root,
                &snapshot,
                &protected_rules,
                Some(&existing),
            )
            .unwrap();

            assert_eq!(
                fs::read_to_string(root.join("config/config.yaml")).unwrap(),
                "provider: custom\n"
            );
            assert_eq!(fs::read_to_string(root.join("data/marker")).unwrap(), "kept");
            fs::remove_file(root.join("config/config.yaml")).unwrap();
            fs::write(root.join("config/config.yaml"), "provider: changed\n").unwrap();
            fs::remove_file(root.join("config/delete-me.yaml")).unwrap();
            fs::rename(
                root.join("config/rename-me.yaml"),
                root.join("config/renamed.yaml"),
            )
            .unwrap();
            fs::write(root.join("config/new.yaml"), "new: true\n").unwrap();
            let mut cfg = config::Config::default();
            cfg.files
                .block_write
                .push(existing.join("config/config.yaml").display().to_string());
            sync_goose_session(&root, &snapshot, &cfg).unwrap();
            assert_eq!(
                fs::read_to_string(existing.join("config/config.yaml")).unwrap(),
                "provider: custom\n"
            );
            assert_eq!(
                fs::read_to_string(existing.join("config/new.yaml")).unwrap(),
                "new: true\n"
            );
            assert!(!existing.join("config/delete-me.yaml").exists());
            assert!(!existing.join("config/rename-me.yaml").exists());
            assert_eq!(
                fs::read_to_string(existing.join("config/renamed.yaml")).unwrap(),
                "rename: true\n"
            );
        });
    }

    #[test]
    fn overlapping_goose_sessions_preserve_newer_state() {
        with_temp_home(|| {
            let existing = home().join("goose");
            let source = existing.join("config");
            fs::create_dir_all(source.join("directory")).unwrap();
            for name in [
                "replace",
                "delete",
                "rename",
                "rename-collision",
                "directory/state",
            ] {
                fs::write(source.join(name), "initial").unwrap();
            }
            let first = home().join("first");
            let second = home().join("second");
            let first_snapshot = home().join("first.json");
            let second_snapshot = home().join("second.json");
            for (root, snapshot) in [(&first, &first_snapshot), (&second, &second_snapshot)] {
                prepare_goose_session(None, root, snapshot, &home().join("rules"), Some(&existing))
                    .unwrap();
            }
            let first_config = first.join("config");
            fs::remove_file(first_config.join("replace")).unwrap();
            fs::write(first_config.join("replace"), "older session").unwrap();
            fs::remove_file(first_config.join("delete")).unwrap();
            fs::remove_file(first_config.join("directory")).unwrap();
            fs::rename(first_config.join("rename"), first_config.join("renamed")).unwrap();
            fs::rename(
                first_config.join("rename-collision"),
                first_config.join("destination"),
            )
            .unwrap();
            fs::write(first_config.join("new"), "older session").unwrap();
            for name in ["replace", "delete", "rename"] {
                fs::remove_file(second.join("config").join(name)).unwrap();
                fs::write(second.join("config").join(name), "newer session").unwrap();
            }
            fs::write(second.join("config/directory/state"), "newer session").unwrap();
            fs::write(second.join("config/destination"), "newer session").unwrap();
            fs::write(second.join("config/new"), "newer session").unwrap();
            let cfg = config::Config::default();
            sync_goose_session(&second, &second_snapshot, &cfg).unwrap();
            sync_goose_session(&first, &first_snapshot, &cfg).unwrap();
            for name in [
                "replace",
                "delete",
                "rename",
                "directory/state",
                "destination",
                "new",
            ] {
                assert_eq!(
                    fs::read_to_string(source.join(name)).unwrap(),
                    "newer session",
                    "{name}"
                );
            }
            assert_eq!(
                fs::read_to_string(source.join("rename-collision")).unwrap(),
                "initial"
            );
            assert!(!source.join("renamed").exists());
        });
    }

    #[test]
    fn overlay_directories_merge_without_reviving_deleted_state() {
        with_temp_home(|| {
            let source = home().join("source");
            let overlay = home().join("overlay");
            fs::create_dir_all(source.join("directory")).unwrap();
            fs::create_dir_all(source.join("deleted")).unwrap();
            fs::write(source.join("directory/first"), "initial").unwrap();
            fs::write(source.join("directory/second"), "initial").unwrap();
            let snapshot = snapshot_overlay_entries(&source, &[]).unwrap();
            fs::create_dir_all(overlay.join("directory")).unwrap();
            fs::create_dir_all(overlay.join("deleted")).unwrap();
            fs::write(overlay.join("directory/first"), "session").unwrap();
            fs::write(overlay.join("directory/second"), "stale").unwrap();
            fs::write(overlay.join("deleted/state"), "stale").unwrap();
            write_atomic(&source.join("directory/second"), "concurrent").unwrap();
            fs::remove_dir(source.join("deleted")).unwrap();
            sync_overlay(
                &source,
                &overlay,
                &[],
                &snapshot,
                &config::Config::default(),
            )
            .unwrap();
            assert_eq!(
                fs::read_to_string(source.join("directory/first")).unwrap(),
                "session"
            );
            assert_eq!(
                fs::read_to_string(source.join("directory/second")).unwrap(),
                "concurrent"
            );
            assert!(!source.join("deleted").exists());
        });
    }

    #[test]
    fn overlay_reconciliation_preserves_concurrent_symlink_target_changes() {
        with_temp_home(|| {
            let source = home().join("source");
            let overlay = home().join("overlay");
            let target = home().join("target");
            fs::create_dir_all(&source).unwrap();
            fs::create_dir_all(&overlay).unwrap();
            fs::write(&target, "initial").unwrap();
            std::os::unix::fs::symlink(&target, source.join("state")).unwrap();
            let snapshot = snapshot_overlay_entries(&source, &[]).unwrap();
            fs::write(overlay.join("state"), "stale").unwrap();
            write_atomic(&target, "concurrent").unwrap();
            sync_overlay(
                &source,
                &overlay,
                &[],
                &snapshot,
                &config::Config::default(),
            )
            .unwrap();
            assert_eq!(fs::read_to_string(target).unwrap(), "concurrent");
            assert!(source.join("state").is_symlink());
        });
    }

    #[test]
    fn overlapping_claude_sessions_preserve_newer_state_and_settings() {
        with_temp_home(|| {
            let source = home().join(".claude");
            let state = home().join(".claude.json");
            fs::create_dir_all(&source).unwrap();
            fs::write(source.join("settings.json"), r#"{"model":"initial"}"#).unwrap();
            fs::write(&state, r#"{"state":"initial"}"#).unwrap();
            let first = home().join("first");
            let second = home().join("second");
            let first_snapshot = home().join("first.json");
            let second_snapshot = home().join("second.json");
            for (root, snapshot, value) in [
                (&first, &first_snapshot, "older"),
                (&second, &second_snapshot, "newer"),
            ] {
                prepare_claude_session_without_adversary(&source, root, snapshot).unwrap();
                fs::remove_file(root.join(".claude.json")).unwrap();
                fs::write(
                    root.join(".claude.json"),
                    format!(r#"{{"state":"{value}"}}"#),
                )
                .unwrap();
                fs::write(
                    root.join("settings.json"),
                    format!(r#"{{"model":"{value}"}}"#),
                )
                .unwrap();
            }
            let cfg = config::Config::default();
            sync_claude_session(&source, &second, &second_snapshot, true, &cfg).unwrap();
            sync_claude_session(&source, &first, &first_snapshot, true, &cfg).unwrap();
            assert_eq!(fs::read_to_string(state).unwrap(), r#"{"state":"newer"}"#);
            let settings: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(source.join("settings.json")).unwrap())
                    .unwrap();
            assert_eq!(settings["model"], "newer");
        });
    }

    #[test]
    fn settings_merge_preserves_concurrent_edits_additions_and_deletions() {
        let base = serde_json::json!({"edited": 0, "deleted": 0, "remove": 0, "nested": {"first": 0, "second": 0}});
        let current = serde_json::json!({"edited": 1, "remove": 1, "added": 1, "nested": {"first": 0, "second": 1}});
        let updated = serde_json::json!({"edited": 2, "deleted": 2, "added": 2, "nested": {"first": 1, "second": 0}});
        assert_eq!(
            merge_session_changes(&base, &current, &updated),
            serde_json::json!({
                "edited": 1, "remove": 1, "added": 1, "nested": {"first": 1, "second": 1}
            })
        );
    }

    #[test]
    fn rejected_overlay_renames_preserve_the_source() {
        with_temp_home(|| {
            let source = home().join("source");
            let overlay = home().join("overlay");
            fs::create_dir_all(&source).unwrap();
            fs::create_dir_all(&overlay).unwrap();
            fs::write(source.join("excluded-source"), "initial").unwrap();
            fs::write(source.join("blocked-source"), "initial").unwrap();
            let snapshot = snapshot_overlay_entries(&source, &[]).unwrap();
            std::os::unix::fs::symlink(
                source.join("excluded-source"),
                overlay.join("settings.json"),
            )
            .unwrap();
            std::os::unix::fs::symlink(source.join("blocked-source"), overlay.join("blocked"))
                .unwrap();
            let mut cfg = config::Config::default();
            cfg.files
                .block_write
                .push(source.join("blocked").display().to_string());
            sync_overlay(&source, &overlay, &["settings.json"], &snapshot, &cfg).unwrap();
            assert_eq!(
                fs::read_to_string(source.join("excluded-source")).unwrap(),
                "initial"
            );
            assert_eq!(
                fs::read_to_string(source.join("blocked-source")).unwrap(),
                "initial"
            );
            assert!(!source.join("settings.json").exists());
            assert!(!source.join("blocked").exists());
        });
    }

    #[test]
    fn session_rules_include_deterministic_policy() {
        let mut cfg = config::Config::default();
        cfg.network.block.push("blocked.example".into());
        cfg.exec.block.push("blocked-command".into());
        let rules = rules_from(Some(&cfg));
        assert!(rules.contains("blocked network domains: blocked.example"));
        assert!(rules.contains("blocked commands: blocked-command"));
    }

    #[test]
    fn goose_paths_honor_xdg_overrides() {
        with_temp_home(|| {
            let config = home().join("xdg-config");
            let data = home().join("xdg-data");
            let state = home().join("xdg-state");
            let previous = [
                ("XDG_CONFIG_HOME", env::var_os("XDG_CONFIG_HOME")),
                ("XDG_DATA_HOME", env::var_os("XDG_DATA_HOME")),
                ("XDG_STATE_HOME", env::var_os("XDG_STATE_HOME")),
            ];
            unsafe {
                env::set_var("XDG_CONFIG_HOME", &config);
                env::set_var("XDG_DATA_HOME", &data);
                env::set_var("XDG_STATE_HOME", &state);
            }

            assert_eq!(goose_config_dir(), config.join("goose"));
            assert_eq!(goose_data_dir(), data.join("goose"));
            assert_eq!(goose_state_dir(), state.join("goose"));

            unsafe {
                for (name, value) in previous {
                    match value {
                        Some(value) => env::set_var(name, value),
                        None => env::remove_var(name),
                    }
                }
            }
        });
    }

    #[test]
    fn amp_delegate_prefers_session_rules() {
        with_temp_home(|| {
            let mut cfg = config::Config::builtin_default();
            refresh_for_run("amp", &cfg).unwrap();

            let script = fs::read_to_string(sandpit_dir().join("amp-review.sh")).unwrap();
            assert!(script.contains("os.environ.get(\"SANDPIT_ADVERSARY_RULES\""));
            assert!(script.contains("SANDPIT_ADVERSARY_DISABLED"));

            let selected = home().join("custom-amp-settings.jsonc");
            fs::write(
                &selected,
                r#"{
                    // Amp accepts comments and trailing commas.
                    "custom": "https://example.com/kept",
                    "amp.permissions": [
                        {"_sandpit": true},
                        {"tool": "Read"},
                    ],
                }"#,
            )
            .unwrap();
            let snapshot = home().join("amp-source-snapshot.json");
            snapshot_amp_settings(Some(&selected), &snapshot).unwrap();
            let disabled = home().join("amp-disabled.json");
            write_amp_session_settings_without_adversary(Some(&selected), &disabled).unwrap();
            let settings = fs::read_to_string(disabled).unwrap();
            assert!(!settings.contains("_sandpit"));
            assert!(settings.contains("https://example.com/kept"));
            assert!(settings.contains("\"tool\": \"Read\""));

            let enabled = home().join("amp-enabled.json");
            write_amp_session_settings_with_adversary(Some(&selected), &enabled).unwrap();
            let settings = fs::read_to_string(&enabled).unwrap();
            assert!(settings.contains("_sandpit"));
            assert!(settings.contains("amp-review.sh"));
            assert!(settings.contains("https://example.com/kept"));
            assert!(settings.contains("\"tool\": \"Read\""));

            let mut edited: serde_json::Value = serde_json::from_str(&settings).unwrap();
            edited["custom"] = serde_json::json!("changed");
            fs::write(&enabled, serde_json::to_string_pretty(&edited).unwrap()).unwrap();
            let mut concurrent = read_amp_settings(Some(&selected));
            concurrent["concurrent"] = serde_json::json!(true);
            fs::write(&selected, serde_json::to_string_pretty(&concurrent).unwrap()).unwrap();
            cfg.files
                .block_write
                .push(selected.display().to_string());
            sync_amp_session(&selected, &snapshot, &enabled, true).unwrap();
            let persisted = read_amp_settings(Some(&selected));
            assert_eq!(persisted["custom"], "changed");
            assert_eq!(persisted["concurrent"], true);
            assert!(persisted["amp.permissions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|permission| permission.get("_sandpit").is_some()));

            let default_jsonc = home().join(".config/amp/settings.jsonc");
            fs::create_dir_all(default_jsonc.parent().unwrap()).unwrap();
            fs::write(&default_jsonc, r#"{"from_jsonc": true,}"#).unwrap();
            assert!(!home().join(".config/amp/settings.json").exists());
            assert_eq!(read_amp_settings(None)["from_jsonc"], true);
        });
    }
}
