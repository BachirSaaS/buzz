import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { OpenTuiShell } from '../src/opentui-shell.ts';
import { HarnessInventoryController } from '../src/harness-inventory.ts';
import type { ProviderClient, ProviderRequest, ProviderSnapshot } from '../src/provider-protocol.ts';
import { ProviderDialog } from '../src/provider-dialog.ts';

function fixture() {
  const requests: ProviderRequest[] = [];
  const secrets: string[] = [];
  const snapshot: ProviderSnapshot = { revision: 1, rows: [{ id: 'p', name: 'Fixture', type: 'openai', endpoint: 'https://api.openai.com/v1', state: 'SAVED', detail: 'Access untested' }], phase: 'idle', message: 'Select a provider.', secretLength: 0, models: [] };
  const listeners = new Set<(s: ProviderSnapshot) => void>();
  const client: ProviderClient = {
    snapshot: () => structuredClone(snapshot),
    subscribe(fn) { listeners.add(fn); fn(structuredClone(snapshot)); return () => { listeners.delete(fn); }; },
    async request(request) { requests.push(request); return true; },
    secret(action, value) { if (value) secrets.push(value); snapshot.secretLength = action === 'clear' ? 0 : action === 'backspace' ? Math.max(0, snapshot.secretLength - 1) : snapshot.secretLength + (value?.length ?? 0); for (const fn of listeners) fn(structuredClone(snapshot)); },
    cancel() {}, dispose() {},
  };
  const inventory = new HarnessInventoryController({ read: () => ({ version: 1, revision: 0, agents: [], providers: [], runtimes: [] }), save: candidate => candidate }, async () => []);
  return { client, inventory, requests, secrets, snapshot, emit() { for (const fn of listeners) fn(structuredClone(snapshot)); } };
}
for (const [width, height] of [[120, 40], [60, 20]]) test(`Providers signed-out keyboard actions and modal at ${width}x${height}`, async () => {
  const ui = await createTestRenderer({ width, height, exitOnCtrlC: false }), f = fixture();
  const shell = new OpenTuiShell(ui.renderer, f.inventory, undefined, f.client);
  try {
    for (let i = 0; i < 3; i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.match(ui.captureCharFrame(), /Add provider/);
    ui.mockInput.pressTab(); await ui.renderOnce();
    assert.equal(shell.state.focus, 'detail');
    assert.match(ui.captureCharFrame(), /Test provider/);
    ui.mockInput.pressArrow('down'); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.deepEqual(f.requests.at(-1), { action: 'test', provider: 'p', revision: 1 });
    ui.mockInput.pressArrow('up'); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.match(ui.captureCharFrame(), /EDIT PROVIDER/);
    ui.mockInput.pressTab(); await ui.renderOnce();
    ui.mockInput.typeText('never-render-this-key'); await ui.renderOnce();
    assert.doesNotMatch(ui.captureCharFrame(), /never-render-this-key/);
    assert.ok(f.secrets.length > 0);
    ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await ui.renderOnce();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.requests.at(-1)?.action, 'save');
    assert.doesNotMatch(JSON.stringify(f.requests), /never-render-this-key/);
  } finally { shell.close(); }
});
test('form input preserves q as text and cancellation clears secret without save', async () => {
  const ui = await createTestRenderer({ width: 60, height: 20, exitOnCtrlC: false });
  const calls: string[] = [];
  const dialog = new ProviderDialog(ui.renderer, 'ADD PROVIDER', [{ label: 'Name', value: '' }, { label: 'API key', secret: true }], action => calls.push(action));
  try {
    dialog.key({ name: 'q', sequence: 'q', ctrl: false, shift: false, meta: false });
    assert.equal(dialog.fields[0]?.value, 'q');
    dialog.cancel(); assert.equal(await dialog.done, undefined); assert.deepEqual(calls, ['clear']);
  } finally { ui.renderer.destroy(); }
});

