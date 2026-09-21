import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { readSettings, saveSettings } from '../src/settings.ts';

test('real fixture IPC rejects stale Add revision without a public settings mutation', async () => {
  const home = mkdtempSync(join(tmpdir(), 'provider-tui-fixture-cas-'));
  const child = fork(new URL('./provider-tui-fixture-child.ts', import.meta.url), [], { execArgv: ['--experimental-transform-types'], silent: true, env: { HOME: home, BEEHIVE_HOME: home, PATH: '/usr/bin:/bin' } });
  child.stdout?.resume(); child.stderr?.resume();
  try {
    await once(child, 'message');
    const directory = join(home, '.beehive', 'host');
    saveSettings(directory, readSettings(directory), 0);
    const completion = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('IPC timeout')), 5000);
      child.on('message', (message: any) => { if (message.type === 'result') { clearTimeout(timer); resolve(message); } });
    });
    child.send({ type: 'secret', action: 'append', value: 'fixture-secret' });
    child.send({ type: 'request', id: 1, request: { action: 'save', revision: 0, values: { type: 'openai', name: 'Stale' } } });
    assert.equal((await completion).ok, false);
    assert.equal(readSettings(directory).revision, 1);
    assert.deepEqual(readSettings(directory).providers, []);
  } finally { const exited = once(child, 'close'); child.kill(); await exited; rmSync(home, { recursive: true, force: true }); }
});
