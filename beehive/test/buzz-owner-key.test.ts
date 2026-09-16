import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nip19 } from 'nostr-tools';
import { readBuzzOwnerKey, buzzOwnerKeyErrors } from '../src/buzz-owner-key.ts';
import { createControllerConfig } from '../src/controller-config.ts';
import { managerCredential } from '../src/manager-credential.ts';
import { ManagerController } from '../src/manager-controller.ts';
import { publicKey } from '../src/protocol.ts';

const secret = '1'.repeat(64), owner = publicKey(secret);
const nsec = nip19.nsecEncode(Buffer.from(secret, 'hex'));
const blob = JSON.stringify({ identity: nsec, 'agent:fixture': 'unrelated-secret-not-returned' });

test('explicit Buzz signin validates actual blob identity and excludes all other bytes', async () => {
  for (const [label, read, reason] of [
    ['success', () => blob, undefined],
    ['missing item', () => null, 'missing'],
    ['missing identity', () => '{}', 'missing'],
    ['denied', () => { throw Error(secret); }, 'access'],
    ['cancelled OS prompt', () => { throw Error(nsec); }, 'access'],
    ['malformed JSON', () => '{'+secret, 'malformed'],
    ['malformed nsec', () => JSON.stringify({identity:secret}), 'malformed'],
    ['invalid scalar', () => JSON.stringify({identity:nip19.nsecEncode(new Uint8Array(32))}), 'malformed'],
    ['wrong owner', () => JSON.stringify({identity:nip19.nsecEncode(Buffer.from('2'.repeat(64),'hex'))}), 'mismatch'],
  ] as const) {
    const home = mkdtempSync(join(tmpdir(), 'beehive-pairing-cli-buzz-owner-'));
    let reads = 0, connections = 0, directoryReads = 0;
    const outputs: unknown[] = [];
    const c = new ManagerController(home, s => outputs.push(s), async (input) => {
      assert.equal((input as any).action, 'signin-buzz');
      const result = readBuzzOwnerKey((input as any).owner, () => { reads++; return read(); });
      if (!result.ok) throw Error(buzzOwnerKeyErrors[result.reason]);
      assert.deepEqual(Object.keys(result).sort(), ['ok','secret']);
      return result;
    }, ((_root: string, relay: string, key: string) => {
      connections++; assert.equal(key, secret); assert.equal(relay, 'wss://fixture.invalid');
      return { ready: Promise.resolve(), connected:false, status:()=>[], close() {} };
    }) as any, async () => undefined, async (_relay,key) => { assert.equal(key,secret); directoryReads++; return []; });
    try {
      c.snapshot(); assert.equal(reads, 0, label);
      const result = await c.request({id:1,action:'signin-buzz',values:{owner,relay:'wss://fixture.invalid'}});
      assert.equal(reads,1,label);
      assert.equal(result.state, reason ? 'failed' : 'completed',label);
      assert.equal(connections,reason ? 0 : 1,label);
      const config = join(home,'.beehive','owner','controller.json');
      if (reason) { assert.equal(c.snapshot().owner,undefined); assert.equal(existsSync(config),false); }
      else {
        assert.equal(c.snapshot().owner,owner);
        assert.deepEqual(JSON.parse(readFileSync(config,'utf8')), {version:1,owner,relay:'wss://fixture.invalid'});
        await c.request({id:2,action:'directory-refresh'});
        assert.equal(reads,1,'refresh reuses explicit session, never rereads Buzz');
        assert.equal(directoryReads,2);
        await c.request({id:3,action:'signout'}); assert.equal(c.snapshot().owner,undefined);
      }
      const output = JSON.stringify(outputs);
      for (const privateValue of [secret,nsec,'unrelated-secret-not-returned']) assert.ok(!output.includes(privateValue),label);
    } finally { c.close(); rmSync(home,{recursive:true,force:true}); }
  }
});

test('Buzz late completion and untrusted helper mismatch cannot configure or connect', async () => {
  for (const mode of ['cancel','close','mismatch','malformed'] as const) {
    const home = mkdtempSync(join(tmpdir(),'beehive-pairing-cli-buzz-stale-'));
    let finish!: (value: unknown) => void;
    const c = new ManagerController(home,()=>{},()=>new Promise(resolve=>{finish=resolve;}), (()=>{throw Error('must never connect');}) as any, async()=>undefined);
    try {
      const pending = c.request({id:1,action:'signin-buzz',values:{owner,relay:'wss://fixture.invalid'}});
      if (mode === 'cancel') c.cancel();
      if (mode === 'close') c.close();
      finish({ok:true,secret:mode === 'mismatch' ? '2'.repeat(64) : mode === 'malformed' ? nsec : secret});
      assert.notEqual((await pending).state,'completed');
      assert.equal(c.snapshot().owner,undefined);
      assert.equal(existsSync(join(home,'.beehive','owner','controller.json')),false);
      assert.ok(!JSON.stringify(c.snapshot()).includes(nsec));
    } finally { c.close(); rmSync(home,{recursive:true,force:true}); }
  }
});


test('actual signin child reads only the canonical item; safe missing/access errors and no Beehive copy', async () => {
  const helper = new URL('./buzz-owner-child-fixture.ts', import.meta.url);
  assert.deepEqual(await managerCredential({action:'signin-buzz',owner,fixture:{blob}},new AbortController().signal,helper),{ok:true,secret});
  for (const [fixture, pattern] of [[{blob:null},/No Buzz owner key/],[{denied:nsec},/locked, denied, cancelled/],[{blob:'invalid'},/malformed/],[{blob},/does not match/]] as const) {
    await assert.rejects(managerCredential({action:'signin-buzz',owner:pattern.source.includes('does not match') ? publicKey('2'.repeat(64)) : owner,fixture},new AbortController().signal,helper), error => {
      assert.match(String(error),pattern); assert.ok(!String(error).includes(nsec)); return true;
    });
  }
});


test('retained owner and relay win over supplied Buzz routing, including mismatch', async () => {
  const home = mkdtempSync(join(tmpdir(),'beehive-pairing-cli-buzz-retained-'));
  const directory = join(home,'.beehive','owner');
  createControllerConfig(directory,owner,'wss://fixture.invalid');
  const before = readFileSync(join(directory,'controller.json'));
  const c = new ManagerController(home,()=>{},async input => {
    assert.equal((input as any).owner,owner);
    return {ok:true,secret:'2'.repeat(64)};
  }, (()=>{throw Error('must never connect');}) as any, async()=>undefined);
  try {
    assert.equal((await c.request({id:1,action:'signin-buzz',values:{owner:publicKey('2'.repeat(64)),relay:'wss://other.invalid'}})).state,'failed');
    assert.deepEqual(readFileSync(join(directory,'controller.json')),before);
    assert.equal(c.snapshot().owner,undefined);
  } finally { c.close(); rmSync(home,{recursive:true,force:true}); }
});
