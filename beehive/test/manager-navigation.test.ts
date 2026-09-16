import test from 'node:test';
import assert from 'node:assert/strict';
import { ManagerNavigation, managerSections, sectionRows } from '../src/manager-navigation.ts';
import type { ManagerSnapshot } from '../src/manager-controller.ts';

test('four sections retain exact selections without retargeting removed items', () => {
  assert.deepEqual(managerSections, ['Host', 'Agents', 'Harnesses', 'Providers']);
  const navigation = new ManagerNavigation();
  const rows = ['a','b'].map(id => ({ id, label: id, detail: id }));
  assert.equal(navigation.selection(rows), 'a');
  navigation.select('b'); navigation.switch(1);
  assert.equal(navigation.selection(rows), 'a');
  navigation.switch(0); assert.equal(navigation.selection(rows), 'b');
  assert.equal(navigation.selection(rows.slice(0,1)), 'b');
  navigation.switch(9); assert.equal(navigation.section, 0);
});

test('section rows expose selected public fields, not credential references or other controls', () => {
  const snapshot: ManagerSnapshot = { local: [{ id: 'host', label: 'This host', detail: '' }], agents: [], status: '', hostRelay: 'wss://fixture.invalid', service: { state: 'stopped' }, settings: { version: 1, revision: 1, agents: [], providers: [{ id: 'p', name: 'Provider A', type: 'openai', endpoint: 'https://api.openai.com/v1', key: { service: 'beehive', account: 'secret-reference' } }], runtimes: [{ id: 'r', name: 'Runtime A', harness: 'buzz-agent', providerId: 'p', model: 'gpt-5', effort: 'high', executable: '/fixture/harness' }] } };
  assert.match(sectionRows(snapshot,0)[0]!.detail, /Host name: This host\nRelay URL: wss:\/\/fixture.invalid\nState: stopped/);
  assert.equal(sectionRows(snapshot,1).length, 0);
  assert.match(sectionRows(snapshot,2)[0]!.detail, /Provider: Provider A\nModel: gpt-5\nEffort: high/);
  assert.equal(sectionRows(snapshot,3)[0]!.id,'p');
  assert.ok(!JSON.stringify(sectionRows(snapshot,3)).includes('secret-reference'));
});
