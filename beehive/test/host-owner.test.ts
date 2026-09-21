import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OwnerService } from '../src/owner-service.ts';
import { fixtureHostDependencies } from './host-fixture-deps.ts';
import { publicKey } from '../src/protocol.ts';
import { readSettings, saveSettings } from '../src/settings.ts';
import { readPrivate, writePrivate } from '../src/storage.ts';
import { credentialReference } from '../src/credential-store.ts';
import { resetHost, pendingHostReset, hostResetRevision } from '../src/host-reset.ts';
import { serviceStatus, startService } from '../src/host-service.ts';

const ownerSecret = '1'.repeat(64), relay = 'wss://relay.example';
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'host-owner-')), directory = join(home, '.beehive/host'), ownerDirectory = join(home, '.beehive/owner');
  const deps = fixtureHostDependencies(home), service = new OwnerService(home, async () => ({ secret: ownerSecret }), deps);
  return { home, directory, ownerDirectory, deps, service, async signin() { assert.equal(await service.request({ action: 'signin-desktop', relay }), true); assert.equal(await service.request({ action: 'host-status' }), true); }, close() { service.dispose(); rmSync(home, { recursive: true, force: true }); } };
}
test('Host requests require active owner; first sign-in creates separate Host identity without Start', async () => {
  const f = fixture(); let starts = 0;
  f.deps.start = async () => { starts++; return { state: 'running' }; };
  try {
    for (const action of ['host-status', 'host-start', 'host-stop', 'host-reset'] as const) assert.equal(await f.service.request({ action }), false);
    await f.signin(); const host = f.service.snapshot().host!;
    assert.notEqual(host.host, publicKey(ownerSecret)); assert.equal(host.owner, publicKey(ownerSecret)); assert.equal(host.state, 'stopped'); assert.equal(starts, 0);
    await f.service.request({ action: 'signout' }); assert.equal(f.service.snapshot().host, undefined); assert.ok(existsSync(join(f.directory, 'host-identity.json')));
  } finally { f.close(); }
});
test('Start/Stop target current Host and observed service instance; unknown never enables reset', async () => {
  const f = fixture(); let state: 'running' | 'stopped' | 'unknown' = 'stopped', starts = 0, stops = 0;
  f.deps.status = async () => ({ state, instance: state === 'running' ? 'instance-one' : undefined, agents: state === 'running' ? 2 : 0 });
  f.deps.start = async () => { starts++; state = 'running'; return { state }; };
  f.deps.stop = async (_, instance) => { assert.equal(instance, 'instance-one'); stops++; state = 'stopped'; return { state }; };
  try {
    await f.signin(); let host = f.service.snapshot().host!;
    assert.equal(await f.service.request({ action: 'host-start', revision: 'stale' }), false); assert.equal(starts, 0);
    assert.equal(await f.service.request({ action: 'host-start', revision: host.revision }), true); assert.equal(starts, 1);
    host = f.service.snapshot().host!; assert.equal(host.agents, 2);
    assert.equal(await f.service.request({ action: 'host-reset', revision: host.revision, confirmed: true }), false);
    assert.equal(await f.service.request({ action: 'host-stop', revision: host.revision, instance: 'other', confirmed: true }), false);
    assert.equal(await f.service.request({ action: 'host-stop', revision: host.revision, instance: host.instance }), false); assert.equal(stops, 0);
    assert.equal(await f.service.request({ action: 'host-stop', revision: host.revision, instance: host.instance, confirmed: true }), true); assert.equal(stops, 1);
    state = 'unknown'; assert.equal(await f.service.request({ action: 'host-reset', revision: host.revision, confirmed: true }), false);
    assert.ok(existsSync(join(f.directory, 'host-identity.json')));
  } finally { f.close(); }
});
test('Reset deletes exact local Host/agent custody, preserves machine catalogs and relay history, then signs out', async () => {
  const f = fixture();
  try {
    await f.signin(); const agent = publicKey('2'.repeat(64)), old = readSettings(f.directory);
    const catalog = saveSettings(f.directory, { ...old, agents: [{ publicKey: agent, key: credentialReference('agent', agent), profileState: 'none' }], providers: [{ id: 'provider-one', name: 'Preserved', type: 'openai', endpoint: 'https://api.openai.com/v1', key: {service: 'beehive', account: 'provider:00000000-0000-0000-0000-000000000000'} }], runtimes: [{ id: 'runtime-one', name: 'Preserved runtime', harness: 'buzz-agent', executable: process.execPath, providerId: 'provider-one', model: 'custom' }], harnesses: [{id: 'buzz-agent', label: 'Buzz Agent', state: 'not-installed', reason: 'Fixture', providers: ['openai']}] }, old.revision);
    const keysPath = join(f.home, 'synthetic-host-keys.json'), keys = JSON.parse(readFileSync(keysPath, 'utf8')); keys[`agent:${agent}`] = '2'.repeat(64); keys['provider:untouched'] = 'keep'; writeFileSync(keysPath, JSON.stringify(keys));
    writePrivate(join(f.directory, 'credential-attempts.json'), [credentialReference('agent', agent), { service: 'beehive', account: 'provider:fixture' }]);
    writePrivate(join(f.ownerDirectory, 'management-intents/retained.json'), { history: true });
    writePrivate(join(f.directory, 'agents', agent, 'enrollment.json'), {registration: true});
    writePrivate(join(f.directory, 'agents', agent, 'journal.json'), {local: true});
    await f.service.request({ action: 'host-status' }); const host = f.service.snapshot().host!;
    assert.equal(await f.service.request({ action: 'host-reset', revision: host.revision }), false);
    assert.equal(await f.service.request({ action: 'host-reset', revision: host.revision, confirmed: true }), true);
    assert.equal(f.service.snapshot().signedIn, false); assert.equal(f.service.snapshot().boundOwner, undefined);
    assert.equal(existsSync(join(f.directory, 'host-identity.json')), false); assert.equal(existsSync(join(f.ownerDirectory, 'controller.json')), false);
    assert.deepEqual(readSettings(f.directory), { ...catalog, revision: catalog.revision + 1, agents: [] });
    assert.deepEqual(JSON.parse(readFileSync(keysPath, 'utf8')), { 'provider:untouched': 'keep' });
    assert.deepEqual(readPrivate(join(f.directory, 'credential-attempts.json')), [{ service: 'beehive', account: 'provider:fixture' }]);
    assert.ok(existsSync(join(f.ownerDirectory, 'management-intents/retained.json')));
    assert.equal(existsSync(join(f.directory, 'agents')), false);
    await f.signin(); assert.notEqual(f.service.snapshot().host!.host, host.host);
  } finally { f.close(); }
});
test('partial reset keeps recovery scope and binding, fences Start/catalog mutation, and can retry', async () => {
  const f = fixture();
  try {
    await f.signin(); const revision = hostResetRevision(f.directory);
    await assert.rejects(resetHost(f.directory, f.ownerDirectory, publicKey(ownerSecret), relay, revision, new AbortController().signal, async () => { throw Error('OS denied'); }));
    assert.ok(pendingHostReset(f.directory)); assert.ok(existsSync(join(f.directory, 'host-identity.json')));
    assert.equal((await serviceStatus(f.directory)).state, 'stopped');
    await assert.rejects(startService(f.directory), /reset incomplete/);
    assert.throws(() => saveSettings(f.directory, readSettings(f.directory), 0), /reset incomplete/);
    await f.service.request({ action: 'host-status' }); assert.equal(f.service.snapshot().host!.resetPending, true);
    assert.equal(await f.service.request({ action: 'host-reset', revision: f.service.snapshot().host!.revision, confirmed: true }), true);
    assert.equal(pendingHostReset(f.directory), undefined);
  } finally { f.close(); }
});
test('reset holds launch/catalog locks across async custody removal and cancellation releases owned locks', async () => {
  const f = fixture(); let finish!: () => void;
  try {
    await f.signin(); const abort = new AbortController();
    const work = resetHost(f.directory, f.ownerDirectory, publicKey(ownerSecret), relay, hostResetRevision(f.directory), abort.signal, () => new Promise(resolve => finish = resolve));
    assert.equal((await serviceStatus(f.directory)).state, 'unknown');
    assert.throws(() => saveSettings(f.directory, readSettings(f.directory), 0));
    abort.abort(); finish(); await assert.rejects(work);
    for (const lock of ['host.lock', 'service.lock', 'settings.lock']) assert.equal(existsSync(join(f.directory, lock)), false);
    assert.ok(pendingHostReset(f.directory));
  } finally { f.close(); }
});
test('late Host status cannot restore protected facts after sign-out', async () => {
  const f = fixture(); let finish!: (s: { state: 'running' }) => void;
  try {
    await f.signin(); f.deps.status = () => new Promise(resolve => finish = resolve);
    const work = f.service.request({ action: 'host-status' }); await f.service.request({ action: 'signout' }); finish({ state: 'running' });
    assert.equal(await work, false); assert.equal(f.service.snapshot().host, undefined);
  } finally { f.close(); }
});

