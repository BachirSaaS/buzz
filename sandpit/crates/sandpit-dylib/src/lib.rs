//! sandpit: DYLD_INSERT_LIBRARIES dylib for macOS.
//!
//! Three enforcement layers, all deterministic, all universal:
//!
//! Layer 1 — Network fence (connect hook):
//!   Intercepts outbound TCP connect() calls and redirects non-localhost
//!   connections through a local transparent proxy. The proxy can allow/block
//!   by domain. Controlled by:
//!     SANDPIT_PROXY_PORT — proxy port (0 or unset = disabled)
//!
//! Layer 2 — Exec gate (posix_spawn/execve hooks):
//!   Intercepts process spawning to block commands matching exfiltration or
//!   destruction patterns. Deterministic substring matching, no LLM.
//!   Controlled by:
//!     SANDPIT_EXEC_RULES_INLINE — newline-separated rules (from config.toml)
//!     SANDPIT_NET_BLOCK — pipe-separated domains (block exec referencing them)
//!
//! Layer 3 — File fence (open/unlink/rename/link/truncate hooks):
//!   Intercepts file operations to enforce path-based allow/deny policies.
//!   Controlled by:
//!     SANDPIT_FILE_ALLOW_WRITE — pipe-separated allowed write prefixes
//!     SANDPIT_FILE_BLOCK_WRITE — pipe-separated blocked write prefixes
//!     SANDPIT_FILE_BLOCK_READ  — pipe-separated blocked read prefixes

#![allow(unsafe_op_in_unsafe_fn)]

use libc::{
    AF_INET, SOCK_STREAM, c_char, c_int, c_uint, c_void, pid_t, size_t, sockaddr, sockaddr_in,
    socklen_t, ssize_t,
};
use std::collections::{HashMap, HashSet};
use std::ffi::{CStr, CString, OsString};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Mutex, OnceLock};

// ============================================================================
// Interpose table — pure Rust
//
// The __DATA,__interpose section tells dyld to replace libc functions with
// ours. Each entry is {replacement, original}. At load time, dyld resolves
// the "original" field to the real libc function pointer.
// ============================================================================

// libc functions we interpose (declared so Rust can reference them)
unsafe extern "C" {
    fn connect(fd: c_int, addr: *const sockaddr, len: socklen_t) -> c_int;
    fn posix_spawn(
        pid: *mut pid_t,
        path: *const c_char,
        file_actions: *const c_void,
        attrp: *const c_void,
        argv: *const *mut c_char,
        envp: *const *mut c_char,
    ) -> c_int;
    fn posix_spawnp(
        pid: *mut pid_t,
        file: *const c_char,
        file_actions: *const c_void,
        attrp: *const c_void,
        argv: *const *mut c_char,
        envp: *const *mut c_char,
    ) -> c_int;
    fn execve(path: *const c_char, argv: *const *const c_char, envp: *const *const c_char)
    -> c_int;
    fn unlink(path: *const c_char) -> c_int;
    fn unlinkat(fd: c_int, path: *const c_char, flag: c_int) -> c_int;
    fn rename(old: *const c_char, new: *const c_char) -> c_int;
    fn renameat(oldfd: c_int, old: *const c_char, newfd: c_int, new: *const c_char) -> c_int;
    fn renamex_np(old: *const c_char, new: *const c_char, flags: c_uint) -> c_int;
    fn renameatx_np(
        oldfd: c_int,
        old: *const c_char,
        newfd: c_int,
        new: *const c_char,
        flags: c_uint,
    ) -> c_int;
    fn link(old: *const c_char, new: *const c_char) -> c_int;
    fn linkat(
        oldfd: c_int,
        old: *const c_char,
        newfd: c_int,
        new: *const c_char,
        flag: c_int,
    ) -> c_int;
    fn truncate(path: *const c_char, length: libc::off_t) -> c_int;
    fn ftruncate(fd: c_int, length: libc::off_t) -> c_int;
    fn getaddrinfo(
        node: *const c_char,
        service: *const c_char,
        hints: *const libc::addrinfo,
        res: *mut *mut libc::addrinfo,
    ) -> c_int;
    fn gethostbyname(name: *const c_char) -> *mut libc::hostent;
    fn gethostbyname2(name: *const c_char, af: c_int) -> *mut libc::hostent;
    fn recvfrom(
        socket: c_int,
        buf: *mut c_void,
        len: size_t,
        flags: c_int,
        addr: *mut sockaddr,
        addrlen: *mut socklen_t,
    ) -> ssize_t;
    #[link_name = "recvfrom$NOCANCEL"]
    fn recvfrom_nocancel(
        socket: c_int,
        buf: *mut c_void,
        len: size_t,
        flags: c_int,
        addr: *mut sockaddr,
        addrlen: *mut socklen_t,
    ) -> ssize_t;
    fn recvmsg(socket: c_int, msg: *mut libc::msghdr, flags: c_int) -> ssize_t;
}

// C variadic wrappers for open/openat (ARM64 ABI — see interpose.c)
unsafe extern "C" {
    fn sandpit_open(); // actual signature is variadic, but we only need the address
    fn sandpit_openat();
}
// open/openat from libc (declared with dummy signatures — only used as addresses)
unsafe extern "C" {
    #[link_name = "open"]
    fn libc_open();
    #[link_name = "openat"]
    fn libc_openat();
}

#[repr(C)]
struct InterposePair {
    replacement: unsafe extern "C" fn(),
    original: unsafe extern "C" fn(),
}
unsafe impl Sync for InterposePair {}

/// Transmute a typed function pointer to the generic `unsafe extern "C" fn()`
/// used in the interpose table. All entries are just address pairs — dyld
/// doesn't care about the signature.
macro_rules! fn_addr {
    ($f:expr) => {
        unsafe { core::mem::transmute::<_, unsafe extern "C" fn()>($f) }
    };
}

#[unsafe(link_section = "__DATA,__interpose")]
#[used]
static INTERPOSE_TABLE: [InterposePair; 22] = [
    InterposePair {
        replacement: fn_addr!(
            sandpit_connect as unsafe extern "C" fn(c_int, *const sockaddr, socklen_t) -> c_int
        ),
        original: fn_addr!(
            connect as unsafe extern "C" fn(c_int, *const sockaddr, socklen_t) -> c_int
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_posix_spawn
                as unsafe extern "C" fn(
                    *mut pid_t,
                    *const c_char,
                    *const c_void,
                    *const c_void,
                    *const *mut c_char,
                    *const *mut c_char,
                ) -> c_int
        ),
        original: fn_addr!(
            posix_spawn
                as unsafe extern "C" fn(
                    *mut pid_t,
                    *const c_char,
                    *const c_void,
                    *const c_void,
                    *const *mut c_char,
                    *const *mut c_char,
                ) -> c_int
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_posix_spawnp
                as unsafe extern "C" fn(
                    *mut pid_t,
                    *const c_char,
                    *const c_void,
                    *const c_void,
                    *const *mut c_char,
                    *const *mut c_char,
                ) -> c_int
        ),
        original: fn_addr!(
            posix_spawnp
                as unsafe extern "C" fn(
                    *mut pid_t,
                    *const c_char,
                    *const c_void,
                    *const c_void,
                    *const *mut c_char,
                    *const *mut c_char,
                ) -> c_int
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_execve
                as unsafe extern "C" fn(
                    *const c_char,
                    *const *const c_char,
                    *const *const c_char,
                ) -> c_int
        ),
        original: fn_addr!(
            execve
                as unsafe extern "C" fn(
                    *const c_char,
                    *const *const c_char,
                    *const *const c_char,
                ) -> c_int
        ),
    },
    InterposePair {
        replacement: fn_addr!(sandpit_open as unsafe extern "C" fn()),
        original: fn_addr!(libc_open as unsafe extern "C" fn()),
    },
    InterposePair {
        replacement: fn_addr!(sandpit_openat as unsafe extern "C" fn()),
        original: fn_addr!(libc_openat as unsafe extern "C" fn()),
    },
    InterposePair {
        replacement: fn_addr!(sandpit_unlink as unsafe extern "C" fn(*const c_char) -> c_int),
        original: fn_addr!(unlink as unsafe extern "C" fn(*const c_char) -> c_int),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_unlinkat as unsafe extern "C" fn(c_int, *const c_char, c_int) -> c_int
        ),
        original: fn_addr!(unlinkat as unsafe extern "C" fn(c_int, *const c_char, c_int) -> c_int),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_rename as unsafe extern "C" fn(*const c_char, *const c_char) -> c_int
        ),
        original: fn_addr!(rename as unsafe extern "C" fn(*const c_char, *const c_char) -> c_int),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_renameat
                as unsafe extern "C" fn(c_int, *const c_char, c_int, *const c_char) -> c_int
        ),
        original: fn_addr!(
            renameat as unsafe extern "C" fn(c_int, *const c_char, c_int, *const c_char) -> c_int
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_getaddrinfo
                as unsafe extern "C" fn(
                    *const c_char,
                    *const c_char,
                    *const libc::addrinfo,
                    *mut *mut libc::addrinfo,
                ) -> c_int
        ),
        original: fn_addr!(
            getaddrinfo
                as unsafe extern "C" fn(
                    *const c_char,
                    *const c_char,
                    *const libc::addrinfo,
                    *mut *mut libc::addrinfo,
                ) -> c_int
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_gethostbyname as unsafe extern "C" fn(*const c_char) -> *mut libc::hostent
        ),
        original: fn_addr!(
            gethostbyname as unsafe extern "C" fn(*const c_char) -> *mut libc::hostent
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_gethostbyname2
                as unsafe extern "C" fn(*const c_char, c_int) -> *mut libc::hostent
        ),
        original: fn_addr!(
            gethostbyname2 as unsafe extern "C" fn(*const c_char, c_int) -> *mut libc::hostent
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_recvfrom
                as unsafe extern "C" fn(
                    c_int,
                    *mut c_void,
                    size_t,
                    c_int,
                    *mut sockaddr,
                    *mut socklen_t,
                ) -> ssize_t
        ),
        original: fn_addr!(
            recvfrom
                as unsafe extern "C" fn(
                    c_int,
                    *mut c_void,
                    size_t,
                    c_int,
                    *mut sockaddr,
                    *mut socklen_t,
                ) -> ssize_t
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_recvfrom_nocancel
                as unsafe extern "C" fn(
                    c_int,
                    *mut c_void,
                    size_t,
                    c_int,
                    *mut sockaddr,
                    *mut socklen_t,
                ) -> ssize_t
        ),
        original: fn_addr!(
            recvfrom_nocancel
                as unsafe extern "C" fn(
                    c_int,
                    *mut c_void,
                    size_t,
                    c_int,
                    *mut sockaddr,
                    *mut socklen_t,
                ) -> ssize_t
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_recvmsg as unsafe extern "C" fn(c_int, *mut libc::msghdr, c_int) -> ssize_t
        ),
        original: fn_addr!(
            recvmsg as unsafe extern "C" fn(c_int, *mut libc::msghdr, c_int) -> ssize_t
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_link as unsafe extern "C" fn(*const c_char, *const c_char) -> c_int
        ),
        original: fn_addr!(link as unsafe extern "C" fn(*const c_char, *const c_char) -> c_int),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_linkat
                as unsafe extern "C" fn(c_int, *const c_char, c_int, *const c_char, c_int) -> c_int
        ),
        original: fn_addr!(
            linkat
                as unsafe extern "C" fn(c_int, *const c_char, c_int, *const c_char, c_int) -> c_int
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_truncate as unsafe extern "C" fn(*const c_char, libc::off_t) -> c_int
        ),
        original: fn_addr!(truncate as unsafe extern "C" fn(*const c_char, libc::off_t) -> c_int),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_ftruncate as unsafe extern "C" fn(c_int, libc::off_t) -> c_int
        ),
        original: fn_addr!(ftruncate as unsafe extern "C" fn(c_int, libc::off_t) -> c_int),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_renamex_np
                as unsafe extern "C" fn(*const c_char, *const c_char, c_uint) -> c_int
        ),
        original: fn_addr!(
            renamex_np as unsafe extern "C" fn(*const c_char, *const c_char, c_uint) -> c_int
        ),
    },
    InterposePair {
        replacement: fn_addr!(
            sandpit_renameatx_np
                as unsafe extern "C" fn(
                    c_int,
                    *const c_char,
                    c_int,
                    *const c_char,
                    c_uint,
                ) -> c_int
        ),
        original: fn_addr!(
            renameatx_np
                as unsafe extern "C" fn(
                    c_int,
                    *const c_char,
                    c_int,
                    *const c_char,
                    c_uint,
                ) -> c_int
        ),
    },
];

