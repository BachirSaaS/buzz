import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nip19 } from 'nostr-tools';
import { fixtureHostDependencies } from './host-fixture-deps.ts';
import { OwnerService } from '../src/owner-service.ts';
import { publicKey } from '../src/protocol.ts';
import { createControllerConfig } from '../src/controller-config.ts';
import { bootstrapHostIdentity } from '../src/host-identity.ts';
const secret = '1'.repeat(64), other = '2'.repeat(64);
const nsec = nip19.nsecEncode(Buffer.from(secret, 'hex'));
const relay = 'wss://relay.example';
function fixture(desktop: ConstructorParameters<typeof OwnerService>[1] = async probe => probe ? ({ available: true }) : ({ secret })) {
  const home = mkdtempSync(join(tmpdir(), 'owner-session-'));
  const service = new OwnerService(home, desktop, fixtureHostDependencies(home));
  return { home, service, close() { service.dispose(); rmSync(home, { recursive: true, force: true }); } };
}
test('nsec session persists only public binding; signout and reopen never restore a signer', async () => {
  const f = fixture();
  try {
    f.service.secret('append', nsec);
    assert.equal(await f.service.request({ action: 'signin-nsec', relay }), true);
    assert.equal(f.service.snapshot().signedIn, true);
    const file = join(f.home, '.beehive/owner/controller.json');
    const saved = readFileSync(file, 'utf8');
    assert.deepEqual(JSON.parse(saved), { version: 1, owner: publicKey(secret), relay });
    assert.ok(!saved.includes(nsec) && !saved.includes(secret));
    assert.doesNotMatch(JSON.stringify(f.service.snapshot()), new RegExp(nsec+'|'+secret));
    assert.equal(f.service.snapshot().secretLength, 0);
    assert.equal(existsSync(join(f.home, '.beehive/host/host-identity.json')), true);
    await f.service.request({ action: 'signout' });
    assert.equal(f.service.snapshot().signedIn, false); assert.equal(f.service.snapshot().owner, undefined);
    const reopened = new OwnerService(f.home, async () => { throw Error('No automatic Keychain read'); });
    assert.equal(reopened.snapshot().signedIn, false); reopened.dispose();
    assert.equal(readFileSync(file, 'utf8'), saved);
  } finally { f.close(); }
});
test('Desktop probe never creates session or files; explicit Desktop sign-in derives matching owner', async () => {
  const calls: boolean[] = [], f = fixture(async probe => { calls.push(probe); return probe ? { available: true } : { secret }; });
  try {
    await f.service.request({ action: 'probe' });
    assert.deepEqual(calls, [true]); assert.equal(f.service.snapshot().desktop, 'available');
    assert.equal(f.service.snapshot().signedIn, false); assert.equal(existsSync(join(f.home, '.beehive')), false);
    assert.equal(await f.service.request({ action: 'signin-desktop', relay }), true);
    assert.deepEqual(calls, [true, false]); assert.equal(f.service.snapshot().owner, nip19.npubEncode(publicKey(secret)));
  } finally { f.close(); }
});
test('invalid nsec, invalid relay and missing/denied Desktop never write routing or leak failure text', async () => {
  const f = fixture(async () => ({ reason: 'access secret-never-print' }));
  try {
    await f.service.request({ action: 'probe' }); assert.equal(f.service.snapshot().desktop, 'unavailable');
    for (const action of ['signin-nsec', 'signin-desktop'] as const) {
      f.service.secret('append', 'invalid-secret-never-print');
      assert.equal(await f.service.request({ action, relay }), false);
      assert.equal(f.service.snapshot().signedIn, false);
      assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /secret-never-print/);
    }
    for (const bad of ['', 'https://relay.example', 'ws://remote.example', 'wss://name:password@relay.example']) {
      f.service.secret('append', nsec); assert.equal(await f.service.request({ action: 'signin-nsec', relay: bad }), false);
    }
    assert.equal(existsSync(join(f.home, '.beehive')), false);
  } finally { f.close(); }
});
test('existing Host owner and relay are authority; mismatch leaves all public state unchanged', async () => {
  const f = fixture(); const keys = new Map<string, string>();
  try {
    bootstrapHostIdentity(join(f.home, '.beehive/host'), 'Fixture Host', publicKey(other), relay, {
      read: ref => keys.get(ref.publicKey) ?? null, create: (ref, value) => { keys.set(ref.publicKey, value); }, remove: ref => { keys.delete(ref.publicKey); },
    });
    const file = join(f.home, '.beehive/host/host-identity.json'), before = readFileSync(file, 'utf8');
    assert.equal(await f.service.request({ action: 'signin-desktop', relay }), false);
    assert.match(f.service.snapshot().message, /does not match/);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.equal(existsSync(join(f.home, '.beehive/owner')), false);
    f.service.secret('append', nip19.nsecEncode(Buffer.from(other, 'hex')));
    assert.equal(await f.service.request({ action: 'signin-nsec', relay: 'wss://ignored.example' }), true);
    assert.equal(f.service.snapshot().relay, relay);
  } finally { f.close(); }
});
test('concurrent first-use winner is rechecked after credential completion', async () => {
  let finish!: (value: { secret: string }) => void;
  const f = fixture(() => new Promise(resolve => finish = resolve));
  try {
    const work = f.service.request({ action: 'signin-desktop', relay });
    createControllerConfig(join(f.home, '.beehive/owner'), publicKey(other), relay);
    finish({ secret }); assert.equal(await work, false);
    assert.equal(f.service.snapshot().signedIn, false);
    assert.equal(JSON.parse(readFileSync(join(f.home, '.beehive/owner/controller.json'), 'utf8')).owner, publicKey(other));
  } finally { f.close(); }
});
for (const stop of ['cancel', 'signout', 'dispose'] as const) test(`${stop} fences late Desktop completion and clears input`, async () => {
  let finish!: (value: { secret: string }) => void;
  const f = fixture(() => new Promise(resolve => finish = resolve));
  try {
    const work = f.service.request({ action: 'signin-desktop', relay });
    if (stop === 'signout') await f.service.request({ action: 'signout' }); else f.service[stop]();
    finish({ secret }); assert.equal(await work, false);
    assert.equal(f.service.snapshot().signedIn, false); assert.equal(f.service.snapshot().secretLength, 0);
    assert.equal(existsSync(join(f.home, '.beehive')), false);
  } finally { f.close(); }
});

test('cancelled read cannot block or overwrite a replacement session', async () => {
  let finish!: (value: { secret: string }) => void;
  const f = fixture(() => new Promise(resolve => finish = resolve));
  try {
    const old = f.service.request({ action: 'signin-desktop', relay });
    f.service.cancel(); f.service.secret('append', nsec);
    assert.equal(await f.service.request({ action: 'signin-nsec', relay }), true);
    finish({ secret: other }); assert.equal(await old, false);
    assert.equal(f.service.snapshot().owner, nip19.npubEncode(publicKey(secret)));
    assert.equal(f.service.snapshot().signedIn, true);
  } finally { f.close(); }
});
