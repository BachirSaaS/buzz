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
  const snapshot: ManagerSnapshot = { owner: 'owner', local: [{ id: 'host', label: 'This host', detail: '' }], agents: [], status: '', hostRelay: 'wss://fixture.invalid', service: { state: 'stopped' }, settings: { version: 1, revision: 1, agents: [], providers: [{ id: 'p', name: 'Provider A', type: 'openai', endpoint: 'https://api.openai.com/v1', key: { service: 'beehive', account: 'secret-reference' } }], runtimes: [{ id: 'r', name: 'Runtime A', harness: 'buzz-agent', providerId: 'p', model: 'gpt-5', effort: 'high', executable: '/fixture/harness' }] } };
  assert.match(sectionRows(snapshot,0)[0]!.detail, /Host name: This host\nRelay URL: wss:\/\/fixture.invalid\nState: stopped/);
  assert.deepEqual(sectionRows(snapshot,1).map(row => row.label), ['Registered agents', '  Register agent', 'Other agents', 'Management', '  Refresh agents', '  Inspect operations', '  Check operation results', '  Sign out', '  Publish profile or instructions']);
  assert.equal(sectionRows(snapshot,2)[0]!.id, 'refresh-harnesses');
  assert.equal(sectionRows(snapshot,3)[0]!.id,'add-provider');
  assert.ok(!JSON.stringify(sectionRows(snapshot,3)).includes('secret-reference'));
});

 test('Agents are separated by registered custody, retaining directory order within each group', () => {
  const agent = (id: string) => ({ id, label: id, detail: id, revision: 0, configurations: [] });
  const snapshot = { owner: 'owner', local: [], agents: [agent('other'), agent('registered')], status: '', settings: { version: 1, revision: 0, providers: [], runtimes: [], agents: [{ publicKey: 'registered', key: { service: 'beehive', role: 'agent', publicKey: 'registered' }, profileState: 'none' }] } } as ManagerSnapshot;
  assert.deepEqual(sectionRows(snapshot, 1).map(row => row.id), ['registered-agents', 'register-agent', 'registered', 'other-agents', 'other', 'management', 'refresh-agents', 'inspect-operations', 'check-results', 'sign-out', 'publish-profile']);
 });

test('signed-out Agents directly offer sign-in and no standing menu survives sign-in', () => {
  const snapshot: ManagerSnapshot = { local: [], agents: [], status: '' };
  assert.deepEqual(sectionRows(snapshot,1).map(row => row.id), ['signin-buzz','signin-saved','signin-import']);
  snapshot.owner = 'owner';
  assert.ok(sectionRows(snapshot,1).every(row => !row.id.startsWith('signin')));
});