test('cancel/signout cannot admit replacement operations until a Host mutation drains', async () => {
  const f = fixture(); let finish!: () => void, starts = 0;
  try {
    await f.signin(); f.deps.start = async () => { starts++; await new Promise<void>(resolve => finish = resolve); return { state: 'running' }; };
    const work = f.service.request({ action: 'host-start', revision: f.service.snapshot().host!.revision });
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    f.service.cancel(); f.service.cancel();
    assert.equal(await f.service.request({ action: 'host-start', revision: f.service.snapshot().host!.revision }), false);
    await f.service.request({ action: 'signout' });
    assert.equal(await f.service.request({ action: 'signin-desktop', relay }), false);
    finish(); assert.equal(await work, false); assert.equal(starts, 1); assert.equal(f.service.snapshot().host, undefined);
    await f.signin();
  } finally { f.close(); }
});

test('reset retry after identity deletion uses retained recovery binding and blocks a different owner', async () => {
  const f = fixture();
  try {
    await f.signin();
    await assert.rejects(resetHost(f.directory, f.ownerDirectory, publicKey(ownerSecret), relay, hostResetRevision(f.directory), new AbortController().signal, async () => { throw Error('Interrupted'); }));
    rmSync(join(f.directory, 'host-identity.json')); rmSync(join(f.ownerDirectory, 'controller.json'));
    await f.service.request({ action: 'signout' });
    const other = new OwnerService(f.home, async () => ({secret: '2'.repeat(64)}), f.deps);
    assert.equal(await other.request({action:'signin-desktop',relay}),false); other.dispose();
    await f.signin(); assert.equal(f.service.snapshot().host!.resetPending,true);
    assert.equal(await f.service.request({action:'host-reset',revision:f.service.snapshot().host!.revision,confirmed:true}),true);
    assert.equal(f.service.snapshot().signedIn,false); assert.equal(f.service.snapshot().relay,undefined);
  } finally { f.close(); }
});

