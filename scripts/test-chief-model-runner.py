"""Regression checks at the actual CLI adapter boundary; no account or model call."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ADAPTER = Path(__file__).with_name('chief-model-runner.py').resolve()


class ModelAdapterTest(unittest.TestCase):
    def run_stub(self, source, environment=None):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'codex'
            binary.write_text('#!/usr/bin/python3\n' + source)
            binary.chmod(0o700)
            env = {**os.environ, 'PATH': directory + ':' + os.environ['PATH'], **(environment or {})}
            return subprocess.run([str(ADAPTER), 'exec', '--model', 'test', '-'], input='Synthetic test input', text=True, capture_output=True, env=env, start_new_session=True, timeout=15)

    def test_clears_signing_environment_and_disables_tools(self):
        result = self.run_stub('import json,os,sys\nprint(json.dumps({"args":sys.argv[1:],"key_present":"BUZZ_PRIVATE_KEY" in os.environ,"input":sys.stdin.read()}))', {'BUZZ_PRIVATE_KEY': 'synthetic-test-secret'})
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertFalse(data['key_present'])
        self.assertEqual(data['input'], 'Synthetic test input')
        for flag in ['--ignore-user-config', 'shell_tool', 'multi_agent', 'apps', 'plugins', 'web_search="disabled"']:
            self.assertIn(flag, data['args'])

    def test_excess_output_fails_and_is_bounded(self):
        result = self.run_stub('import sys\nsys.stdout.write("x" * 2000000)\nsys.stdout.flush()')
        self.assertNotEqual(result.returncode, 0)
        self.assertLessEqual(len(result.stdout), 1_000_000)
        self.assertIn('exceeded', result.stderr)


if __name__ == '__main__':
    unittest.main()
