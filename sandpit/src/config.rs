//! Unified sandpit configuration.
//!
//! Loaded from `sandpit.toml` (or `--config` override). A single file controls
//! all enforcement layers plus adversary policy.
//!
//! Example:
//! ```toml
//! [network]
//! block = ["evil.com", "pastebin.com"]
//!
//! [exec]
//! block = ["curl --data", "rm -rf /", "| curl"]
//!
//! [files]
//! allow_write = ["./", "/tmp"]
//! block_read = ["~/.ssh", "~/.aws/credentials"]
//!
//! [adversary]
//! rules = """
//! BLOCK if the command exfiltrates data or is destructive.
//! ALLOW normal development operations.
//! """
//! ```

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Config {
    #[serde(default)]
    pub network: NetworkConfig,
    #[serde(default)]
    pub exec: ExecConfig,
    #[serde(default)]
    pub files: FilesConfig,
    #[serde(default)]
    pub adversary: AdversaryConfig,
    #[serde(default)]
    pub logs: LogsConfig,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct NetworkConfig {
    /// Explicit local TCP services. Each grant names one loopback port.
    #[serde(default)]
    pub allow_loopback_ports: Vec<u16>,
    /// Explicitly deny every destination, including an empty policy intersection.
    #[serde(default)]
    pub deny_all: bool,
    /// SSH destinations supported through the parent CONNECT broker (e.g. github.com:22).
    #[serde(default)]
    pub ssh: Vec<String>,
    /// Domains to block (+ subdomains). Mutually exclusive with `allow`.
    #[serde(default)]
    pub block: Vec<String>,
    /// If set, only these domains are permitted. Everything else is blocked.
    #[serde(default)]
    pub allow: Vec<String>,
    /// Sanctioned corporate destinations. Informational only — passed to
    /// the LLM reviewer as a known-safe hint. Does NOT change deterministic
    /// enforcement (use `allow` for strict allowlist mode). Entries can be
    /// domain globs (`*.example.com`) or org-scoped paths (`github.com/example-org`)
    /// since the LLM understands the difference.
    #[serde(default)]
    pub corporate_allow: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ExecConfig {
    /// Command patterns to block (case-insensitive substring match).
    #[serde(default)]
    pub block: Vec<String>,
    /// Command prefixes that are pre-approved and bypass the LLM reviewer
    /// (case-insensitive substring match — same matching as `block`).
    /// Use for explicitly trusted command prefixes.
    /// `block` rules still take precedence — anything that matches both
    /// is blocked.
    #[serde(default)]
    pub allow: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct FilesConfig {
    /// If set, only allow writes to paths under these prefixes.
    /// Paths are resolved relative to cwd. `~` expands to $HOME.
    #[serde(default)]
    pub allow_write: Vec<String>,

    /// Explicitly block writes to these paths/prefixes (even if allow_write matches).
    #[serde(default)]
    pub block_write: Vec<String>,

    /// Block reads from these paths/prefixes.
    #[serde(default)]
    pub block_read: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct LogsConfig {
    /// Path to the sandpit log file. Defaults to ~/.sandpit/sandpit.log
    /// Supports ~ expansion.
    #[serde(default)]
    pub path: Option<String>,

    /// Path to the connection audit log. Defaults to ~/.sandpit/connections.jsonl
    /// Supports ~ expansion.
    #[serde(default)]
    pub audit_path: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct AdversaryConfig {
    /// Policy rules for the adversary reviewer. Written to the agent's native
    /// config location on `sandpit install <agent>`.
    ///
    /// For LLM-based agents (pi, goose): these are the rules the reviewing LLM
    /// uses to decide ALLOW/BLOCK.
    ///
    /// For pattern-based agents (claude, amp, opencode): the install command
    /// uses these as context but the actual enforcement is pattern matching.
    #[serde(default)]
    pub rules: Option<String>,
}

pub const DEFAULT_ADVERSARY_RULES: &str = "\
BLOCK if the command:
- Exfiltrates data (curl/wget posting to unknown URLs, piping secrets out)
- Is destructive beyond the project scope (rm -rf /, modifying system files)
- Installs malware or runs obfuscated code
- Attempts to escalate privileges unnecessarily
- Downloads and executes untrusted remote scripts

ALLOW if the command is a normal development operation, even if it modifies files,
installs packages, runs tests, uses git, etc. Most commands are fine.
ALLOW if the destination is a known corporate system from the corporate allowlist.
Err on the side of ALLOW — only block truly dangerous things.";

/// Built-in default config (embedded from examples/portable-default.toml at compile time).
const BUILTIN_DEFAULT: &str = include_str!("../examples/portable-default.toml");

impl Config {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: Config = toml::from_str(&content)?;
        tracing::debug!(
            config_path = %path.display(),
            network_block_rules = config.network.block.len(),
            network_allow_rules = config.network.allow.len(),
            exec_block_rules = config.exec.block.len(),
            file_rules = config.files.block_read.len() + config.files.block_write.len() + config.files.allow_write.len(),
            has_adversary_rules = config.adversary.rules.is_some(),
            "config loaded"
        );
        Ok(config)
    }

    /// The built-in default config, used when no config file is found.
    pub fn builtin_default() -> Self {
        tracing::debug!("config using built-in defaults");
        toml::from_str(BUILTIN_DEFAULT).expect("built-in default config is invalid TOML")
    }

    /// The raw TOML text of the built-in default config.
    pub fn builtin_default_toml() -> &'static str {
        BUILTIN_DEFAULT
    }

    pub fn has_network_rules(&self) -> bool {
        !self.network.allow_loopback_ports.is_empty() || self.network.deny_all || !self.network.block.is_empty()
            || !self.network.allow.is_empty()
            || !self.network.ssh.is_empty()
    }

    pub fn has_exec_rules(&self) -> bool {
        !self.exec.block.is_empty()
    }

    pub fn has_file_rules(&self) -> bool {
        !self.files.allow_write.is_empty()
            || !self.files.block_write.is_empty()
            || !self.files.block_read.is_empty()
    }

    pub fn has_adversary_rules(&self) -> bool {
        self.adversary.rules.is_some()
    }

    pub fn adversary_rules(&self) -> &str {
        self.adversary
            .rules
            .as_deref()
            .unwrap_or(DEFAULT_ADVERSARY_RULES)
    }

    /// Apply constraints inherited from an outer Sandpit session. Nested runs
    /// may add restrictions, but cannot loosen the policy already containing
    /// the process tree.
    pub fn inherit_outer_policy(&mut self, outer: &Config) {
        self.network.deny_all |= outer.network.deny_all;
        self.network.allow_loopback_ports.retain(|port| outer.network.allow_loopback_ports.contains(port));
        extend_unique(&mut self.network.block, &outer.network.block);
        if !outer.network.allow.is_empty() && !self.network.allow.is_empty() {
            self.network.allow = intersect_domains(&self.network.allow, &outer.network.allow);
            if self.network.allow.is_empty() {
                self.network.deny_all = true;
            }
        } else if !outer.network.allow.is_empty() {
            self.network.allow.clone_from(&outer.network.allow);
        }
        self.network
            .ssh
            .retain(|value| outer.network.ssh.contains(value));
        self.network
            .corporate_allow
            .retain(|value| outer.network.corporate_allow.contains(value));
        extend_unique(&mut self.exec.block, &outer.exec.block);
        self.exec
            .allow
            .retain(|value| outer.exec.allow.contains(value));
        extend_unique(&mut self.files.block_write, &outer.files.block_write);
        extend_unique(&mut self.files.block_read, &outer.files.block_read);
        if !outer.files.allow_write.is_empty() && !self.files.allow_write.is_empty() {
            self.files.allow_write =
                intersect_paths(&self.files.allow_write, &outer.files.allow_write);
            if self.files.allow_write.is_empty() {
                self.files
                    .allow_write
                    .push("/.sandpit-no-write-path-matches".to_string());
            }
        } else if !outer.files.allow_write.is_empty() {
            self.files.allow_write.clone_from(&outer.files.allow_write);
        }
        self.adversary.rules = Some(outer.adversary_rules().to_string());
    }

    pub fn resolve_file_rules(&mut self) {
        // Allow rules authorize the captured target, not an alias that can be
        // retargeted later to expand access.
        for rule in &mut self.files.allow_write {
            *rule = resolve_policy_path(Path::new(&expand_path(rule)))
                .to_string_lossy()
                .to_string();
        }
        for rules in [&mut self.files.block_write, &mut self.files.block_read] {
            let original = std::mem::take(rules);
            for rule in original {
                let expanded = PathBuf::from(expand_path(&rule));
                let absolute = if expanded.is_absolute() {
                    expanded
                } else {
                    std::env::current_dir()
                        .map(|cwd| cwd.join(&expanded))
                        .unwrap_or(expanded)
                };
                // Keep the requested name as well as the frozen target. If a
                // missing ancestor later becomes a symlink, its new target no
                // longer matches the resolved rule. The original alias must
                // still deny the operation, including after a child exec.
                extend_unique(
                    rules,
                    &[
                        absolute.to_string_lossy().into_owned(),
                        resolve_policy_path(&absolute).to_string_lossy().into_owned(),
                    ],
                );
            }
        }
    }

    /// Whether the effective file policy permits a write to `path`.
    /// Session overlay reconciliation runs outside the sandbox, so it must
    /// apply the same decision before copying child-created state back.
    pub fn allows_write_to(&self, path: &Path) -> bool {
        let resolved = resolve_policy_path(path);
        let matches = |rules: &[String]| {
            rules.iter().any(|rule| {
                let rule = resolve_policy_path(Path::new(&expand_path(rule)));
                resolved.starts_with(rule)
            })
        };
        if matches(&self.files.block_write) {
            return false;
        }
        self.files.allow_write.is_empty() || matches(&self.files.allow_write)
    }

    /// Resolved log file path (from config or default).
    pub fn log_path(&self) -> PathBuf {
        match &self.logs.path {
            Some(p) => PathBuf::from(expand_path(p)),
            None => default_log_path(),
        }
    }

    /// Absolute audit log path (from config or default), preserving aliases.
    pub fn audit_log_path(&self) -> PathBuf {
        let path = match &self.logs.audit_path {
            Some(p) => PathBuf::from(expand_path(p)),
            None => default_audit_log_path(),
        };
        absolute_runtime_path(&path)
    }

    /// Lexical and canonical paths that must both be protected. Retaining the
    /// configured alias prevents a child from replacing it with forged data,
    /// while protecting the resolved target prevents writes through aliases.
    pub fn audit_log_protection_paths(&self) -> Vec<PathBuf> {
        let lexical = self.audit_log_path();
        let resolved = resolve_existing_ancestors(&lexical);
        if resolved == lexical {
            vec![lexical]
        } else {
            vec![lexical, resolved]
        }
    }
}

fn extend_unique(destination: &mut Vec<String>, source: &[String]) {
    for value in source {
        if !destination.contains(value) {
            destination.push(value.clone());
        }
    }
}

fn intersect_domains(inner: &[String], outer: &[String]) -> Vec<String> {
    let mut intersection = Vec::new();
    for inner_domain in inner {
        for outer_domain in outer {
            let inner_base = inner_domain.trim_start_matches("*.");
            let outer_base = outer_domain.trim_start_matches("*.");
            let narrower = if inner_base == outer_base || inner_base.ends_with(&format!(".{outer_base}")) {
                inner_domain
            } else if outer_base.ends_with(&format!(".{inner_base}")) {
                outer_domain
            } else {
                continue;
            };
            if !intersection.contains(narrower) {
                intersection.push(narrower.clone());
            }
        }
    }
    intersection
}

fn intersect_paths(inner: &[String], outer: &[String]) -> Vec<String> {
    let mut intersection = Vec::new();
    for inner_path in inner {
        for outer_path in outer {
            let inner_resolved = resolve_policy_path(Path::new(&expand_path(inner_path)));
            let outer_resolved = resolve_policy_path(Path::new(&expand_path(outer_path)));
            let narrower = if inner_resolved.starts_with(&outer_resolved) {
                inner_path
            } else if outer_resolved.starts_with(&inner_resolved) {
                outer_path
            } else {
                continue;
            };
            if !intersection.contains(narrower) {
                intersection.push(narrower.clone());
            }
        }
    }
    intersection
}

fn absolute_runtime_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        match std::env::current_dir() {
            Ok(cwd) => cwd.join(path),
            Err(_) => return path.to_path_buf(),
        }
    }
}

/// Resolve every existing ancestor while preserving a missing tail. The final
/// audit file often does not exist yet, so canonicalizing it alone is not
/// sufficient.
fn resolve_existing_ancestors(path: &Path) -> PathBuf {
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                resolved.pop();
            }
            Component::CurDir => {}
            other => {
                resolved.push(other.as_os_str());
                if let Ok(canonical) = std::fs::canonicalize(&resolved) {
                    resolved = canonical;
                }
            }
        }
    }
    resolved
}