test('minimum-size results, recovery text and models remain reachable through real page keys', async () => {
  const ui = await createTestRenderer({ width: 60, height: 20, exitOnCtrlC: false }), f = fixture();
  const shell = new OpenTuiShell(ui.renderer, f.inventory, undefined, f.client);
  try {
    for (let i = 0; i < 3; i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter(); ui.mockInput.pressTab();
    f.snapshot.resultTarget = 'p'; f.snapshot.phase = 'error'; f.snapshot.message = 'Denied. Check provider access. Reload before retrying.'; f.emit();
    await ui.renderOnce(); assert.match(ui.captureCharFrame(), /Denied/); assert.match(ui.captureCharFrame(), /retrying/);
    ui.mockInput.pressKey('\x1b[6~'); await ui.renderOnce(); assert.match(ui.captureCharFrame(), /State/);
    f.snapshot.phase = 'idle'; f.snapshot.message = 'Models loaded.'; f.snapshot.modelProvider = 'p'; f.snapshot.models = ['gpt-visible']; f.emit();
    await ui.renderOnce(); assert.match(ui.captureCharFrame(), /Models loaded/);
    for (let i = 0; i < 12; i++) ui.mockInput.pressKey('\x1b[6~');
    await ui.renderOnce(); assert.match(ui.captureCharFrame(), /gpt-visible/);
    f.snapshot.message = 'Stopped waiting. Changes may already be saved. Reload before retrying.'; f.emit();
    await ui.renderOnce(); assert.match(ui.captureCharFrame(), /Stopped waiting/);
  } finally { shell.close(); }
});

test('success and failure reports belong only to their selected provider', async () => {
  const ui = await createTestRenderer({ width: 60, height: 20, exitOnCtrlC: false }), f = fixture();
  f.snapshot.rows.push({ id: 'other', name: 'Other account', type: 'anthropic', endpoint: 'https://api.anthropic.com', state: 'SAVED', detail: 'Untested' });
  f.snapshot.resultTarget = 'p'; f.snapshot.message = 'OpenAI result only';
  const shell = new OpenTuiShell(ui.renderer, f.inventory, undefined, f.client);
  try {
    for (let i = 0; i < 3; i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter(); ui.mockInput.pressArrow('down'); await ui.renderOnce();
    assert.doesNotMatch(ui.captureCharFrame(), /OpenAI result only/);
    ui.mockInput.pressArrow('up'); await ui.renderOnce(); assert.match(ui.captureCharFrame(), /OpenAI result only/);
    f.snapshot.phase = 'error'; f.snapshot.message = 'OpenAI denied only'; f.emit();
    ui.mockInput.pressArrow('down'); await ui.renderOnce(); assert.doesNotMatch(ui.captureCharFrame(), /OpenAI denied only|FAILED/);
    ui.mockInput.pressArrow('up'); await ui.renderOnce(); assert.match(ui.captureCharFrame(), /OpenAI denied only/);
  } finally { shell.close(); }
});

for (const [width, height] of [[120, 40], [60, 20]]) test(`fresh Providers always exposes supported types and states at ${width}x${height}`, async () => {
  const ui = await createTestRenderer({ width, height, exitOnCtrlC: false }), f = fixture();
  f.snapshot.rows = [];
  const shell = new OpenTuiShell(ui.renderer, f.inventory, undefined, f.client);
  try {
    for (let i = 0; i < 3; i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter(); await ui.renderOnce();
    const frame = ui.captureCharFrame();
    assert.match(frame, /MODEL ACCOUNTS/); assert.match(frame, /OpenAI/); assert.match(frame, /Anthropic/); assert.match(frame, /OpenRouter/);
    assert.match(frame, /NOT SET/); assert.match(frame, /ENV MISSING/);
    ui.mockInput.pressTab(); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.match(ui.captureCharFrame(), /API key/); assert.doesNotMatch(ui.captureCharFrame(), /Type  ←/);
  } finally { shell.close(); }
});