// ============================================================================
// Original libc function pointers — read from the interpose table
//
// After dyld resolves the interpose table at load time, the "original" field
// of each entry contains the real libc function pointer. We read them via
// a safe accessor.
// ============================================================================

type ConnectFn = unsafe extern "C" fn(c_int, *const sockaddr, socklen_t) -> c_int;
type PosixSpawnFn = unsafe extern "C" fn(
    *mut pid_t,
    *const c_char,
    *const c_void,
    *const c_void,
    *const *mut c_char,
    *const *mut c_char,
) -> c_int;
type ExecveFn =
    unsafe extern "C" fn(*const c_char, *const *const c_char, *const *const c_char) -> c_int;
type UnlinkFn = unsafe extern "C" fn(*const c_char) -> c_int;
type UnlinkatFn = unsafe extern "C" fn(c_int, *const c_char, c_int) -> c_int;
type RenameFn = unsafe extern "C" fn(*const c_char, *const c_char) -> c_int;
type RenameatFn = unsafe extern "C" fn(c_int, *const c_char, c_int, *const c_char) -> c_int;
type RenamexNpFn = unsafe extern "C" fn(*const c_char, *const c_char, c_uint) -> c_int;
type RenameatxNpFn =
    unsafe extern "C" fn(c_int, *const c_char, c_int, *const c_char, c_uint) -> c_int;
type GetaddrinfoFn = unsafe extern "C" fn(
    *const c_char,
    *const c_char,
    *const libc::addrinfo,
    *mut *mut libc::addrinfo,
) -> c_int;
type GethostbynameFn = unsafe extern "C" fn(*const c_char) -> *mut libc::hostent;
type Gethostbyname2Fn = unsafe extern "C" fn(*const c_char, c_int) -> *mut libc::hostent;
type RecvfromFn = unsafe extern "C" fn(
    c_int,
    *mut c_void,
    size_t,
    c_int,
    *mut sockaddr,
    *mut socklen_t,
) -> ssize_t;
type RecvmsgFn = unsafe extern "C" fn(c_int, *mut libc::msghdr, c_int) -> ssize_t;
type LinkFn = unsafe extern "C" fn(*const c_char, *const c_char) -> c_int;
type LinkatFn = unsafe extern "C" fn(c_int, *const c_char, c_int, *const c_char, c_int) -> c_int;
type TruncateFn = unsafe extern "C" fn(*const c_char, libc::off_t) -> c_int;
type FtruncateFn = unsafe extern "C" fn(c_int, libc::off_t) -> c_int;

/// Read the original function pointer from the interpose table at the given index.
unsafe fn orig<T>(index: usize) -> Option<T> {
    let addr = INTERPOSE_TABLE[index].original;
    let ptr = addr as *const ();
    if ptr.is_null() {
        None
    } else {
        Some(core::mem::transmute_copy(&addr))
    }
}

unsafe fn real_connect() -> Option<ConnectFn> {
    orig(0)
}
unsafe fn real_posix_spawn() -> Option<PosixSpawnFn> {
    orig(1)
}
unsafe fn real_posix_spawnp() -> Option<PosixSpawnFn> {
    orig(2)
}
unsafe fn real_execve() -> Option<ExecveFn> {
    orig(3)
}
// indices 4,5 = open/openat — called from C, not Rust
unsafe fn real_unlink() -> Option<UnlinkFn> {
    orig(6)
}
unsafe fn real_unlinkat() -> Option<UnlinkatFn> {
    orig(7)
}
unsafe fn real_rename() -> Option<RenameFn> {
    orig(8)
}
unsafe fn real_renameat() -> Option<RenameatFn> {
    orig(9)
}
unsafe fn real_getaddrinfo() -> Option<GetaddrinfoFn> {
    orig(10)
}
unsafe fn real_gethostbyname() -> Option<GethostbynameFn> {
    orig(11)
}
unsafe fn real_gethostbyname2() -> Option<Gethostbyname2Fn> {
    orig(12)
}
unsafe fn real_recvfrom() -> Option<RecvfromFn> {
    orig(13)
}
unsafe fn real_recvfrom_nocancel() -> Option<RecvfromFn> {
    orig(14)
}
unsafe fn real_recvmsg() -> Option<RecvmsgFn> {
    orig(15)
}
unsafe fn real_link() -> Option<LinkFn> {
    orig(16)
}
unsafe fn real_linkat() -> Option<LinkatFn> {
    orig(17)
}
unsafe fn real_truncate() -> Option<TruncateFn> {
    orig(18)
}
unsafe fn real_ftruncate() -> Option<FtruncateFn> {
    orig(19)
}
unsafe fn real_renamex_np() -> Option<RenamexNpFn> {
    orig(20)
}
unsafe fn real_renameatx_np() -> Option<RenameatxNpFn> {
    orig(21)
}

// Original open/openat pointers — exported for the C variadic wrappers.
// The C code reads these to call the real functions with variadic ABI.
#[unsafe(no_mangle)]
pub static mut sandpit_real_open: *const c_void = std::ptr::null();
#[unsafe(no_mangle)]
pub static mut sandpit_real_openat: *const c_void = std::ptr::null();

/// Constructor: copy the original open/openat pointers from the interpose
/// table so the C variadic wrappers can call them, and snapshot env vars
/// before any process can modify them.
#[unsafe(no_mangle)]
extern "C" fn sandpit_init() {
    unsafe {
        sandpit_real_open = INTERPOSE_TABLE[4].original as *const c_void;
        sandpit_real_openat = INTERPOSE_TABLE[5].original as *const c_void;
    }
    init_logging();

    // Freeze file-policy paths before untrusted process code can retarget an
    // allowlisted symlink. Keep both lexical and resolved variants so aliases
    // such as /tmp -> /private/tmp retain their intended policy semantics.
    let _ = file_allow_write();
    let _ = file_block_write();
    let _ = file_block_read();

    // Capture sandpit env vars at load time — before any process can clear
    // them. File policies are captured from the frozen caches, rather than the
    // raw environment, so descendants do not re-resolve retargeted symlinks.
    SAVED_ENV_VARS.get_or_init(|| {
        SANDPIT_ENV_NAMES
            .iter()
            .filter_map(|name| saved_env_value(name).map(|value| (name.to_string(), value)))
            .collect()
    });
}

// Use a .mod_init_func entry to run sandpit_init before main.
#[unsafe(link_section = "__DATA,__mod_init_func")]
#[used]
static INIT_FN: extern "C" fn() = sandpit_init;

// ============================================================================
// Shared state
// ============================================================================

static PROXY_PORT: AtomicU16 = AtomicU16::new(0);
static TRUSTED_SESSION_PATHS: OnceLock<(std::path::PathBuf, std::path::PathBuf)> = OnceLock::new();
static EXEC_RULES: OnceLock<Vec<String>> = OnceLock::new();
static FILE_ALLOW_WRITE: OnceLock<Vec<PathBuf>> = OnceLock::new();
static FILE_BLOCK_WRITE: OnceLock<Vec<PathBuf>> = OnceLock::new();
static FILE_BLOCK_READ: OnceLock<Vec<PathBuf>> = OnceLock::new();
static FILE_POLICY_INVALID: AtomicBool = AtomicBool::new(false);
static NET_BLOCK: OnceLock<Vec<String>> = OnceLock::new();

/// Env vars captured at dylib load time. Re-injected into child envp in exec
/// hooks to prevent agents from spawning unhooked children via env stripping.
static SAVED_ENV_VARS: OnceLock<Vec<(String, String)>> = OnceLock::new();

/// Env var names that must be preserved across exec boundaries.
const SANDPIT_ENV_NAMES: &[&str] = &[
    "DYLD_INSERT_LIBRARIES",
    "SANDPIT_PROXY_PORT",
    "SANDPIT_EXEC_RULES_INLINE",
    "SANDPIT_FILE_ALLOW_WRITE",
    "SANDPIT_FILE_BLOCK_WRITE",
    "SANDPIT_FILE_BLOCK_READ",
    "SANDPIT_FILE_POLICY_FROZEN",
    "SANDPIT_NET_BLOCK",
    "SANDPIT_LOG_FILE",
    "SANDPIT_CONFIG",
    "SANDPIT_ADVERSARY_RULES",
    "SANDPIT_ADVERSARY_DISABLED",
    "SANDPIT_SESSION_ROOT",
    "SANDPIT_MUTABLE_SESSION_DIR",
    "SANDPIT_LAUNCHER_EXE",
    "SANDPIT_AGENT_TYPE",
    "SANDPIT_SESSION_ID",
    "CLAUDE_CONFIG_DIR",
    "AMP_SETTINGS_FILE",
    "GOOSE_PATH_ROOT",
];

/// DNS cache: maps IPv4 address → domain name that resolved to it.
/// Populated by getaddrinfo/gethostbyname/res_query/res_search hooks, read by connect hook.
/// Max 4096 entries to bound memory; evicts oldest on overflow.
static DNS_CACHE: OnceLock<Mutex<HashMap<u32, String>>> = OnceLock::new();

fn dns_cache() -> &'static Mutex<HashMap<u32, String>> {
    DNS_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn dns_cache_insert(ip: u32, domain: String) {
    if let Ok(mut cache) = dns_cache().lock() {
        if cache.len() >= 4096 {
            let keys: Vec<u32> = cache.keys().take(2048).copied().collect();
            for k in keys {
                cache.remove(&k);
            }
        }
        cache.insert(ip, domain);
    }
}