/// Default sandpit log: ~/.sandpit/sandpit.log
pub fn default_log_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sandpit")
        .join("sandpit.log")
}

/// Default audit log: ~/.sandpit/connections.jsonl
pub fn default_audit_log_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sandpit")
        .join("connections.jsonl")
}

/// Resolve `~` and `./` in path strings.
pub fn expand_path(s: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let s = if s.starts_with("~/") {
        format!("{}/{}", home, &s[2..])
    } else if s == "~" {
        home.clone()
    } else {
        s.to_string()
    };
    if s.starts_with("./") {
        if let Ok(cwd) = std::env::current_dir() {
            return format!("{}/{}", cwd.display(), &s[2..]);
        }
    } else if s == "." {
        if let Ok(cwd) = std::env::current_dir() {
            return cwd.to_string_lossy().to_string();
        }
    }
    s
}

pub fn is_session_snapshot(path: &Path) -> bool {
    if path.file_name().and_then(|name| name.to_str()) != Some("config.toml") {
        return false;
    }
    let Some(run_dir) = path.parent() else {
        return false;
    };
    let Some(root) = run_dir.parent() else {
        return false;
    };
    let sandpit_root = session_root();
    is_session_root(root, &sandpit_root.join("sessions"))
        || is_session_root(root, &sandpit_root.join("session-state/nested-sessions"))
}

