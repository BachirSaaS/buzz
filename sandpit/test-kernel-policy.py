#!/usr/bin/env python3
"""Disposable macOS regressions for the mandatory kernel sandbox."""
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parent
BINARY = ROOT / 'target/release/sandpit'
DYLIB = ROOT / 'target/release/libsandpit_dylib.dylib'
NODE = shutil.which('node')
# Resolve Hermit before fixtures change HOME or clear the environment.
if NODE:
    NODE = subprocess.check_output([NODE, "-p", "process.execPath"], text=True).strip()


@unittest.skipUnless(NODE, 'Node.js required')
class KernelFilePolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sandpit-kernel-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        (self.root / 'home').mkdir()
        (self.root / 'protected').mkdir()
        (self.root / 'protected/secret').write_text('synthetic')
        (self.root / 'protected/keep').write_text('original')
        self.config = self.root / 'policy.toml'
        self.config.write_text('[files]\nblock_read = ' + json.dumps([
            str(self.root / 'protected/secret')]) + '\nblock_write = ' + json.dumps([
            str(self.root / 'protected')]) + '\n')
        self.env = os.environ.copy()
        for name in list(self.env):
            if name.startswith('SANDPIT_') or name == 'DYLD_INSERT_LIBRARIES':
                self.env.pop(name)
        self.env['HOME'] = str(self.root / 'home')

    def run_agent(self, *args):
        return subprocess.run([
            str(BINARY), 'run', '--no-adversary',
            '--config', str(self.config), '--', NODE, *args,
        ], env=self.env, cwd=self.root, text=True, capture_output=True, timeout=30)

    def test_file_denies_survive_system_shell_and_empty_environment(self):
        probe = self.root / 'probe.js'
        probe.write_text(r'''
const fs = require('fs');
const root = process.argv[2];
const out = {dyld: Boolean(process.env.DYLD_INSERT_LIBRARIES)};
for (const [name, action] of [
 ['read', () => fs.readFileSync(root + '/protected/secret')],
 ['write', () => fs.writeFileSync(root + '/protected/keep', 'CHANGED')]]) {
 try { action(); out[name] = 'allowed'; } catch(e) { out[name] = e.code; }
}
fs.writeFileSync(root + '/normal', 'normal work');
console.log(JSON.stringify(out));
''')
        script = r'''
const cp = require('child_process');
const [probe, root] = process.argv.slice(1);
for (const [command, args] of [
 [process.execPath, [probe, root]],
 ['/bin/sh', ['-c', 'exec "$1" "$2" "$3"', 'probe', process.execPath, probe, root]],
 ['/bin/sh', ['-c', 'exec /usr/bin/env -i "$1" "$2" "$3"', 'probe', process.execPath, probe, root]],
 ['/bin/sh', ['-c', 'exec /bin/sh -c \'exec "$1" "$2" "$3"\' probe "$1" "$2" "$3"', 'probe', process.execPath, probe, root]],
]) {
 const child = cp.spawnSync(command, args, {encoding:'utf8'});
 if (child.status !== 0) throw Error(child.stderr);
 process.stdout.write(child.stdout);
}
'''
        result = self.run_agent('-e', script, str(probe), str(self.root))
        self.assertEqual(result.returncode, 0, result.stderr)
        outcomes = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(outcomes), 4)
        self.assertTrue(outcomes[0]['dyld'])
        self.assertTrue(all(not outcome['dyld'] for outcome in outcomes[1:]))
        for outcome in outcomes:
            self.assertIn(outcome['read'], ('EACCES', 'EPERM'))
            self.assertIn(outcome['write'], ('EACCES', 'EPERM'))
        self.assertEqual((self.root / 'protected/keep').read_text(), 'original')
        self.assertEqual((self.root / 'normal').read_text(), 'normal work')

    def test_preference_service_respects_file_denies(self):
        account_home = Path(pwd.getpwuid(os.getuid()).pw_dir)
        domain = 'org.sandpit.synthetic.' + uuid.uuid4().hex
        preference = account_home / 'Library/Preferences' / (domain + '.plist')
        marker = 'SANDPIT_CANARY_' + uuid.uuid4().hex
        preference_env = dict(self.env, HOME=str(account_home))

        def remove_domain():
            subprocess.run(['/usr/bin/defaults', 'delete', domain], env=preference_env,
                           capture_output=True, timeout=15)
            if preference.exists():
                preference.unlink()

        self.addCleanup(remove_domain)
        subprocess.run(['/usr/bin/defaults', 'write', domain, 'canary', '-string', marker],
                       env=preference_env, check=True, capture_output=True, timeout=15)
        self.assertEqual(subprocess.check_output(
            ['/usr/bin/defaults', 'read', domain, 'canary'], env=preference_env,
            text=True, timeout=15).strip(), marker)
        self.config.write_text('[files]\nblock_read = ' + json.dumps([str(preference)])
                               + '\nblock_write = ' + json.dumps([str(preference)]) + '\n')
        # cfprefsd serves the actual account's preferences. Keep Sandpit's
        # scaffolding in the disposable home and restore HOME only in the child.
        script = r'''
const cp = require('child_process');
const [home, domain, preference] = process.argv.slice(1);
for (const [name, command, args] of [
 ['direct-read', '/bin/cat', [preference]],
 ['direct-write', '/bin/sh', ['-c', 'exec 3>>"$1"', 'probe', preference]],
 ['preferences-read', '/usr/bin/defaults', ['read', domain, 'canary']],
 ['preferences-write', '/usr/bin/defaults', ['write', domain, 'canary', '-string', 'changed']],
]) {
 const child = cp.spawnSync('/usr/bin/env', ['HOME=' + home, command, ...args], {encoding:'utf8'});
 if (child.error || child.status === null) throw child.error || Error(child.stderr);
 console.log(JSON.stringify({name, status:child.status, stdout:child.stdout, stderr:child.stderr}));
}
'''
        result = self.run_agent('-e', script, str(account_home), domain, str(preference))
        self.assertEqual(result.returncode, 0, result.stderr)
        outcomes = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(outcomes), 4)
        for outcome in outcomes:
            with self.subTest(operation=outcome['name']):
                self.assertNotEqual(outcome['status'], 0, outcome)
        self.assertEqual(subprocess.check_output(
            ['/usr/bin/defaults', 'read', domain, 'canary'], env=preference_env,
            text=True, timeout=15).strip(), marker)

    @unittest.skipUnless(shutil.which('cc'), 'C compiler required')
    def test_agent_constructor_is_already_confined(self):
        source = self.root / 'constructor.c'
        source.write_text(r"""
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <unistd.h>
#include <sys/syscall.h>
static int result;
__attribute__((constructor)) static void probe(void) {
    int fd = syscall(SYS_open, "protected/keep", O_WRONLY | O_TRUNC, 0);
    result = fd < 0 ? errno : 0;
    if (fd >= 0) close(fd);
}
int main(void) { printf("%d\n", result); return result == EACCES || result == EPERM ? 0 : 1; }
""")
        executable = self.root / 'constructor'
        subprocess.run(['cc', str(source), '-o', str(executable)], check=True, capture_output=True)
        result = subprocess.run([str(BINARY), 'run', '--no-adversary', '--config',
                                 str(self.config), '--', str(executable)],
                                cwd=self.root, env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'protected/keep').read_text(), 'original')

    def test_proxy_rejects_denied_domain_and_raw_ip(self):
        with self.config.open('a') as config:
            config.write('\n[network]\nallow=["example.com"]\n')
        code = r"""
const net=require('net');
async function request(host) {
 return await new Promise((resolve,reject)=>{
 const socket=net.connect({host:'127.0.0.1',port:Number(process.env.SANDPIT_PROXY_PORT)});
 let response=''; socket.on('connect',()=>socket.write('CONNECT '+host+':443 HTTP/1.1\r\n\r\n'));
 socket.on('data',data=>response+=data); socket.on('error',reject);
 socket.on('end',()=>{if(!response.startsWith('HTTP/1.1 403 ')) reject(Error(response));else resolve()});
 });
}
(async()=>{await request('blocked.invalid');await request('127.0.0.1');console.log('proxy-denied')})().catch(e=>{console.error(e);process.exit(1)});
"""
        result = self.run_agent('-e', code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'proxy-denied')

    def test_domain_policy_ignores_stale_ssh_agent_when_ssh_unconfigured(self):
        with self.config.open('a') as config:
            config.write('\n[network]\nblock=["blocked.invalid"]\n')
        self.env['SSH_AUTH_SOCK'] = str(self.root / 'missing-agent.sock')
        result = self.run_agent('-e', "console.log('started')")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'started')

    def test_internal_hardlinks_are_allowed_but_remain_protected(self):
        os.link(self.root / 'protected/keep', self.root / 'protected/second-name')
        result = self.run_agent('-e', "console.log('started')")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'started')

    def test_extra_inherited_descriptor_is_closed(self):
        import fcntl
        with (self.root / 'protected/keep').open('r+') as stream:
            descriptor = fcntl.fcntl(stream.fileno(), fcntl.F_DUPFD, 1000)
            try:
                code = "try{require('fs').writeSync(%d,'bad');process.exit(1)}catch(e){if(e.code!=='EBADF')throw e}" % descriptor
                result = subprocess.run([str(BINARY), 'run', '--no-adversary', '--config', str(self.config),
                                         '--', NODE, '-e', code], cwd=self.root, env=self.env,
                                        pass_fds=(descriptor,), capture_output=True, text=True, timeout=30)
            finally:
                os.close(descriptor)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'protected/keep').read_text(), 'original')

    @unittest.skipUnless(shutil.which('cc'), 'C compiler required')
    def test_broker_serves_detached_descendant_until_lease_released(self):
        self.config.write_text(self.config.read_text() + '\n[network]\nblock = ["blocked.invalid"]\n')
        source = self.root / 'broker-detach.c'
        source.write_text(r"""
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <arpa/inet.h>
int main(void) {
    int ready[2];
    if (pipe(ready)) return 1;
    pid_t child = fork();
    if (child < 0) return 2;
    if (child == 0) {
        close(ready[0]);
        if (setsid() < 0) _exit(3);
        close(0); close(1); close(2);
        alarm(20);
        FILE *state = fopen("child-state", "w");
        if (!state) _exit(4);
        fprintf(state, "%s\n", getenv("SANDPIT_CONFIG"));
        fclose(state);
        if (write(ready[1], "r", 1) != 1) _exit(5);
        close(ready[1]);
        while (access("probe-broker", F_OK) != 0) usleep(10000);
        int fd = socket(AF_INET, SOCK_STREAM, 0);
        struct sockaddr_in address = {0};
        address.sin_family = AF_INET;
        address.sin_port = htons(atoi(getenv("SANDPIT_PROXY_PORT")));
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        const char *request = "CONNECT blocked.invalid:443 HTTP/1.1\r\nHost: blocked.invalid:443\r\n\r\n";
        char response[256] = {0};
        int ok = fd >= 0 && connect(fd, (struct sockaddr *)&address, sizeof(address)) == 0
            && write(fd, request, strlen(request)) == (ssize_t)strlen(request)
            && read(fd, response, sizeof(response) - 1) > 0
            && strstr(response, "403");
        if (fd >= 0) close(fd);
        FILE *result = fopen("broker-result", "w");
        if (result) { fputs(ok ? "403" : "failed", result); fclose(result); }
        while (access("release-child", F_OK) != 0) usleep(10000);
        _exit(ok ? 0 : 6);
    }
    close(ready[1]);
    char byte;
    if (read(ready[0], &byte, 1) != 1) return 7;
    close(ready[0]);
    printf("agent exited\n");
    return 23;
}
""")
        executable = self.root / 'broker-detach'
        subprocess.run(['cc', str(source), '-o', str(executable)], check=True, capture_output=True)
        process = subprocess.Popen([str(BINARY), 'run', '--no-adversary', '--config',
                                    str(self.config), '--', str(executable)], cwd=self.root,
                                   env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True)
        try:
            deadline = time.monotonic() + 15
            while not (self.root / 'child-state').exists():
                if process.poll() is not None or time.monotonic() >= deadline:
                    self.fail('agent did not start detached child')
                time.sleep(0.02)
            # The initial agent flushes this line as it exits; the detached child
            # has already closed stdout. Let the launcher observe that exit.
            self.assertEqual(process.stdout.readline(), 'agent exited\n')
            time.sleep(0.3)
            self.assertIsNone(process.poll(), 'launcher exited while broker was still needed')
            session = Path((self.root / 'child-state').read_text().strip()).parent
            mutable = Path(json.loads((session / 'mutable-root.json').read_text()))
            (self.root / 'probe-broker').touch()
            deadline = time.monotonic() + 10
            while not (self.root / 'broker-result').exists():
                if time.monotonic() >= deadline:
                    self.fail('detached child did not receive broker response')
                time.sleep(0.02)
            self.assertEqual((self.root / 'broker-result').read_text(), '403')
            self.assertTrue(session.is_dir())
            self.assertTrue(mutable.is_dir())
            (self.root / 'release-child').touch()
            _, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 23, stderr)
            self.assertFalse(session.exists())
            self.assertFalse(mutable.exists())
        finally:
            (self.root / 'release-child').touch()
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)

    def test_network_audit_is_only_required_with_network_rules(self):
        # A directory cannot be opened as an append-only audit file.
        self.config.write_text(self.config.read_text() + '\n[logs]\naudit_path = '
                               + json.dumps(str(self.root / 'home')) + '\n')
        result = self.run_agent('-e', "require('fs').writeFileSync('started', 'yes')")
        self.assertEqual(result.returncode, 0, result.stderr)
        (self.root / 'started').unlink()
        self.config.write_text(self.config.read_text() + '\n[network]\nblock = ["blocked.invalid"]\n')
        result = self.run_agent('-e', "require('fs').writeFileSync('started', 'yes')")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('cannot open parent-owned network audit log', result.stderr)
        self.assertFalse((self.root / 'started').exists())

    @unittest.skipUnless(shutil.which('cc'), 'C compiler required')
    def test_detached_descendant_retains_session_lease(self):
        import fcntl
        source = self.root / 'detach.c'
        source.write_text(r"""
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/types.h>
int main(void) {
    int ready[2];
    if (pipe(ready)) return 1;
    pid_t child = fork();
    if (child < 0) return 2;
    if (child == 0) {
        close(ready[0]);
        if (setsid() < 0) _exit(3);
        close(0); close(1); close(2);
        alarm(20);
        if (write(ready[1], "r", 1) != 1) _exit(4);
        close(ready[1]);
        while (access("release-child", F_OK) != 0) usleep(10000);
        _exit(0);
    }
    close(ready[1]);
    char byte;
    if (read(ready[0], &byte, 1) != 1) return 5;
    close(ready[0]);
    printf("%ld\n%s\n", (long)child, getenv("SANDPIT_CONFIG"));
    return 0;
}
""")
        executable = self.root / 'detach'
        subprocess.run(['cc', str(source), '-o', str(executable)], check=True, capture_output=True)
        result = subprocess.run([str(BINARY), 'run', '--no-adversary', '--config',
                                 str(self.config), '--', str(executable)], cwd=self.root,
                                env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        pid, config_path = result.stdout.strip().splitlines()
        child_pid = int(pid)
        # Release even if an assertion fails; the helper also has a hard timeout.
        self.addCleanup(lambda: (self.root / 'release-child').touch())
        session_config = Path(config_path)
        session = session_config.parent
        self.assertTrue(session_config.is_file(), 'live detached child lost its policy')
        self.assertEqual(os.getpgid(child_pid), child_pid)
        mutable = Path(json.loads((session / 'mutable-root.json').read_text()))
        self.assertTrue(mutable.is_dir(), 'live detached child lost its overlay')
        with (session / '.active').open('r+') as lease:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            (self.root / 'release-child').touch()
            deadline = time.monotonic() + 10
            while True:
                try:
                    fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    fcntl.flock(lease.fileno(), fcntl.LOCK_UN)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        self.fail('detached child did not release its lease')
                    time.sleep(0.02)
        cleanup = self.run_agent('-e', "console.log('cleanup')")
        self.assertEqual(cleanup.returncode, 0, cleanup.stderr)
        self.assertFalse(session.exists(), 'exited child session was not cleaned up')
        self.assertFalse(mutable.exists(), 'exited child overlay was not cleaned up')

    @unittest.skipUnless(shutil.which('cc'), 'C compiler required')
    def test_dyld_codex_requires_and_accepts_external_sandbox(self):
        source = self.root / 'codex.c'
        source.write_text(r"""
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    FILE *marker = fopen("codex-started", "w");
    if (!marker) return 1;
    fclose(marker);
    printf("dyld=%s\n", getenv("DYLD_INSERT_LIBRARIES") ? "yes" : "no");
    for (int i = 1; i < argc; i++) puts(argv[i]);
    return 0;
}
""")
        executable = self.root / 'codex'
        subprocess.run(['cc', str(source), '-o', str(executable)], check=True, capture_output=True)
        base = [str(BINARY), 'run', '--no-adversary', '--config', str(self.config)]
        rejected = subprocess.run(base + ['--', str(executable)], cwd=self.root,
                                  env=self.env, capture_output=True, text=True, timeout=30)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn('inner sandbox cannot be composed', rejected.stderr)
        self.assertFalse((self.root / 'codex-started').exists())
        accepted = subprocess.run(base + ['--codex-external-sandbox', '--', str(executable),
                                          '--ask-for-approval', 'on-request'], cwd=self.root,
                                  env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertTrue((self.root / 'codex-started').is_file())
        arguments = accepted.stdout.splitlines()
        self.assertEqual(arguments[0], 'dyld=yes')
        self.assertIn('sandbox_mode="danger-full-access"', arguments)
        self.assertIn('--ask-for-approval\non-request', accepted.stdout)
        self.assertNotIn('--dangerously-bypass-approvals-and-sandbox', arguments)

    def test_failed_nested_kernel_installation_does_not_run_agent(self):
        profile = '(version 1)(allow default)(deny file-write* (subpath "/.sandpit-test-deny"))'
        result = subprocess.run(['/usr/bin/sandbox-exec', '-p', profile, str(BINARY), 'run',
                                 '--no-adversary', '--config', str(self.config), '--', NODE, '-e',
                                 "require('fs').writeFileSync('ran-main','bad')"],
                                cwd=self.root, env=self.env, capture_output=True, text=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'ran-main').exists())

    def test_nonregular_external_hardlinks_stop_before_main(self):
        for kind in ('fifo', 'symlink'):
            with self.subTest(kind=kind):
                source = self.root / 'protected' / kind
                if kind == 'fifo':
                    os.mkfifo(source)
                else:
                    source.symlink_to('missing-target')
                external = self.root / ('outside-' + kind)
                os.link(source, external, follow_symlinks=False)
                result = self.run_agent('-e', "require('fs').writeFileSync('ran-main','bad')")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('aliases outside its roots', result.stderr)
                self.assertFalse((self.root / 'ran-main').exists())
                external.unlink()
                source.unlink()

    def test_preexisting_hardlink_stops_before_main(self):
        os.link(self.root / 'protected/keep', self.root / 'alias')
        result = self.run_agent('-e', "require('fs').writeFileSync('ran-main','bad')")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('hard-linked file', result.stderr)
        self.assertFalse((self.root / 'ran-main').exists())

    def test_dangling_denied_symlink_protects_target_created_after_launch(self):
        target = self.root / 'future-secret'
        (self.root / 'protected/dangling').symlink_to('../future-secret')
        self.config.write_text('[files]\nblock_read = ' + json.dumps([
            str(self.root / 'protected')]) + '\nblock_write = ' + json.dumps([
            str(self.root / 'protected')]) + '\n')
        script = r'''
const fs = require('fs'), cp = require('child_process');
fs.writeFileSync('ready', 'ready');
const timer = setInterval(() => {
 if (!fs.existsSync('go')) return;
 clearInterval(timer);
 const code = `const fs=require('fs');
 if(process.env.DYLD_INSERT_LIBRARIES) throw Error('hooks survived shell');
 for(const name of ['future-secret','protected/dangling']) {
  for(const operation of [()=>fs.readFileSync(name),()=>fs.writeFileSync(name,'bad')]) {
   try { operation(); throw Error('policy escaped: '+name); }
   catch(e) { if(!['EACCES','EPERM'].includes(e.code)) throw e; }
  }
 }
 console.log('denied');`;
 const child=cp.spawnSync('/bin/sh', ['-c','exec "$1" -e "$2"','probe',process.execPath,code], {encoding:'utf8'});
 process.stdout.write(child.stdout);
 process.stderr.write(child.stderr);
 process.exit(child.status === null ? 1 : child.status);
}, 20);
'''
        process = subprocess.Popen([
            str(BINARY), 'run', '--no-adversary', '--config', str(self.config),
            '--', NODE, '-e', script,
        ], env=self.env, cwd=self.root, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 20
            while not (self.root / 'ready').exists():
                if process.poll() is not None or time.monotonic() >= deadline:
                    self.fail('agent did not reach post-confinement readiness')
                time.sleep(0.02)
            # This unsandboxed test parent materializes the target only after
            # the child has installed its immutable kernel policy.
            target.write_text('synthetic')
            (self.root / 'go').write_text('go')
            stdout, stderr = process.communicate(timeout=20)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertEqual(stdout.strip(), 'denied')
            self.assertEqual(target.read_text(), 'synthetic')
        finally:
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=10)

    def test_unsearchable_protected_directory_fails_before_main(self):
        protected = self.root / 'protected'
        os.link(protected / 'keep', self.root / 'external-alias')
        self.config.write_text('[files]\nblock_write = ' + json.dumps([
            str(protected)]) + '\n')
        protected.chmod(0)
        try:
            result = self.run_agent('-e', "require('fs').writeFileSync('ran-main','bad')")
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((self.root / 'ran-main').exists())
        finally:
            protected.chmod(0o700)
        self.assertEqual((self.root / 'external-alias').read_text(), 'original')

    def test_write_allowlist_survives_system_shell(self):
        (self.root / 'allowed').mkdir()
        with self.config.open('a') as config:
            config.write('allow_write = ' + json.dumps([str(self.root / 'allowed')]) + '\n')
        script = r"""
const cp = require('child_process');
const code = `const fs=require('fs');
fs.writeFileSync('allowed/ok','ok');
try { fs.writeFileSync('outside','bad'); throw Error('write escaped'); }
catch(e) { if(!['EPERM','EACCES'].includes(e.code)) throw e; }
try { fs.linkSync('allowed/ok','allowed/alias'); throw Error('hard link escaped'); }
catch(e) { if(!['EPERM','EACCES'].includes(e.code)) throw e; }`;
const result=cp.spawnSync('/bin/sh',['-c','exec "$1" -e "$2"','probe',process.execPath,code],{encoding:'utf8'});
if(result.status !== 0) throw Error(result.stderr);
"""
        result = self.run_agent('-e', script)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'allowed/ok').read_text(), 'ok')
        self.assertFalse((self.root / 'outside').exists())

    def test_loopback_grant_is_limited_to_one_port_after_env_clear(self):
        import socket
        allowed = socket.socket()
        allowed.bind(('127.0.0.1', 0))
        allowed.listen()
        blocked = socket.socket()
        blocked.bind(('127.0.0.1', 0))
        blocked.listen()
        self.addCleanup(allowed.close)
        self.addCleanup(blocked.close)
        ports = [allowed.getsockname()[1], blocked.getsockname()[1]]
        with self.config.open('a') as config:
            config.write('\n[network]\ndeny_all=true\nallow_loopback_ports=[' + str(ports[0]) + ']\n')
        probe = self.root / 'local-probe.js'
        probe.write_text(r"""
const net=require('net');
async function connect(port) { return new Promise(resolve => {
 const s=net.connect({host:'127.0.0.1',port});
 s.on('connect',()=>{s.destroy();resolve('allowed')});
 s.on('error',e=>resolve(e.code));
}); }
(async()=>{console.log(JSON.stringify(await Promise.all(process.argv.slice(2).map(p=>connect(Number(p))))));})();
""")
        args = [NODE, str(probe), *map(str, ports)]
        control = subprocess.run(args, text=True, capture_output=True, timeout=5)
        self.assertEqual(json.loads(control.stdout), ['allowed', 'allowed'])
        result = self.run_agent('-e', "const c=require('child_process').spawnSync(process.argv[1], process.argv.slice(2), {env:{},encoding:'utf8'}); process.stdout.write(c.stdout); process.stderr.write(c.stderr); process.exit(c.status);", *args)
        self.assertEqual(result.returncode, 0, result.stderr)
        observed = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(observed[0], 'allowed')
        self.assertIn(observed[1], ['EPERM', 'EACCES'])

    def test_network_denies_survive_cleared_environment(self):
        with self.config.open('a') as config:
            config.write('\n[network]\nallow=["example.com"]\n')
        code = r"""
const cp = require('child_process');
const probe = `const net=require('net');
const connection=net.connect({host:'192.0.2.1',port:9});
connection.on('connect',()=>{throw Error('direct socket escaped')});
connection.on('error',error=>{if(!['EPERM','EACCES'].includes(error.code)) throw error; console.log('kernel-denied')});
connection.setTimeout(2000,()=>{throw Error('kernel did not deny socket')});`;
const result = cp.spawnSync('/bin/sh',['-c','exec /usr/bin/env -i "$1" -e "$2"','probe',process.execPath,probe],{encoding:'utf8'});
if(result.status !== 0) throw Error(result.stderr);
process.stdout.write(result.stdout);
"""
        result = self.run_agent('-e', code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'kernel-denied')