fn dns_cache_lookup(ip: u32) -> Option<String> {
    dns_cache().lock().ok()?.get(&ip).cloned()
}

thread_local! {
    static IN_HOOK: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

// ============================================================================
// Logging — uses the `log` crate with a tiny file-based backend.
// SANDPIT_LOG_FILE env var → append to file. Unset → stderr fallback.
// ============================================================================

use std::io::Write;

struct FileLogger {
    path: Option<String>,
}

impl log::Log for FileLogger {
    fn enabled(&self, _metadata: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        if let Some(ref path) = self.path {
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
            {
                let _ = writeln!(f, "[sandpit-dylib] {} {}", record.level(), record.args());
                return;
            }
        }
        eprintln!("[sandpit-dylib] {} {}", record.level(), record.args());
    }

    fn flush(&self) {}
}

static LOGGER: OnceLock<FileLogger> = OnceLock::new();

fn init_logging() {
    let logger = LOGGER.get_or_init(|| FileLogger {
        path: std::env::var("SANDPIT_LOG_FILE").ok(),
    });
    // Ignore error — may already be set if dylib is loaded twice
    let _ = log::set_logger(logger);
    log::set_max_level(log::LevelFilter::Info);
}

// ============================================================================
// Config loading (lazy, from env vars)
// ============================================================================

fn proxy_port() -> u16 {
    let cached = PROXY_PORT.load(Ordering::Relaxed);
    if cached != 0 {
        return cached;
    }
    let port = std::env::var("SANDPIT_PROXY_PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);
    if port != 0 {
        PROXY_PORT.store(port, Ordering::Relaxed);
    }
    port
}

fn exec_rules() -> &'static Vec<String> {
    EXEC_RULES.get_or_init(|| match std::env::var("SANDPIT_EXEC_RULES_INLINE") {
        Ok(inline) if !inline.is_empty() => inline
            .lines()
            .map(|l| l.trim().to_lowercase())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .collect(),
        _ => Vec::new(),
    })
}

fn load_pipe_list(var: &str) -> Vec<String> {
    std::env::var(var)
        .ok()
        .map(|v| {
            v.split('|')
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn load_file_prefixes(var: &str) -> Vec<PathBuf> {
    match std::env::var("SANDPIT_FILE_POLICY_FROZEN") {
        Ok(marker) if marker == "2" => match deserialize_file_prefixes(var) {
            Ok(prefixes) => prefixes,
            Err(()) => {
                log::warn!("invalid encoded file policy in {var}; denying file operations");
                FILE_POLICY_INVALID.store(true, Ordering::Relaxed);
                Vec::new()
            }
        },
        Ok(marker) if marker == "0" => load_initial_file_prefixes(var),
        Err(std::env::VarError::NotPresent) => load_initial_file_prefixes(var),
        _ => {
            log::warn!("invalid file-policy encoding marker; denying file operations");
            FILE_POLICY_INVALID.store(true, Ordering::Relaxed);
            Vec::new()
        }
    }
}

fn load_initial_file_prefixes(var: &str) -> Vec<PathBuf> {
    let mut prefixes = Vec::new();
    let value = match std::env::var(var) {
        Ok(value) => value,
        Err(std::env::VarError::NotPresent) => return prefixes,
        Err(std::env::VarError::NotUnicode(_)) => {
            log::warn!("non-UTF-8 configured file policy in {var}; denying file operations");
            FILE_POLICY_INVALID.store(true, Ordering::Relaxed);
            return prefixes;
        }
    };
    for raw in value.split('|').filter(|raw| !raw.is_empty()) {
        match file_prefix_variants(Path::new(raw)) {
            Ok(variants) => prefixes.extend(variants),
            Err(()) => {
                log::warn!(
                    "could not resolve configured file policy in {var}; denying file operations"
                );
                FILE_POLICY_INVALID.store(true, Ordering::Relaxed);
            }
        }
    }
    prefixes
}

fn file_prefix_variants(path: &Path) -> Result<Vec<PathBuf>, ()> {
    let absolute = absolute_path(path).ok_or(())?;
    let lexical = normalize_path(&absolute);
    // Resolve from the captured absolute path so a relative rule cannot use a
    // different cwd if the directory changes between these two variants.
    let resolved = resolve_policy_prefix(&absolute).ok_or(())?;
    Ok(vec![lexical, resolved])
}

/// Resolve the existing portion of a configured prefix, preserving any
/// missing tail. This freezes platform aliases such as /tmp -> /private/tmp
/// even when the configured destination has not been created yet.
fn resolve_policy_prefix(path: &Path) -> Option<PathBuf> {
    let mut ancestor = path;
    loop {
        if let Ok(resolved_ancestor) = std::fs::canonicalize(ancestor) {
            let suffix = path.strip_prefix(ancestor).ok()?;
            return Some(normalize_path(&resolved_ancestor.join(suffix)));
        }
        ancestor = ancestor.parent()?;
    }
}

fn file_allow_write() -> &'static Vec<PathBuf> {
    FILE_ALLOW_WRITE.get_or_init(|| load_file_prefixes("SANDPIT_FILE_ALLOW_WRITE"))
}

fn file_block_write() -> &'static Vec<PathBuf> {
    FILE_BLOCK_WRITE.get_or_init(|| load_file_prefixes("SANDPIT_FILE_BLOCK_WRITE"))
}

fn file_block_read() -> &'static Vec<PathBuf> {
    FILE_BLOCK_READ.get_or_init(|| load_file_prefixes("SANDPIT_FILE_BLOCK_READ"))
}

fn serialize_file_prefixes(prefixes: &[PathBuf]) -> String {
    prefixes
        .iter()
        .map(|path| encode_hex(path.as_os_str().as_bytes()))
        .collect::<Vec<_>>()
        .join("|")
}

fn deserialize_file_prefixes(var: &str) -> Result<Vec<PathBuf>, ()> {
    let Some(value) = std::env::var_os(var) else {
        return Ok(Vec::new());
    };
    let value = value.into_string().map_err(|_| ())?;
    deserialize_file_prefix_value(&value)
}

fn deserialize_file_prefix_value(value: &str) -> Result<Vec<PathBuf>, ()> {
    if value.is_empty() {
        return Ok(Vec::new());
    }
    value
        .split('|')
        .map(|encoded| {
            let bytes = decode_hex(encoded)?;
            let path = PathBuf::from(OsString::from_vec(bytes));
            if !path.is_absolute() {
                return Err(());
            }
            Ok(normalize_path(&path))
        })
        .collect()
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn decode_hex(encoded: &str) -> Result<Vec<u8>, ()> {
    fn nibble(byte: u8) -> Result<u8, ()> {
        match byte {
            b'0'..=b'9' => Ok(byte - b'0'),
            b'a'..=b'f' => Ok(byte - b'a' + 10),
            b'A'..=b'F' => Ok(byte - b'A' + 10),
            _ => Err(()),
        }
    }

    let bytes = encoded.as_bytes();
    if bytes.len() % 2 != 0 {
        return Err(());
    }
    bytes
        .chunks_exact(2)
        .map(|pair| Ok((nibble(pair[0])? << 4) | nibble(pair[1])?))
        .collect()
}

fn saved_env_value(name: &str) -> Option<String> {
    match name {
        "SANDPIT_FILE_ALLOW_WRITE" => Some(serialize_file_prefixes(file_allow_write())),
        "SANDPIT_FILE_BLOCK_WRITE" => Some(serialize_file_prefixes(file_block_write())),
        "SANDPIT_FILE_BLOCK_READ" => Some(serialize_file_prefixes(file_block_read())),
        // Version 2 hex-encodes the raw path bytes, preserving non-UTF-8
        // canonical targets across exec while remaining safe for envp.
        "SANDPIT_FILE_POLICY_FROZEN" => Some(
            if FILE_POLICY_INVALID.load(Ordering::Relaxed) {
                "invalid"
            } else {
                "2"
            }
            .to_string(),
        ),
        _ => std::env::var(name).ok(),
    }
}

fn net_block() -> &'static Vec<String> {
    NET_BLOCK.get_or_init(|| load_pipe_list("SANDPIT_NET_BLOCK"))
}

fn exec_gate_enabled() -> bool {
    !exec_rules().is_empty() || !net_block().is_empty()
}

// ============================================================================
// SIP path detection (Fix 6)
// ============================================================================

fn is_sip_path(path: &str) -> bool {
    path.starts_with("/usr/bin/")
        || path.starts_with("/bin/")
        || path.starts_with("/sbin/")
        || path.starts_with("/usr/sbin/")
        || path.starts_with("/usr/lib/")
        || path.starts_with("/usr/libexec/")
        || path.starts_with("/System/")
}

/// SIP detection for bare binary names (e.g. "python3") that posix_spawnp
/// will resolve against PATH. Checks whether a standard SIP bin directory
/// contains a binary of that name.
fn is_sip_basename(name: &str) -> bool {
    if name.is_empty() || name.contains('/') {
        return false;
    }
    const SIP_BIN_DIRS: &[&str] = &[
        "/usr/bin/",
        "/bin/",
        "/usr/sbin/",
        "/sbin/",
        "/usr/libexec/",
    ];
    SIP_BIN_DIRS.iter().any(|dir| {
        let full = format!("{}{}", dir, name);
        std::path::Path::new(&full).exists()
    })
}

// ============================================================================
// Env re-injection for exec hooks (Fix 1)
//
// When a child process is exec'd with an explicit envp that omits our env
// vars (DYLD_INSERT_LIBRARIES, SANDPIT_*), re-inject them so grandchildren
// remain hooked. Without this, `env -i <cmd>` completely escapes the sandbox.
// ============================================================================

/// Check an envp (explicit or inherited) and return a new one with sandpit
/// vars re-injected if any are missing or have been tampered with.
///
/// Handles three cases:
/// 1. Explicit envp that omits our vars (e.g. `env -i cmd`).
/// 2. Explicit envp that includes our vars with altered values (e.g.
///    `DYLD_INSERT_LIBRARIES=` cleared, or repointed to a different dylib).
/// 3. NULL envp (inherit) where the parent process has stripped our vars
///    from its own `environ` before exec (e.g. some agents delete
///    DYLD_INSERT_LIBRARIES from their environment to avoid leaking it to
///    their own children). Without re-injection the child escapes.
///
/// Returns (owned_cstrings, new_envp_pointers). The caller MUST keep
/// `owned_cstrings` alive until the real exec/spawn call completes.
unsafe fn ensure_sandpit_env(
    envp: *const *const c_char,
) -> Option<(Vec<CString>, Vec<*const c_char>)> {
    // A nested invocation of the same protected Sandpit binary establishes a
    // new session boundary and intentionally replaces the outer session vars.
    if is_trusted_sandpit_process() {
        return None;
    }
    let saved = SAVED_ENV_VARS.get()?;
    if saved.is_empty() {
        return None;
    }

    // For NULL envp (inherit), read the current process's environ so we can
    // detect the case where our vars have been stripped from it. Returning
    // None here used to be a silent escape: `DYLD_INSERT_LIBRARIES` gone
    // from environ + NULL envp = child with no hooks.
    let use_environ = envp.is_null();
    let effective_envp = if use_environ {
        // On macOS, dylibs must use _NSGetEnviron() from <crt_externs.h>
        // rather than referencing `environ` directly — Apple's documented
        // API for accessing the process environment from a dynamic library.
        // Direct `extern environ` may resolve on current macOS but is not
        // guaranteed across link configurations / SDK versions.
        unsafe extern "C" {
            fn _NSGetEnviron() -> *mut *const *const c_char;
        }
        let ep = _NSGetEnviron();
        if ep.is_null() || (*ep).is_null() {
            return None;
        }
        *ep
    } else {
        envp
    };

    // Collect existing entries keyed by var name. Track value too so we can
    // detect tampering (e.g. DYLD_INSERT_LIBRARIES cleared to empty or
    // repointed to an attacker-controlled dylib).
    let mut existing: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut existing_ptrs: Vec<*const c_char> = Vec::new();
    let mut i = 0;
    loop {
        let entry = *effective_envp.add(i);
        if entry.is_null() {
            break;
        }
        if let Ok(s) = CStr::from_ptr(entry).to_str() {
            if let Some(eq_pos) = s.find('=') {
                existing.insert(s[..eq_pos].to_string(), s[eq_pos + 1..].to_string());
            }
        }
        existing_ptrs.push(entry);
        i += 1;
        if i > 65536 {
            break;
        } // safety cap
    }

    // Re-inject if any of our vars are missing OR have been altered.
    let need_inject = saved
        .iter()
        .any(|(key, val)| match existing.get(key.as_str()) {
            None => true,
            Some(existing_val) => existing_val != val,
        });
    if !need_inject {
        return None;
    }

    // Build new envp: keep existing entries (minus our keys), then append ours
    let our_keys: HashSet<&str> = saved.iter().map(|(k, _)| k.as_str()).collect();
    let mut owned_strings: Vec<CString> = Vec::new();
    let mut new_envp: Vec<*const c_char> = Vec::new();

    for ptr in &existing_ptrs {
        if let Ok(s) = CStr::from_ptr(*ptr).to_str() {
            if let Some(eq_pos) = s.find('=') {
                if our_keys.contains(&s[..eq_pos]) {
                    continue; // skip — we'll add our saved version
                }
            }
        }
        new_envp.push(*ptr);
    }

    for (key, val) in saved {
        if let Ok(entry) = CString::new(format!("{}={}", key, val)) {
            new_envp.push(entry.as_ptr());
            owned_strings.push(entry);
        }
    }

    // Defense in depth: if every CString::new failed (shouldn't happen — our
    // values never contain NULs), we'd have stripped our own keys and added
    // nothing back. That's strictly worse than passing the original envp.
    if owned_strings.is_empty() {
        log::warn!("ensure_sandpit_env produced no replacements; leaving envp unchanged");
        return None;
    }

    new_envp.push(std::ptr::null());
    log::info!(
        "re-injected {} sandpit env vars into child envp (from {})",
        owned_strings.len(),
        if use_environ {
            "environ (NULL envp)"
        } else {
            "explicit envp"
        }
    );
    Some((owned_strings, new_envp))
}

fn file_fence_enabled() -> bool {
    let has_policy = !file_allow_write().is_empty()
        || !file_block_write().is_empty()
        || !file_block_read().is_empty();
    FILE_POLICY_INVALID.load(Ordering::Relaxed) || has_policy
}

// ============================================================================
// File path checking
// ============================================================================

#[derive(Clone, Copy)]
enum FinalSymlink {
    Follow,
    NoFollow,
}

fn normalize_path(path: &Path) -> PathBuf {
    path.components()
        .fold(PathBuf::new(), |mut result, component| {
            match component {
                Component::ParentDir => {
                    result.pop();
                }
                Component::CurDir => {}
                other => result.push(other.as_os_str()),
            }
            result
        })
}

fn absolute_path(path: &Path) -> Option<PathBuf> {
    if path.is_absolute() {
        Some(path.to_path_buf())
    } else {
        std::env::current_dir().ok().map(|cwd| cwd.join(path))
    }
}

/// Resolve a path while permitting only its final component to be missing.
///
/// `canonicalize` alone cannot resolve a create destination because its final
/// component usually does not exist. Canonicalizing the complete parent path
/// resolves symlinks and `..` in the same traversal order as the kernel, then
/// the missing final name can be appended without losing that information.
///
/// This is still a userspace preflight check, so the kernel seatbelt remains
/// the race-free enforcement layer if another thread swaps a path afterward.
fn resolve_following_final(path: &Path) -> Option<PathBuf> {
    let candidate = absolute_path(path)?;
    if let Ok(canonical) = std::fs::canonicalize(&candidate) {
        return Some(canonical);
    }

    let name = candidate.file_name()?;
    let parent = std::fs::canonicalize(candidate.parent()?).ok()?;
    Some(parent.join(name))
}

fn resolve_path(path: &Path, final_symlink: FinalSymlink) -> Option<PathBuf> {
    match final_symlink {
        FinalSymlink::Follow => resolve_following_final(path),
        FinalSymlink::NoFollow => {
            let candidate = absolute_path(path)?;
            let Some(name) = candidate.file_name() else {
                return std::fs::canonicalize(candidate).ok();
            };
            let parent = std::fs::canonicalize(candidate.parent()?).ok()?;
            Some(parent.join(name))
        }
    }
}

fn path_from_fd(fd: c_int) -> Option<PathBuf> {
    let mut buffer = [0i8; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(fd, libc::F_GETPATH, buffer.as_mut_ptr()) } < 0 {
        return None;
    }
    Some(PathBuf::from(std::ffi::OsStr::from_bytes(unsafe {
        CStr::from_ptr(buffer.as_ptr()).to_bytes()
    })))
}

fn absolute_path_at(fd: c_int, path: &Path) -> Option<PathBuf> {
    if path.is_absolute() || fd == libc::AT_FDCWD {
        absolute_path(path)
    } else {
        path_from_fd(fd).map(|base| base.join(path))
    }
}

fn matches_prefix(path: &Path, prefixes: &[PathBuf]) -> bool {
    prefixes.iter().any(|prefix| path.starts_with(prefix))
}

fn contains_prefix(path: &Path, prefixes: &[PathBuf]) -> bool {
    prefixes.iter().any(|prefix| prefix.starts_with(path))
}

fn check_write_allowed(requested: &Path, resolved: &Path, protect_descendants: bool) -> bool {
    if trusted_sandpit_session_write(requested) && trusted_sandpit_session_write(resolved) {
        return true;
    }
    if saved_session_overlay_contains(requested, protect_descendants)
        && saved_session_overlay_contains(resolved, protect_descendants)
    {
        return true;
    }
    let allow = file_allow_write();
    let block = file_block_write();
    if !block.is_empty()
        && (matches_prefix(requested, block)
            || matches_prefix(resolved, block)
            || (protect_descendants
                && (contains_prefix(requested, block) || contains_prefix(resolved, block))))
    {
        return false;
    }
    if !allow.is_empty() && !matches_prefix(resolved, allow) {
        return false;
    }
    true
}

fn saved_session_overlay_contains(path: &Path, protect_descendants: bool) -> bool {
    let Some(root) = SAVED_ENV_VARS
        .get()
        .and_then(|vars| {
            vars.iter()
                .find(|(name, _)| name == "SANDPIT_MUTABLE_SESSION_DIR")
        })
        .map(|(_, root)| std::path::Path::new(root))
    else {
        return false;
    };
    session_overlay_allows_write(path, root, file_block_write(), protect_descendants)
}

fn session_overlay_allows_write(
    path: &Path,
    root: &Path,
    blocked_paths: &[PathBuf],
    protect_descendants: bool,
) -> bool {
    path.starts_with(root)
        && !blocked_paths.iter().any(|blocked| {
            blocked.starts_with(root)
                && (path.starts_with(blocked) || (protect_descendants && blocked.starts_with(path)))
        })
}

fn configured_sandpit_root() -> std::path::PathBuf {
    std::env::var_os("SANDPIT_SESSION_ROOT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
                .join(".sandpit")
        })
}

