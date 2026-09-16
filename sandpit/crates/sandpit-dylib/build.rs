fn main() {
    cc::Build::new()
        .file("src/interpose.c")
        .compile("interpose");

    // Export the C variadic wrappers and the Rust-populated original pointers.
    // The interpose table is in Rust and handled by #[link_section].
    for sym in &[
        "_sandpit_open",
        "_sandpit_openat",
        "_sandpit_real_open",
        "_sandpit_real_openat",
    ] {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-exported_symbol,{sym}");
    }
}