pub(crate) fn session_root() -> PathBuf {
    resolve_policy_path(&system_home_dir().join(".sandpit"))
}

pub(crate) fn adversary_lock_path() -> PathBuf {
    session_root().join("adversary.lock")
}

pub(crate) fn system_home_dir() -> PathBuf {
    #[cfg(unix)]
    unsafe {
        let passwd = libc::getpwuid(libc::getuid());
        if !passwd.is_null() && !(*passwd).pw_dir.is_null() {
            if let Ok(path) = std::ffi::CStr::from_ptr((*passwd).pw_dir).to_str() {
                return PathBuf::from(path);
            }
        }
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"))
}

fn is_session_root(actual: &Path, configured: &Path) -> bool {
    let actual = std::fs::canonicalize(actual).unwrap_or_else(|_| actual.to_path_buf());
    let configured =
        std::fs::canonicalize(configured).unwrap_or_else(|_| configured.to_path_buf());
    actual == configured
}

pub(crate) fn resolve_policy_path(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else if let Ok(cwd) = std::env::current_dir() {
        cwd.join(path)
    } else {
        return path.to_path_buf();
    };
    let mut ancestor = absolute.as_path();
    let mut missing = Vec::new();
    loop {
        if let Ok(mut canonical) = std::fs::canonicalize(ancestor) {
            for component in missing.iter().rev() {
                canonical.push(component);
            }
            return canonical;
        }
        let Some(name) = ancestor.file_name() else {
            break;
        };
        missing.push(name.to_os_string());
        let Some(parent) = ancestor.parent() else {
            break;
        };
        ancestor = parent;
    }
    absolute
}

/// Search order for config file:
/// 1. Explicit path (--config)
/// 2. ~/.sandpit/config.toml (global)
///
/// Project-local configs are intentionally not auto-loaded: repository
/// contents are inside the sandbox's threat boundary. Pass one explicitly
/// with `--config` after reviewing it.
pub fn find_config(explicit: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = explicit {
        return Some(p.to_path_buf());
    }
    let home = std::env::var("HOME").ok()?;
    let global = PathBuf::from(home).join(".sandpit/config.toml");
    if global.exists() {
        return Some(global);
    }
    None
}

/// Path to the global config file: ~/.sandpit/config.toml
pub fn global_config_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".sandpit/config.toml"))
}

