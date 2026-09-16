import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeEnvironment } from '../src/runtime-environment.ts';
import { AgentSession, prepareAgent } from '../src/acp.ts';
import { runtimeBindings } from '../src/settings-runtime.ts';
import { saveSettings, readSettings, type Settings } from '../src/settings.ts';
import { bindingFingerprint, type Setup } from '../src/host.ts';
import { publicKey } from '../src/protocol.ts';

const key = { service: 'beehive' as const, account: 'provider:00000000-0000-0000-0000-000000000000' };
test('runtime environment validates names, bytes and bounds; catalog Save retains immutable prior definitions', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'beehive-pairing-cli-env-')));
  try {
    for (const name of ['HOME','PATH','BUZZ_PRIVATE_KEY','BEEHIVE_PI_RUNTIME','NODE_OPTIONS','LD_PRELOAD','OPENAI_API_KEY','PI_ACP_PI_COMMAND','MY_SECRET','DATABRICKS_HOST','BUZZ_AGENT_MODEL','BUZZ_AGENT_THINKING_EFFORT']) assert.throws(() => runtimeEnvironment({[name]:'x'}));
    for (const input of [null, [], {REVIEW: 1}, {REVIEW: 'x\n'}, {REVIEW: '界'.repeat(700)}, Object.fromEntries(Array.from({length:33},(_,i)=>[`VAR_${i}`,'x'])), Object.fromEntries(Array.from({length:5},(_,i)=>[`VAR_${i}`,'x'.repeat(2048)]))]) assert.throws(() => runtimeEnvironment(input));
    const settings: Settings = {version:1, revision:0, agents:[], providers:[{id:'p',name:'Synthetic',type:'openai',endpoint:'https://api.openai.com/v1',key}], runtimes:[{id:'a',name:'A',harness:'buzz-agent',executable:realpathSync(process.execPath),providerId:'p',model:'gpt-5',environment:{REVIEW_MODE:'first'}}]};
    const saved = saveSettings(root,settings,0);
    const base: Setup = {host:'fixture',ownerPublic:publicKey('1'.repeat(64)),runner:realpathSync(process.execPath),args:[],workspace:root,serviceHome:root,configDirectory:root,mode:'fixture'};
    const first = runtimeBindings(base,saved)['runtime:a']!;
    const next = saveSettings(root,{...saved,runtimes:[...saved.runtimes,{...saved.runtimes[0]!,id:'b',name:'B',environment:{REVIEW_MODE:'second'}}]},1);
    assert.deepEqual(first.environment,{REVIEW_MODE:'first'});
    assert.notEqual(bindingFingerprint(first),bindingFingerprint(runtimeBindings(base,next)['runtime:b']!));
    assert.throws(()=>saveSettings(root,{...next,runtimes:[{...next.runtimes[0]!,environment:{REVIEW_MODE:'changed'}},next.runtimes[1]!]},2),/Retained/);
    assert.equal(readSettings(root).revision,2);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('actual owned ACP child receives snapshotted local environment, not ambient identity or credentials', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'beehive-pairing-cli-env-')));
  let session: AgentSession | undefined;
  try {
    const script = join(root,'fixture.ts'), evidence = join(root,'environment.json');
    writeFileSync(script,`import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(evidence)},JSON.stringify({value:process.env.REVIEW_MODE, identity:process.env.BUZZ_PRIVATE_KEY, token:process.env.DATABRICKS_TOKEN})); await import(${JSON.stringify(new URL('./acp-fixture.ts',import.meta.url).href)});`);
    const plan = {executable:realpathSync(process.execPath),args:[script],workspace:root,home:root,configDirectory:root,databricksHost:'https://fixture.invalid',model:'databricks-claude-haiku-4-5',environment:{REVIEW_MODE:'first'}};
    const prepared = prepareAgent(plan);
    plan.environment.REVIEW_MODE = 'later';
    assert.equal(prepared.env.REVIEW_MODE,'first');
    assert.equal(prepared.plan.environment?.REVIEW_MODE,'first');
    session = new AgentSession(prepared.plan,1500);
    await session.catalog(); await session.verify();
    assert.deepEqual(JSON.parse(readFileSync(evidence,'utf8')),{value:'first'});
  } finally { await session?.owned.stop(); rmSync(root,{recursive:true,force:true}); }
});

test('runtime form stops on failed discovery and cancelled models rather than continuing stale choices', async () => {
  const {runtimeForm} = await import('../src/runtime-form.ts');
  const snapshot = {local:[],agents:[],status:'synthetic',harnesses:[{id:'buzz-agent',label:'Buzz Agent',executable:'/fixture',state:'available' as const,providers:['openai' as const],reason:'fixture'}],settings:{version:1 as const,revision:1,agents:[],runtimes:[],providers:[{id:'p',name:'Provider',type:'openai' as const,endpoint:'https://api.openai.com/v1',key}]}};
  let choices = 0;
  const screen = {choose:async (_label:string,options:string[])=>{choices++;return options[0];},input:async()=>{throw Error('must not enter configuration');},confirm:async()=>{throw Error('must not save');},notice:()=>{}};
  await runtimeForm(screen,()=>snapshot,async()=>({state:'failed',reason:'fixture'}));
  assert.equal(choices,0);
  const calls:string[]=[];
  await runtimeForm(screen,()=>snapshot,async action=>{calls.push(action);return action === 'models' ? {state:'cancelled',reason:'fixture'} : {state:'completed'};});
  assert.equal(choices,2);
  assert.deepEqual(calls,['configuration-form','models']);
});
