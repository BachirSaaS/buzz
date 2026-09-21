import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessInventoryController, localHarnessInventory } from '../src/harness-inventory.ts';
import type { DetectedHarness } from '../src/harness-discovery.ts';
import type { Settings } from '../src/settings.ts';

const row = (id: string, state: DetectedHarness['state'] = 'available'): DetectedHarness => ({ id, label: id.toUpperCase(), state, providers: state === 'available' ? ['openai'] : [], reason: state === 'available' ? 'Detected; authorization unverified' : 'Not installed', ...(state === 'available' ? { executable: `/fixture/${id}` } : {}) });
const fixture = (initial: DetectedHarness[] = []) => {
  let settings: Settings = { version: 1, revision: 4, agents: [], providers: [], runtimes: [], harnesses: initial };
  let saves = 0;
  const store = {
    read: () => structuredClone(settings),
    save: (candidate: Settings, expected: number) => { assert.equal(expected, settings.revision); saves++; settings = { ...structuredClone(candidate), revision: expected + 1 }; return structuredClone(settings); },
  };
  return { store, settings: () => settings, saves: () => saves };
};

const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('loads durable local harness facts and saved configuration counts without probing', () => {
  const data = fixture([row('codex'), row('pi', 'not-installed')]);
  const settings = data.settings();
  settings.providers = [{ id: 'provider', name: 'Provider', type: 'openai', endpoint: 'https://api.openai.com/v1', key: { service: 'beehive', account: 'provider' } }];
  settings.runtimes = [{ id: 'runtime', name: 'Saved', harness: 'codex', executable: '/fixture/codex', cli: '/fixture/codex-cli', providerId: 'provider', model: 'model' }];
  let probes = 0;
  const controller = new HarnessInventoryController(data.store, async () => { probes++; return []; });
  assert.equal(probes, 0);
  assert.deepEqual(controller.snapshot().harnesses.map(value => [value.id, value.state]), [['codex', 'available'], ['pi', 'not-installed']]);
  assert.equal(controller.snapshot().savedConfigurations.codex, 1);
  controller.dispose();
});

test('refresh commits one complete inventory and rejects a duplicate in-flight request', async () => {
  const data = fixture([row('old')]);
  const work = deferred<DetectedHarness[]>();
  const controller = new HarnessInventoryController(data.store, () => work.promise);
  const states: string[] = [];
  controller.subscribe(snapshot => states.push(snapshot.phase));
  const first = controller.refresh();
  assert.equal(await controller.refresh(), false);
  assert.equal(controller.snapshot().phase, 'refreshing');
  work.resolve([row('codex'), row('pi', 'not-installed')]);
  assert.equal(await first, true);
  assert.equal(data.saves(), 1);
  assert.deepEqual(data.settings().harnesses?.map(value => value.id), ['codex', 'pi']);
  assert.deepEqual(states, ['idle', 'refreshing', 'idle']);
  controller.dispose();
});

test('refresh failure keeps durable rows and exposes a retryable plain reason', async () => {
  const data = fixture([row('retained')]);
  const controller = new HarnessInventoryController(data.store, async () => { throw Error('/private/path/token=secret'); });
  assert.equal(await controller.refresh(), false);
  assert.equal(data.saves(), 0);
  assert.equal(controller.snapshot().harnesses[0]?.id, 'retained');
  assert.equal(controller.snapshot().phase, 'error');
  assert.doesNotMatch(controller.snapshot().message, /private|token|secret/);
  assert.match(controller.snapshot().message, /try again/i);
  controller.dispose();
});

