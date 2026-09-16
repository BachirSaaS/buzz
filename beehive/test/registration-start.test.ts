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
import { sectionRows } from '../src/manager-navigation.ts';
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
  assert.equal((await f.request('directory-refresh')).state,'signin-required');
  assert.equal(f.snapshot.agents.length,0);
});


test('initially unassigned owned directory agent enrolls under explicit local Start, without public genesis provisioning',async t=>{
  const home=realpathSync(mkdtempSync(join(tmpdir(),'beehive-pairing-cli-unassigned-')));
  let snapshot:ManagerSnapshot;
  const f=await registrationFixture(home,s=>{snapshot=s;},false);
  t.after(async()=>{await f.close();rmSync(home,{recursive:true,force:true});});
  let id=0;const request=(action:string,values?:Record<string,string>,target?:string,revision?:number)=>f.controller.request({id:++id,action,values,target,revision});
  assert.equal((await request('signin')).state,'completed');
  const row=()=>snapshot!.agents.find(a=>a.id===f.agent)!;
  await until(()=>!!row()?.startTarget);
  assert.equal(existsSync(join(f.directory,'setup.json')),false);
  let begin=await request('start',undefined,row().startTarget,-1);
  if(begin.state!=='registration-required') throw Error(snapshot!.status);
  await request('retire-continuation');
  assert.equal(existsSync(join(f.directory,'setup.json')),false);
  begin=await request('start',undefined,row().startTarget,-1);
  if(begin.state!=='registration-required') throw Error(snapshot!.status);
  assert.equal((await request('profile-preview',{secret:f.nsec,continuation:begin.continuation})).state,'completed');
  const result=await request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation});
  assert.equal(result.state,'submitted',snapshot!.status);
  await until(()=>row().label.includes('running'));
  const report=JSON.parse(row().evidence!).report;
  assert.equal(report.host,f.host);
  assert.equal(report.body.actualRun.selection.model,'gpt-5');
  assert.equal(report.body.actualRun.selection.harnessSetup.id,`runtime:${f.runtimeId}`);
  assert.equal(existsSync(join(f.directory,'setup.json')),true);
  assert.equal(readSettings(f.directory).agents.length,1);
  assert.equal((await request('stop',undefined,row().target,row().revision)).state,'submitted');
  await until(()=>row().label.includes('stopped'));
  assert.deepEqual(f.errors,[]);
});

test('ordinary independent local enrollments compose with selected-source Move and retain destination history',async t=>{
  const home=realpathSync(mkdtempSync(join(tmpdir(),'beehive-pairing-cli-independent-')));
  let snapshot:ManagerSnapshot;
  const f=await registrationFixture(home,s=>{snapshot=s;},false,true);
  t.after(async()=>{await f.close();rmSync(home,{recursive:true,force:true});});
  let id=0;const request=(action:string,values?:Record<string,string>,target?:string,revision?:number)=>f.controller.request({id:++id,action,values,target,revision});
  assert.equal((await request('signin')).state,'completed');
  const row=()=>snapshot!.agents.find(a=>a.id===f.agent)!;
  await until(()=>!!row()?.startTarget);
  assert.equal(row().startTarget,JSON.stringify([f.host,f.agent]),'explicit local Start, not the other already-enrolled host');
  const destinationBefore=JSON.parse(readFileSync(join(f.destination!.directory,'agents',f.agent,'journal.json'),'utf8'));
  assert.ok(Object.keys(destinationBefore.runs).length===1,'destination actually started then stopped via ordinary registration/enrollment');
  const begin=await request('start',undefined,row().startTarget,-1);
  if(begin.state!=='registration-required') throw Error(snapshot!.status);
  await request('profile-preview',{secret:f.nsec,continuation:begin.continuation});
  assert.equal((await request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation})).state,'submitted',snapshot!.status);
  await until(()=>row().label.includes('running'));
  const source=JSON.parse(row().evidence!).report;
  assert.notDeepEqual(source.body.genesis,destinationBefore.assignment.genesis);
  const target=row().destinations!.find(d=>d.target===JSON.stringify([f.destination!.host,f.agent]))!;
  assert.equal(target.reason,undefined);
  const {managementClient}=await import('../src/intents.ts');
  const {message,publicKey}=await import('../src/protocol.ts');
  const raw=managementClient(join(home,'unauthorized-destination'),f.url,f.ownerSecret,()=>{},()=>{},{catalog:{version:1,owner:publicKey(f.ownerSecret),relay:f.url,registrations:[]}});
  try {
    await raw.ready;
    const unauthorized=message('move',f.host,f.agent,source.revision,{target:f.destination!.host,targetRevision:target.revision,selection:destinationBefore.selected});
    raw.submit(unauthorized);
    await until(()=>raw.status().some(o=>o.request.id===unauthorized.id&&o.state==='failed'));
    assert.deepEqual(JSON.parse(readFileSync(join(f.directory,'agents',f.agent,'journal.json'),'utf8')).actual,source.body.actualRun,'source must not Stop before destination owner authorizes this independent enrollment');
  } finally {raw.close();}
  const move=await request('move',{destination:target.target,destinationRevision:String(target.revision)},row().target,row().revision);
  assert.equal(move.state,'submitted',snapshot!.status);
  await until(()=>snapshot!.diagnostics!.some(d=>d.id===`operation:${move.state==='submitted'?move.operationId:''}`&&d.label.includes('Completed')));
  await until(()=>JSON.parse(row().evidence!).report.host===f.destination!.host&&row().label.includes('running'));
  const after=JSON.parse(readFileSync(join(f.destination!.directory,'agents',f.agent,'journal.json'),'utf8'));
  assert.deepEqual(after.assignmentHistory,[destinationBefore.assignment]);
  assert.deepEqual(after.runs[Object.keys(destinationBefore.runs)[0]!],Object.values(destinationBefore.runs)[0]);
  assert.equal(after.assignment.genesis.id,source.body.genesis.id);
  assert.ok(after.assignment.chain.at(-1).proof);
  assert.equal((await request('stop',undefined,row().target,row().revision)).state,'submitted');
  await until(()=>row().label.includes('stopped'));
});

