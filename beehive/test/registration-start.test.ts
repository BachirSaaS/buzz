import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { nsecEncode } from 'nostr-tools/nip19';
import { registrationFixture } from './registration-fixture.ts';
import { readSettings } from '../src/settings.ts';
import type { ManagerSnapshot } from '../src/manager-controller.ts';
async function until(fn:()=>boolean) { for(let n=0;n<400;n++) { if(fn()) return; await delay(20); } throw Error('Synthetic workflow evidence missing'); }
async function fixture(t:test.TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(),'beehive-pairing-cli-registration-')));
  let snapshot: ManagerSnapshot;
  const f = await registrationFixture(home,s=>{snapshot=s;});
  t.after(async()=>{await f.close();rmSync(home,{recursive:true,force:true});});
  let id=0;
  const request=(action:string,values?:Record<string,string>,target?:string,revision?:number)=>f.controller.request({id:++id,action,values,target,revision});
  assert.equal((await request('signin')).state,'completed');
  await until(()=>!!snapshot?.agents.find(a=>a.id===f.agent)?.target);
  const start=async()=>{ const row=snapshot!.agents.find(a=>a.id===f.agent)!; return request('start',undefined,row.target,row.revision); };
  return {...f,request,start,get snapshot(){return snapshot!;}};
}

test('relay directory → local Start → matching nsec/runtime registration → authenticated Save receipt → Start → actual run and awaited Stop',async t=>{
  const f=await fixture(t), manifest=readFileSync(join(f.directory,'setup.json'));
  const begin=await f.start(); assert.equal(begin.state,'registration-required'); if(begin.state!=='registration-required') return;
  assert.equal(readSettings(f.directory).agents.length,0);
  assert.equal((await f.request('profile-preview',{secret:f.nsec,continuation:begin.continuation})).state,'completed');
  const result=await f.request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation});
  assert.equal(result.state,'submitted',f.snapshot.status);
  assert.equal(readSettings(f.directory).agents[0]?.runtimeId,f.runtimeId);
  await until(()=>f.snapshot.agents.find(a=>a.id===f.agent)?.label.includes('running')===true);
  const row=f.snapshot.agents.find(a=>a.id===f.agent)!;
  const report=JSON.parse(row.evidence!).report;
  assert.equal(report.body.actualRun.selection.model,'gpt-5'); assert.equal(report.body.actualRun.selection.harnessSetup.id,`runtime:${f.runtimeId}`);
  assert.match(row.detail,/Registered here: Yes/); assert.match(row.detail,/Relay presence: unknown/);
  assert.deepEqual(readFileSync(join(f.directory,'setup.json')),manifest,'registration does not rewrite assignment or credential manifest');
  assert.ok(!JSON.stringify(f.snapshot).includes(f.nsec)); assert.deepEqual(f.errors,[]); assert.ok(f.relay.independentWraps>0,'actual private encrypted transport');
  const stopped=await f.request('stop',undefined,row.target,row.revision); assert.equal(stopped.state,'submitted');
  await until(()=>f.snapshot.agents.find(a=>a.id===f.agent)?.label.includes('stopped')===true);
  assert.equal(JSON.parse(f.snapshot.agents.find(a=>a.id===f.agent)!.evidence!).report.body.actualRun,null);
});

test('mismatch, cancellation and credential failure retire Start and never submit a lifecycle intent',async t=>{
  const f=await fixture(t);
  let begin=await f.start(); assert.equal(begin.state,'registration-required'); if(begin.state!=='registration-required') return;
  assert.equal((await f.request('profile-preview',{secret:nsecEncode(Buffer.from('3'.repeat(64),'hex')),continuation:begin.continuation})).state,'failed');
  assert.equal((await f.request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation})).state,'failed');
  assert.equal(readSettings(f.directory).agents.length,0);
  begin=await f.start(); if(begin.state!=='registration-required') throw Error('Missing continuation');
  await f.request('retire-continuation');
  assert.equal((await f.request('profile-preview',{secret:f.nsec,continuation:begin.continuation})).state,'failed');
  begin=await f.start(); if(begin.state!=='registration-required') throw Error('Missing continuation');
  await f.request('profile-preview',{secret:f.nsec,continuation:begin.continuation}); f.setCredentialFailure(true);
  assert.equal((await f.request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation})).state,'failed');
  assert.equal(readSettings(f.directory).agents.length,0);
  await f.request('operations'); assert.match(f.snapshot.status,/No saved operations/);
});

test('cancelled late credential completion cannot continue Start',async t=>{
  const f=await fixture(t); const begin=await f.start(); if(begin.state!=='registration-required') throw Error('Missing continuation');
  await f.request('profile-preview',{secret:f.nsec,continuation:begin.continuation});
  let entered!:()=>void,release!:()=>void;
  const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
  f.beforeCredential(async()=>{entered();await wait;});
  const pending=f.request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation});
  await ready; f.controller.cancel(); release(); assert.equal((await pending).state,'cancelled');
  assert.equal(readSettings(f.directory).agents.length,0);
  await f.request('operations'); assert.match(f.snapshot.status,/No saved operations/);
});

test('provider failure after registered Start is a failed host result, never a running claim or implicit retry',async t=>{
  const f=await fixture(t); f.setProviderFailure(true);
  const begin=await f.start(); if(begin.state!=='registration-required') throw Error('Missing continuation');
  await f.request('profile-preview',{secret:f.nsec,continuation:begin.continuation});
  const result=await f.request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation});
  assert.equal(result.state,'submitted',f.snapshot.status); if(result.state!=='submitted') return;
  await until(()=>f.snapshot.diagnostics!.some(a=>a.id===`operation:${result.operationId}` && a.label.includes('Failed')));
  assert.ok(f.snapshot.agents.find(a=>a.id===f.agent)!.label.includes('stopped'));
  assert.equal((await f.request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation})).state,'failed');
});