test('production adapter discovers and durably saves only an explicit isolated HOME/PATH fixture', async () => {
  const home = mkdtempSync(join(tmpdir(), 'beehive-harness-inventory-'));
  try {
    const bin = join(home, 'bin'); mkdirSync(bin);
    const executable = join(bin, 'buzz-agent'); writeFileSync(executable, '#!/bin/sh\necho "buzz-agent 2.3.4"\n'); chmodSync(executable, 0o700);
    const controller = localHarnessInventory({ BEEHIVE_HOME: home, BEEHIVE_HARNESS_PATH: bin, BEEHIVE_HARNESS_ISOLATED: '1', PATH: bin });
    assert.equal(await controller.refresh(), true);
    const buzz = controller.snapshot().harnesses.find(value => value.id === 'buzz-agent');
    assert.deepEqual({ state: buzz?.state, version: buzz?.version, executable: buzz?.executable, providers: buzz?.providers }, { state: 'available', version: '2.3.4', executable: realpathSync(executable), providers: ['openai', 'anthropic', 'openai-compat', 'openrouter', 'databricks_v2'] });
    assert.equal(controller.snapshot().harnesses.find(value => value.id === 'codex')?.state, 'not-installed');
    const persisted = JSON.parse(readFileSync(join(home, '.beehive', 'host', 'settings.json'), 'utf8'));
    assert.equal(persisted.harnesses.find((value: DetectedHarness) => value.id === 'buzz-agent').executable, realpathSync(executable));
    controller.dispose();

    rmSync(executable);
    const relaunched = localHarnessInventory({ BEEHIVE_HOME: home, BEEHIVE_HARNESS_PATH: bin, BEEHIVE_HARNESS_ISOLATED: '1', PATH: '/ordinary/path-must-not-be-used' });
    assert.deepEqual({ state: relaunched.snapshot().harnesses.find(value => value.id === 'buzz-agent')?.state, version: relaunched.snapshot().harnesses.find(value => value.id === 'buzz-agent')?.version }, { state: 'available', version: '2.3.4' }, 'relaunch reads durable inventory without another probe');
    relaunched.dispose();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('discovers Beehive-owned definitions without Desktop and skips malformed entries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beehive-custom-harnesses-'));
  try {
    const command = join(root, 'pic-pi-acp'); writeFileSync(command, '#!/bin/sh\necho custom\n'); chmodSync(command, 0o700);
    const definitions = join(root, '.beehive', 'custom_harnesses'); mkdirSync(definitions, { recursive: true });
    writeFileSync(join(definitions, 'custom.json'), JSON.stringify({ id: 'pic-pi', label: 'Pi custom', command, args: [] }));
    writeFileSync(join(definitions, 'bad.json'), '{');
    // Desktop-only entries must not leak into Beehive, even when installed.
    const desktop = join(root, 'Library/Application Support/xyz.block.buzz.app/custom_harnesses');
    mkdirSync(desktop, { recursive: true });
    writeFileSync(join(desktop, 'desktop.json'), JSON.stringify({ id: 'desktop-only', label: 'Desktop only', command }));
    const { discoverHarnesses } = await import('../src/harness-discovery.ts');
    const rows = await discoverHarnesses(new AbortController().signal, { home: root, path: '', bundled: [], common: [], loginShells: [] });
    assert.equal(rows.some(value => value.id === 'desktop-only'), false);
    assert.equal(rows.some(value => value.id === 'buzz-agent'), true, 'built-in catalog requires no Desktop');
    assert.deepEqual(rows.filter(value => value.id === 'pic-pi').map(value => ({ label: value.label, state: value.state, executable: value.executable })), [{ label: 'Pi custom', state: 'available', executable: realpathSync(command) }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('isolated production adapter fails closed unless both fixture root and executable path are explicit', () => {
  assert.throws(() => localHarnessInventory({ BEEHIVE_HARNESS_ISOLATED: '1', BEEHIVE_HARNESS_PATH: '/fixture/bin' }), /explicit BEEHIVE_HOME/);
  assert.throws(() => localHarnessInventory({ BEEHIVE_HARNESS_ISOLATED: '1', BEEHIVE_HOME: '/fixture/home' }), /explicit BEEHIVE_HOME/);
});

test('a failed refresh and cancellation preserve the last trustworthy inventory across reconstruction', async () => {
  const data = fixture([row('trusted')]);
  const failed = new HarnessInventoryController(data.store, async () => { throw Error('probe failed'); });
  assert.equal(await failed.refresh(), false);
  failed.dispose();
  const reconstructed = new HarnessInventoryController(data.store, async () => [row('must-not-probe')]);
  assert.equal(reconstructed.snapshot().harnesses[0]?.id, 'trusted');
  const work = deferred<DetectedHarness[]>();
  const refresh = new HarnessInventoryController(data.store, () => work.promise);
  const pending = refresh.refresh(); refresh.cancel(); work.resolve([row('late')]);
  assert.equal(await pending, false);
  assert.equal(new HarnessInventoryController(data.store, async () => []).snapshot().harnesses[0]?.id, 'trusted');
  reconstructed.dispose(); refresh.dispose();
});

test('cancel and disposal fence late discovery before persistence or presentation', async () => {
  for (const mode of ['cancel', 'dispose'] as const) {
    const data = fixture([row('retained')]);
    const work = deferred<DetectedHarness[]>();
    const controller = new HarnessInventoryController(data.store, () => work.promise);
    let notifications = 0;
    controller.subscribe(() => notifications++);
    const refresh = controller.refresh();
    if (mode === 'cancel') controller.cancel(); else controller.dispose();
    const beforeLate = notifications;
    work.resolve([row('late')]);
    assert.equal(await refresh, false);
    assert.equal(data.saves(), 0, `${mode} must fence durable commit`);
    assert.equal(notifications, beforeLate, `${mode} must fence late presentation`);
    assert.equal(data.settings().harnesses?.[0]?.id, 'retained');
    controller.dispose();
  }
});
