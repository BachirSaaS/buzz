import test from 'node:test';
import assert from 'node:assert/strict';
import { actionsForRow } from '../src/manager-menu.ts';
import { sectionRows } from '../src/manager-navigation.ts';
import type { ManagerSnapshot } from '../src/manager-controller.ts';

const action = (label: string) => ({ label, run() {} });
const candidates = ['Start','Stop','Configure this computer','Register agent','Configure','Restart','Move…','Refresh agents','Inspect operations','Check operation results','Sign out','Publish profile or instructions','Refresh harnesses','Add provider','Models','Sign in with Buzz key','Sign in with saved owner key','Import matching owner key and sign in'].map(action);
const agent = { id:'agent', label:'Agent', detail:'', revision:1, configurations:[] };
const snapshot = { owner:'owner', local:[{id:'host',label:'Host',detail:''}], agents:[agent], status:'', harnesses:[{id:'h',label:'H',state:'available',providers:[],reason:''}], settings:{version:1,revision:1,agents:[],runtimes:[],providers:[{id:'p',name:'P',type:'openai',endpoint:'https://fixture.invalid',key:{service:'beehive',account:'x'}}]} } as ManagerSnapshot;

function labels(section: number, id: string) {
  const row = sectionRows(snapshot, section).find(r => r.id === id);
  const actions = actionsForRow(snapshot, section, row, candidates);
  assert.ok(actions.every(a => a.object.id === id));
  return actions.map(a => a.label);
}

test('every Details menu belongs only to its selected entity or command row', () => {
  assert.deepEqual(labels(0,'host'), ['Start','Stop']);
  assert.deepEqual(labels(1,'registered-agents'), []);
  assert.deepEqual(labels(1,'agent'), ['Start','Stop','Register agent','Restart','Move…']);
  assert.deepEqual(labels(1,'refresh-agents'), ['Refresh agents']);
  assert.deepEqual(labels(1,'inspect-operations'), ['Inspect operations']);
  assert.deepEqual(labels(2,'refresh-harnesses'), ['Refresh harnesses']);
  assert.deepEqual(labels(2,'harness:h'), []);
  assert.deepEqual(labels(3,'add-provider'), ['Add provider']);
  assert.deepEqual(labels(3,'p'), ['Models']);
  assert.deepEqual(actionsForRow(snapshot,3,undefined,candidates), []);
});

test('signed-out sign-in rows each expose only themselves', () => {
  const signedOut = {...snapshot, owner:undefined} as ManagerSnapshot;
  for (const row of sectionRows(signedOut,1)) {
    const actions = actionsForRow(signedOut,1,row,candidates);
    assert.equal(actions.length,1); assert.equal(actions[0]!.object.id,row.id);
  }
});
