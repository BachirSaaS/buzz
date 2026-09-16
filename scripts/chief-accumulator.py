"""Local prototype bootstrap. Source, database and build outputs stay gitignored."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
REVISION = '5d12db76c0b6b59c686c5a9aaf9d2367bd73f7ad'
URL = 'https://buzz.block.builderlab.xyz/git/478bb5a31222ea2b28a3d1afb8b1d598940628f19c2a87efc3c4b822299eeec6/intelligence-workbench'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, help='Use an existing clean checkout of the pinned revision')
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--relay', default='wss://buzz.block.builderlab.xyz')
    args = parser.parse_args()
    os.umask(0o077)
    base = ROOT / '.cache/chief'
    base.mkdir(parents=True, exist_ok=True)
    source = args.source_dir.resolve() if args.source_dir else base / 'source'
    identity = None

    def load_identity():
        nonlocal identity
        if identity:
            return identity
        result = subprocess.run(['/usr/bin/security', 'find-generic-password', '-s', 'buzz-desktop', '-a', 'secrets', '-w'], capture_output=True, text=True)
        if result.returncode:
            sys.exit('Could not access the existing Buzz identity in Keychain.')
        try:
            identity = json.loads(result.stdout).get('identity')
        except (ValueError, AttributeError):
            sys.exit('Unexpected Buzz Keychain format.')
        if not isinstance(identity, str) or not identity.strip():
            sys.exit('No Buzz identity found in Keychain.')
        identity = identity.strip()
        return identity

    if not source.exists():
        helper = ROOT / 'target/release/git-credential-nostr'
        if not helper.is_file():
            subprocess.run([str(ROOT / 'bin/cargo'), 'build', '--release', '-p', 'git-credential-nostr'], cwd=ROOT, check=True)
        environment = os.environ.copy()
        environment.update(NOSTR_PRIVATE_KEY=load_identity(), GIT_TERMINAL_PROMPT='0')
        subprocess.run(['git', '-c', 'credential.helper=', '-c', f'credential.helper={helper}', '-c', 'credential.useHttpPath=true', 'clone', '--single-branch', '--branch', 'main', URL, str(source)], env=environment, check=True, timeout=180)
        subprocess.run(['git', '-C', str(source), 'checkout', '--detach', REVISION], check=True)
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain', '--untracked-files=no'], text=True).strip()
    if revision != REVISION or dirty:
        sys.exit(f'Expected a clean Accumulator checkout at {REVISION}. No files were reset.')
    target = base / 'target'
    subprocess.run([str(ROOT / 'bin/cargo'), 'build', '--locked', '--manifest-path', str(source / 'Cargo.toml'), '--target-dir', str(target), '-p', 'buzz-accumulator'], cwd=source, check=True)
    if args.build_only:
        return
    key = load_identity()
    # Separate local databases for every identity/relay. The directory is an opaque
    # hash; neither the key nor a key file is persisted in the source checkout.
    scope = hashlib.sha256((args.relay.rstrip('/') + '\0' + key).encode()).hexdigest()
    data = base / 'data' / scope
    data.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    for name in list(environment):
        if name.startswith(('BUZZ_', 'NOSTR_')):
            del environment[name]
    environment['BUZZ_FOLD_RUNNER_BIN'] = str(ROOT / 'scripts/chief-model-runner.py')
    with tempfile.TemporaryDirectory(prefix='buzz-chief-identity-') as keydir:
        keyfile = Path(keydir) / 'identity.key'
        keyfile.write_text(key)
        keyfile.chmod(0o600)
        print('Starting private briefings on 127.0.0.1:4640 using your Buzz identity.', flush=True)
        print('Open Home → Saved briefings. Accumulator model calls only happen when you choose Run.', flush=True)
        child = subprocess.Popen([str(target / 'debug/buzz-accumulator'), '--key-file', str(keyfile), '--relay', args.relay, '--db', str(data / 'accumulator.db'), '--http-addr', '127.0.0.1:4640'], env=environment, cwd=data)
        try:
            sys.exit(child.wait())
        except KeyboardInterrupt:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(f'Accumulator setup failed (exit {error.returncode}).')
