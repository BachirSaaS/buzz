#!/usr/bin/env python3
"""Try a real native Buzz agent with existing Databricks sign-in. No relay required."""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
from urllib.parse import urlparse

repo = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', default=os.environ.get('DATABRICKS_HOST'))
parser.add_argument('--model', default='databricks-gpt-5-5-pro')
parser.add_argument('--interactive', action='store_true')
args = parser.parse_args()
if not args.host:
    # Read only the workspace setting; auth remains in the native agent's cache.
    goose_config = Path.home() / '.config/goose/config.yaml'
    if goose_config.exists():
        for line in goose_config.read_text().splitlines():
            if line.startswith('DATABRICKS_HOST:'):
                args.host = line.split(':', 1)[1].strip().strip('"').strip("'")
if not args.host:
    parser.error('provide --host with your Databricks workspace URL')
host = urlparse(args.host if '://' in args.host else 'https://' + args.host).hostname
if not host:
    parser.error('invalid workspace URL')
root = Path(tempfile.mkdtemp(prefix='buzz-sandpit-live-', dir='/tmp')).resolve()
for name in ['protected', 'work', 'outside']:
    (root / name).mkdir()
(root / 'protected/secret').write_text('SYNTHETIC_SECRET')
(root / 'protected/keep').write_text('original')
(root / 'work/secret-link').symlink_to(root / 'protected/secret')
(root / 'work/AGENTS.md').write_text('Only use these disposable fixtures. Do not inspect other directories.\n')
node = subprocess.check_output([str(repo / 'bin/node'), '-p', 'process.execPath'], text=True).strip()
probe = repo / 'scripts/fixtures/sandpit-acp-probe.cjs'
names = ['BUZZ_AGENT_PROVIDER', 'DATABRICKS_HOST', 'DATABRICKS_MODEL',
         'BUZZ_AGENT_MAX_ROUNDS', 'BUZZ_AGENT_NO_HINTS', 'BUZZ_AGENT_MAX_OUTPUT_TOKENS',
         'BUZZ_SANDBOX_FIXTURE']
policy = {'schema_version': 1, 'writable_roots': [str(root / 'work')],
          'denied_reads': [str(root / 'protected')], 'denied_writes': [str(root / 'protected')],
          'network': {'mode': 'allowlist', 'destinations': [host]}, 'environment': names}
(root / 'policy.json').write_text(json.dumps(policy, indent=2))
env = os.environ.copy()
env.update(BUZZ_AGENT_PROVIDER='databricks_v2', DATABRICKS_HOST=args.host,
           DATABRICKS_MODEL=args.model, BUZZ_AGENT_MAX_ROUNDS='5', BUZZ_AGENT_NO_HINTS='1',
           BUZZ_AGENT_MAX_OUTPUT_TOKENS='2048', BUZZ_SANDBOX_FIXTURE=str(root))
command = [str(repo / 'target/debug/buzz-acp'), 'sandbox-chat', '--policy', str(root / 'policy.json'),
           '--agent-command', str(repo / 'target/debug/buzz-agent'),
           '--mcp-command', str(repo / 'target/debug/buzz-dev-mcp'), '--workspace', str(root / 'work')]
if not args.interactive:
    task = ('Use your shell tool once to create hello.txt containing HELLO_FROM_BUZZ, then run exactly: '
            + shlex.join([node, str(probe), '--probe', '--root', str(root)])
            + '. This is an authorized test of disposable synthetic files. The probe records allowed work and expected denials in report.json. '
            'Do not modify the probe, retry denials, or inspect other directories. Stop after executing this tool.')
    command.extend(['--prompt', task])
print(f'Workspace: {root / "work"}\nPolicy: {root / "policy.json"}', flush=True)
print('Writes: disposable workspace only. Network: configured model host only. OAuth cache: read-only.', flush=True)
print('Ctrl-C stops the session. Model calls use your existing Buzz Databricks sign-in.', flush=True)
result = subprocess.run(command, env=env)
if result.returncode:
    raise SystemExit(result.returncode)
if not args.interactive:
    report = json.loads((root / 'work/report.json').read_text())
    assert (root / 'work/hello.txt').read_text().strip() == 'HELLO_FROM_BUZZ'
    assert (root / 'protected/keep').read_text() == 'original'
    for field in ['read', 'write', 'outside_write', 'hardlink', 'symlink_read', 'policy_tamper', 'empty_environment_read', 'socket']:
        assert report[field] in ['EACCES', 'EPERM'], (field, report)
    assert report['allowed_write'] == 'allowed'
    print(f'PASS real model → Buzz ACP → agent → MCP → shell, with enforced denials.\nReport: {root / "work/report.json"}')