@unittest.skipUnless(shutil.which('cc') and Path('/usr/bin/openssl').exists(),
                     'C compiler and openssl required')
class KernelNetworkServiceTests(unittest.TestCase):
    def test_daemons_cannot_connect_outside_network_policy(self):
        with tempfile.TemporaryDirectory(prefix='sandpit-daemon-regression-') as directory:
            result = subprocess.run([
                sys.executable, str(ROOT / 'evals/xpc/reproduce-egress.py'),
                '--sandpit', str(BINARY), '--expect', 'blocked',
                '--output', str(Path(directory) / 'evidence'),
            ], cwd=ROOT, text=True, capture_output=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)


class KernelTerminalTests(unittest.TestCase):
    def test_child_cannot_queue_commands_for_parent_shell(self):
        for shell in ('/bin/sh', '/bin/zsh'):
            for network in (False, True):
                with self.subTest(shell=shell, network=network), tempfile.TemporaryDirectory(
                        prefix='sandpit-terminal-regression-') as directory:
                    command = [sys.executable, str(ROOT / 'evals/tty-injection/tty_injection.py'),
                               '--sandpit', str(BINARY), '--shell', shell, '--expect', 'blocked',
                               '--output', directory]
                    if network:
                        command.append('--network')
                    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True,
                                            timeout=30)
                    self.assertEqual(result.returncode, 0, result.stdout + '\n' + result.stderr)


if __name__ == '__main__':
    unittest.main()
