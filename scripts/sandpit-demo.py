#!/usr/bin/env python3
"""Safe, repeatable confinement demo through Buzz's production ACP launch seam."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import shutil
import time

REPO = Path(__file__).resolve().parents[1]
NODE = subprocess.check_output([str(REPO / 'bin/node'), '-p', 'process.execPath'], text=True).strip()
root = Path(tempfile.mkdtemp(prefix='buzz-sandpit-demo-')).resolve()
for name in ['protected', 'work', 'outside']:
    (root / name).mkdir()
(root / 'protected/secret').write_text('synthetic secret; no real credentials')
(root / 'protected/keep').write_text('original')
(root / 'work/secret-link').symlink_to(root / 'protected/secret')
policy = {
    'schema_version': 1,
    'writable_roots': [str(root / 'work')],
    'denied_reads': [str(root / 'protected')],
    'denied_writes': [str(root / 'protected')],
    'network': {'mode': 'deny_all'},
    'environment': ['BUZZ_SANDBOX_FIXTURE'],
}
(root / 'policy.json').write_text(json.dumps(policy, indent=2))
env = os.environ.copy()
env['BUZZ_SANDBOX_FIXTURE'] = str(root)
env['BUZZ_SANDBOX_UNGRANTED_SECRET'] = 'synthetic-ambient-secret'
args = [str(REPO / 'target/debug/buzz-acp'), 'sandbox-chat', '--policy', str(root / 'policy.json'),
        '--agent-command', NODE, '--arg', str(REPO / 'scripts/fixtures/sandpit-acp-probe.cjs'),
        '--workspace', str(root / 'work'), '--prompt', 'Complete ordinary work and try the escape probes.']
print('Buzz + Sandpit: real ACP launch, disposable synthetic files', flush=True)
# Negative control: identical probes have access without the production guard.
control = subprocess.run([NODE, str(REPO / 'scripts/fixtures/sandpit-acp-probe.cjs'), '--probe'],
    env={'PATH': os.environ.get('PATH', ''), 'BUZZ_SANDBOX_FIXTURE': str(root)},
    text=True, capture_output=True, timeout=10)
assert control.returncode == 0, control.stderr
control_report = json.loads((root / 'work/report.json').read_text())
for field in ['read', 'write', 'outside_write', 'symlink_read', 'empty_environment_read']:
    assert control_report[field] == 'allowed', (field, control_report)
(root / 'work/alias').unlink()
(root / 'outside/escape').unlink()
(root / 'protected/keep').write_text('original')
print('PASS  negative control: probes succeed without confinement')

result = subprocess.run(args, env=env, text=True, capture_output=True, timeout=90)
print(result.stderr)
if result.returncode:
    raise SystemExit(result.returncode)
report = json.loads((root / 'work/report.json').read_text())
for _ in range(30):
    try:
        os.kill(report['descendant_pid'], 0)
    except ProcessLookupError:
        break
    time.sleep(0.1)
else:
    raise AssertionError('Buzz shutdown stranded a descendant')
print('PASS  descendant stopped with Buzz')
assert report['allowed_write'] == 'allowed', report
assert report['ambient_secret'] == 'absent', report
for field in ['read', 'write', 'outside_write', 'hardlink', 'symlink_read', 'policy_tamper', 'empty_environment_read', 'socket']:
    assert report[field] in ['EPERM', 'EACCES'], (field, report)
    print(f'PASS  {field.replace("_", " ")} blocked')
assert (root / 'protected/keep').read_text() == 'original'
assert 'Protected' in result.stderr
print('PASS  ordinary workspace work completed')
print('PASS  ungranted environment secret removed')
# A second process exercises the same frozen-input launch path afresh.
second = subprocess.run(args[:-2], input='/restart\nRun the probes.\n/quit\n', env=env, text=True, capture_output=True, timeout=90)
assert second.returncode == 0 and 'Restarted under the same immutable policy' in second.stderr, second.stderr
print('PASS  restart and reinitialize')
# Fail closed before even launching an adapter.
invalid = dict(policy, schema_version=999)
(root / 'invalid.json').write_text(json.dumps(invalid))
invalid_args = list(args)
invalid_args[invalid_args.index('--policy')+1] = str(root / 'invalid.json')
failed = subprocess.run(invalid_args, env=env, text=True, capture_output=True, timeout=20)
assert failed.returncode != 0 and 'unsupported security schema' in failed.stderr
print('PASS  unsupported policy refused')
# A separate executable directory must not fall back to PATH/Homebrew.
with tempfile.TemporaryDirectory(prefix='buzz-missing-engine-') as isolated:
    isolated = Path(isolated)
    harness = isolated / 'buzz-acp'
    shutil.copy2(REPO / 'target/debug/buzz-acp', harness)
    isolated_args = [str(harness), *args[1:]]
    absent = subprocess.run(isolated_args, env=env, text=True, capture_output=True, timeout=20)
    assert absent.returncode != 0 and 'bundled buzz-sandpit is missing' in absent.stderr, absent.stderr
    print('PASS  missing engine refused without fallback')
    engine = isolated / 'buzz-sandpit'
    engine.write_text('#!/bin/sh\nprintf incompatible\n')
    engine.chmod(0o700)
    incompatible = subprocess.run(isolated_args, env=env, text=True, capture_output=True, timeout=20)
    assert incompatible.returncode != 0 and 'incompatible bundled security engine' in incompatible.stderr, incompatible.stderr
    print('PASS  incompatible engine refused without fallback')

print(f'\nTry/edit the policy: {root / "policy.json"}')
print(f'Work product:       {root / "work/result.txt"}')
print(f'Probe report:       {root / "work/report.json"}')
