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
  const snapshot: ProviderSnapshot = { revision: 1, rows: [{ id: 'p', name: 'Fixture', type: 'openai', endpoint: 'https://api.openai.com/v1', state: 'SAVED', detail: 'Access untested' }], phase: 'idle', message: 'Select a provider.', secretLength: 0 };
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
    assert.doesNotMatch(ui.captureCharFrame(), /Add provider/);
    ui.mockInput.pressTab(); await ui.renderOnce();
    assert.equal(shell.state.focus, 'detail');
    assert.match(ui.captureCharFrame(), /Refresh models/);
    ui.mockInput.pressArrow('down'); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.deepEqual(f.requests.at(-1), { action: 'models', provider: 'p', revision: 1 });
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

test('minimum-size results and recovery text remain reachable; only the model count is shown', async () => {
  const ui = await createTestRenderer({ width: 60, height: 20, exitOnCtrlC: false }), f = fixture();
  const shell = new OpenTuiShell(ui.renderer, f.inventory, undefined, f.client);
  try {
    for (let i = 0; i < 3; i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter(); ui.mockInput.pressTab();
    f.snapshot.resultTarget = 'p'; f.snapshot.phase = 'error'; f.snapshot.message = 'Denied. Check provider access. Reload before retrying.'; f.emit();
    await ui.renderOnce(); assert.match(ui.captureCharFrame(), /Denied/); assert.match(ui.captureCharFrame(), /retrying/);
    ui.mockInput.pressKey('\x1b[6~'); await ui.renderOnce(); assert.match(ui.captureCharFrame(), /State/);
    f.snapshot.phase = 'idle'; f.snapshot.message = 'Models loaded.'; f.snapshot.rows[0]!.state = 'Connected'; f.snapshot.rows[0]!.modelCount = 2; f.emit();
    await ui.renderOnce(); assert.match(ui.captureCharFrame(), /Models loaded/);
    for (let i = 0; i < 12; i++) ui.mockInput.pressKey('\x1b[6~');
    await ui.renderOnce(); assert.match(ui.captureCharFrame(), /Connected · 2 models/); assert.doesNotMatch(ui.captureCharFrame(), /gpt-visible|MODELS/);
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
    assert.match(frame, /NOT SET/); assert.doesNotMatch(frame, /ENV MISSING/);
    ui.mockInput.pressTab(); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.match(ui.captureCharFrame(), /API key/); assert.doesNotMatch(ui.captureCharFrame(), /Type  ←/);
  } finally { shell.close(); }
});

for (const [width, height] of [[120, 40], [60, 20]]) for (const saved of [false, true]) test(`Databricks workspace is editable with saved/default/empty precedence at ${width}x${height}, saved=${saved}`, async () => {
  const ui = await createTestRenderer({ width, height, exitOnCtrlC: false }), f = fixture();
  f.snapshot.rows = saved ? [{ id: 'dbr', name: 'Databricks', type: 'databricks_v2', endpoint: 'https://saved.example', state: 'Not checked', detail: 'Saved' }] : [];
  f.snapshot.databricksHost = saved ? 'https://environment.example' : undefined;
  const shell = new OpenTuiShell(ui.renderer, f.inventory, undefined, f.client);
  try {
    for (let i = 0; i < 3; i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter();
    for (let i = 0; i < 4; i++) ui.mockInput.pressArrow('down');
    ui.mockInput.pressTab(); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.match(ui.captureCharFrame(), /Workspace \(DATABRICKS_HOST\)/);
    assert.doesNotMatch(ui.captureCharFrame(), /REQUIRED|← →|environment.example/);
    if (saved) assert.match(ui.captureCharFrame(), /https:\/\/saved.example/);
    ui.mockInput.pressTab(); ui.mockInput.pressKey('\x15'); ui.mockInput.typeText('https://edited.example');
    await ui.renderOnce(); assert.match(ui.captureCharFrame(), /https:\/\/edited.example/);
    ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.equal(f.requests.at(-1)?.action, 'save');
    assert.equal(f.requests.at(-1)?.values?.endpoint, 'https://edited.example');
    if (!saved) {
      f.snapshot.databricksHost = 'https://environment.example'; f.emit();
      ui.mockInput.pressEnter(); await ui.renderOnce();
      assert.match(ui.captureCharFrame(), /https:\/\/environment.example/);
    }
  } finally { shell.close(); }
});

for (const [width, height] of [[120, 40], [60, 20]]) test(`dialog visual hierarchy and pointer focus at ${width}x${height}`, async () => {
  const ui = await createTestRenderer({ width, height, exitOnCtrlC: false });
  const dialog = new ProviderDialog(ui.renderer, 'ADD PROVIDER', [{ label: 'Name', value: 'OpenAI' }, { label: 'API key', secret: true }], () => {});
  const rgb = (color: { buffer: Uint16Array }) => Array.from(color.buffer).slice(0, 3).join(',');
  const spans = () => ui.captureSpans().lines.flatMap(line => line.spans);
  const check = (text: string, color: string) => {
    const span = spans().find(span => span.text.includes(text));
    assert.ok(span, text); assert.equal(rgb(span.fg), color); assert.equal(rgb(span.bg), '13,16,14');
  };
  const key = (name: string) => dialog.key({ name, sequence: '', ctrl: false, meta: false, shift: false });
  try {
    await ui.renderOnce();
    check('Name', '125,134,124'); check('OpenAI', '220,225,216'); check('[', '255,211,78'); check('Enter API key', '125,134,124');
    key('tab'); await ui.renderOnce(); check('Enter API key', '125,134,124');
    const keyboard = ui.captureCharFrame();
    key('up'); await ui.renderOnce();
    const lines = ui.captureCharFrame().split('\n'), y = lines.findIndex(line => line.includes('Enter API key'));
    await ui.mockMouse.click(lines[y]!.indexOf('Enter API key'), y); await ui.renderOnce();
    assert.equal(ui.captureCharFrame(), keyboard);
    dialog.updateSecretLength(4); await ui.renderOnce(); check('••••', '220,225,216');
    key('tab'); await ui.renderOnce(); check('Save', '220,225,216'); check('Tab next', '125,134,124');
    for (const span of spans()) assert.notEqual(rgb(span.bg), '220,225,216');
  } finally { dialog.cancel(); ui.renderer.destroy(); }
});

for (const [width, height] of [[120, 40], [60, 20]]) test(`choice arrows and notice actions have separate boundaries at ${width}x${height}`, async () => {
  const ui = await createTestRenderer({ width, height, exitOnCtrlC: false });
  let dialog = new ProviderDialog(ui.renderer, 'ADD PROVIDER', [{ label: 'Type', value: 'openai', choices: ['openai', 'anthropic'] }], () => {}, 'Continue');
  try {
    await ui.renderOnce();
    const lines = ui.captureCharFrame().split('\n');
    assert.doesNotMatch(lines.find(line => line.includes('Type'))!, /←|→/);
    assert.match(lines.find(line => line.includes('openai'))!, /\[ openai +← → \]/);
    assert.match(lines.find(line => line.includes('Continue'))!, /\[ Continue +\]/);
    dialog.cancel();
    dialog = new ProviderDialog(ui.renderer, 'NOTICE', [], () => {}, 'Close', 'Nothing changed.');
    await ui.renderOnce();
    assert.match(ui.captureCharFrame(), /\[ Close +\]/);
    const help = ui.captureSpans().lines.flatMap(line => line.spans).find(span => span.text.includes('Enter or Esc close'))!;
    assert.deepEqual(Array.from(help.fg.buffer).slice(0, 3), [125, 134, 124]);
    assert.deepEqual(Array.from(help.bg.buffer).slice(0, 3), [13, 16, 14]);
  } finally { dialog.cancel(); ui.renderer.destroy(); }
});

for (const [width, height] of [[120, 40], [60, 20]]) test(`all provider actions stay above output with matching pointer focus at ${width}x${height}`, async () => {
  const ui = await createTestRenderer({ width, height, exitOnCtrlC: false }), f = fixture();
  f.snapshot.rows[0] = { id: 'p', name: 'Workspace', type: 'databricks_v2', endpoint: 'https://fixture.cloud.databricks.com', state: 'SAVED', detail: 'Sign in explicitly, then test.' };
  f.snapshot.databricksHost = f.snapshot.rows[0]!.endpoint;
  const shell = new OpenTuiShell(ui.renderer, f.inventory, undefined, f.client);
  try {
    for (let i = 0; i < 3; i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter();
    for (let i = 0; i < 4; i++) ui.mockInput.pressArrow('down');
    await ui.renderOnce();
    const lines = () => ui.captureCharFrame().split('\n');
    const actionRow = (name: string) => lines().findIndex(line => line.includes(name));
    const names = ['Edit configuration', 'Refresh models', 'Sign in to Databricks'];
    const heading = actionRow('AVAILABLE ACTIONS');
    assert.ok(heading < height / 2);
    for (const [i, name] of names.entries()) assert.equal(actionRow(name), heading + i + 1);
    const spans = () => ui.captureSpans().lines.flatMap(line => line.spans);
    const rgb = (value: { buffer: Uint16Array }) => Array.from(value.buffer).slice(0, 3).join(',');
    assert.equal(rgb(spans().find(span => span.text.includes('AVAILABLE ACTIONS'))!.fg), '255,211,78');
    ui.mockInput.pressTab(); ui.mockInput.pressArrow('down'); await ui.renderOnce();
    const focused = spans().find(span => span.text.includes('› Refresh models'))!;
    assert.equal(rgb(focused.fg), '255,211,78'); assert.equal(rgb(focused.bg), '13,16,14');
    const keyboard = ui.captureCharFrame();
    ui.mockInput.pressTab(); await ui.renderOnce();
    const y = actionRow('Refresh models'), x = lines()[y]!.indexOf('Refresh models');
    await ui.mockMouse.click(x, y); await ui.renderOnce();
    assert.equal(ui.captureCharFrame(), keyboard);
    assert.equal(f.requests.at(-1)?.action, 'models');
    f.snapshot.resultTarget = 'p'; f.snapshot.phase = 'error'; f.snapshot.message = 'Denied. Check access. Reload before retrying.'; f.emit();
    await ui.renderOnce(); assert.match(ui.captureCharFrame(), /FAILED: Denied/);
    assert.ok(actionRow('FAILED') > actionRow('Sign in to Databricks'));
    assert.doesNotMatch(ui.captureCharFrame(), /Set up Codex|Set up Pi|Test provider|Load models/);
    let recoveryVisible = false;
    for (let i = 0; i < 10; i++) {
      recoveryVisible ||= /retrying/.test(ui.captureCharFrame());
      for (const [index, name] of names.entries()) assert.equal(actionRow(name), heading + index + 1);
      ui.mockInput.pressKey('\x1b[6~'); await ui.renderOnce();
    }
    assert.ok(recoveryVisible);
  } finally { shell.close(); }
});

for (const [width, height] of [[120, 40], [60, 20]]) test(`provider inventory has no global Add command and retains saved accounts at ${width}x${height}`, async () => {
  const ui = await createTestRenderer({ width, height, exitOnCtrlC: false }), f = fixture();
  f.snapshot.rows.push({ ...f.snapshot.rows[0]!, id: 'second', name: 'Second' });
  const before = structuredClone(f.snapshot);
  const shell = new OpenTuiShell(ui.renderer, f.inventory, undefined, f.client);
  try {
    for (let i = 0; i < 3; i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.doesNotMatch(ui.captureCharFrame(), /Add provider/);
    assert.match(ui.captureCharFrame(), /Fixture/);
    assert.match(ui.captureCharFrame(), /Second/);
    ui.mockInput.pressArrow('down'); ui.mockInput.pressTab(); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.match(ui.captureCharFrame(), /EDIT PROVIDER/);
    assert.match(ui.captureCharFrame(), /Second/);
    ui.mockInput.pressEscape(); await new Promise(resolve => setTimeout(resolve, 50)); await ui.renderOnce();
    assert.doesNotMatch(ui.captureCharFrame(), /EDIT PROVIDER/);
    ui.mockInput.pressTab();
    for (let i = 0; i < 5; i++) ui.mockInput.pressArrow('down');
    ui.mockInput.pressTab(); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.deepEqual(f.requests.at(-1), { action: 'reload' });
    assert.doesNotMatch(ui.captureCharFrame(), /Add provider|ADD PROVIDER/);
    const lines = ui.captureCharFrame().split('\n');
    const y = lines.findIndex(line => line.includes('› Reload providers'));
    assert.ok(y >= 0, ui.captureCharFrame());
    const count = f.requests.length;
    await ui.mockMouse.click(lines[y]!.indexOf('Reload providers'), y); await ui.renderOnce();
    assert.equal(f.requests.length, count + 1);
    assert.deepEqual(f.requests.at(-1), { action: 'reload' });
    assert.deepEqual(f.snapshot, before);
  } finally { shell.close(); }
});
