#!/usr/bin/env python3
"""Safe file-policy regressions. Build release first; requires macOS and Node.js."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


BINARY = Path(__file__).resolve().parent / "target/release/sandpit"
NODE = shutil.which("node")
# Resolve Hermit before fixtures change HOME or clear the environment.
if NODE:
    NODE = subprocess.check_output([NODE, "-p", "process.execPath"], text=True).strip()


@unittest.skipUnless(NODE, "Node.js is required for DYLD file-policy tests")
class FilePolicyTests(unittest.TestCase):
    def test_open_errors_preserve_missing_parent_without_weakening_denies(self):
        with tempfile.TemporaryDirectory(prefix="sandpit-errno-", dir="/tmp") as tmp:
            root = Path(tmp).resolve()
            home = root / "home"
            home.mkdir()
            protected = root / "protected"
            protected.write_text("unchanged")
            config = root / "policy.toml"
            config.write_text("[files]\nblock_write = [" + json.dumps(str(protected)) + "]\n")
            script = r"""
const fs = require('fs');
const root = process.argv[1];
function check(path, flags, expected) {
    try { fs.openSync(path, flags); throw new Error('unexpected success'); }
    catch (e) { if (e.code !== expected) throw e; }
}
fs.writeFileSync(root + '/ordinary', 'file');
for (const flags of ['r', 'w']) {
    check(root + '/missing/child', flags, 'ENOENT');
    check(root + '/ordinary/missing/child', flags, 'ENOTDIR');
}
check(root + '/protected', 'w', 'EACCES');
fs.mkdirSync(root + '/missing');
fs.writeFileSync(root + '/missing/child', 'allowed');
try { fs.linkSync(root + '/protected', root + '/alias'); throw new Error('link succeeded'); }
catch (e) { if (e.code !== 'EACCES') throw e; }
"""
            env = os.environ.copy()
            env.update(HOME=str(home), XDG_CONFIG_HOME=str(home / ".config"))
            env.pop("SANDPIT_CONFIG", None)
            result = subprocess.run(
                [str(BINARY), "run", "--no-adversary", "--config", str(config),
                 "--", NODE, "-e", script, str(root)],
                env=env, capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(protected.read_text(), "unchanged")
            self.assertEqual((root / "missing/child").read_text(), "allowed")

    def test_missing_deny_prefix_survives_aliases_and_exec(self):
        for rule in ("block_write", "block_read"):
            for alias_kind in ("platform", "symlink", "canonical"):
                with self.subTest(rule=rule, alias=alias_kind):
                    with tempfile.TemporaryDirectory(prefix="sandpit-policy-", dir="/tmp") as tmp:
                        root = Path(tmp)
                        actual = root.resolve()
                        home = actual / "home"
                        home.mkdir()
                        if alias_kind == "symlink":
                            (actual / "alias").symlink_to(actual, target_is_directory=True)
                            requested = actual / "alias"
                        elif alias_kind == "canonical":
                            requested = actual
                        else:
                            requested = root
                        (actual / "target/secret").mkdir(parents=True)
                        existing = actual / "target/secret/existing"
                        existing.write_text("original")
                        config = actual / "config.toml"
                        # An ordinary allow rule must not override an explicit deny.
                        config.write_text(
                            "[files]\nallow_write = [" + json.dumps(str(actual)) + "]\n"
                            + rule + " = [" + json.dumps(str(requested / "future/secret")) + "]\n"
                        )
                        operation = (
                            "fs.writeFileSync(p, 'CHANGED')"
                            if rule == "block_write" else "fs.readFileSync(p)"
                        )
                        probe = """
const fs = require('fs');
const outcomes = [];
for (const p of PATHS) {
    try { OPERATION; outcomes.push('allowed'); }
    catch (e) { outcomes.push(e.code); }
}
console.log(JSON.stringify(outcomes));
""".replace("PATHS", json.dumps([
                            str(requested / "future/secret/existing"),
                            *([str(requested / "future/secret/new")] if rule == "block_write" else []),
                        ])).replace("OPERATION", operation)
                        script = """