test('cancelling after host enrollment preserves stopped placement and cannot launch on late receipt',async t=>{
  const home=realpathSync(mkdtempSync(join(tmpdir(),'beehive-pairing-cli-enrollment-cancel-')));
  let snapshot:ManagerSnapshot;
  const f=await registrationFixture(home,s=>{snapshot=s;},false);
  t.after(async()=>{await f.close();rmSync(home,{recursive:true,force:true});});
  let id=0;const request=(action:string,values?:Record<string,string>,target?:string,revision?:number)=>f.controller.request({id:++id,action,values,target,revision});
  await request('signin');
  const row=()=>snapshot!.agents.find(a=>a.id===f.agent)!;
  await until(()=>!!row()?.startTarget);
  const begin=await request('start',undefined,row().startTarget,-1);
  if(begin.state!=='registration-required') throw Error(snapshot!.status);
  await request('profile-preview',{secret:f.nsec,continuation:begin.continuation});
  f.setHoldEnrollment(true);
  const pending=request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:begin.continuation});
  await until(()=>f.heldPrepared>0);
  f.controller.cancel();assert.equal((await pending).state,'cancelled');
  f.releasePrepared();
  await until(()=>snapshot!.diagnostics!.some(d=>d.label.startsWith('Enroll locally · Completed')));
  assert.ok(row().label.includes('stopped'));
  const journal=JSON.parse(readFileSync(join(f.directory,'agents',f.agent,'journal.json'),'utf8'));
  assert.equal(journal.actual,null);assert.deepEqual(journal.runs??{},{});
  assert.ok(!snapshot!.diagnostics!.some(d=>d.label.startsWith('Start ·')));
  const retry=await request('start',undefined,row().target,row().revision);
  assert.equal(retry.state,'registration-required','retry is explicit, never resumes cancelled continuation');
});


test('Other-agent registration requires that exact identity and does not require runtime setup', async t => {
  const f = await fixture(t);
  const other = 'f'.repeat(64);
  assert.equal((await f.request('profile-preview', { secret: f.nsec, agent: other })).state, 'failed');
  assert.equal(readSettings(f.directory).agents.length, 0);
  assert.equal((await f.request('profile-preview', { secret: f.nsec, agent: f.agent })).state, 'completed');
  assert.equal((await f.request('register-agent', { secret: f.nsec, agent: other })).state, 'failed');
  assert.equal(readSettings(f.directory).agents.length, 0);
  const before = readSettings(f.directory);
  assert.equal((await f.request('register-agent', { secret: f.nsec, agent: f.agent })).state, 'completed');
  const after = readSettings(f.directory);
  assert.equal(after.agents[0]?.publicKey, f.agent);
  assert.equal(after.agents[0]?.runtimeId, undefined);
  assert.deepEqual(after.providers, before.providers);
  assert.deepEqual(after.runtimes, before.runtimes);
  const rows = sectionRows(f.snapshot, 1);
  assert.equal(rows.filter(row => row.id === f.agent).length, 1, 'registered identity has one row');
  assert.ok(rows.indexOf(rows.find(row => row.id === f.agent)!) < rows.findIndex(row => row.id === 'other-agents'), 'successful registration moves the row immediately without Start');
  await f.request('operations');
  assert.match(f.snapshot.status, /No saved operations/);
});

