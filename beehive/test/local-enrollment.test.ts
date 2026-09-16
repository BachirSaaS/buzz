import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync, realpathSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const fault={path:'',after:false,armed:false};
Object.assign(globalThis,{__enrollmentFault:fault});
registerHooks({load(url,context,next){
  const result=next(url,context);
  if(!url.endsWith('/src/storage.ts'))return result;
  const source=String(result.source);
  const marker='export function writePrivate(path: string, value: unknown, exclusive = false): void {';
  assert.ok(source.includes(marker));
  return {...result,source:source.replace(marker,marker+`
    const fault = (globalThis as any).__enrollmentFault;
    const fail = () => { if(fault.armed && path === fault.path) { fault.armed=false; throw Error('Synthetic enrollment persistence failure'); } };
    if (!fault.after) fail();
  `).replace("trace('private.end');","trace('private.end'); if (fault.after) fail();")};
}});
const {registrationFixture}=await import('./registration-fixture.ts');
const {readSettings}=await import('../src/settings.ts');
import type { ManagerSnapshot } from '../src/manager-controller.ts';
async function until(fn:()=>boolean){for(let n=0;n<400;n++){if(fn())return;await delay(20);}throw Error('Enrollment recovery evidence missing');}

for(const phase of ['before-journal','before-manifest','after-manifest'] as const) test(`host-owned enrollment recovers ${phase} prefix without resetting identity or root`,async t=>{
  const home=realpathSync(mkdtempSync(join(tmpdir(),'beehive-pairing-cli-enrollment-recovery-')));
  let snapshot:ManagerSnapshot;
  const f=await registrationFixture(home,s=>{snapshot=s;},false);
  t.after(async()=>{fault.armed=false;await f.close();rmSync(home,{recursive:true,force:true});});
  let id=0;const request=(action:string,values?:Record<string,string>,target?:string,revision?:number)=>f.controller.request({id:++id,action,values,target,revision});
  await request('signin');
  const row=()=>snapshot!.agents.find(a=>a.id===f.agent)!;
  await until(()=>!!row()?.startTarget);
  const begin=async()=>{
    const result=await request('start',undefined,row().startTarget,-1);
    if(result.state!=='registration-required')throw Error(snapshot!.status);
    await request('profile-preview',{secret:f.nsec,continuation:result.continuation});
    return request('register-agent',{secret:f.nsec,runtime:f.runtimeId,continuation:result.continuation});
  };
  fault.path=phase==='before-journal'?join(f.directory,'agents',f.agent,'journal.json'):join(f.directory,'setup.json');
  fault.after=phase==='after-manifest';fault.armed=true;
  assert.equal((await begin()).state,'failed',snapshot!.status);
  assert.equal(fault.armed,false,'real production persistence boundary reached');
  const retained=readFileSync(join(f.directory,'agents',f.agent,'enrollment.json'));
  const identity=readSettings(f.directory).agents;
  assert.ok(!row().label.includes('running'));
  await until(()=>!!row()?.startTarget);
  assert.equal((await begin()).state,'submitted',snapshot!.status);
  await until(()=>row().label.includes('running'));
  assert.deepEqual(readFileSync(join(f.directory,'agents',f.agent,'enrollment.json')),retained);
  assert.deepEqual(readSettings(f.directory).agents,identity);
  const report=JSON.parse(row().evidence!).report;
  assert.deepEqual(report.body.genesis,JSON.parse(retained.toString()).state.assignment.genesis);
  assert.equal((await request('stop',undefined,row().target,row().revision)).state,'submitted');
  await until(()=>row().label.includes('stopped'));
  assert.equal(existsSync(join(f.directory,'setup.json')),true);
  await f.service.close();
  const {host}=await import('../src/host.ts');
  const {readHostIdentity}=await import('../src/host-identity.ts');
  const {privateHostTransport}=await import('../src/host-transport.ts');
  const hostIdentity=readHostIdentity(f.directory,f.credentials);
  const reopened=await host(f.directory,f.url,undefined,privateHostTransport(hostIdentity.pairing,hostIdentity.secret),f.credentials,async()=>({ok:true,secret:'synthetic-provider-key'}));
  try {
    assert.deepEqual(reopened.agents,[f.agent]);
    const state=JSON.parse(readFileSync(join(f.directory,'agents',f.agent,'journal.json'),'utf8'));
    assert.equal(state.phase,'stopped');assert.equal(state.actual,null);assert.deepEqual(state.assignment.genesis,report.body.genesis);
  } finally {await reopened.close();}
});

test('new local slot preserves a running sibling and exact enrollment retries cannot duplicate it',async t=>{
  const {managementClient}=await import('../src/intents.ts');
  const {message,publicKey,newKey}=await import('../src/protocol.ts');
  const {registerAgent}=await import('../src/settings-credentials.ts');
  const home=realpathSync(mkdtempSync(join(tmpdir(),'beehive-pairing-cli-enrollment-sibling-')));
  const f=await registrationFixture(home,()=>{});
  const inventory=new Map<string,any>();
  const c=managementClient(join(home,'sibling-client'),f.url,f.ownerSecret,m=>{if(m.type==='inventory')inventory.set(m.agent,m);},()=>{},{catalog:{version:1,owner:publicKey(f.ownerSecret),relay:f.url,registrations:[]}});
  t.after(async()=>{c.close();await f.close();rmSync(home,{recursive:true,force:true});});
  await c.ready;await until(()=>inventory.has(f.agent));
  const send=async(m:Parameters<typeof c.submit>[0])=>{c.submit(m);await until(()=>c.status().some(o=>o.request.id===m.id&&o.state==='completed'));};
  await send(message('start',f.host,f.agent,inventory.get(f.agent).revision));
  await until(()=>inventory.get(f.agent).body.phase==='running');
  const active=inventory.get(f.agent).body.actualRun;
  const siblingJournal=readFileSync(join(f.directory,'agents',f.agent,'journal.json'));
  const secret=newKey(),agent=publicKey(secret);
  registerAgent(f.directory,secret,f.credentials,{profileState:'none'},f.runtimeId,readSettings(f.directory).revision);
  const enroll=message('enroll',f.host,agent,0,{runtime:f.runtimeId,settingsRevision:readSettings(f.directory).revision});
  await send(enroll);await until(()=>inventory.has(agent));
  const root=inventory.get(agent).body.genesis;
  assert.deepEqual(readFileSync(join(f.directory,'agents',f.agent,'journal.json')),siblingJournal);
  assert.deepEqual(inventory.get(f.agent).body.actualRun,active);
  await send(message('enroll',f.host,agent,0,{runtime:f.runtimeId,settingsRevision:readSettings(f.directory).revision}));
  c.reconcile();await delay(250);
  assert.deepEqual(inventory.get(agent).body.genesis,root);
  assert.equal(inventory.get(agent).body.phase,'stopped');
  assert.equal(Object.keys(JSON.parse(readFileSync(join(f.directory,'setup.json'),'utf8')).agents).length,2);
  await send(message('stop',f.host,f.agent,inventory.get(f.agent).revision));
});