const fs = require('fs');
const {spawnSync} = require('child_process');
try { fs.symlinkSync(TARGET, FUTURE); }
catch(e) { if (!["EPERM", "EACCES"].includes(e.code)) throw e; }
fs.writeFileSync(SAFE, 'safe');
eval(PROBE);
const child = spawnSync(process.execPath, ['-e', PROBE], {encoding: 'utf8'});
if (child.status !== 0) throw new Error(child.stderr);
process.stdout.write(child.stdout);
""".replace("TARGET", json.dumps(str(actual / "target"))) \
                            .replace("FUTURE", json.dumps(str(requested / "future"))) \
                            .replace("SAFE", json.dumps(str(actual / "safe"))) \
                            .replace("PROBE", json.dumps(probe))
                        env = os.environ.copy()
                        env.update(HOME=str(home), XDG_CONFIG_HOME=str(home / ".config"))
                        for key in ("SANDPIT_CONFIG", "SANDPIT_OTLP_ENDPOINT",
                                    "SANDPIT_CLASSIFIER_ENDPOINT", "AMP_SETTINGS_FILE"):
                            env.pop(key, None)
                        result = subprocess.run(
                            [str(BINARY), "run", "--no-adversary", "--no-shims",
                             "--config", str(config), "--", NODE, "-e", script],
                            env=env, capture_output=True, text=True, timeout=30,
                        )
                        self.assertEqual(result.returncode, 0, result.stderr)
                        outcomes = [json.loads(line) for line in result.stdout.splitlines()]
                        self.assertEqual(len(outcomes), 2, result.stdout)
                        for outcome in outcomes:
                            self.assertEqual(len(outcome), 2 if rule == "block_write" else 1)
                            self.assertTrue(all(code in ("EACCES", "EPERM", "ENOENT") for code in outcome), outcome)
                        self.assertEqual(existing.read_text(), "original")
                        self.assertFalse((actual / "target/secret/new").exists())
                        self.assertEqual((actual / "safe").read_text(), "safe")


@unittest.skipUnless(shutil.which("git"), "Git is required")
class GitCompatibilityTests(unittest.TestCase):
    def test_objects_reflogs_and_clone(self):
        with tempfile.TemporaryDirectory(prefix="sandpit-git-", dir="/tmp") as tmp:
            root = Path(tmp).resolve()
            home = root / "home"
            home.mkdir()
            config = root / "policy.toml"
            protected = root / "protected"
            protected.write_text("unchanged")
            config.write_text("[files]\nblock_write = [" + json.dumps(str(protected)) + "]\n")
            env = os.environ.copy()
            env.update(HOME=str(home), XDG_CONFIG_HOME=str(home / ".config"))
            for key in ("SANDPIT_CONFIG", "SANDPIT_OTLP_ENDPOINT",
                        "SANDPIT_CLASSIFIER_ENDPOINT", "AMP_SETTINGS_FILE"):
                env.pop(key, None)
            def run(*args):
                result = subprocess.run(
                    [str(BINARY), "run", "--no-adversary", "--config", str(config),
                     "--", shutil.which("git"), "-c", "core.fsmonitor=false",
                     "-c", "user.name=Sandbox Test", "-c", "user.email=test@example.invalid",
                     "-c", "commit.gpgsign=false", *map(str, args)],
                    cwd=root, env=env, capture_output=True, text=True, timeout=30,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                return result.stdout.strip()
            run("init", "source")
            (root / "source/input").write_text("git sandbox regression\n")
            run("-C", "source", "add", "input")
            run("-C", "source", "commit", "-m", "fixture")
            # Use Git transport rather than the local hard-link optimization.
            run("clone", "--no-local", root / "source", "clone")
            self.assertEqual(run("-C", "source", "rev-parse", "HEAD"),
                             run("-C", "clone", "rev-parse", "HEAD"))
            self.assertEqual(run("-C", "clone", "status", "--porcelain"), "")
            run("-C", "clone", "fsck", "--no-dangling")
            self.assertEqual(protected.read_text(), "unchanged")


if __name__ == "__main__":
    unittest.main()
