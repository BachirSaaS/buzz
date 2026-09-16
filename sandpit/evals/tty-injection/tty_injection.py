#!/usr/bin/env python3
"""Check terminal-input injection through an ordinary Sandpit launch."""

import argparse
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import pty
import secrets
import select
import shlex
import signal
import subprocess
import sys
import tempfile
import termios
import time


SCRIPT = Path(__file__).resolve()
REPO = SCRIPT.parents[2]
DENIALS = {errno.EPERM, errno.EACCES}


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def payload(fixture_path):
    fixture = json.loads(fixture_path.read_text())
    marker = Path(fixture['marker'])
    report = {'pid': os.getpid(), 'isatty': os.isatty(0),
              'dyld_interposed': bool(os.environ.get('DYLD_INSERT_LIBRARIES'))}
    try:
        profile = Path(os.environ['SANDPIT_CONFIG']).parent / 'kernel.sb'
        Path('kernel.sb').write_text(profile.read_text())
        # Ordinary terminal queries and mode changes must remain available.
        attributes = termios.tcgetattr(0)
        termios.tcsetattr(0, termios.TCSANOW, attributes)
        report['window_size'] = fcntl.ioctl(0, termios.TIOCGWINSZ, bytes(8)).hex()
        try:
            marker.write_text('UNEXPECTED_DIRECT_WRITE\n')
        except OSError as error:
            if error.errno not in DENIALS:
                raise
            report['direct_write_errno'] = error.errno
        else:
            raise RuntimeError('direct write succeeded; file-policy control failed')

        # The parent shell expands $$ after the sandboxed foreground command
        # exits, identifying the process that actually writes the marker.
        command = ("printf '%s %s\\n' " + shlex.quote(fixture['canary'])
                   + ' "$$" > ' + shlex.quote(str(marker)) + '\n').encode()
        report.update(injected_bytes=0, command_bytes=len(command))
        for byte in command:
            try:
                fcntl.ioctl(0, termios.TIOCSTI, bytes([byte]))
            except OSError as error:
                if error.errno not in DENIALS:
                    raise
                report['ioctl_errno'] = error.errno
                break
            report['injected_bytes'] += 1
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
    write_json(Path('payload-result.json'), report)
    return 2 if 'error' in report else 0


def reap_shell(pid, fd):
    try:
        try:
            os.write(fd, b'exit\n')
        except OSError:
            pass
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if os.waitpid(pid, os.WNOHANG)[0] == pid:
                return
            if select.select([fd], [], [], 0.05)[0]:
                try:
                    os.read(fd, 65536)
                except OSError:
                    pass
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
    finally:
        os.close(fd)


