#!/usr/bin/env python3
"""Real native agent + MCP + shell under Sandpit, with a local scripted model.

No real model, credentials, relay, or production user data are used. This proves
native tool plumbing and confinement; it is not the live UI conversation test.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import threading

repo = Path(__file__).resolve().parents[1]
root = Path(tempfile.mkdtemp(prefix='buzz-native-security-', dir='/tmp')).resolve()
for name in ['home', 'work', 'protected', 'outside', 'control']:
    (root / name).mkdir()
(root / 'protected/secret').write_text('synthetic')
(root / 'protected/keep').write_text('original')
(root / 'work/secret-link').symlink_to(root / 'protected/secret')
node = subprocess.check_output([str(repo / 'bin/node'), '-p', 'process.execPath'], text=True).strip()
probe_command = shlex.join([node, str(repo / 'scripts/fixtures/sandpit-acp-probe.cjs'), '--probe', '--root', str(root)])
requests = []

class Model(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append(request)
        if len(requests) == 1:
            names = [tool['function']['name'] for tool in request['tools']]
            shell = next(name for name in names if name.endswith('__shell') or name == 'shell')
            message = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'probe', 'type': 'function', 'function': {'name': shell, 'arguments': json.dumps({'command': probe_command, 'workdir': str(root / 'work')})}}]}
            finish = 'tool_calls'
        else:
            message = {'role': 'assistant', 'content': 'Scripted model: probe complete.'}
            finish = 'stop'
        body = json.dumps({'id': 'local-scripted-model', 'object': 'chat.completion', 'model': 'scripted-test', 'choices': [{'index': 0, 'message': message, 'finish_reason': finish}]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

server = ThreadingHTTPServer(('127.0.0.1', 0), Model)
threading.Thread(target=server.serve_forever, daemon=True).start()
values = {'BUZZ_AGENT_PROVIDER': 'openai', 'OPENAI_COMPAT_API_KEY': 'synthetic-test', 'OPENAI_COMPAT_MODEL': 'scripted-test', 'OPENAI_COMPAT_BASE_URL': f'http://127.0.0.1:{server.server_port}', 'BUZZ_AGENT_MAX_ROUNDS': '3', 'BUZZ_AGENT_NO_HINTS': '1', 'BUZZ_SANDBOX_FIXTURE': str(root)}
policy = {'schema_version': 1, 'writable_roots': [str(root / 'work')], 'denied_reads': [str(root / 'protected')], 'denied_writes': [str(root / 'protected')], 'network': {'mode': 'allowlist', 'destinations': [f'localhost:{server.server_port}']}, 'environment': list(values)}
source = root / 'control/policy.json'
source.write_text(json.dumps(policy))
status = root / 'control/protected'
env = {'HOME': str(root / 'home'), 'PATH': os.environ['PATH'], 'TMPDIR': str(root), 'BUZZ_ACP_SECURITY_STATUS': str(status), **values}
try:
    result = subprocess.run([str(repo / 'target/debug/buzz-acp'), 'sandbox-chat', '--policy', str(source), '--agent-command', str(repo / 'target/debug/buzz-agent'), '--mcp-command', str(repo / 'target/debug/buzz-dev-mcp'), '--workspace', str(root / 'work'), '--prompt', 'Execute the disposable probe once.'], env=env, text=True, capture_output=True, timeout=60)
    (root / 'transcript.txt').write_text(result.stdout + result.stderr)
    (root / 'model-requests.json').write_text(json.dumps(requests, indent=2))
    assert result.returncode == 0, result.stderr
    report = json.loads((root / 'work/report.json').read_text())
    assert len(requests) == 2, len(requests)
    assert len(status.read_text()) == 64
    assert report['allowed_write'] == 'allowed'
    for key in ['read', 'write', 'outside_write', 'hardlink', 'symlink_read', 'policy_tamper', 'empty_environment_read', 'socket']:
        assert report[key] in ['EACCES', 'EPERM'], (key, report)
    assert (root / 'protected/keep').read_text() == 'original'
    print(f'PASS native Buzz agent → local scripted model → MCP → real shell, with eight enforced denials.\nArtifacts: {root}')
finally:
    server.shutdown()
    server.server_close()
