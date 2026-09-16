#!/usr/bin/python3
"""Bounded text-only CLI adapter for the pinned Accumulator (macOS/Unix)."""
import os
import selectors
import shutil
import signal
import subprocess
import sys
import time


def main():
    # The upstream runner starts this adapter as a process-group leader.
    # Keep the CLI in that group so the daemon's deadline contains both.
    if os.getpgrp() != os.getpid():
        sys.exit('The model adapter must be launched by the Accumulator.')
    args = sys.argv[1:]
    codex = args[:1] == ['exec']
    binary = shutil.which('codex' if codex else 'claude')
    if not binary:
        sys.exit('Install and sign in to the selected model CLI.')
    if codex:
        args = args[:-1] + ['--ignore-user-config', '--disable', 'shell_tool', '--disable', 'multi_agent', '--disable', 'apps', '--disable', 'plugins', '-c', 'web_search="disabled"', '-c', 'tools.view_image=false', '-c', 'project_doc_max_bytes=0', '-c', 'model_reasoning_effort="low"', '-']
    else:
        args += ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--disable-slash-commands']
    allowed = {'PATH', 'HOME', 'USER', 'TMPDIR', 'CODEX_HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'MAX_THINKING_TOKENS'}
    env = {key: value for key, value in os.environ.items() if key in allowed}
    child = subprocess.Popen([binary, *args], stdin=sys.stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    poller = selectors.DefaultSelector()
    poller.register(child.stdout, selectors.EVENT_READ, sys.stdout.buffer)
    poller.register(child.stderr, selectors.EVENT_READ, sys.stderr.buffer)
    deadline = time.monotonic() + 590
    size = 0
    while poller.get_map():
        if time.monotonic() > deadline:
            os.killpg(os.getpgrp(), signal.SIGKILL)
        for key, _ in poller.select(timeout=0.2):
            chunk = os.read(key.fileobj.fileno(), 8192)
            if not chunk:
                poller.unregister(key.fileobj)
                continue
            size += len(chunk)
            if size > 1_000_000:
                sys.stderr.write('Model output exceeded the local briefing limit.\n')
                sys.stderr.flush()
                os.killpg(os.getpgrp(), signal.SIGKILL)
            key.data.write(chunk)
            key.data.flush()
    while child.poll() is None:
        if time.monotonic() > deadline:
            os.killpg(os.getpgrp(), signal.SIGKILL)
        time.sleep(0.05)
    sys.exit(child.returncode)


if __name__ == '__main__':
    main()
