# Terminal input injection regression

`tty_injection.py` checks whether a sandboxed child can queue a command for its
unsandboxed parent shell using `TIOCSTI`. This terminal ioctl inserts a byte into
the terminal's input queue. When the foreground child exits, the parent shell
can read the queued line and execute it with its own permissions.

On macOS 26.6.2 arm64, PR #83's unchanged head (`055a40a`) allowed the parent-shell
write in all four shell/network combinations below. With the fix, the first
injection attempt fails with EPERM in every case and the marker stays unchanged.

Sandpit now denies this ioctl in every generated kernel profile, regardless of
file or network configuration. Other terminal ioctls remain available. The rule
uses `libc::TIOCSTI`, which is `2147578994` on Darwin:

```scheme
(deny file-ioctl (ioctl-command 2147578994))
```

After building the release binary, run:

```sh
python3 evals/tty-injection/tty_injection.py
python3 evals/tty-injection/tty_injection.py --shell /bin/sh --network
```

The default expectation is `blocked`. To reproduce against an affected build,
pass `--sandpit /absolute/path/to/sandpit --expect bypass`. The kernel suite runs
both shells, with and without network rules:

```sh
python3 test-kernel-policy.py KernelTerminalTests
```

Each case starts a clean interactive shell on a fresh private PTY and runs the
real `sandpit run` command. A platform shell removes the DYLD hooks before
executing the Python payload, so the test checks the inherited kernel policy.
The payload first confirms that it can read terminal settings, set those same
settings, and query the window size. It then attempts a direct write to a
protected synthetic marker; that write must fail with EPERM or EACCES.

The payload next uses `TIOCSTI` to queue a command that writes a random canary and
the parent shell's PID to the same marker. A bypass requires every byte to be
accepted and the marker to contain exactly that canary and PID. A blocked result
requires the first ioctl to fail with EPERM or EACCES and the marker to remain
unchanged. In both cases the harness waits for the Sandpit command to exit and
for the parent shell to execute a subsequent ordinary terminal command. Startup
failures, missing reports, and timeouts fail the check.

This escape requires a shared controlling terminal and a parent shell that
resumes reading input. It does not establish that every agent or terminal mode
has those conditions. The harness touches only its private PTY and synthetic
files in a new directory, with a disposable home for Sandpit state. It closes
the PTY and reaps the shell after each case.

Evidence remains under `target/tty-injection/run-*`, or beneath `--output` when
specified. `result.json` records the binary SHA-256, checkout commit, platform,
launch command, ioctl result, parent and child PIDs, and marker contents.
`kernel.sb` captures the generated profile; `transcript.txt` records terminal
output. The checkout commit describes the harness checkout and does not attest
the source revision of an arbitrary binary supplied through `--sandpit`.
