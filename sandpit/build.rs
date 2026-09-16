use std::path::PathBuf;

fn main() {
    // The sandpit-dylib crate builds as a cdylib. Since it's a build-dependency,
    // cargo builds it before this crate. Find the built dylib and make its path
    // available to main.rs via an env var for include_bytes!().

    // Re-run when the dylib source changes so the embedded bytes stay fresh.
    println!("cargo:rerun-if-changed=crates/sandpit-dylib/src/lib.rs");
    println!("cargo:rerun-if-changed=crates/sandpit-dylib/src/interpose.c");
    println!("cargo:rerun-if-changed=crates/sandpit-dylib/build.rs");

    let target_dir = find_target_dir();

    // Search for the dylib in various cargo output locations.
    // The cdylib name is libsandpit_dylib.dylib (underscores, not hyphens).
    // Match the current build profile first.
    let current_profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let profiles = if current_profile == "release" {
        ["release", "debug"]
    } else {
        ["debug", "release"]
    };
    for profile in &profiles {
        let search_dirs = [
            target_dir.join(profile),
            target_dir.join(profile).join("deps"),
        ];
        for dir in &search_dirs {
            let dylib = dir.join("libsandpit_dylib.dylib");
            if dylib.exists() {
                println!(
                    "cargo:rustc-env=SANDPIT_DYLIB_PATH={}",
                    dylib.canonicalize().unwrap().display()
                );
                println!("cargo:rerun-if-changed={}", dylib.display());
                return;
            }
        }
    }

    // The dylib might not exist yet on first build. That's OK — cargo will
    // build the dependency first, then re-run this build script.
    // Use a placeholder that will cause a compile error if the dylib is truly missing.
    eprintln!(
        "cargo:warning=libsandpit_dylib.dylib not found in {}. \
         Run `cargo build` again if this is the first build.",
        target_dir.display()
    );
    println!("cargo:rustc-env=SANDPIT_DYLIB_PATH=/dev/null");
}

fn find_target_dir() -> PathBuf {
    // OUT_DIR is like .../target/debug/build/sandpit-xxx/out
    // Walk up to find the target dir
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let mut dir = out_dir.as_path();
    loop {
        if dir.file_name().map(|n| n == "target").unwrap_or(false) {
            return dir.to_path_buf();
        }
        dir = match dir.parent() {
            Some(p) => p,
            None => {
                // Fallback: assume target/ is in CARGO_MANIFEST_DIR
                let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
                return manifest.join("target");
            }
        };
    }
}