def run(args):
    args.output.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='run-', dir=args.output.resolve()))
    (root / 'home').mkdir()
    (root / 'protected').mkdir()
    marker = root / 'protected/marker'
    marker.write_text('UNCHANGED\n')
    fixture = {'marker': str(marker), 'canary': 'TTY-' + secrets.token_hex(16)}
    write_json(root / 'fixture.json', fixture)
    config = root / 'config.toml'
    config.write_text(
        '[files]\nblock_write = ' + json.dumps([str(root / 'protected')]) + '\n'
        + ('\n[network]\nallow = ["no-destinations-allowed.invalid"]\n' if args.network else '')
        + '\n[logs]\npath = ' + json.dumps(str(root / 'sandpit.log'))
        + '\naudit_path = ' + json.dumps(str(root / 'network.jsonl')) + '\n')
    binary = args.sandpit.resolve()
    report = {'outcome': 'INCONCLUSIVE', 'artifacts': str(root), 'binary': str(binary),
              'parent_shell': args.shell, 'network_rules': args.network,
              'platform': platform.platform(), 'expected': args.expect}
    pid = fd = None
    transcript = bytearray()
    print(f'Artifacts: {root}', flush=True)
    try:
        report['binary_sha256'] = hashlib.sha256(binary.read_bytes()).hexdigest()
        report['checkout_commit'] = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip()
        # The platform shell strips DYLD hooks so the payload tests the
        # inherited kernel policy without the interposed library.
        launch = [str(binary), 'run', '--config', str(config), '--no-adversary',
                  '--', '/bin/sh', '-c', 'exec "$@"', 'tty-poc',
                  sys.executable, str(SCRIPT), '_payload', 'fixture.json']
        report['launch_command'] = launch
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(('SANDPIT_', 'DYLD_'))}
        env.update(HOME=str(root / 'home'), XDG_CONFIG_HOME=str(root / 'home/.config'),
                   ZDOTDIR=str(root / 'home'), ENV='', PS1='', PS2='', TERM='dumb',
                   OTEL_SDK_DISABLED='true')
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(root)
            shell_args = [args.shell, '-f', '-i'] if args.shell == '/bin/zsh' else [args.shell, '-i']
            os.execve(args.shell, shell_args, env)
        report['parent_shell_pid'] = pid
        # Only this fresh PTY is touched. The parent receives a normal foreground
        # command, then resumes reading terminal input when that command exits.
        os.write(fd, (shlex.join(launch) + "; printf '%s\\n' \"$?\" > launch-status\n").encode())
        sent_resume = False
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 0.05)[0]:
                try:
                    chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                transcript.extend(chunk)
            if (root / 'launch-status').exists() and not sent_resume:
                # Queue this after the attack and wait for it to finish. An
                # unchanged marker alone cannot prove the parent resumed reading.
                command = ("printf '%s %s\\n' " + shlex.quote(fixture['canary'])
                           + ' "$$" > resumed.tmp; /bin/mv resumed.tmp resumed\n')
                os.write(fd, command.encode())
                sent_resume = True
            if (root / 'resumed').exists():
                break

        result = json.loads((root / 'payload-result.json').read_text())
        report['payload'] = result
        report['marker_contents'] = marker.read_text()
        expected = f"{fixture['canary']} {pid}\n"
        if (root / 'launch-status').read_text() != '0\n':
            raise RuntimeError('sandboxed launch failed')
        if (root / 'resumed').read_text() != expected:
            raise RuntimeError('parent shell did not resume normal terminal input')
        if 'error' in result or not result['isatty'] or result['dyld_interposed']:
            raise RuntimeError(f'payload controls failed: {result}')
        if result.get('direct_write_errno') not in DENIALS:
            raise RuntimeError('direct file write was not denied')
        if (result['injected_bytes'] == result['command_bytes']
                and report['marker_contents'] == expected):
            report['outcome'] = 'BYPASS'
        elif (result.get('ioctl_errno') in DENIALS and result['injected_bytes'] == 0
              and report['marker_contents'] == 'UNCHANGED\n'):
            report['outcome'] = 'BLOCKED'
        else:
            raise RuntimeError('injection did not produce the expected parent-shell write')
    except (Exception, KeyboardInterrupt) as error:
        report['error'] = f'{type(error).__name__}: {error}'
    finally:
        if pid and fd is not None:
            try:
                reap_shell(pid, fd)
            except Exception as error:
                report['cleanup_error'] = f'{type(error).__name__}: {error}'
        (root / 'transcript.txt').write_bytes(transcript)
        write_json(root / 'result.json', report)
    print(json.dumps(report, indent=2), flush=True)
    return 0 if report['outcome'] == args.expect.upper() and 'cleanup_error' not in report else 1


def main():
    if len(sys.argv) == 3 and sys.argv[1] == '_payload':
        return payload(Path(sys.argv[2]))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sandpit', type=Path, default=REPO / 'target/release/sandpit')
    parser.add_argument('--shell', choices=('/bin/sh', '/bin/zsh'), default='/bin/zsh')
    parser.add_argument('--network', action='store_true', help='also install network restrictions')
    parser.add_argument('--expect', choices=('bypass', 'blocked'), default='blocked')
    parser.add_argument('--output', type=Path, default=REPO / 'target/tty-injection')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('this PoC requires macOS')
    return run(args)


if __name__ == '__main__':
    sys.exit(main())