fn trusted_sandpit_session_write(path: &Path) -> bool {
    if !is_trusted_sandpit_process() {
        return false;
    }
    let Some((immutable_session, mutable_session)) = TRUSTED_SESSION_PATHS.get() else {
        return false;
    };
    session_write_capability_allows(
        path,
        immutable_session,
        mutable_session,
        &configured_sandpit_root(),
        file_block_write(),
    )
}

fn session_write_capability_allows(
    path: &Path,
    immutable_session: &Path,
    mutable_session: &Path,
    sandpit_root: &Path,
    blocked_paths: &[PathBuf],
) -> bool {
    let Some(path) = resolve_policy_prefix(path) else {
        return false;
    };
    let Some(resolved_sandpit_root) = resolve_policy_prefix(sandpit_root) else {
        return false;
    };
    let managed_file = [
        "adversary.lock",
        "amp-review.sh",
        "amp-review-settings.json",
        "amp-adversary.md",
    ]
    .iter()
    .map(|name| resolved_sandpit_root.join(name))
    .any(|managed| path == managed && blocked_paths.contains(&managed));
    let authorized_session_path =
        path.starts_with(immutable_session) || path.starts_with(mutable_session);
    managed_file || authorized_session_path
}

/// Enable managed writes only after the Sandpit CLI has dispatched a `run`.
/// Merely executing the protected binary (for example `sandpit uninstall`)
/// is not sufficient to acquire this capability.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_enable_trusted_session_writes(
    immutable: *const c_char,
    mutable: *const c_char,
) {
    if !is_trusted_sandpit_process() || immutable.is_null() || mutable.is_null() {
        return;
    }
    let Ok(immutable) = unsafe { CStr::from_ptr(immutable) }.to_str() else {
        return;
    };
    let Ok(mutable) = unsafe { CStr::from_ptr(mutable) }.to_str() else {
        return;
    };
    let Some(immutable) = resolve_policy_prefix(Path::new(immutable)) else {
        return;
    };
    let Some(mutable) = resolve_policy_prefix(Path::new(mutable)) else {
        return;
    };
    let Some(expected_immutable_root) =
        resolve_policy_prefix(&configured_sandpit_root().join("session-state/nested-sessions"))
    else {
        return;
    };
    let saved_mutable = SAVED_ENV_VARS.get().and_then(|vars| {
        vars.iter()
            .find(|(name, _)| name == "SANDPIT_MUTABLE_SESSION_DIR")
            .and_then(|(_, value)| resolve_policy_prefix(Path::new(value)))
    });
    if immutable.parent() == Some(expected_immutable_root.as_path())
        && saved_mutable
            .as_ref()
            .is_some_and(|root| mutable.starts_with(root))
    {
        let _ = TRUSTED_SESSION_PATHS.set((immutable, mutable));
    }
}

