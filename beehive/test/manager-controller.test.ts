import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerController, managerCredential, type ManagerSnapshot } from '../src/manager-controller.ts';
import { bootstrapHostIdentity } from '../src/host-identity.ts';
import { createCredential, credentialReference, readCredential, type CredentialBackend } from '../src/credential-store.ts';
import { publicKey, message, type Message } from '../src/protocol.ts';
import { profileDrafts } from '../src/profile-drafts.ts';
import { saveSettings } from '../src/settings.ts';

const secret = '1'.repeat(64), owner = publicKey(secret);
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'beehive-manager-'));
  const secrets = new Map<string,string>();
  const backend: CredentialBackend = { read: r => secrets.get(JSON.stringify(r)) ?? null, create: (r,s) => { secrets.set(JSON.stringify(r),s); }, remove: r => { secrets.delete(JSON.stringify(r)); } };
  let snapshot: ManagerSnapshot;
  let receive: (m: Message) => void = () => {};
  let closed = 0;
  const submitted: Message[] = [];
  let states: any[] = [];
  const client = { ready: Promise.resolve(), connected: true, close() { closed++; }, status: () => states, submit: (m: Message) => { submitted.push(m); }, reconcile() {} };
  const credential = async (input: any, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (input.action === 'configure') { bootstrapHostIdentity(input.directory,input.label,input.owner,input.relay,backend); return { ok: true }; }
    if (input.secret) {
      if (publicKey(input.secret) !== input.owner) throw Error('mismatch');
      createCredential('owner',input.secret,backend);
    }
    return { ok: true, secret: backend.read(credentialReference('owner',input.owner)) === null ? null : readCredential(credentialReference('owner',input.owner),backend) };
  };
  const controller = new ManagerController(home, s => { snapshot = s; }, credential, ((_root: string,_url: string,_secret: string,r: typeof receive) => { receive = r; return client; }) as any, async () => undefined, async () => [{publicKey:'agent-a',name:'Fixture agent',status:'unknown',channels:[]}]);
  return { controller, home, submitted, backend, get closed() { return closed; }, get snapshot() { return snapshot!; }, receive: (m: Message) => receive(m), states: (s: any[]) => { states = s; }, cleanup() { controller.close(); rmSync(home,{ recursive: true, force: true }); } };
}

test('saved registration seeds snapshots when directory omits it, survives reopen, and never duplicates discovery', () => {
  const home = mkdtempSync(join(tmpdir(), 'beehive-manager-'));
  const directory = join(home, '.beehive', 'host');
  const agent = 'a'.repeat(64);
  saveSettings(directory, { version: 1, revision: 0, providers: [], runtimes: [], agents: [{ publicKey: agent, key: credentialReference('agent', agent), profileState: 'found', profile: { relay: 'wss://fixture.invalid', name: 'Retained agent' } }] }, 0);
  const empty = new ManagerController(home, () => {}, undefined, undefined, undefined, async () => []);
  try {
    assert.deepEqual(empty.snapshot().agents.map(row => [row.id, row.names?.agent]), [[agent, 'Retained agent']]);
    empty.close();
    const reopened = new ManagerController(home, () => {}, undefined, undefined, undefined, async () => { throw Error('relay unavailable'); });
    try { assert.deepEqual(reopened.snapshot().agents.map(row => row.id), [agent]); }
    finally { reopened.close(); }
    const discovered = new ManagerController(home, () => {}, undefined, undefined, undefined, async () => [{ publicKey: agent, name: 'Directory name', status: 'offline', channels: [] }]);
    try {
      (discovered as any).directory = [{ publicKey: agent, name: 'Directory name', status: 'offline', channels: [] }];
      assert.deepEqual(discovered.snapshot().agents.map(row => [row.id, row.names?.agent]), [[agent, 'Directory name']]);
    } finally { discovered.close(); }
  } finally { empty.close(); rmSync(home, { recursive: true, force: true }); }
});