fn normalize_allow_write_path(path: &str, cwd: &Path, home: &Path) -> Result<String> {
    if path.is_empty() {
        bail!("allowlist paths cannot be empty");
    }

    let expanded = if path == "~" {
        home.to_path_buf()
    } else if let Some(rest) = path.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(path)
    };
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        cwd.join(expanded)
    };

    let normalized = resolve_existing_ancestors(&absolute);
    Ok(normalized.to_string_lossy().into_owned())
}

fn normalize_allow_write_paths(paths: &[String]) -> Result<Vec<String>> {
    let cwd = std::env::current_dir().context("cannot determine current directory")?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .context("cannot determine HOME directory")?;
    paths
        .iter()
        .map(|path| normalize_allow_write_path(path, &cwd, &home))
        .collect()
}

fn validate_allow_write_paths_for_add(paths: &[String]) -> Result<()> {
    if let Some(path) = paths.iter().find(|path| path.contains('|')) {
        bail!("allowlist paths cannot contain '|': {path}");
    }
    Ok(())
}

fn resolve_config_target(path: &Path) -> Result<PathBuf> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => std::fs::canonicalize(path)
            .with_context(|| format!("failed to resolve symlinked config {}", path.display())),
        Ok(_) => Ok(path.to_path_buf()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(error) => {
            Err(error).with_context(|| format!("failed to inspect config {}", path.display()))
        }
    }
}