test('a newer host revision retires captured registration before credential persistence',async t=>{
  const f=await fixture(t); const begin=await f.start(); if(begin.state!=='registration-required') throw Error('Missing continuation');
  await f.request('profile-preview',{secret:f.nsec,continuation:begin.continuation});
  const row=f.snapshot.agents.find(a=>a.id===f.agent)!;
  assert.equal((await f.request('stop',undefined,row.target,row.revision)).state,'submitted');
  await until(()=>f.snapshot.agents.find(a=>a.id===f.agent)!.revision>row.revision);
  assert.equal((await f.request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation})).state,'failed');
  assert.equal(readSettings(f.directory).agents.length,0);
});

test('cancellation after registration persistence retains verified identity/runtime but never resumes Start',async t=>{
  const f=await fixture(t);const begin=await f.start();if(begin.state!=='registration-required')throw Error('Missing continuation');
  await f.request('profile-preview',{secret:f.nsec,continuation:begin.continuation});
  let enter!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>enter=r),wait=new Promise<void>(r=>release=r);
  f.afterCredential(async()=>{enter();await wait;});
  const pending=f.request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation});
  await ready;assert.equal(readSettings(f.directory).agents[0]?.runtimeId,f.runtimeId);
  f.controller.cancel();release();assert.equal((await pending).state,'cancelled');
  assert.equal(readSettings(f.directory).agents[0]?.runtimeId,f.runtimeId);
  await f.request('operations');assert.match(f.snapshot.status,/No saved operations/);
  assert.equal((await f.start()).state,'registration-required','retry cannot silently start the old default runtime');
});

test('registered identity retains its initial runtime while authenticated Save selects the next launch without changing the active run',async t=>{
  const f=await fixture(t);
  const begin=await f.start(); if(begin.state!=='registration-required') throw Error('Missing continuation');
  await f.request('profile-preview',{secret:f.nsec,continuation:begin.continuation});
  assert.equal((await f.request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation})).state,'submitted');
  const row=()=>f.snapshot.agents.find(a=>a.id===f.agent)!;
  const report=()=>JSON.parse(row().evidence!).report;
  await until(()=>!!report().body.actualRun);
  const active=report().body.actualRun;
  const {saveSettings}=await import('../src/settings.ts');
  const settings=readSettings(f.directory), identity=structuredClone(settings.agents);
  saveSettings(f.directory,{...settings,runtimes:[...settings.runtimes,{...settings.runtimes[0]!,id:'second-runtime',name:'Second runtime',effort:'low',environment:{REVIEW_MODE:'synthetic',NEXT_RUN:'yes'}}]},settings.revision);
  await until(()=>report().body.harnessSetups.some((b:any)=>b.id==='runtime:second-runtime'));
  const selected=await f.request('select-runtime',{runtime:'second-runtime'},row().target,row().revision);
  assert.equal(selected.state,'submitted',f.snapshot.status);
  await until(()=>report().body.selectedNext.harnessSetup.id==='runtime:second-runtime');
  assert.deepEqual(report().body.actualRun,active);
  assert.deepEqual(readSettings(f.directory).agents,identity);
  assert.equal((await f.request('stop',undefined,row().target,row().revision)).state,'submitted');
  await until(()=>report().body.phase==='stopped');
  assert.equal((await f.start()).state,'submitted',f.snapshot.status);
  await until(()=>!!report().body.actualRun);
  assert.equal(report().body.actualRun.selection.harnessSetup.id,'runtime:second-runtime');
  assert.notDeepEqual(report().body.actualRun,active);
  assert.deepEqual(readSettings(f.directory).agents,identity);
});

test('explicit directory refresh reuses authenticated discovery without reconnecting management',async t=>{
  const f=await fixture(t);
  const before=f.snapshot.agents.map(a=>a.id);
  assert.equal((await f.request('directory-refresh')).state,'completed',f.snapshot.status);
  assert.deepEqual(f.snapshot.agents.map(a=>a.id),before);
  assert.deepEqual(f.errors,[]);
  await f.request('signout');
  assert.equal((await f.request('directory-refresh')).state,'failed');
  assert.equal(f.snapshot.agents.length,0);
});


test('initially unassigned owned directory agent exposes the remaining placement gap; registration never invents authority',async t=>{
  const home=realpathSync(mkdtempSync(join(tmpdir(),'beehive-pairing-cli-unassigned-')));
  let snapshot:ManagerSnapshot;
  const f=await registrationFixture(home,s=>{snapshot=s;},false);
  t.after(async()=>{await f.close();rmSync(home,{recursive:true,force:true});});
  let id=0;const request=(action:string,values?:Record<string,string>)=>f.controller.request({id:++id,action,values});
  assert.equal((await request('signin')).state,'completed');
  const row=()=>snapshot!.agents.find(a=>a.id===f.agent)!;
  assert.ok(row()); assert.equal(row().target,undefined);
  assert.equal((await request('profile-preview',{secret:f.nsec})).state,'completed');
  assert.equal((await request('register-agent',{secret:f.nsec,runtime:f.runtimeId})).state,'completed');
  assert.equal(readSettings(f.directory).agents.length,1);
  assert.equal(existsSync(join(f.directory,'setup.json')),false);
  assert.equal((await request('start')).state,'failed');
  assert.match(row().disabled!.start!,/authority is unknown/);
  assert.deepEqual(f.errors,[]);
});