fn is_trusted_sandpit_process() -> bool {
    let Ok(current_exe) = std::env::current_exe().and_then(std::fs::canonicalize) else {
        return false;
    };
    let launcher = SAVED_ENV_VARS.get().and_then(|vars| {
        vars.iter()
            .find(|(name, _)| name == "SANDPIT_LAUNCHER_EXE")
            .map(|(_, path)| std::path::Path::new(path))
    });
    if launcher != Some(current_exe.as_path()) {
        return false;
    }
    let blocked = file_block_write();
    if !blocked.contains(&current_exe) {
        return false;
    }
    true
}

fn check_read_allowed(requested: &Path, resolved: &Path) -> bool {
    let block = file_block_read();
    if block.is_empty() {
        return true;
    }
    !matches_prefix(requested, block) && !matches_prefix(resolved, block)
}

fn check_file_policy(
    requested: &Path,
    resolved: &Path,
    is_write: bool,
    protect_descendants: bool,
) -> bool {
    if FILE_POLICY_INVALID.load(Ordering::Relaxed) {
        log::warn!("BLOCKED file operation because the inherited file policy is invalid");
        return false;
    }
    if is_write {
        if !check_write_allowed(requested, resolved, protect_descendants) {
            log::warn!(
                "BLOCKED write to {}",
                truncate_log(&requested.to_string_lossy(), 200)
            );
            return false;
        }
    } else if !check_read_allowed(requested, resolved) {
        log::warn!(
            "BLOCKED read from {}",
            truncate_log(&requested.to_string_lossy(), 200)
        );
        return false;
    }
    true
}

fn check_file_op(
    path: *const c_char,
    is_write: bool,
    final_symlink: FinalSymlink,
    protect_descendants: bool,
) -> bool {
    if !file_fence_enabled() {
        return true;
    }
    if path.is_null() {
        return false;
    }
    let path = Path::new(std::ffi::OsStr::from_bytes(unsafe {
        CStr::from_ptr(path).to_bytes()
    }));
    let absolute = match absolute_path(path) {
        Some(path) => path,
        None => return false,
    };
    let requested = normalize_path(&absolute);
    let resolved = match resolve_path(&absolute, final_symlink) {
        Some(path) => path,
        None => return false,
    };
    check_file_policy(&requested, &resolved, is_write, protect_descendants)
}

fn check_file_op_at(
    fd: c_int,
    path: *const c_char,
    is_write: bool,
    final_symlink: FinalSymlink,
    protect_descendants: bool,
) -> bool {
    if !file_fence_enabled() {
        return true;
    }
    if path.is_null() {
        return false;
    }
    let path = Path::new(std::ffi::OsStr::from_bytes(unsafe {
        CStr::from_ptr(path).to_bytes()
    }));
    let absolute = match absolute_path_at(fd, path) {
        Some(path) => path,
        None => return false,
    };
    let requested = normalize_path(&absolute);
    let resolved = match resolve_path(&absolute, final_symlink) {
        Some(path) => path,
        None => return false,
    };
    check_file_policy(&requested, &resolved, is_write, protect_descendants)
}

fn open_is_write(flags: c_int) -> bool {
    (flags & libc::O_WRONLY) != 0
        || (flags & libc::O_RDWR) != 0
        || (flags & libc::O_CREAT) != 0
        || (flags & libc::O_TRUNC) != 0
        || (flags & libc::O_APPEND) != 0
}

// ============================================================================
// Command extraction and review (exec gate)
// ============================================================================

fn is_shell(name: &str) -> bool {
    matches!(name, "bash" | "sh" | "zsh" | "dash" | "ksh" | "fish")
}

fn is_dangerous_binary(name: &str) -> bool {
    matches!(
        name,
        "curl" | "wget" | "nc" | "ncat" | "netcat" | "scp" | "rsync" | "ssh"
        // Tools that can publish/exfiltrate code
        | "gh" | "git" | "npm" | "npx" | "cargo"
        // Scripting runtimes — agents can write+run scripts to bypass shims
        | "python" | "python3" | "python3.12" | "python3.13" | "python3.14"
        | "node" | "ruby" | "perl" | "php" | "lua"
        | "deno" | "bun"
    )
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

unsafe fn extract_shell_command(path: *const c_char, argv: *const *const c_char) -> Option<String> {
    if path.is_null() || argv.is_null() {
        return None;
    }
    let path_str = CStr::from_ptr(path).to_str().ok()?;
    let bin = basename(path_str);

    let (effective_bin, args_start) = if bin == "env" {
        let mut i = 1;
        loop {
            let arg = *argv.add(i);
            if arg.is_null() {
                return None;
            }
            let s = CStr::from_ptr(arg).to_str().ok()?;
            if !s.starts_with('-') {
                break (basename(s), i + 1);
            }
            i += 1;
        }
    } else {
        (bin, 1)
    };

    if is_shell(effective_bin) {
        let mut i = args_start;
        loop {
            let arg = *argv.add(i);
            if arg.is_null() {
                return None;
            }
            let s = CStr::from_ptr(arg).to_str().ok()?;
            if s == "-c" {
                let cmd_arg = *argv.add(i + 1);
                if cmd_arg.is_null() {
                    return None;
                }
                return CStr::from_ptr(cmd_arg).to_str().ok().map(String::from);
            }
            i += 1;
        }
    }

    // Detect SIP-protected targets. `path_str` may be absolute (execve) or a
    // bare basename (posix_spawnp, PATH-resolved by the loader). For bare
    // names, check whether a SIP bin dir contains a binary of that name.
    let sip_target =
        is_sip_path(path_str) || (!path_str.contains('/') && is_sip_basename(effective_bin));

    if is_dangerous_binary(effective_bin) || sip_target {
        let mut parts = Vec::new();
        let mut i = 0;
        loop {
            let arg = *argv.add(i);
            if arg.is_null() {
                break;
            }
            if let Ok(s) = CStr::from_ptr(arg).to_str() {
                parts.push(s.to_string());
            }
            i += 1;
            if i > 256 {
                break;
            }
        }
        if !parts.is_empty() {
            if sip_target && !is_dangerous_binary(effective_bin) {
                log::info!(
                    "SIP binary exec (DYLD will be stripped): {}",
                    truncate_log(&parts.join(" "), 200)
                );
            }
            return Some(parts.join(" "));
        }
    }

    None
}

unsafe fn extract_shell_command_spawn(
    path: *const c_char,
    argv: *const *mut c_char,
) -> Option<String> {
    extract_shell_command(path, argv as *const *const c_char)
}

fn check_rules(command: &str) -> Option<&'static str> {
    let rules = exec_rules();
    if rules.is_empty() {
        return None;
    }
    let lower = command.to_lowercase();
    for rule in rules {
        if lower.contains(rule.as_str()) {
            return Some(rule.as_str());
        }
    }
    None
}

fn check_blocked_domain(command: &str) -> Option<&'static str> {
    let domains = net_block();
    if domains.is_empty() {
        return None;
    }
    let lower = command.to_lowercase();
    for domain in domains {
        if lower.contains(domain.as_str()) {
            return Some(domain.as_str());
        }
    }
    None
}

fn review_command(command: &str) -> bool {
    if let Some(matched_rule) = check_rules(command) {
        log::warn!(
            "BLOCKED (rule: {matched_rule}) command: {}",
            truncate_log(command, 200)
        );
        return false;
    }
    if let Some(domain) = check_blocked_domain(command) {
        log::warn!(
            "BLOCKED (domain: {domain}) command: {}",
            truncate_log(command, 200)
        );
        return false;
    }
    true
}

fn truncate_log(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut end = max;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &s[..end])
    }
}

// ============================================================================
// Replacement functions (called via dyld interpose)
// ============================================================================

// --- connect ---