fn write_config_atomically(path: &Path, content: &str) -> Result<()> {
    let target = resolve_config_target(path)?;
    let path = target.as_path();
    let parent = path
        .parent()
        .context("global config path has no parent directory")?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .context("global config path has no valid file name")?;

    let (temp_path, mut temp_file) = (0..1000)
        .find_map(|attempt| {
            let temp_path = parent.join(format!(
                ".{file_name}.tmp.{}.{}",
                std::process::id(),
                attempt
            ));
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)
            {
                Ok(file) => Some(Ok((temp_path, file))),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => None,
                Err(error) => Some(Err(error)),
            }
        })
        .context("could not create a unique temporary config file")?
        .with_context(|| {
            format!(
                "failed to create a temporary file beside {}",
                path.display()
            )
        })?;

    let publish = (|| -> Result<()> {
        temp_file
            .write_all(content.as_bytes())
            .with_context(|| format!("failed to write {}", temp_path.display()))?;

        match std::fs::metadata(path) {
            Ok(metadata) => temp_file
                .set_permissions(metadata.permissions())
                .with_context(|| {
                    format!("failed to preserve permissions for {}", path.display())
                })?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(error).with_context(|| format!("failed to inspect {}", path.display()));
            }
        }

        temp_file
            .sync_all()
            .with_context(|| format!("failed to flush {}", temp_path.display()))?;
        drop(temp_file);
        std::fs::rename(&temp_path, path).with_context(|| {
            format!(
                "failed to atomically replace {} with {}",
                path.display(),
                temp_path.display()
            )
        })?;
        Ok(())
    })();

    if publish.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    publish
}

fn add_allow_write_paths_to_document(
    content: &str,
    paths: &[String],
) -> Result<(String, Vec<String>)> {
    let mut doc = content
        .parse::<toml_edit::DocumentMut>()
        .context("failed to parse config as TOML")?;

    if doc.get("files").is_none() {
        doc["files"] = toml_edit::Item::Table(toml_edit::Table::new());
    }

    let allow_write = match doc.get_mut("files").expect("files was just created") {
        toml_edit::Item::Table(files) => {
            if !files.contains_key("allow_write") {
                files["allow_write"] = toml_edit::value(toml_edit::Array::new());
            }
            files["allow_write"]
                .as_array_mut()
                .context("files.allow_write is not an array")?
        }
        toml_edit::Item::Value(toml_edit::Value::InlineTable(files)) => {
            if !files.contains_key("allow_write") {
                files.insert(
                    "allow_write",
                    toml_edit::Value::Array(toml_edit::Array::new()),
                );
            }
            files
                .get_mut("allow_write")
                .and_then(toml_edit::Value::as_array_mut)
                .context("files.allow_write is not an array")?
        }
        _ => bail!("files must be a table"),
    };

    let mut added = Vec::new();
    for path in paths {
        if !allow_write.iter().any(|value| value.as_str() == Some(path)) {
            allow_write.push(path.as_str());
            added.push(path.clone());
        }
    }

    Ok((doc.to_string(), added))
}

fn remove_allow_write_paths_from_document(
    content: &str,
    raw_paths: &[String],
    normalized_paths: &[String],
) -> Result<(String, Vec<String>)> {
    let mut doc = content
        .parse::<toml_edit::DocumentMut>()
        .context("failed to parse config as TOML")?;

    let Some(files) = doc.get_mut("files") else {
        return Ok((content.to_string(), Vec::new()));
    };
    let allow_write = match files {
        toml_edit::Item::Table(files) => match files.get_mut("allow_write") {
            Some(value) => value
                .as_array_mut()
                .context("files.allow_write is not an array")?,
            None => return Ok((content.to_string(), Vec::new())),
        },
        toml_edit::Item::Value(toml_edit::Value::InlineTable(files)) => {
            match files.get_mut("allow_write") {
                Some(value) => value
                    .as_array_mut()
                    .context("files.allow_write is not an array")?,
                None => return Ok((content.to_string(), Vec::new())),
            }
        }
        _ => bail!("files must be a table"),
    };

    let mut removed = Vec::new();
    for (raw, normalized) in raw_paths.iter().zip(normalized_paths) {
        let before_len = allow_write.len();
        allow_write.retain(|value| {
            let Some(value) = value.as_str() else {
                return true;
            };
            value != raw && value != normalized
        });
        if allow_write.len() < before_len {
            removed.push(raw.clone());
        }
    }

    Ok((doc.to_string(), removed))
}

/// Add paths to the global config's `[files].allow_write` list.
/// Creates `~/.sandpit/config.toml` from the built-in default if it doesn't exist.
pub fn add_allow_write_paths(paths: &[String]) -> Result<Vec<String>> {
    // Validate and resolve every argument before touching the config file.
    validate_allow_write_paths_for_add(paths)?;
    let paths = normalize_allow_write_paths(paths)?;
    let config_path = global_config_path().context("cannot determine HOME directory")?;
    let config_target = resolve_config_target(&config_path)?;

    // Load or create the global config
    let content = if config_target.exists() {
        std::fs::read_to_string(&config_target)
            .with_context(|| format!("failed to read {}", config_target.display()))?
    } else {
        // Create ~/.sandpit/ if needed, seed with built-in default
        if let Some(parent) = config_target.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        BUILTIN_DEFAULT.to_string()
    };

    let (updated, added) = add_allow_write_paths_to_document(&content, &paths)?;

    write_config_atomically(&config_target, &updated)?;

    Ok(added)
}

