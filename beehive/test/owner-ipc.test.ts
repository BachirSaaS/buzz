import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nip19 } from 'nostr-tools';
import { localOwner } from '../src/owner-client.ts';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test('real private IPC binds public snapshots to session, cancel, signout and restart', async () => {
  const home = mkdtempSync(join(tmpdir(), 'owner-tui-fixture-'));
  writeFileSync(join(home, 'desktop-mode'), 'available');
  const open = () => localOwner({ helper: new URL('./owner-tui-fixture-child.ts', import.meta.url), environment: { PATH: process.env.PATH, BEEHIVE_HOME: home } });
  let client = open(); const snapshots: unknown[] = []; client.subscribe(s => snapshots.push(s));
  try {
    assert.equal(await client.request({ action: 'probe' }), true); assert.equal(client.snapshot().desktop, 'available');
    const nsec = nip19.nsecEncode(Buffer.from('1'.repeat(64), 'hex'));
    client.secret('append', nsec);
    assert.equal(await client.request({ action: 'signin-nsec', relay: 'wss://relay.example' }), true);
    assert.equal(client.snapshot().signedIn, true);
    assert.doesNotMatch(JSON.stringify(snapshots), new RegExp(nsec));
    await client.request({ action: 'signout' }); assert.equal(client.snapshot().signedIn, false);
    writeFileSync(join(home, 'desktop-mode'), 'delayed');
    const pending = client.request({ action: 'signin-desktop' }); await sleep(80); client.cancel();
    assert.equal(await pending, false); assert.equal(client.snapshot().signedIn, false);
    client.dispose(); client = open();
    await client.request({ action: 'probe' }); assert.equal(client.snapshot().signedIn, false);
    assert.equal(existsSync(join(home, '.beehive/owner/controller.json')), true);
  } finally { client.dispose(); rmSync(home, { recursive: true, force: true }); }
});