test('manager config save is real/keyless owner routing; retained configuration refuses reset; offline multiline draft persists', async () => {
  const f = fixture();
  try {
    await f.controller.request({ id: 1, action: 'configure', values: { owner, relay: 'wss://example.invalid' } });
    assert.ok(existsSync(join(f.home,'.beehive','host','host-identity.json')));
    assert.match(f.snapshot.status,/saved/);
    assert.match(f.snapshot.local[0]!.detail, /Host configured/);
    assert.ok(!f.snapshot.local[0]!.detail.includes('{'));
    assert.equal(f.snapshot.local[0]!.evidence, undefined);
    assert.equal(f.backend.read(credentialReference('owner',owner)),null);
    await f.controller.request({ id: 2, action: 'configure', values: { owner, relay: 'wss://other.invalid' } });
    assert.match(f.snapshot.status,/already exists/);
    assert.equal(f.snapshot.hostRelay,'wss://example.invalid');
    await f.controller.request({ id: 3, action: 'draft', values: { name: 'Working', instructions: 'First line\nSecond line' } });
    assert.equal(profileDrafts(join(f.home,'.beehive','owner')).list()[0]!.value.instructions,'First line\nSecond line');
  } finally { f.cleanup(); }
});

test('manager gates owner, exact selection/revision/freshness, unresolved operations and Restart handler; signout is never Stop', async () => {
  const f = fixture();
  let id = 0;
  const request = (action: string, rest = {}) => f.controller.request({ id: ++id, action, ...rest });
  try {
    await request('start'); assert.match(f.snapshot.status,/sign-in required/);
    await request('signin',{ values: { owner, relay: 'wss://example.invalid', secret: '2'.repeat(64) } }); assert.match(f.snapshot.status,/mismatch/);
    await request('signin',{ values: { owner, relay: 'wss://example.invalid', secret } }); assert.equal(f.snapshot.owner,owner);
    const m = message('inventory','host-a','agent-a',3,{ observedAt: Date.now(), phase: 'stopped', actualRun: null, assignedHost: 'host-a', configurations: { default: {} }, selectedNext: {} });
    f.receive(m);
    assert.match(f.snapshot.agents[0]!.detail, /Current run \(host report\)/);
    assert.match(f.snapshot.agents[0]!.detail, /Configuration for next start/);
    assert.ok(!f.snapshot.agents[0]!.detail.includes('{'));
    assert.equal(f.snapshot.agents[0]!.disabled!.start, '');
    assert.equal(f.snapshot.agents[0]!.names?.agent, 'Fixture agent');
    assert.equal(f.snapshot.agents[0]!.names?.host, 'host-a');
    f.receive(message('availability','host-a','',0,{ observedAt: Date.now(), configuration: { label: 'Readable host', relay: 'wss://example.invalid' } }));
    assert.equal(f.snapshot.agents[0]!.names?.host, 'Readable host');
    const target = JSON.stringify(['host-a','agent-a']);
    assert.equal(f.snapshot.agents[0]!.target, target, 'presentation cannot replace routing authority');
    await request('start',{ target, revision: 2 }); assert.match(f.snapshot.status,/selection changed/);
    await request('restart',{ target, revision: 2 }); assert.match(f.snapshot.status,/selection changed/); assert.equal(f.submitted.length,0);
    await request('start',{ target, revision: 3 }); assert.equal(f.submitted.length,1); assert.equal(f.submitted[0]!.type,'start');
    await f.controller.request({ id, action: 'start', target, revision: 3 }); assert.equal(f.submitted.length,1,'duplicate request cannot act twice');
    await request('restart',{ target, revision: 3 }); assert.equal(f.submitted.at(-1)!.type,'restart'); assert.equal(f.submitted.length,2);
    f.states([{ request: f.submitted[0], state: 'unknown' }]);
    await request('stop',{ target, revision: 3 }); assert.match(f.snapshot.status,/no confirmed result/); assert.equal(f.submitted.length,2);
    await request('restart',{ target, revision: 3 }); assert.equal(f.submitted.length,2,'unresolved operation blocks Restart');
    f.states([{ request: f.submitted[0], state: 'completed' }]);
    await request('select-config',{ target, revision: 3, values: { name: 'Alternative' } }); assert.equal(f.submitted[2]!.type,'save');
    await request('stop',{ target, revision: 3 }); assert.equal(f.submitted[3]!.type,'stop');
    f.receive({ ...m, revision: 4, body: { ...m.body, observedAt: Date.now()+1, phase: 'running', actualRun: { run: 'actual' } } });
    await request('start',{ target, revision: 4 }); assert.match(f.snapshot.status,/recent report from the assigned host/);
    f.receive({ ...m, revision: 5, body: { ...m.body, observedAt: Date.now()+2, assignedHost: 'host-b' } });
    await request('restart',{ target, revision: 5 }); assert.match(f.snapshot.status,/selection changed/); assert.equal(f.submitted.length,4);
    await request('signout'); assert.equal(f.snapshot.owner,undefined); assert.equal(f.submitted.length,4); assert.equal(f.closed,1);
    f.receive(m); assert.equal(f.controller.snapshot().agents.length,0,'late receive is fenced after signout');
  } finally { f.cleanup(); }
});