/// Remove paths from the global config's `[files].allow_write` list.
pub fn remove_allow_write_paths(paths: &[String]) -> Result<Vec<String>> {
    let normalized_paths = normalize_allow_write_paths(paths)?;
    let config_path = global_config_path().context("cannot determine HOME directory")?;
    let config_target = resolve_config_target(&config_path)?;

    if !config_target.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&config_target)
        .with_context(|| format!("failed to read {}", config_target.display()))?;

    let (updated, removed) =
        remove_allow_write_paths_from_document(&content, paths, &normalized_paths)?;

    write_config_atomically(&config_target, &updated)?;

    Ok(removed)
}

/// List the current global `[files].allow_write` entries.
pub fn list_allow_write_paths() -> Result<Vec<String>> {
    let config_path = global_config_path().context("cannot determine HOME directory")?;

    if !config_path.exists() {
        // Fall back to built-in default
        let cfg = Config::builtin_default();
        return Ok(cfg.files.allow_write);
    }

    let cfg = Config::load(&config_path)?;
    Ok(cfg.files.allow_write)
}

/// Serialize the deterministic layers into env vars for the dylib.
pub fn config_to_env_vars(config: &Config) -> Vec<(String, String)> {
    // The first injected process resolves file-policy symlinks and replaces
    // this marker with `1` for descendants so exec cannot retarget an
    // allowlisted root and cause the next dylib instance to trust it.
    let mut vars = vec![("SANDPIT_FILE_POLICY_FROZEN".into(), "0".into())];

    if !config.exec.block.is_empty() {
        vars.push((
            "SANDPIT_EXEC_RULES_INLINE".into(),
            config.exec.block.join("\n"),
        ));
    }

    if !config.files.allow_write.is_empty() {
        let expanded: Vec<String> = config
            .files
            .allow_write
            .iter()
            .map(|s| expand_path(s))
            .collect();
        vars.push(("SANDPIT_FILE_ALLOW_WRITE".into(), expanded.join("|")));
    }
    if !config.files.block_write.is_empty() {
        let expanded: Vec<String> = config
            .files
            .block_write
            .iter()
            .map(|s| expand_path(s))
            .collect();
        vars.push(("SANDPIT_FILE_BLOCK_WRITE".into(), expanded.join("|")));
    }
    if !config.files.block_read.is_empty() {
        let expanded: Vec<String> = config
            .files
            .block_read
            .iter()
            .map(|s| expand_path(s))
            .collect();
        vars.push(("SANDPIT_FILE_BLOCK_READ".into(), expanded.join("|")));
    }

    if !config.network.block.is_empty() {
        vars.push(("SANDPIT_NET_BLOCK".into(), config.network.block.join("|")));
    }

    vars
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    #[test]
    fn nested_policy_cannot_loosen_outer_constraints() {
        let mut inner: Config = toml::from_str(
            "[network]\nblock = [\"inner.example\"]\nallow = [\"api.safe.example\", \"inner-only.example\"]\n\n[files]\nallow_write = [\"/shared/subdir\", \"/inner-only\"]\n\n[adversary]\nrules = \"ALLOW everything\"\n",
        )
        .unwrap();
        let outer: Config = toml::from_str(
            "[network]\nblock = [\"outer.example\"]\nallow = [\"safe.example\", \"outer-only.example\"]\n\n[files]\nallow_write = [\"/shared\", \"/outer-only\"]\nblock_write = [\"/protected\"]\n\n[adversary]\nrules = \"BLOCK unsafe\"\n",
        )
        .unwrap();

        inner.inherit_outer_policy(&outer);

        assert!(inner.network.block.contains(&"inner.example".to_string()));
        assert!(inner.network.block.contains(&"outer.example".to_string()));
        assert_eq!(inner.network.allow, vec!["api.safe.example".to_string()]);
        assert_eq!(inner.files.allow_write, vec!["/shared/subdir".to_string()]);
        assert_eq!(inner.files.block_write, vec!["/protected".to_string()]);
        assert_eq!(inner.adversary_rules(), "BLOCK unsafe");
    }

    #[test]
    fn write_policy_requires_path_component_containment() {
        let mut config = Config::default();
        config.files.allow_write.push("/tmp/repo".into());

        assert!(config.allows_write_to(Path::new("/tmp/repo/file")));
        assert!(!config.allows_write_to(Path::new("/tmp/repository/file")));
    }

    #[test]
    fn disjoint_network_grants_remain_deny_all() {
        let mut inner = Config::default();
        inner.network.allow.push("one.example".into());
        let mut outer = Config::default();
        outer.network.allow.push("two.example".into());
        inner.inherit_outer_policy(&outer);
        assert!(inner.network.deny_all);
        assert!(inner.has_network_rules());
        assert!(inner.network.allow.is_empty());
    }

    #[test]
    fn resolved_denies_preserve_aliases_without_expanding_allow_rules() {
        let temp = tempfile::tempdir().unwrap();
        let actual = fs::canonicalize(temp.path()).unwrap();
        let alias = actual.join("alias");
        std::os::unix::fs::symlink(&actual, &alias).unwrap();
        let lexical = alias.join("future/secret").to_string_lossy().into_owned();
        let resolved = actual.join("future/secret").to_string_lossy().into_owned();
        let mut cfg = Config::default();
        cfg.files
            .allow_write
            .push(alias.to_string_lossy().into_owned());
        cfg.files.block_write.push(lexical.clone());
        cfg.files.block_read.push(lexical.clone());

        cfg.resolve_file_rules();
        assert_eq!(cfg.files.allow_write, vec![actual.to_string_lossy()]);
        assert_eq!(
            cfg.files.block_write,
            vec![lexical.clone(), resolved.clone()]
        );
        assert_eq!(cfg.files.block_read, vec![lexical, resolved]);

        // Session snapshots must carry both variants into nested runs.
        let snapshot = toml::to_string(&cfg).unwrap();
        let mut restored: Config = toml::from_str(&snapshot).unwrap();
        restored.resolve_file_rules();
        assert_eq!(restored.files.block_write, cfg.files.block_write);
        assert_eq!(restored.files.block_read, cfg.files.block_read);
        assert_eq!(restored.files.allow_write, cfg.files.allow_write);
    }

    #[test]
    fn runtime_paths_resolve_symlinked_roots_before_appending_missing_state() {
        let temp = tempfile::tempdir().unwrap();
        let actual = temp.path().join("actual");
        let alias = temp.path().join("home/.sandpit");
        fs::create_dir_all(&actual).unwrap();
        fs::create_dir_all(alias.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&actual, &alias).unwrap();
        let root = resolve_policy_path(&alias);
        assert_eq!(root, fs::canonicalize(actual).unwrap());
        for suffix in ["adversary.lock", "session-state/nested-sessions/run-test"] {
            assert_eq!(resolve_policy_path(&alias.join(suffix)), root.join(suffix));
        }
    }

    #[test]
    fn session_roots_are_compared_canonically() {
        let temp = tempfile::tempdir().unwrap();
        let configured = temp.path().join("configured/sessions");
        let actual = temp.path().join("actual/sessions");
        fs::create_dir_all(&actual).unwrap();
        fs::create_dir_all(configured.parent().unwrap()).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&actual, &configured).unwrap();
        #[cfg(not(unix))]
        fs::create_dir_all(&configured).unwrap();

        #[cfg(unix)]
        assert!(is_session_root(&actual, &configured));
        #[cfg(not(unix))]
        assert!(is_session_root(&configured, &configured));
        assert!(!is_session_root(
            &temp.path().join("untrusted/sessions"),
            &configured
        ));
    }

    #[test]
    fn add_preserves_inline_file_rules() {
        let content = r#"files = { block_write = ["/secret"], block_read = ["/private"] }"#;
        let paths = vec!["/work/shared".to_string()];

        let (updated, added) = add_allow_write_paths_to_document(content, &paths).unwrap();
        let config: Config = toml::from_str(&updated).unwrap();

        assert_eq!(added, paths);
        assert_eq!(config.files.block_write, ["/secret"]);
        assert_eq!(config.files.block_read, ["/private"]);
        assert_eq!(config.files.allow_write, ["/work/shared"]);
        assert!(updated.contains("files = {"));
    }

    #[test]
    fn config_writes_are_published_atomically() {
        let temp = tempfile::tempdir().unwrap();
        let config_path = temp.path().join("config.toml");
        std::fs::write(&config_path, "old = true\n").unwrap();

        write_config_atomically(&config_path, "new = true\n").unwrap();

        assert_eq!(
            std::fs::read_to_string(&config_path).unwrap(),
            "new = true\n"
        );
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_config_write_preserves_symlinked_target() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("managed-config.toml");
        let link = temp.path().join("config.toml");
        std::fs::write(&target, "old = true\n").unwrap();
        symlink(&target, &link).unwrap();

        write_config_atomically(&link, "new = true\n").unwrap();

        assert!(
            std::fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(std::fs::read_to_string(target).unwrap(), "new = true\n");
    }

    #[test]
    fn remove_supports_inline_file_rules() {
        let content = r#"files = { block_write = ["/secret"], allow_write = ["/one", "/two"] }"#;
        let paths = vec!["/one".to_string()];

        let (updated, removed) =
            remove_allow_write_paths_from_document(content, &paths, &paths).unwrap();
        let config: Config = toml::from_str(&updated).unwrap();

        assert_eq!(removed, paths);
        assert_eq!(config.files.block_write, ["/secret"]);
        assert_eq!(config.files.allow_write, ["/two"]);
    }

    #[test]
    fn remove_matches_raw_legacy_and_normalized_entries() {
        let content = r#"[files]
allow_write = ["./", "/work/project"]
"#;
        let raw = vec!["./".to_string()];
        let normalized = vec!["/work/project".to_string()];

        let (updated, removed) =
            remove_allow_write_paths_from_document(content, &raw, &normalized).unwrap();
        let config: Config = toml::from_str(&updated).unwrap();

        assert_eq!(removed, raw);
        assert!(config.files.allow_write.is_empty());
    }

    #[test]
    fn add_deduplicates_repeated_arguments() {
        let paths = vec!["/shared".to_string(), "/shared".to_string()];
        let (updated, added) = add_allow_write_paths_to_document("", &paths).unwrap();
        let config: Config = toml::from_str(&updated).unwrap();

        assert_eq!(added, ["/shared"]);
        assert_eq!(config.files.allow_write, ["/shared"]);
    }

    #[test]
    fn normalize_relative_allow_write_paths_against_current_directory() {
        let cwd = Path::new("/work/project");
        let home = Path::new("/Users/alex");

        assert_eq!(
            normalize_allow_write_path("repo", cwd, home).unwrap(),
            "/work/project/repo"
        );
        assert_eq!(
            normalize_allow_write_path("../shared", cwd, home).unwrap(),
            "/work/shared"
        );
        assert_eq!(
            normalize_allow_write_path("~/src", cwd, home).unwrap(),
            "/Users/alex/src"
        );
    }

    #[cfg(unix)]
    #[test]
    fn normalize_resolves_symlinked_ancestor_of_missing_path() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let real = temp.path().join("real");
        let link = temp.path().join("link");
        std::fs::create_dir(&real).unwrap();
        symlink(&real, &link).unwrap();

        let normalized = normalize_allow_write_path(
            &link.join("new").to_string_lossy(),
            temp.path(),
            temp.path(),
        )
        .unwrap();

        assert_eq!(
            normalized,
            fs::canonicalize(real).unwrap().join("new").to_string_lossy()
        );
    }

    #[cfg(unix)]
    #[test]
    fn normalize_applies_parent_after_resolving_symlink() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let real = temp.path().join("real");
        let child = real.join("child");
        let repo = real.join("repo");
        let link = temp.path().join("link");
        std::fs::create_dir_all(&child).unwrap();
        std::fs::create_dir(&repo).unwrap();
        symlink(&child, &link).unwrap();

        let path = link.join("..").join("repo");
        let normalized =
            normalize_allow_write_path(&path.to_string_lossy(), temp.path(), temp.path()).unwrap();

        assert_eq!(
            normalized,
            std::fs::canonicalize(repo).unwrap().to_string_lossy()
        );
    }

    #[test]
    fn pipe_delimiter_is_rejected_before_add_mutates_config() {
        let paths = vec!["/tmp/foo|/".to_string()];
        let error = validate_allow_write_paths_for_add(&paths).unwrap_err();

        assert!(error.to_string().contains("cannot contain '|'"));
    }

    #[test]
    fn audit_path_is_absolute_even_when_configured_relative() {
        let mut config = Config::default();
        config.logs.audit_path = Some("connections.jsonl".into());

        assert_eq!(
            config.audit_log_path(),
            std::env::current_dir().unwrap().join("connections.jsonl")
        );
    }

    #[test]
    fn audit_protection_preserves_alias_and_resolves_its_target() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("target.jsonl");
        let alias = root.path().join("alias.jsonl");
        std::fs::write(&target, "").unwrap();
        std::os::unix::fs::symlink(&target, &alias).unwrap();
        let mut config = Config::default();
        config.logs.audit_path = Some(alias.to_string_lossy().into());

        assert_eq!(
            config.audit_log_protection_paths(),
            vec![alias, std::fs::canonicalize(target).unwrap()]
        );
    }
}