for (const artifact of ['host.lock', 'service.lock', 'service.sock', 'service.json']) test(`reset refuses retained ${artifact} without deleting it`, async () => {
  const f = fixture();
  try {
    await f.signin(); const revision=hostResetRevision(f.directory);
    if(artifact.endsWith('.lock')) mkdirSync(join(f.directory,artifact)); else writeFileSync(join(f.directory,artifact),'retained');
    await assert.rejects(resetHost(f.directory,f.ownerDirectory,publicKey(ownerSecret),relay,revision,new AbortController().signal,async()=>{assert.fail('Must not remove keys');}));
    assert.ok(existsSync(join(f.directory,artifact))); assert.ok(existsSync(join(f.directory,'host-identity.json')));
  } finally {f.close();}
});

test('pending sign-in cannot recreate a binding removed by another manager', async () => {
  const f=fixture();let resolve!: (v:{secret:string})=>void;
  try {
    await f.signin();
    const other=new OwnerService(f.home,()=>new Promise(r=>resolve=r),f.deps);
    const signin=other.request({action:'signin-desktop'});
    assert.equal(await f.service.request({action:'host-reset',revision:f.service.snapshot().host!.revision,confirmed:true}),true);
    resolve({secret:ownerSecret});assert.equal(await signin,false);other.dispose();
    assert.equal(existsSync(join(f.ownerDirectory,'controller.json')),false);
    assert.equal(existsSync(join(f.directory,'host-identity.json')),false);
  }finally{f.close();}
});
