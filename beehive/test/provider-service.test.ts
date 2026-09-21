import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderService, type ProviderDependencies } from '../src/provider-service.ts';
import { addProvider, editProvider, type ProviderCredentials } from '../src/settings-credentials.ts';
import { readSettings } from '../src/settings.ts';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'providers-')), directory = join(home, '.beehive', 'host');
  const keys = new Map<string, string>();
  const backend: ProviderCredentials = { read: ref => keys.get(ref.account) ?? null, create: (ref, secret) => { assert.equal(keys.has(ref.account), false); keys.set(ref.account, secret); } };
  const deps: ProviderDependencies = {
    credential: async (input: any) => {
      if (input.action === 'add-provider') addProvider(directory, input.name, input.secret, backend, input.type, input.endpoint, input.wire);
      else if (input.action === 'edit-provider') editProvider(directory, input.provider, input.revision, input.name, input.endpoint, input.wire, input.secret, backend);
      else if (input.action === 'models') return { models: ['gpt-fixture'] };
      else throw Error('Unexpected credential action');
      return { ok: true };
    },
    native: async () => ({ ok: true, models: ['fixture-model'] }),
    discover: async () => [{ id: 'codex', label: 'Codex', executable: '/fixture/codex-acp', cli: '/fixture/codex', state: 'available', providers: ['openai'], reason: 'Fixture' }],
  };
  const service = new ProviderService(home, {}, deps);
  return { home, directory, keys, backend, deps, service, close() { service.dispose(); rmSync(home, { recursive: true, force: true }); } };
}
test('signed-out add, edit, models and Codex setup retain active credential references and durable data', async () => {
  const f = fixture();
  try {
    f.service.secret('append', 'first-private-key');
    assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /first-private-key/);
    assert.equal(await f.service.request({ action: 'save', revision: 0, values: { type: 'openai', name: 'Fixture' } }), true);
    let settings = readSettings(f.directory), provider = settings.providers[0]!;
    const oldKey = provider.key;
    assert.equal(await f.service.request({ action: 'models', provider: provider.id, revision: settings.revision }), true);
    assert.deepEqual(f.service.snapshot().models, ['gpt-fixture']);
    assert.equal(f.service.snapshot().resultTarget, provider.id);
    assert.equal(await f.service.request({ action: 'setup', provider: provider.id, revision: settings.revision, values: { harness: 'codex', model: 'gpt-fixture' } }), true);
    settings = readSettings(f.directory);
    f.service.secret('append', 'second-private-key');
    assert.equal(await f.service.request({ action: 'save', provider: provider.id, revision: settings.revision, values: { name: 'Renamed' } }), true);
    settings = readSettings(f.directory); provider = settings.providers[0]!;
    assert.equal(provider.name, 'Renamed'); assert.notDeepEqual(provider.key, oldKey);
    assert.equal(f.keys.get(oldKey.account), 'first-private-key', 'active launch reference remains valid');
    assert.equal(f.keys.get(provider.key.account), 'second-private-key');
    assert.equal(settings.runtimes.length, 1);
    assert.doesNotMatch(readFileSync(join(f.directory, 'settings.json'), 'utf8'), /private-key/);
    assert.equal(f.service.snapshot().secretLength, 0);
    const reopened = new ProviderService(f.home, {}, f.deps);
    assert.equal(reopened.snapshot().rows[0]?.name, 'Renamed'); reopened.dispose();
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
test('Databricks environment adds origin without credentials; missing environment blocks network', async () => {
  const f = fixture(); let calls = 0;
  f.deps.native = async () => { calls++; return { ok: true }; };
  const service = new ProviderService(f.home, { DATABRICKS_HOST: 'https://fixture.cloud.databricks.com' }, f.deps);
  try {
    assert.equal(await service.request({ action: 'reload' }), true);
    assert.equal(calls, 0); assert.equal(f.keys.size, 0);
    const row = service.snapshot().rows[0]!;
    assert.equal(await service.request({ action: 'login', provider: row.id }), true);
    assert.equal(calls, 1);
    const without = new ProviderService(f.home, {}, f.deps);
    assert.equal(without.snapshot().rows[0]?.state, 'ENV MISSING');
    assert.equal(await without.request({ action: 'models', provider: row.id }), false);
    assert.equal(calls, 1); without.dispose();
  } finally { service.dispose(); f.close(); }
});
test('cancel fences late model result and duplicate operation; secrets clear', async () => {
  const f = fixture();
  try {
    addProvider(f.directory, 'Fixture', 'secret', f.backend, 'openai', 'https://api.openai.com/v1');
    await f.service.request({ action: 'reload' });
    let finish!: (value: any) => void;
    f.deps.credential = () => new Promise(resolve => finish = resolve);
    const id = f.service.snapshot().rows[0]!.id;
    const pending = f.service.request({ action: 'models', provider: id });
    assert.equal(await f.service.request({ action: 'models', provider: id }), false);
    f.service.cancel(); finish({ models: ['late'] });
    assert.equal(await pending, false); assert.deepEqual(f.service.snapshot().models, []);
    assert.match(f.service.snapshot().message, /may already be saved/);
    assert.equal(f.service.snapshot().resultTarget, id);
  } finally { f.close(); }
});