test('cancelled/closed credential completion cannot sign in or open transport', async () => {
  const home = mkdtempSync(join(tmpdir(),'beehive-manager-'));
  let finish!: (v: any) => void; let connections = 0;
  const c = new ManagerController(home, () => {}, () => new Promise(resolve => { finish = resolve; }), (() => { connections++; throw Error('must not connect'); }) as any);
  try {
    const pending = c.request({ id: 1, action: 'signin', values: { owner, relay: 'wss://example.invalid' } });
    c.cancel(); c.close(); finish({ ok: true, secret }); await pending;
    assert.equal(connections,0); assert.equal(c.snapshot().owner,undefined);
    assert.ok(!existsSync(join(home,'.beehive','owner','controller.json')));
  } finally { c.close(); rmSync(home,{ recursive: true, force: true }); }
});


test('credential orchestration uses explicit Node, strips loaders, and awaits owned cancellation', async () => {
  const home = mkdtempSync(join(tmpdir(),'beehive-manager-'));
  const helper = new URL('./manager-credential-fixture.ts', import.meta.url);
  const abort = new AbortController();
  try {
    const result = await managerCredential({},abort.signal,helper);
    assert.equal(result.node,process.versions.node); assert.equal(result.overrides,undefined);
    const marker = join(home,'helper-pid');
    const pending = managerCredential({ wait: true, marker },abort.signal,helper);
    for (let i=0; i<100 && !existsSync(marker); i++) await new Promise(r => setTimeout(r,10));
    assert.ok(existsSync(marker),'owned helper reached explicit fixture boundary');
    const pid = Number(readFileSync(marker,'utf8'));
    abort.abort(); await assert.rejects(pending,/cancelled/);
    assert.throws(() => process.kill(pid,0),{ code: 'ESRCH' });
  } finally { abort.abort(); rmSync(home,{ recursive: true, force: true }); }
});

test('manager presentation preserves raw evidence, unknown states and literal configuration values', async () => {
  const f = fixture();
  try {
    await f.controller.request({ id: 1, action: 'signin', values: { owner, relay: 'wss://example.invalid', secret } });
    const m = message('inventory','host-a','agent-a',3,{ observedAt: Date.now() - 10000, phase: 'running', assignedHost: 'host-a', actualRun: { selection: { model: 'accepted', workspace: 'unconfirmed', profile: 'default' }, future: { diagnostic: 'raw detail' } }, selectedNext: { configuration: { name: 'accepted', revision: 2 }, harnessSetup: { id: 'setup', fingerprint: 'fingerprint' } } });
    f.receive(m);
    const row = f.snapshot.agents[0]!;
    assert.match(row.label, /Unknown/);
    assert.match(row.detail, /Current status unknown/);
    assert.match(row.detail, /Reported status: running/);
    assert.match(row.detail, /Model: accepted\nWorkspace: unconfirmed/);
    assert.match(row.detail, /Configuration name: accepted/);
    assert.match(row.detail, /future: diagnostic: raw detail/);
    assert.deepEqual(JSON.parse(row.evidence!).report, m);
    assert.match(row.disabled!.start!, /host report is old/);
    const request = message('save','host-a','agent-a',3,{ configurationAction: 'select', name: 'accepted' });
    const operation = { request, state: 'unknown', publication: 'relay policy failure; automatic retry disabled; reconcile, then retry after policy repair', result: 'new backend diagnostic' };
    f.states([operation]); f.controller.refresh();
    const shown = f.snapshot.diagnostics!.find(r => r.id === `operation:${request.id}`)!;
    assert.match(shown.label, /Choose configuration · Unknown/);
    assert.match(shown.detail, /Automatic retry is disabled/);
    assert.match(shown.detail, /Host result: new backend diagnostic/);
    assert.deepEqual(JSON.parse(shown.evidence!), operation);
    await f.controller.request({ id: 2, action: 'operations' });
    assert.ok(f.snapshot.status.startsWith(`Choose configuration · Unknown · ${request.id.slice(0,8)}\nnew backend diagnostic`));
    await f.controller.request({ id: 3, action: 'reconcile' });
    assert.match(f.snapshot.status, /Checking operation results. Operations blocked by relay policy will not be retried./);
    assert.equal(f.submitted.length, 0);
    assert.equal(operation.state, 'unknown');
    f.receive(message('availability','host-b','',0,{ observedAt: Date.now(), configuration: { label: 'Host B', relay: 'wss://example.invalid' } }));
    assert.match(f.snapshot.diagnostics!.find(r => r.id === 'host:host-b')!.detail, /Host configuration: Host name: Host B/);
  } finally { f.cleanup(); }
});

