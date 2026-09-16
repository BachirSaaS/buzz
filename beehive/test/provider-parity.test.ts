import test from 'node:test';
import assert from 'node:assert/strict';
import { providerModelOptions } from '../src/settings-models.ts';
import { runtimeEfforts } from '../src/runtime-effort.ts';
import { validateSettings, type Settings } from '../src/settings.ts';
import { presets } from '../src/presets.ts';
const key = {service:'beehive' as const,account:'provider:11111111-1111-1111-1111-111111111111'};
const signal = () => AbortSignal.timeout(1000);
test('Desktop OpenAI prefix/exclusion/creation ordering/alias labels differ from compatible endpoints',async()=>{
  const data=[{id:'gpt-5-2026-01-01',created:10},{id:'gpt-5',created:1},{id:'o3',created:9},{id:'other-model',created:7},{id:'gpt-transcribe',created:12},{id:'chatgpt-4o',created:2},{id:'custom',created:20},{id:'gpt-4.1-2025-04-14',created:3}];
  const fetcher: typeof fetch = async(url,options)=>{assert.equal(url,'https://fixture.example/v1/models');assert.equal((options?.headers as any).Authorization,'Bearer synthetic');assert.equal(options?.redirect,'error');return new Response(JSON.stringify({data}));};
  assert.deepEqual(await providerModelOptions({type:'openai',endpoint:'https://fixture.example/v1'},'synthetic',signal(),fetcher),[{id:'o3',name:'o3'},{id:'other-model',name:'other-model'},{id:'gpt-4.1-2025-04-14',name:'GPT-4.1'},{id:'chatgpt-4o',name:'ChatGPT 4o'},{id:'gpt-5',name:'GPT-5'}]);
  const compatible=await providerModelOptions({type:'openai-compat',endpoint:'https://fixture.example/v1'},'synthetic',signal(),fetcher);
  assert.equal(compatible[0]?.id,'custom');assert.ok(compatible.some(v=>v.id==='gpt-5-2026-01-01'));assert.ok(compatible.some(v=>v.id==='gpt-transcribe'));
});
test('Anthropic headers, display names, bounded pagination; OpenRouter tools-only',async()=>{
  let calls=0;
  const rows=await providerModelOptions({type:'anthropic',endpoint:'https://fixture.example'},'synthetic',signal(),async(url,options)=>{
    assert.equal((options?.headers as any)['x-api-key'],'synthetic');assert.equal((options?.headers as any)['anthropic-version'],'2023-06-01');
    assert.equal(url,'https://fixture.example/v1/models'+(calls?'?after_id=a':''));
    return new Response(JSON.stringify(calls++?{data:[{id:'b',display_name:'Beta'}],has_more:false}:{data:[{id:'a',display_name:'Alpha'}],has_more:true,last_id:'a'}));
  });assert.deepEqual(rows,[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}]);assert.equal(calls,2);
  await assert.rejects(providerModelOptions({type:'anthropic',endpoint:'https://fixture.example'},'synthetic',signal(),async()=>new Response(JSON.stringify({data:[],has_more:true,last_id:'repeat'}))),/unavailable/);
  const router=await providerModelOptions({type:'openrouter',endpoint:'https://fixture.example/api/v1'},'synthetic',signal(),async()=>new Response(JSON.stringify({data:[{id:'vendor/tools',supported_parameters:['tools']},{id:'vendor/text',supported_parameters:[]}]})));
  assert.deepEqual(router,[{id:'vendor/tools',name:'vendor/tools'}]);
  await assert.rejects(providerModelOptions({type:'openai',endpoint:'https://fixture.example'},'synthetic',signal(),async()=>new Response('x'.repeat(1048577))),/unavailable/);
});
test('OS-backed provider validation preserves harness matrix and custom effort rules',()=>{
  for (const type of ['anthropic','openai-compat','openrouter'] as const) {
    const settings:Settings={version:1,revision:0,agents:[],providers:[{id:'p',name:'P',type,endpoint:'https://fixture.example/v1',key,...(type==='openai-compat'?{wire:'responses' as const}:{})}],runtimes:[{id:'r',name:'R',harness:'buzz-agent',executable:process.execPath,providerId:'p',model:'custom'}]};
    validateSettings(settings);
    for (const harness of ['codex','pi'] as const) assert.throws(()=>validateSettings({...settings,runtimes:[{...settings.runtimes[0]!,harness,cli:process.execPath}]}),/combination/);
    assert.throws(()=>validateSettings({...settings,providers:[{...settings.providers[0]!,endpoint:'https://secret@fixture.example'}]}),/endpoint/);
    if(type !== 'anthropic') validateSettings({...settings,runtimes:[{...settings.runtimes[0]!,effort:'high'}]});
  }
  assert.deepEqual(runtimeEfforts('anthropic','custom'),[]);
  assert.ok(runtimeEfforts('openai','custom').includes('high'));
  assert.ok(!runtimeEfforts('openai','gpt-5').includes('xhigh'));
  const pi=presets.find(p=>p.id==='pi')!;assert.equal(pi.command,'buzz-pi-acp');assert.match(pi.installHint,/salman1993\/buzz-pi-acp.git#86b201e/);
});