test('direct agent configuration registers, saves future selection without mutating actual, remembers discovery and preserves provider references', async t => {
  const f = await fixture(t);
  const begin = await f.start(); assert.equal(begin.state,'registration-required'); if (begin.state !== 'registration-required') return;
  await f.request('profile-preview',{secret:f.nsec,agent:f.agent,continuation:begin.continuation});
  assert.equal((await f.request('configuration-form')).state,'completed',f.snapshot.status);
  const provider = readSettings(f.directory).providers[0]!;
  const fields = {harness:'buzz-agent',provider:provider.id,model:'gpt-5',effort:'high',environment:'{"REVIEW_MODE":"synthetic"}'};
  assert.equal((await f.request('register-agent',{...fields,secret:f.nsec,agent:f.agent,continuation:begin.continuation})).state,'submitted',f.snapshot.status);
  await until(()=>f.snapshot.agents[0]?.label.includes('running') === true);
  let row = f.snapshot.agents[0]!;
  const actual = JSON.parse(row.evidence!).report.body.actualRun;
  assert.notEqual(actual.selection.harnessSetup.id, `runtime:${f.runtimeId}`);
  assert.equal((await f.request('configure-agent',{...fields,effort:'low'},row.target,row.revision)).state,'submitted',f.snapshot.status);
  await until(()=>f.snapshot.agents[0]!.revision > row.revision);
  row = f.snapshot.agents[0]!;
  assert.deepEqual(JSON.parse(row.evidence!).report.body.actualRun,actual);
  assert.equal(row.configuration?.effort,'low');
  assert.ok(!row.detail.includes('runtime:'));
  const saved = readSettings(f.directory);
  assert.equal((await f.request('configuration-form')).state,'completed');
  assert.deepEqual(readSettings(f.directory).providers,saved.providers);
  assert.deepEqual(readSettings(f.directory).runtimes,saved.runtimes);
  assert.deepEqual(readSettings(f.directory).harnesses,f.snapshot.harnesses);
  const {ManagerController} = await import('../src/manager-controller.ts');
  const reopened = new ManagerController(f.controller.home,()=>{});
  assert.deepEqual(reopened.snapshot().harnesses,f.snapshot.harnesses);
  assert.deepEqual(reopened.snapshot().settings?.providers,saved.providers);
  assert.deepEqual(reopened.snapshot().settings?.runtimes,saved.runtimes);
  assert.equal((await reopened.request({id:1,action:'configure-agent',values:fields})).state,'signin-required');
  reopened.close();
  await f.request('stop',undefined,row.target,row.revision);
  await until(()=>f.snapshot.agents[0]?.label.includes('stopped') === true);
  row=f.snapshot.agents[0]!;
  await f.request('start',undefined,row.target,row.revision);
  await until(()=>f.snapshot.agents[0]?.label.includes('running') === true);
  assert.notEqual(JSON.parse(f.snapshot.agents[0]!.evidence!).report.body.actualRun.selection.harnessSetup.id,actual.selection.harnessSetup.id);
});

test('environment Databricks is normalized, visible and durable before any provider setup or credential read', async t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(),'beehive-pairing-cli-env-provider-')));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const prior = process.env.DATABRICKS_HOST;
  process.env.DATABRICKS_HOST = 'https://synthetic-workspace.example/';
  const {ManagerController} = await import('../src/manager-controller.ts');
  try {
    const controller = new ManagerController(home,()=>{},async()=>{ throw Error('Passive availability cannot read credentials'); });
    const providers = controller.snapshot().settings!.providers;
    assert.equal(providers.length,1); assert.equal(providers[0]!.type,'databricks_v2');
    assert.equal(providers[0]!.endpoint,'https://synthetic-workspace.example');
    controller.close();
    const reopened = new ManagerController(home,()=>{});
    assert.deepEqual(reopened.snapshot().settings!.providers,providers); reopened.close();
    assert.ok(!existsSync(join(home,'credentials.json')));
  } finally { if (prior === undefined) delete process.env.DATABRICKS_HOST; else process.env.DATABRICKS_HOST = prior; }
});
