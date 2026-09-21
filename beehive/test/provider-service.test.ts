import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderService, type ProviderDependencies } from '../src/provider-service.ts';
import { addProvider, editProvider, type ProviderCredentials } from '../src/settings-credentials.ts';
import { readSettings, replaceProvider } from '../src/settings.ts';
import { rememberEnvironmentDatabricks } from '../src/databricks.ts';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'providers-')), directory = join(home, '.beehive', 'host');
  const keys = new Map<string, string>(), calls: any[] = [];
  const backend: ProviderCredentials = { read: ref => keys.get(ref.account) ?? null, create: (ref, secret) => { assert.equal(keys.has(ref.account), false); keys.set(ref.account, secret); } };
  const deps: ProviderDependencies = {
    credential: async (input: any) => {
      calls.push(input);
      if (input.action === 'add-provider') addProvider(directory, input.name, input.secret, backend, input.type, input.endpoint, input.wire, input.revision);
      else if (input.action === 'edit-provider') editProvider(directory, input.provider, input.revision, input.name, input.endpoint, input.wire, input.secret, backend);
      else if (input.action === 'models') return { models: ['gpt-fixture'] };
      else throw Error('Unexpected credential action');
      return { ok: true };
    },
    native: async input => { calls.push(input); return { ok: true, models: ['fixture-model'] }; },
  };
  const service = new ProviderService(home, {}, deps);
  return { home, directory, keys, backend, deps, service, calls, close() { service.dispose(); rmSync(home, { recursive: true, force: true }); } };
}
test('save/edit automatically check catalogs, retain active credential references, expose count only and survive reopen', async () => {
  const f = fixture();
  try {
    f.service.secret('append', 'first-private-key');
    assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /first-private-key/);
    assert.equal(await f.service.request({ action: 'save', revision: 0, values: { type: 'openai', name: 'Fixture' } }), true);
    let settings = readSettings(f.directory), provider = settings.providers[0]!;
    const oldKey = provider.key;
    assert.deepEqual(f.calls.map(c => c.action), ['add-provider', 'models']);
    assert.equal(f.service.snapshot().rows[0]?.state, 'Connected');
    assert.equal(f.service.snapshot().rows[0]?.modelCount, 1);
    assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /gpt-fixture/);
    assert.equal(f.service.snapshot().resultTarget, provider.id);
    assert.equal(await f.service.request({ action: 'save', provider: provider.id, revision: settings.revision, values: { name: 'Unchanged key' } }), true);
    settings = readSettings(f.directory);
    assert.deepEqual(settings.providers[0]!.key, oldKey);
    assert.equal(f.keys.size, 1, 'unchanged masked field does not rotate credentials');
    assert.equal(f.calls.find(c => c.action === 'edit-provider').secret, '');
    f.service.secret('append', 'cancelled-private-key'); f.service.secret('clear');
    assert.equal(await f.service.request({ action: 'save', provider: provider.id, revision: settings.revision, values: { name: 'After cancel' } }), true);
    settings = readSettings(f.directory);
    assert.deepEqual(settings.providers[0]!.key, oldKey); assert.equal(f.keys.size, 1);
    f.service.secret('append', 'second-private-key');
    assert.equal(await f.service.request({ action: 'save', provider: provider.id, revision: settings.revision, values: { name: 'Renamed' } }), true);
    settings = readSettings(f.directory); provider = settings.providers[0]!;
    assert.equal(provider.name, 'Renamed'); assert.notDeepEqual(provider.key, oldKey);
    assert.equal(f.keys.get(oldKey.account), 'first-private-key', 'active launch reference remains valid');
    assert.equal(f.keys.get(provider.key.account), 'second-private-key');
    assert.equal(settings.runtimes.length, 0);
    assert.doesNotMatch(readFileSync(join(f.directory, 'settings.json'), 'utf8'), /private-key/);
    assert.equal(f.service.snapshot().secretLength, 0);
    const reopened = new ProviderService(f.home, {}, f.deps);
    assert.equal(reopened.snapshot().rows[0]?.name, 'Renamed');
    assert.equal(reopened.snapshot().rows[0]?.state, 'Not checked');
    await reopened.request({ action: 'reload' });
    assert.equal(reopened.snapshot().rows[0]?.state, 'Connected'); reopened.dispose();
    for (const action of ['setup', 'discover', 'test']) assert.equal(await f.service.request({ action } as any), false);
    assert.equal(readSettings(f.directory).runtimes.length, 0);
  } finally { f.close(); }
});
test('stale revision and denied credential read-back leave public provider unchanged', async () => {
  const f = fixture();
  try {
    f.service.secret('append', 'secret');
    assert.equal(await f.service.request({ action: 'save', revision: 9, values: { type: 'openai', name: 'No' } }), false);
    assert.equal(readSettings(f.directory).providers.length, 0);
    assert.throws(() => addProvider(f.directory, 'No', 'secret', { create() {}, read() { return null; } }, 'openai', 'https://api.openai.com/v1'), /verification/);
    assert.equal(readSettings(f.directory).providers.length, 0);
    assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /"secret"/);
  } finally { f.close(); }
});
test('Databricks environment is only a form default; saved workspace and isolated authorization win across reload/restart', async () => {
  const f = fixture();
  const service = new ProviderService(f.home, { DATABRICKS_HOST: 'https://environment.example' }, f.deps);
  try {
    assert.equal(await service.request({ action: 'reload' }), true);
    assert.equal(f.calls.length, 0); assert.equal(service.snapshot().rows.length, 0);
    assert.equal(service.snapshot().databricksHost, 'https://environment.example');
    assert.equal(await service.request({ action: 'save', values: { type: 'databricks_v2', name: 'Chosen', endpoint: 'https://chosen.example/' } }), true);
    let provider = readSettings(f.directory).providers[0]!;
    assert.equal(provider.endpoint, 'https://chosen.example');
    const oldKey = provider.key;
    assert.deepEqual(f.calls.map(c => c.action), ['models']);
    assert.equal(await service.request({ action: 'login', provider: provider.id }), true);
    assert.deepEqual(f.calls.map(c => c.action), ['models', 'login', 'models']);
    f.deps.native = async input => { f.calls.push(input); throw Error('missing new-workspace auth'); };
    assert.equal(await service.request({ action: 'save', provider: provider.id, values: { endpoint: 'https://other.example' } }), false);
    provider = readSettings(f.directory).providers[0]!;
    assert.notDeepEqual(provider.key, oldKey);
    assert.equal(service.snapshot().rows[0]?.state, 'Failed');
    assert.equal(service.snapshot().rows[0]?.modelCount, undefined);
    assert.equal(f.calls.at(-1).host, 'https://other.example');
    assert.deepEqual(f.calls.at(-1).key, provider.key);
    assert.match(service.snapshot().message, /Provider saved/);
    for (const env of [{}, { DATABRICKS_HOST: 'https://different.example' }, { DATABRICKS_HOST: 'invalid' }]) {
      rememberEnvironmentDatabricks(f.directory, env.DATABRICKS_HOST);
      const reopened = new ProviderService(f.home, env, f.deps);
      await reopened.request({ action: 'reload' });
      assert.equal(reopened.snapshot().rows.length, 1);
      assert.equal(reopened.snapshot().rows[0]?.endpoint, 'https://other.example');
      assert.equal(f.calls.at(-1).host, 'https://other.example');
      assert.deepEqual(f.calls.at(-1).key, provider.key);
      reopened.dispose();
    }
    const before = readSettings(f.directory);
    assert.equal(await service.request({ action: 'save', provider: provider.id, values: { endpoint: 'http://bad.example/path' } }), false);
    assert.deepEqual(readSettings(f.directory), before);
    assert.equal(f.calls.filter(c => c.action === 'login').length, 1);
  } finally { service.dispose(); f.close(); }
});
test('reload checks every saved account independently; failure clears count and retry can connect with zero models', async () => {
  const f = fixture();
  try {
    addProvider(f.directory, 'One', 'secret', f.backend, 'openai', 'https://api.openai.com/v1');
    addProvider(f.directory, 'Two', 'secret', f.backend, 'anthropic', 'https://api.anthropic.com');
    await f.service.request({ action: 'reload' });
    const [one, two] = f.service.snapshot().rows;
    assert.equal(one?.modelCount, 1); assert.equal(two?.modelCount, 1);
    f.deps.credential = async (input: any) => { if (input.provider === one!.id) throw Error('private untrusted vendor message'); return { models: [] }; };
    const states: string[] = [];
    f.service.subscribe(s => states.push(s.rows[0]?.state ?? ''));
    assert.equal(await f.service.request({ action: 'reload' }), false);
    assert.ok(states.includes('Checking…'));
    assert.equal(f.service.snapshot().rows[0]?.state, 'Failed');
    assert.equal(f.service.snapshot().rows[0]?.modelCount, undefined);
    assert.match(f.service.snapshot().rows[0]!.detail, /API key.*Refresh models/);
    assert.equal(f.service.snapshot().rows[1]?.state, 'Connected');
    assert.equal(f.service.snapshot().rows[1]?.modelCount, 0);
    assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /private untrusted/);
    f.deps.credential = async () => ({ models: [] });
    assert.equal(await f.service.request({ action: 'models', provider: one!.id }), true);
    assert.equal(f.service.snapshot().rows[0]?.modelCount, 0);
  } finally { f.close(); }
});
test('cancel fences late model result and duplicate operation; refresh after cancel is usable', async () => {
  const f = fixture();
  try {
    addProvider(f.directory, 'Fixture', 'secret', f.backend, 'openai', 'https://api.openai.com/v1');
    await f.service.request({ action: 'reload' });
    let finish!: (value: any) => void;
    f.deps.credential = () => new Promise(resolve => finish = resolve);
    const id = f.service.snapshot().rows[0]!.id;
    const pending = f.service.request({ action: 'models', provider: id });
    assert.equal(f.service.snapshot().rows[0]?.modelCount, undefined);
    assert.equal(await f.service.request({ action: 'models', provider: id }), false);
    f.service.cancel(); finish({ models: ['late'] });
    assert.equal(await pending, false); assert.equal(f.service.snapshot().rows[0]?.state, 'Not checked');
    assert.equal(f.service.snapshot().rows[0]?.modelCount, undefined);
    assert.match(f.service.snapshot().message, /may already be saved/);
    f.deps.credential = async () => ({ models: ['retry'] });
    assert.equal(await f.service.request({ action: 'reload' }), true);
    assert.equal(f.service.snapshot().rows[0]?.state, 'Connected');
  } finally { f.close(); }
});
test('late catalog for an externally changed workspace never marks the new workspace connected', async () => {
  const f = fixture();
  try {
    await f.service.request({ action: 'save', values: { type: 'databricks_v2', endpoint: 'https://first.example' } });
    let finish!: (value: any) => void;
    f.deps.native = () => new Promise(resolve => finish = resolve);
    const before = readSettings(f.directory), provider = before.providers[0]!;
    const pending = f.service.request({ action: 'models', provider: provider.id });
    replaceProvider(f.directory, { ...provider, endpoint: 'https://second.example' }, before.revision);
    finish({ ok: true, models: ['old'] }); await pending;
    assert.equal(f.service.snapshot().rows[0]?.endpoint, 'https://second.example');
    assert.equal(f.service.snapshot().rows[0]?.state, 'Not checked');
    assert.equal(f.service.snapshot().rows[0]?.modelCount, undefined);
  } finally { f.close(); }
});
test('unreadable settings are not repaired or reset', async () => {
  const f = fixture();
  try {
    addProvider(f.directory, 'Fixture', 'secret', f.backend, 'openai', 'https://api.openai.com/v1');
    writeFileSync(join(f.directory, 'settings.json'), '{broken');
    const service = new ProviderService(f.home, {}, f.deps);
    assert.equal(service.snapshot().phase, 'error');
    assert.equal(await service.request({ action: 'reload' }), false);
    assert.equal(readFileSync(join(f.directory, 'settings.json'), 'utf8'), '{broken'); service.dispose();
  } finally { f.close(); }
});