unsafe fn is_localhost_v4(addr: *const sockaddr_in) -> bool {
    let ip = u32::from_be((*addr).sin_addr.s_addr);
    (ip >> 24) == 127
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_connect(
    sockfd: c_int,
    addr: *const sockaddr,
    addrlen: socklen_t,
) -> c_int {
    let real = match real_connect() {
        Some(f) => f,
        None => {
            *libc::__error() = libc::ENOSYS;
            return -1;
        }
    };

    if IN_HOOK.with(|c| c.get()) {
        return real(sockfd, addr, addrlen);
    }

    let port = proxy_port();
    if port == 0 {
        return real(sockfd, addr, addrlen);
    }

    if addr.is_null() || (*addr).sa_family as i32 != AF_INET {
        return real(sockfd, addr, addrlen);
    }

    let addr_in = addr as *const sockaddr_in;
    if is_localhost_v4(addr_in) {
        return real(sockfd, addr, addrlen);
    }

    let mut sock_type: c_int = 0;
    let mut optlen: socklen_t = std::mem::size_of::<c_int>() as socklen_t;
    if libc::getsockopt(
        sockfd,
        libc::SOL_SOCKET,
        libc::SO_TYPE,
        &mut sock_type as *mut _ as *mut c_void,
        &mut optlen,
    ) != 0
        || sock_type != SOCK_STREAM
    {
        return real(sockfd, addr, addrlen);
    }

    let orig_ip = (*addr_in).sin_addr.s_addr;
    let orig_port = (*addr_in).sin_port;

    let mut proxy_addr: sockaddr_in = std::mem::zeroed();
    proxy_addr.sin_family = AF_INET as u8;
    proxy_addr.sin_port = port.to_be();
    proxy_addr.sin_addr.s_addr = u32::from_be_bytes([127, 0, 0, 1]).to_be();

    IN_HOOK.with(|c| c.set(true));
    let ret = real(
        sockfd,
        &proxy_addr as *const sockaddr_in as *const sockaddr,
        std::mem::size_of::<sockaddr_in>() as socklen_t,
    );
    IN_HOOK.with(|c| c.set(false));

    let errno_val = if ret != 0 { *libc::__error() } else { 0 };
    if ret != 0 && errno_val != libc::EINPROGRESS {
        return ret;
    }

    if errno_val == libc::EINPROGRESS {
        let mut pollfd = libc::pollfd {
            fd: sockfd,
            events: libc::POLLOUT,
            revents: 0,
        };
        let poll_ret = libc::poll(&mut pollfd, 1, 1000);
        if poll_ret <= 0 || (pollfd.revents & libc::POLLOUT) == 0 {
            *libc::__error() = libc::ETIMEDOUT;
            return -1;
        }
        let mut err: c_int = 0;
        let mut errlen: socklen_t = std::mem::size_of::<c_int>() as socklen_t;
        libc::getsockopt(
            sockfd,
            libc::SOL_SOCKET,
            libc::SO_ERROR,
            &mut err as *mut _ as *mut c_void,
            &mut errlen,
        );
        if err != 0 {
            *libc::__error() = err;
            return -1;
        }
    }

    let orig_flags = libc::fcntl(sockfd, libc::F_GETFL);
    let is_nonblocking = orig_flags >= 0 && (orig_flags & libc::O_NONBLOCK) != 0;
    if is_nonblocking {
        libc::fcntl(sockfd, libc::F_SETFL, orig_flags & !libc::O_NONBLOCK);
    }

    let ip_bytes = orig_ip.to_ne_bytes();
    let dest_ip = format!(
        "{}.{}.{}.{}",
        ip_bytes[0], ip_bytes[1], ip_bytes[2], ip_bytes[3]
    );
    let dest_port = u16::from_be(orig_port);
    let dest_host = dns_cache_lookup(orig_ip).unwrap_or_else(|| dest_ip.clone());
    let request = format!(
        "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n\r\n",
        dest_host, dest_port, dest_host, dest_port
    );

    let timeout = libc::timeval {
        tv_sec: 5,
        tv_usec: 0,
    };
    libc::setsockopt(
        sockfd,
        libc::SOL_SOCKET,
        libc::SO_RCVTIMEO,
        &timeout as *const _ as *const c_void,
        std::mem::size_of::<libc::timeval>() as socklen_t,
    );
    libc::setsockopt(
        sockfd,
        libc::SOL_SOCKET,
        libc::SO_SNDTIMEO,
        &timeout as *const _ as *const c_void,
        std::mem::size_of::<libc::timeval>() as socklen_t,
    );

    let written = libc::send(sockfd, request.as_ptr() as *const c_void, request.len(), 0);
    if written != request.len() as isize {
        if is_nonblocking {
            libc::fcntl(sockfd, libc::F_SETFL, orig_flags);
        }
        libc::close(sockfd);
        *libc::__error() = libc::ECONNRESET;
        return -1;
    }

    let mut resp_buf = [0u8; 256];
    let mut resp_len: usize = 0;
    loop {
        if resp_len >= resp_buf.len() {
            if is_nonblocking {
                libc::fcntl(sockfd, libc::F_SETFL, orig_flags);
            }
            libc::close(sockfd);
            *libc::__error() = libc::ECONNRESET;
            return -1;
        }
        let n = libc::recv(
            sockfd,
            resp_buf[resp_len..].as_mut_ptr() as *mut c_void,
            1,
            0,
        );
        if n <= 0 {
            if is_nonblocking {
                libc::fcntl(sockfd, libc::F_SETFL, orig_flags);
            }
            libc::close(sockfd);
            *libc::__error() = libc::ECONNRESET;
            return -1;
        }
        resp_len += n as usize;
        if resp_len >= 4
            && resp_buf[resp_len - 4] == b'\r'
            && resp_buf[resp_len - 3] == b'\n'
            && resp_buf[resp_len - 2] == b'\r'
            && resp_buf[resp_len - 1] == b'\n'
        {
            break;
        }
    }

    if is_nonblocking {
        libc::fcntl(sockfd, libc::F_SETFL, orig_flags);
    }
    let no_timeout = libc::timeval {
        tv_sec: 0,
        tv_usec: 0,
    };
    libc::setsockopt(
        sockfd,
        libc::SOL_SOCKET,
        libc::SO_RCVTIMEO,
        &no_timeout as *const _ as *const c_void,
        std::mem::size_of::<libc::timeval>() as socklen_t,
    );
    libc::setsockopt(
        sockfd,
        libc::SOL_SOCKET,
        libc::SO_SNDTIMEO,
        &no_timeout as *const _ as *const c_void,
        std::mem::size_of::<libc::timeval>() as socklen_t,
    );

    let resp_str = std::str::from_utf8(&resp_buf[..resp_len]).unwrap_or("");
    if !resp_str.contains(" 200 ") {
        libc::close(sockfd);
        *libc::__error() = if resp_str.contains(" 403 ") {
            libc::EPERM
        } else {
            libc::ECONNREFUSED
        };
        return -1;
    }

    0
}

// --- posix_spawn ---

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_posix_spawn(
    pid: *mut pid_t,
    path: *const c_char,
    file_actions: *const c_void,
    attrp: *const c_void,
    argv: *const *mut c_char,
    envp: *const *mut c_char,
) -> c_int {
    if exec_gate_enabled() {
        if let Some(command) = extract_shell_command_spawn(path, argv) {
            if !review_command(&command) {
                return libc::EACCES;
            }
        }
    }
    // Re-inject sandpit env vars if the child's envp is missing them
    let injected = ensure_sandpit_env(envp as *const *const c_char);
    let final_envp = match injected {
        Some((ref _owned, ref ptrs)) => ptrs.as_ptr() as *const *mut c_char,
        None => envp,
    };
    match real_posix_spawn() {
        Some(real) => real(pid, path, file_actions, attrp, argv, final_envp),
        None => libc::ENOSYS,
    }
}

// --- posix_spawnp ---

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_posix_spawnp(
    pid: *mut pid_t,
    file: *const c_char,
    file_actions: *const c_void,
    attrp: *const c_void,
    argv: *const *mut c_char,
    envp: *const *mut c_char,
) -> c_int {
    if exec_gate_enabled() {
        if let Some(command) = extract_shell_command_spawn(file, argv) {
            if !review_command(&command) {
                return libc::EACCES;
            }
        }
    }
    // Re-inject sandpit env vars if the child's envp is missing them
    let injected = ensure_sandpit_env(envp as *const *const c_char);
    let final_envp = match injected {
        Some((ref _owned, ref ptrs)) => ptrs.as_ptr() as *const *mut c_char,
        None => envp,
    };
    match real_posix_spawnp() {
        Some(real) => real(pid, file, file_actions, attrp, argv, final_envp),
        None => libc::ENOSYS,
    }
}

// --- execve ---

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_execve(
    path: *const c_char,
    argv: *const *const c_char,
    envp: *const *const c_char,
) -> c_int {
    if exec_gate_enabled() {
        if let Some(command) = extract_shell_command(path, argv) {
            if !review_command(&command) {
                *libc::__error() = libc::EACCES;
                return -1;
            }
        }
    }
    // Re-inject sandpit env vars if the child's envp is missing them.
    // For execve, the kernel copies envp before replacing the process image,
    // so the owned CStrings are safe to drop after the call.
    let injected = ensure_sandpit_env(envp);
    let final_envp = match injected {
        Some((ref _owned, ref ptrs)) => ptrs.as_ptr(),
        None => envp,
    };
    match real_execve() {
        Some(real) => real(path, argv, final_envp),
        None => {
            *libc::__error() = libc::ENOSYS;
            -1
        }
    }
}

// --- open / openat ---
// Policy check only. The C variadic wrappers in interpose.c call these,
// then call the real open/openat themselves (ARM64 variadic ABI).

/// Preserve missing-parent errors without performing an unchecked open. Git
/// uses ENOENT to create object/reflog directories before retrying. Other
/// resolution failures and actual policy denials remain EACCES.
unsafe fn open_denial_errno(fd: c_int, path: *const c_char) -> c_int {
    if !path.is_null() {
        let path = Path::new(std::ffi::OsStr::from_bytes(CStr::from_ptr(path).to_bytes()));
        if let Some(absolute) = absolute_path_at(fd, path) {
            if let Some(parent) = absolute.parent() {
                if let Err(error) = std::fs::canonicalize(parent) {
                    if let Some(code @ (libc::ENOENT | libc::ENOTDIR)) = error.raw_os_error() {
                        return code;
                    }
                }
            }
        }
    }
    libc::EACCES
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_check_open(path: *const c_char, flags: c_int) -> c_int {
    if !check_file_op(path, open_is_write(flags), FinalSymlink::Follow, false) {
        *libc::__error() = open_denial_errno(libc::AT_FDCWD, path);
        return -1;
    }
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_check_openat(
    fd: c_int,
    path: *const c_char,
    flags: c_int,
) -> c_int {
    if !check_file_op_at(fd, path, open_is_write(flags), FinalSymlink::Follow, false) {
        *libc::__error() = open_denial_errno(fd, path);
        return -1;
    }
    0
}

// --- unlink ---

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_unlink(path: *const c_char) -> c_int {
    if !check_file_op(path, true, FinalSymlink::NoFollow, false) {
        *libc::__error() = libc::EACCES;
        return -1;
    }
    match real_unlink() {
        Some(real) => real(path),
        None => {
            *libc::__error() = libc::ENOSYS;
            -1
        }
    }
}

// --- unlinkat ---

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_unlinkat(fd: c_int, path: *const c_char, flag: c_int) -> c_int {
    if !check_file_op_at(fd, path, true, FinalSymlink::NoFollow, false) {
        *libc::__error() = libc::EACCES;
        return -1;
    }
    match real_unlinkat() {
        Some(real) => real(fd, path, flag),
        None => {
            *libc::__error() = libc::ENOSYS;
            -1
        }
    }
}

// --- rename ---

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_rename(old: *const c_char, new_path: *const c_char) -> c_int {
    if !check_file_op(old, true, FinalSymlink::NoFollow, true)
        || !check_file_op(new_path, true, FinalSymlink::NoFollow, true)
    {
        *libc::__error() = libc::EACCES;
        return -1;
    }
    match real_rename() {
        Some(real) => real(old, new_path),
        None => {
            *libc::__error() = libc::ENOSYS;
            -1
        }
    }
}

// --- renameat ---

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_renameat(
    oldfd: c_int,
    old: *const c_char,
    newfd: c_int,
    new_path: *const c_char,
) -> c_int {
    if !check_file_op_at(oldfd, old, true, FinalSymlink::NoFollow, true)
        || !check_file_op_at(newfd, new_path, true, FinalSymlink::NoFollow, true)
    {
        *libc::__error() = libc::EACCES;
        return -1;
    }
    match real_renameat() {
        Some(real) => real(oldfd, old, newfd, new_path),
        None => {
            *libc::__error() = libc::ENOSYS;
            -1
        }
    }
}

// --- renamex_np / renameatx_np ---

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_renamex_np(
    old: *const c_char,
    new_path: *const c_char,
    flags: c_uint,
) -> c_int {
    if !check_file_op(old, true, FinalSymlink::NoFollow, true)
        || !check_file_op(new_path, true, FinalSymlink::NoFollow, true)
    {
        *libc::__error() = libc::EACCES;
        return -1;
    }
    match real_renamex_np() {
        Some(real) => real(old, new_path, flags),
        None => {
            *libc::__error() = libc::ENOSYS;
            -1
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_renameatx_np(
    oldfd: c_int,
    old: *const c_char,
    newfd: c_int,
    new_path: *const c_char,
    flags: c_uint,
) -> c_int {
    if !check_file_op_at(oldfd, old, true, FinalSymlink::NoFollow, true)
        || !check_file_op_at(newfd, new_path, true, FinalSymlink::NoFollow, true)
    {
        *libc::__error() = libc::EACCES;
        return -1;
    }
    match real_renameatx_np() {
        Some(real) => real(oldfd, old, newfd, new_path, flags),
        None => {
            *libc::__error() = libc::ENOSYS;
            -1
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_link(old: *const c_char, new_path: *const c_char) -> c_int {
    // A path check followed by link(2) cannot atomically bind authorization to
    // the source inode: another thread can retarget a permitted source symlink
    // to a protected file between those operations. Reject hard links whenever
    // path policy is active rather than create a writable alias outside it.
    if file_fence_enabled() {
        log::warn!("BLOCKED hard link while file policy is active");
        *libc::__error() = libc::EACCES;
        return -1;
    }
    match real_link() {
        Some(real) => real(old, new_path),
        None => {
            *libc::__error() = libc::ENOSYS;
            -1
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_linkat(
    oldfd: c_int,
    old: *const c_char,
    newfd: c_int,
    new_path: *const c_char,
    flag: c_int,
) -> c_int {
    if file_fence_enabled() {
        log::warn!("BLOCKED hard link while file policy is active");
        *libc::__error() = libc::EACCES;
        return -1;
    }
    match real_linkat() {
        Some(real) => real(oldfd, old, newfd, new_path, flag),
        None => {
            *libc::__error() = libc::ENOSYS;
            -1
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_truncate(path: *const c_char, length: libc::off_t) -> c_int {
    if !file_fence_enabled() {
        return match real_truncate() {
            Some(real) => real(path, length),
            None => {
                *libc::__error() = libc::ENOSYS;
                -1
            }
        };
    }
    // Path-based truncate cannot be both race-free and transparent in DYLD
    // mode. Authorizing before truncate leaves a symlink race; opening a
    // temporary FD and closing it releases every POSIX record lock this
    // process holds on the file. Deny it under policy.
    *libc::__error() = libc::EACCES;
    -1
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_ftruncate(fd: c_int, length: libc::off_t) -> c_int {
    let real = match real_ftruncate() {
        Some(real) => real,
        None => {
            *libc::__error() = libc::ENOSYS;
            return -1;
        }
    };
    if !file_fence_enabled() {
        return real(fd, length);
    }
    // A caller-owned descriptor can be replaced concurrently. Duplicating it
    // requires a close that releases POSIX record locks; guarding it in place
    // makes concurrent close/dup a fatal process error. Denial is the only
    // race-free, non-fatal behavior available to DYLD interposition.
    *libc::__error() = libc::EACCES;
    -1
}

// --- getaddrinfo ---

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_getaddrinfo(
    node: *const c_char,
    service: *const c_char,
    hints: *const libc::addrinfo,
    res: *mut *mut libc::addrinfo,
) -> c_int {
    let real = match real_getaddrinfo() {
        Some(f) => f,
        None => return libc::EAI_SYSTEM,
    };

    let ret = real(node, service, hints, res);
    if ret != 0 || res.is_null() || (*res).is_null() || node.is_null() {
        return ret;
    }

    let domain = match CStr::from_ptr(node).to_str() {
        Ok(s) if !s.is_empty() => s,
        _ => return ret,
    };

    let mut ai = *res;
    while !ai.is_null() {
        if (*ai).ai_family == AF_INET && !(*ai).ai_addr.is_null() {
            let addr = (*ai).ai_addr as *const sockaddr_in;
            let ip = (*addr).sin_addr.s_addr;
            dns_cache_insert(ip, domain.to_string());
        }
        ai = (*ai).ai_next;
    }

    ret
}

// --- gethostbyname / gethostbyname2 ---
// Populate DNS cache from legacy resolver functions so the connect hook
// can map IPs back to domain names for blocklist checking.

unsafe fn populate_dns_cache_from_hostent(he: *mut libc::hostent, domain: &str) {
    if he.is_null() || (*he).h_addrtype != AF_INET || (*he).h_length != 4 {
        return;
    }
    if (*he).h_addr_list.is_null() {
        return;
    }
    let mut i = 0;
    loop {
        let addr_ptr = *(*he).h_addr_list.add(i);
        if addr_ptr.is_null() {
            break;
        }
        let ip_bytes: [u8; 4] = *(addr_ptr as *const [u8; 4]);
        let ip = u32::from_ne_bytes(ip_bytes);
        dns_cache_insert(ip, domain.to_string());
        i += 1;
        if i > 64 {
            break;
        } // safety cap
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_gethostbyname(name: *const c_char) -> *mut libc::hostent {
    let real = match real_gethostbyname() {
        Some(f) => f,
        None => return std::ptr::null_mut(),
    };
    let result = real(name);
    if !result.is_null() && !name.is_null() {
        if let Ok(domain) = CStr::from_ptr(name).to_str() {
            if !domain.is_empty() {
                populate_dns_cache_from_hostent(result, domain);
            }
        }
    }
    result
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_gethostbyname2(
    name: *const c_char,
    af: c_int,
) -> *mut libc::hostent {
    let real = match real_gethostbyname2() {
        Some(f) => f,
        None => return std::ptr::null_mut(),
    };
    let result = real(name, af);
    if !result.is_null() && !name.is_null() {
        if let Ok(domain) = CStr::from_ptr(name).to_str() {
            if !domain.is_empty() {
                populate_dns_cache_from_hostent(result, domain);
            }
        }
    }
    result
}

// --- recvfrom ---
// Populate DNS cache by inspecting UDP/53 traffic. Node's c-ares-based resolver
// (used by dns.resolve, undici, etc.) speaks DNS over raw UDP sockets and never
// calls libresolv/getaddrinfo, so without this the connect hook sees raw IPs
// with no domain mapping and the proxy fails closed.
//
// Strategy: on every recvfrom return, if the source address is UDP port 53
// (or, for connected sockets, the peer is on port 53), parse the buffer as a
// DNS wire-format response. Extract the domain from the response's question
// section (responses echo the query) and insert (ip → domain) for every A
// record in the answer section.

/// Skip a DNS wire-format name (label sequence with possible compression pointers).
/// Returns the byte offset past the name, or None on parse error.
unsafe fn skip_dns_name(buf: *const u8, len: usize, mut offset: usize) -> Option<usize> {
    let mut jumps = 0;
    loop {
        if offset >= len {
            return None;
        }
        let b = *buf.add(offset);
        if b == 0 {
            return Some(offset + 1);
        }
        if b & 0xC0 == 0xC0 {
            if offset + 1 >= len {
                return None;
            }
            return Some(offset + 2);
        }
        let label_len = b as usize;
        if label_len > 63 {
            return None;
        }
        offset += 1 + label_len;
        jumps += 1;
        if jumps > 128 {
            return None;
        }
    }
}

/// Read a DNS wire-format name into a dotted string, following compression
/// pointers. Returns (domain, offset_past_inline_name) or None on parse error.
/// `offset_past_inline_name` is the offset just past the original (non-pointer)
/// part of the name, suitable for resuming parsing after a Question entry.
unsafe fn read_dns_name(buf: *const u8, len: usize, start: usize) -> Option<(String, usize)> {
    let mut out = String::new();
    let mut offset = start;
    let mut final_offset: Option<usize> = None;
    let mut jumps = 0;
    loop {
        if offset >= len {
            return None;
        }
        let b = *buf.add(offset);
        if b == 0 {
            let end = final_offset.unwrap_or(offset + 1);
            return Some((out, end));
        }
        if b & 0xC0 == 0xC0 {
            if offset + 1 >= len {
                return None;
            }
            let lo = *buf.add(offset + 1);
            if final_offset.is_none() {
                final_offset = Some(offset + 2);
            }
            let ptr = ((b as usize & 0x3F) << 8) | lo as usize;
            if ptr >= offset {
                return None;
            } // forward/self pointer = malformed
            offset = ptr;
            jumps += 1;
            if jumps > 16 {
                return None;
            }
            continue;
        }
        let label_len = b as usize;
        if label_len > 63 || offset + 1 + label_len > len {
            return None;
        }
        if !out.is_empty() {
            out.push('.');
        }
        for i in 0..label_len {
            let c = *buf.add(offset + 1 + i);
            // RFC 1035 allows arbitrary octets, but real domains are ASCII.
            if !(c.is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b'.') {
                return None;
            }
            out.push(c as char);
        }
        offset += 1 + label_len;
    }
}

/// Parse a DNS wire-format response and insert A record IPs into the DNS cache,
/// keyed by the domain extracted from the response's question section.
unsafe fn parse_dns_response(buf: *const u8, len: usize) {
    if len < 12 {
        return;
    }

    // Header: [id:2][flags:2][qd:2][an:2][ns:2][ar:2]
    // QR bit must be set (response, not query).
    let flags = u16::from_be_bytes([*buf.add(2), *buf.add(3)]);
    if flags & 0x8000 == 0 {
        return;
    }

    let qdcount = u16::from_be_bytes([*buf.add(4), *buf.add(5)]) as usize;
    let ancount = u16::from_be_bytes([*buf.add(6), *buf.add(7)]) as usize;

    if qdcount == 0 || ancount == 0 || qdcount > 16 {
        return;
    }

    // Read the first question's QNAME — this is the domain the app asked for.
    let mut offset = 12usize;
    let (domain, after_name) = match read_dns_name(buf, len, offset) {
        Some(v) => v,
        None => return,
    };
    if domain.is_empty() {
        return;
    }
    offset = after_name + 4; // skip QTYPE + QCLASS

    // Skip any remaining questions.
    for _ in 1..qdcount {
        offset = match skip_dns_name(buf, len, offset) {
            Some(o) => o,
            None => return,
        };
        offset += 4;
        if offset > len {
            return;
        }
    }

    // Walk answers, inserting A records under the original question domain.
    // (CNAME chains may produce answers with different owner names, but the
    // app will connect using the name it originally resolved — the question.)
    for _ in 0..ancount {
        if offset >= len {
            return;
        }
        offset = match skip_dns_name(buf, len, offset) {
            Some(o) => o,
            None => return,
        };
        if offset + 10 > len {
            return;
        }
        let rtype = u16::from_be_bytes([*buf.add(offset), *buf.add(offset + 1)]);
        let rdlength = u16::from_be_bytes([*buf.add(offset + 8), *buf.add(offset + 9)]) as usize;
        offset += 10;
        if offset + rdlength > len {
            return;
        }
        if rtype == 1 && rdlength == 4 {
            let ip = u32::from_ne_bytes([
                *buf.add(offset),
                *buf.add(offset + 1),
                *buf.add(offset + 2),
                *buf.add(offset + 3),
            ]);
            dns_cache_insert(ip, domain.clone());
        }
        offset += rdlength;
    }
}

/// Extract the port (host byte order) from a sockaddr if it is AF_INET/AF_INET6.
unsafe fn sockaddr_port(addr: *const sockaddr, len: socklen_t) -> Option<u16> {
    if addr.is_null() || (len as usize) < std::mem::size_of::<libc::sockaddr_in>() {
        return None;
    }
    match (*addr).sa_family as c_int {
        libc::AF_INET => {
            let sin = addr as *const libc::sockaddr_in;
            Some(u16::from_be((*sin).sin_port))
        }
        libc::AF_INET6 => {
            if (len as usize) < std::mem::size_of::<libc::sockaddr_in6>() {
                return None;
            }
            let sin6 = addr as *const libc::sockaddr_in6;
            Some(u16::from_be((*sin6).sin6_port))
        }
        _ => None,
    }
}

/// True if the recv came from a DNS server (UDP port 53). Checks the explicit
/// source address first; falls back to getpeername for connected sockets.
unsafe fn is_dns_source(fd: c_int, addr: *const sockaddr, addrlen: *const socklen_t) -> bool {
    if !addr.is_null() && !addrlen.is_null() {
        if let Some(port) = sockaddr_port(addr, *addrlen) {
            return port == 53;
        }
    }
    // Connected UDP socket: recvfrom may pass NULL src_addr. Use getpeername.
    let mut peer: libc::sockaddr_storage = std::mem::zeroed();
    let mut peer_len = std::mem::size_of::<libc::sockaddr_storage>() as socklen_t;
    if libc::getpeername(fd, &mut peer as *mut _ as *mut sockaddr, &mut peer_len) != 0 {
        return false;
    }
    sockaddr_port(&peer as *const _ as *const sockaddr, peer_len) == Some(53)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_recvfrom(
    socket: c_int,
    buf: *mut c_void,
    len: size_t,
    flags: c_int,
    addr: *mut sockaddr,
    addrlen: *mut socklen_t,
) -> ssize_t {
    let real = match real_recvfrom() {
        Some(f) => f,
        None => {
            *libc::__error() = libc::ENOSYS;
            return -1;
        }
    };
    let ret = real(socket, buf, len, flags, addr, addrlen);
    if ret >= 12 && !buf.is_null() && is_dns_source(socket, addr, addrlen) {
        parse_dns_response(buf as *const u8, ret as usize);
    }
    ret
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_recvfrom_nocancel(
    socket: c_int,
    buf: *mut c_void,
    len: size_t,
    flags: c_int,
    addr: *mut sockaddr,
    addrlen: *mut socklen_t,
) -> ssize_t {
    let real = match real_recvfrom_nocancel() {
        Some(f) => f,
        None => {
            *libc::__error() = libc::ENOSYS;
            return -1;
        }
    };
    let ret = real(socket, buf, len, flags, addr, addrlen);
    if ret >= 12 && !buf.is_null() && is_dns_source(socket, addr, addrlen) {
        parse_dns_response(buf as *const u8, ret as usize);
    }
    ret
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn sandpit_recvmsg(
    socket: c_int,
    msg: *mut libc::msghdr,
    flags: c_int,
) -> ssize_t {
    let real = match real_recvmsg() {
        Some(f) => f,
        None => {
            *libc::__error() = libc::ENOSYS;
            return -1;
        }
    };
    let ret = real(socket, msg, flags);
    if ret < 12 || msg.is_null() {
        return ret;
    }
    let m = &*msg;
    // Check DNS source: prefer msg_name (recvfrom-style src addr), else
    // fall back to getpeername for connected sockets.
    let from_dns = if !m.msg_name.is_null()
        && m.msg_namelen as usize >= std::mem::size_of::<libc::sockaddr_in>()
    {
        sockaddr_port(m.msg_name as *const sockaddr, m.msg_namelen) == Some(53)
    } else {
        let mut peer: libc::sockaddr_storage = std::mem::zeroed();
        let mut peer_len = std::mem::size_of::<libc::sockaddr_storage>() as socklen_t;
        libc::getpeername(socket, &mut peer as *mut _ as *mut sockaddr, &mut peer_len) == 0
            && sockaddr_port(&peer as *const _ as *const sockaddr, peer_len) == Some(53)
    };
    if !from_dns || m.msg_iov.is_null() || m.msg_iovlen < 1 {
        return ret;
    }
    // DNS responses are small (< 4KB typical, 64KB hard cap on UDP), so
    // the first iovec almost always holds the full datagram. Skip the
    // gather-buffer reassembly complexity.
    let iov0 = &*m.msg_iov;
    if iov0.iov_base.is_null() {
        return ret;
    }
    let bytes = (ret as usize).min(iov0.iov_len);
    if bytes >= 12 {
        parse_dns_response(iov0.iov_base as *const u8, bytes);
    }
    ret
}

#[cfg(test)]
mod file_path_tests {
    #[test]
    fn trusted_session_writes_accept_aliases_but_keep_capabilities_frozen() {
        let root = test_root("session-capability-alias");
        let real_root = root.join("real");
        let alias = root.join("alias");
        let other_root = root.join("other");
        std::fs::create_dir_all(&real_root).unwrap();
        std::fs::create_dir_all(&other_root).unwrap();
        std::os::unix::fs::symlink(&real_root, &alias).unwrap();
        let immutable =
            resolve_policy_prefix(&real_root.join("session-state/nested-sessions/run-test"))
                .unwrap();
        let mutable =
            resolve_policy_prefix(&real_root.join("session-state/run-outer/nested/run-test"))
                .unwrap();
        let lock = resolve_policy_prefix(&real_root.join("adversary.lock")).unwrap();
        let blocked = vec![lock];
        for suffix in [
            "session-state/nested-sessions/run-test/config.toml",
            "session-state/run-outer/nested/run-test/claude/settings.json",
            "adversary.lock",
        ] {
            assert!(session_write_capability_allows(
                &alias.join(suffix),
                &immutable,
                &mutable,
                &alias,
                &blocked,
            ));
        }
        for suffix in [
            "session-state/nested-sessions/run-other/config.toml",
            "config.toml",
            "amp-review.sh",
        ] {
            assert!(!session_write_capability_allows(
                &alias.join(suffix),
                &immutable,
                &mutable,
                &alias,
                &blocked,
            ));
        }
        std::fs::remove_file(&alias).unwrap();
        std::os::unix::fs::symlink(&other_root, &alias).unwrap();
        assert!(!session_write_capability_allows(
            &alias.join("session-state/nested-sessions/run-test/config.toml"),
            &immutable,
            &mutable,
            &alias,
            &blocked,
        ));
        assert!(!session_write_capability_allows(
            &alias.join("adversary.lock"),
            &immutable,
            &mutable,
            &alias,
            &blocked,
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn session_overlay_keeps_protected_hooks_and_ancestors_blocked() {
        let root = Path::new("/tmp/session-state/run");
        let blocked = vec![
            PathBuf::from("/tmp/session-state"),
            root.join("claude/settings.json"),
        ];
        assert!(session_overlay_allows_write(
            &root.join("state"),
            root,
            &blocked,
            false
        ));
        assert!(!session_overlay_allows_write(
            &root.join("claude/settings.json"),
            root,
            &blocked,
            false
        ));
        assert!(!session_overlay_allows_write(
            &root.join("claude"),
            root,
            &blocked,
            true
        ));
        assert!(!session_overlay_allows_write(
            Path::new("/tmp/session-state/other"),
            root,
            &blocked,
            false
        ));
    }

    #[test]
    fn log_truncation_preserves_utf8_boundaries() {
        assert_eq!(truncate_log("éé", 3), "é...");
        assert_eq!(truncate_log("short", 10), "short");
    }
    use super::*;
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("sandpit-{name}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn resolves_missing_destination_through_symlinked_parent() {
        let root = test_root("missing-destination");
        let protected = root.join("protected");
        let allowed = root.join("allowed");
        std::fs::create_dir_all(&protected).unwrap();
        std::fs::create_dir_all(&allowed).unwrap();
        std::os::unix::fs::symlink(&protected, allowed.join("escape")).unwrap();

        let expected = std::fs::canonicalize(&protected).unwrap().join("new");
        assert_eq!(
            resolve_path(&allowed.join("escape/new"), FinalSymlink::NoFollow),
            Some(expected)
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nofollow_preserves_final_symlink_entry() {
        let root = test_root("nofollow-final");
        let protected = root.join("protected");
        let allowed = root.join("allowed");
        std::fs::create_dir_all(&protected).unwrap();
        std::fs::create_dir_all(&allowed).unwrap();
        let target = allowed.join("target");
        std::fs::write(&target, b"target").unwrap();
        let symlink = protected.join("link");
        std::os::unix::fs::symlink(&target, &symlink).unwrap();

        assert_eq!(
            resolve_path(&symlink, FinalSymlink::Follow),
            Some(std::fs::canonicalize(&target).unwrap())
        );
        assert_eq!(
            resolve_path(&symlink, FinalSymlink::NoFollow),
            Some(std::fs::canonicalize(&protected).unwrap().join("link"))
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolves_symlinks_before_parent_components() {
        let root = test_root("symlink-parent-component");
        let blocked = root.join("blocked");
        let allowed = root.join("allowed");
        std::fs::create_dir_all(blocked.join("sub")).unwrap();
        std::fs::create_dir_all(&allowed).unwrap();
        std::os::unix::fs::symlink(blocked.join("sub"), allowed.join("s")).unwrap();

        let path = allowed.join("s/../victim");
        let expected = std::fs::canonicalize(&blocked).unwrap().join("victim");
        assert_eq!(
            resolve_path(&path, FinalSymlink::Follow),
            Some(expected.clone())
        );
        assert_eq!(resolve_path(&path, FinalSymlink::NoFollow), Some(expected));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn policy_prefixes_are_frozen_after_resolution() {
        let root = test_root("policy-prefix");
        let target = root.join("target");
        let outside = root.join("outside");
        let alias = root.join("alias");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&target, &alias).unwrap();

        let variants = file_prefix_variants(&alias).unwrap();
        let target = std::fs::canonicalize(&target).unwrap();
        let outside = std::fs::canonicalize(&outside).unwrap();
        assert!(variants.contains(&normalize_path(&alias)));
        assert!(variants.contains(&target));

        std::fs::remove_file(&alias).unwrap();
        std::os::unix::fs::symlink(&outside, &alias).unwrap();
        assert!(matches_prefix(&target.join("file"), &variants));
        assert!(!matches_prefix(&outside.join("file"), &variants));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolves_policy_prefix_from_deepest_existing_ancestor() {
        let root = test_root("missing-policy-tail");
        std::fs::create_dir_all(&root).unwrap();
        let policy = root.join("not-created/nested/secret");
        let expected = std::fs::canonicalize(&root)
            .unwrap()
            .join("not-created/nested/secret");

        assert_eq!(resolve_policy_prefix(&policy), Some(expected));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserves_non_utf8_path_components() {
        let root = test_root("non-utf8");
        std::fs::create_dir_all(&root).unwrap();
        let name = OsString::from_vec(vec![b'n', b'e', b'w', 0xff]);

        assert_eq!(
            resolve_path(&root.join(&name), FinalSymlink::NoFollow),
            Some(std::fs::canonicalize(&root).unwrap().join(name))
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn frozen_policy_encoding_preserves_non_utf8_path_bytes() {
        let path = PathBuf::from(OsString::from_vec(vec![
            b'/', b't', b'm', b'p', b'/', b'p', b'o', b'l', b'i', b'c', b'y', 0xff,
        ]));
        let encoded = serialize_file_prefixes(std::slice::from_ref(&path));

        assert_eq!(deserialize_file_prefix_value(&encoded), Ok(vec![path]));
    }

    #[test]
    fn malformed_frozen_policy_encoding_is_rejected() {
        assert_eq!(deserialize_file_prefix_value("abc"), Err(()));
        assert_eq!(deserialize_file_prefix_value("zz"), Err(()));
    }

    #[test]
    fn detects_protected_descendants_when_renaming_a_parent() {
        let blocked = vec![PathBuf::from("/tmp/.sandpit/connections.jsonl")];

        assert!(contains_prefix(Path::new("/tmp/.sandpit"), &blocked));
        assert!(!contains_prefix(Path::new("/tmp/.sandpit-other"), &blocked));
    }
}
