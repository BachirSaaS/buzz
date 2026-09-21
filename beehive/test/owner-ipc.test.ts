import { once } from 'node:events';
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

test('owner child disconnect drains earlier operations after a later signout resolves', async () => {
  const { fork } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const home=mkdtempSync(join(tmpdir(),'owner-disconnect-'));
  const loader=join(home,'isolate.mjs'), marker=join(home,'drained');
  writeFileSync(loader,`import {registerHooks} from 'node:module';
registerHooks({load(url,ctx,next){if(!url.endsWith('/src/owner-service.ts'))return next(url,ctx);return {format:'module',shortCircuit:true,source:${JSON.stringify(`import {writeFileSync} from 'node:fs';
export class OwnerService {
 subscribe() {} secret() {} cancel() {} dispose() {}
 async request(r) { if(r.action==='host-reset') { process.send({started:true});await new Promise(resolve=>setTimeout(resolve,200));writeFileSync(${JSON.stringify(marker)},'drained'); } return true; }
}`)}};}});`);
  const child=fork(fileURLToPath(new URL('../src/owner-child.ts',import.meta.url)),[],{execPath:process.execPath,execArgv:['--import',loader],silent:true,env:{HOME:home,PATH:'/usr/bin:/bin'}});
  try {
    const started=once(child,'message');child.send({type:'request',id:1,request:{action:'host-reset'}});await started;
    const signedout=once(child,'message');child.send({type:'request',id:2,request:{action:'signout'}});assert.equal((await signedout)[0].id,2);
    const exited=once(child,'exit');child.disconnect();await exited;
    assert.equal(existsSync(marker),true,'earlier cleanup completed before process exit');
  } finally {child.kill();rmSync(home,{recursive:true,force:true});}
});