test('typed completion separates submitted intent from failures, cancellation and ignored requests', async () => {
  const f = fixture();
  try {
    assert.equal((await f.controller.request({id:1,action:'start'})).state,'failed');
    assert.equal((await f.controller.request({id:1,action:'start'})).state,'ignored');
    assert.equal((await f.controller.request({id:2,action:'signin',values:{owner,relay:'wss://example.invalid',secret}})).state,'completed');
    f.receive(message('inventory','host-a','agent-a',3,{observedAt:Date.now(),phase:'stopped',actualRun:null,assignedHost:'host-a'}));
    const result = await f.controller.request({id:3,action:'start',target:JSON.stringify(['host-a','agent-a']),revision:3});
    assert.equal(result.state,'submitted');
    if (result.state === 'submitted') assert.equal(result.operationId,f.submitted[0]!.id);
    assert.equal((await f.controller.request({id:4,action:'start',target:JSON.stringify(['host-a','agent-a']),revision:2})).state,'failed');
  } finally {f.cleanup();}
  const home = mkdtempSync(join(tmpdir(),'beehive-manager-'));
  let finish!: (v:any)=>void;
  const c = new ManagerController(home,()=>{},()=>new Promise(resolve=>{finish=resolve;}),undefined,async()=>undefined);
  try {
    const pending = c.request({id:1,action:'signin',values:{owner,relay:'wss://example.invalid'}});
    c.cancel(); finish({ok:true,secret});
    assert.equal((await pending).state,'cancelled');
    assert.equal(c.snapshot().owner,undefined);
  } finally {c.close();rmSync(home,{recursive:true,force:true});}
});

test('late directory completion after cancellation cannot repopulate Agents',async()=>{
  const home=mkdtempSync(join(tmpdir(),'beehive-manager-'));let enter!:()=>void,release!:(v:any)=>void;
  const entered=new Promise<void>(r=>enter=r),read=new Promise<any>(r=>release=r);
  const client={ready:Promise.resolve(),connected:true,close(){},status:()=>[],reconcile(){},submit(){throw Error('No execution');}};
  const c=new ManagerController(home,()=>{},async()=>({ok:true,secret}),(()=>client) as any,async()=>undefined,async()=>{enter();return read;});
  try {
    const pending=c.request({id:1,action:'signin',values:{owner,relay:'wss://fixture.invalid'}});
    await entered;c.cancel();release([{publicKey:'late-agent',name:'Late',status:'unknown',channels:[]}]);
    assert.equal((await pending).state,'cancelled');assert.deepEqual(c.snapshot().agents,[]);
  } finally {c.close();rmSync(home,{recursive:true,force:true});}
});

test('directory refresh replaces removals, retains prior rows on failure, and fences cancelled completion',async()=>{
  const home=mkdtempSync(join(tmpdir(),'beehive-manager-'));
  const rows=[{publicKey:'agent-a',name:'A',status:'unknown' as const,channels:[]}];
  let read:()=>Promise<any>=async()=>rows,connections=0;
  const client={ready:Promise.resolve(),connected:true,close(){},status:()=>[],reconcile(){},submit(){throw Error('No execution');}};
  const c=new ManagerController(home,()=>{},async()=>({ok:true,secret}),(()=>{connections++;return client;}) as any,async()=>undefined,()=>read());
  let id=0;const request=(action:string)=>c.request({id:++id,action,values:{owner,relay:'wss://fixture.invalid'}});
  try {
    assert.equal((await request('signin')).state,'completed');
    read=async()=>{throw Error('Offline');};
    assert.equal((await request('directory-refresh')).state,'failed');
    assert.equal(c.snapshot().agents.length,1);assert.match(c.snapshot().status,/Previous results retained/);
    let enter!:()=>void,release!:(v:any)=>void;
    const entered=new Promise<void>(r=>enter=r),pendingRead=new Promise<any>(r=>release=r);
    read=async()=>{enter();return pendingRead;};
    const pending=request('directory-refresh');await entered;c.cancel();release([]);
    assert.equal((await pending).state,'cancelled');assert.equal(c.snapshot().agents.length,1);
    read=async()=>[];
    assert.equal((await request('directory-refresh')).state,'completed');assert.equal(c.snapshot().agents.length,0);
    assert.equal(connections,1);
  } finally {c.close();rmSync(home,{recursive:true,force:true});}
});
