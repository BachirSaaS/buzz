# Sandpit local builds

Sandpit is a macOS-only engine in a separate Cargo workspace with its own
lockfile. Use the Buzz Hermit toolchain from the Buzz repository root.

- Build: `just sandpit-build`
- Test with disposable kernel/file-policy fixtures: `just sandpit-test`

The build rebuilds the dylib before embedding it in the binary. Standalone
runs may cache a dylib at `~/.sandpit/lib/libsandpit.dylib`; remove a stale
cached copy after changing dylib versions.

Do not run the legacy `test.sh` against real paths: it includes probes against
system and home-directory paths.

## Default configuration

The build embeds `examples/portable-default.toml`. The ignored local
`examples/default.toml` is not read or required by builds.

## Engine isolation

The engine contains macOS FFI and unsafe code. Keep it isolated in this
separate workspace; Buzz integration code must follow Buzz's safe-Rust rule.
