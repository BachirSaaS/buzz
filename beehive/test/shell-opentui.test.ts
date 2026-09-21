import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { OpenTuiShell, footerGuides, helpDialogGeometry, palette } from '../src/opentui-shell.ts';
import { HarnessInventoryController } from '../src/harness-inventory.ts';
import type { Settings } from '../src/settings.ts';

const inventoryWith = (harnesses: NonNullable<Settings['harnesses']>, discover: (signal: AbortSignal) => Promise<NonNullable<Settings['harnesses']>> = async () => []) => {
  let settings: Settings = { version: 1, revision: 0, agents: [], providers: [], runtimes: [], harnesses };
  return new HarnessInventoryController({ read: () => structuredClone(settings), save: (candidate, expected) => settings = { ...structuredClone(candidate), revision: expected + 1 } }, discover);
};
const inventory = () => inventoryWith([{ id: 'fixture', label: 'Fixture Harness', state: 'available', providers: [], reason: 'Synthetic test executable detected', executable: '/fixture/bin/harness' }]);
const text = (frame: string) => frame.endsWith('\n') ? frame.slice(0, -1).split('\n') : frame.split('\n');
const waitForEscape = () => new Promise(resolve => setTimeout(resolve, 50));
const cell = (ui: Awaited<ReturnType<typeof createTestRenderer>>, x: number, y: number) => {
  let offset = 0;
  for (const span of ui.captureSpans().lines[y]!.spans) {
    if (x < offset + span.width) return span;
    offset += span.width;
  }
  throw Error(`missing cell ${x},${y}`);
};
const rgb = (value: any) => [value.buffer['0'], value.buffer['1'], value.buffer['2']].join(',');

test('memory renderer draws the exact wide empty shell and focus perimeter', async () => {
  const ui = await createTestRenderer({ width: 120, height: 40, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer, inventory());
  try {
    await ui.renderOnce(); let frame = ui.captureCharFrame();
    assert.ok(frame.includes('⬢ BEEHIVE')); assert.ok(frame.includes('HOST AGENTS HARNESSES PROVIDERS')); assert.ok(frame.includes('SIGNED OUT'));
    assert.ok(frame.includes(footerGuides.wide)); assert.doesNotMatch(frame, /loading|sample|placeholder|sign in to/i);
    assert.equal(text(frame).length, 40);
    // Host is protected and therefore owns one literally empty full-width body.
    assert.equal(text(frame).slice(3, 38).join('').replace(/[│─┌┐└┘ ]/g, ''), '');
    ui.mockInput.pressArrow('right'); await ui.renderOnce();
    assert.equal(shell.state.headerIndex, 1); assert.equal(shell.state.activeSection, 0);
    ui.mockInput.pressArrow('right'); ui.mockInput.pressEnter(); await ui.renderOnce(); frame = ui.captureCharFrame();
    assert.equal(shell.state.activeSection, 2); assert.equal(shell.state.focus, 'list'); assert.ok(frame.includes('│'));
    assert.ok(frame.includes('Fixture Harness · Available'));
    assert.ok(frame.includes('State: available'));
    const spans = JSON.stringify(ui.captureSpans());
    assert.ok(spans.includes('"0":255,"1":211,"2":78'), `focus color missing from ${spans.slice(0, 300)}`);
  } finally { shell.close(); }
});

test('memory renderer owns split geometry, flat hierarchy, and focus inset without width shifts', async () => {
  const ui = await createTestRenderer({ width: 120, height: 40, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer, inventory());
  try {
    ui.mockInput.pressArrow('right'); ui.mockInput.pressArrow('right'); ui.mockInput.pressEnter(); await ui.renderOnce();
    let frame = text(ui.captureCharFrame());
    // 35 list cells, exactly one neutral divider, then 84 detail cells (35 + 1 + 84 = 120).
    assert.equal(frame[3]!.length, 120); assert.equal(frame[3]![35], '│');
    assert.equal(frame[3]!.slice(0, 35).length, 35); assert.equal(frame[3]!.slice(36).length, 84);
    assert.doesNotMatch(frame[3]!, /┐┌/); assert.equal(rgb(cell(ui, 35, 4).fg), '74,81,73');
    assert.equal(rgb(cell(ui, 0, 3).fg), '255,211,78'); // focused list's inset perimeter
    ui.mockInput.pressArrow('right'); await ui.renderOnce(); frame = text(ui.captureCharFrame());
    assert.equal(shell.state.focus, 'detail'); assert.equal(shell.state.activeSection, 2, 'pane movement never activates another destination');
    assert.equal(frame[3]![35], '│'); assert.equal(frame[3]!.slice(36).length, 84);
    assert.equal(rgb(cell(ui, 36, 3).fg), '255,211,78'); // right moves the perimeter to Details
    ui.mockInput.pressArrow('left'); await ui.renderOnce();
    assert.equal(shell.state.focus, 'list'); assert.equal(rgb(cell(ui, 0, 3).fg), '255,211,78');
    ui.mockInput.pressTab(); await ui.renderOnce(); frame = text(ui.captureCharFrame());
    assert.equal(shell.state.focus, 'header', 'Tab skips informational Details that have no action');
    ui.mockInput.pressEscape(); await waitForEscape(); await ui.renderOnce(); frame = text(ui.captureCharFrame());
    assert.equal(frame[3]![35], '│'); assert.doesNotMatch(frame.slice(3, 38).join('\n'), /[┌┐└┘]/); // unfocused panes remain flat
  } finally { shell.close(); }
});

test('memory renderer keeps keyboard, pointer, resize, and Help return focus visible', async () => {
  const ui = await createTestRenderer({ width: 120, height: 40, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer, inventory());
  try {
    ui.mockInput.pressArrow('right'); ui.mockInput.pressArrow('right'); ui.mockInput.pressEnter(); await ui.renderOnce();
    await ui.mockMouse.click(60, 10); await ui.renderOnce();
    assert.equal(shell.state.focus, 'detail', 'pointer focuses the visible Details pane');
    ui.resize(50, 20); await ui.renderOnce();
    assert.deepEqual({ focus: shell.state.focus, pane: shell.state.narrowPane }, { focus: 'detail', pane: 'detail' });
    ui.mockInput.pressKey('?'); await ui.renderOnce(); ui.mockInput.pressEscape(); await waitForEscape(); await ui.renderOnce();
    assert.deepEqual({ focus: shell.state.focus, pane: shell.state.narrowPane, help: shell.state.helpOpen }, { focus: 'detail', pane: 'detail', help: false });
    ui.mockInput.pressArrow('left'); await ui.renderOnce();
    assert.deepEqual({ focus: shell.state.focus, pane: shell.state.narrowPane }, { focus: 'list', pane: 'list' });
    await ui.mockMouse.click(10, 10); await ui.renderOnce();
    assert.equal(shell.state.focus, 'list', 'pointer returns focus to the visible List pane');
  } finally { shell.close(); }
});

test('memory renderer layers a full scrim and naturally sized help surface with constrained-body geometry', async () => {
  const ui = await createTestRenderer({ width: 120, height: 40, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer, inventory());
  try {
    ui.mockInput.pressKey('?'); await ui.renderOnce();
    const geometry = helpDialogGeometry(120, 40);
    assert.deepEqual(geometry, { width: 62, maxHeight: 36, naturalHeight: 15, height: 15, bodyHeight: 7, bodyWidth: 56, scrollbar: false });
    assert.equal(rgb(cell(ui, 0, 0).bg), '7,9,7'); // scrim covers cells outside the dialog
    assert.equal(rgb(cell(ui, 30, 14).bg), '13,16,14'); // surface is above the scrim
    assert.equal(rgb(cell(ui, 29, 13).fg), '156,164,155'); // centered dialog boundary
    // A longer body is constrained to H - 4 while title/actions retain their fixed rows.
    const overflowing = Array.from({ length: 12 }, (_, row) => `overflow row ${row}`).join('\n');
    assert.deepEqual(helpDialogGeometry(50, 20, overflowing), { width: 46, maxHeight: 16, naturalHeight: 20, height: 16, bodyHeight: 8, bodyWidth: 39, scrollbar: true });
    assert.equal(helpDialogGeometry(50, 20).height, 15); // short help stays natural, below its max of 16
  } finally { shell.close(); }
});

test('memory renderer reserves the overflow scrollbar cell outside help text and chrome', async () => {
  const content = Array.from({ length: 12 }, (_, row) => `overflow row ${row} ends here`).join('\n');
  const ui = await createTestRenderer({ width: 50, height: 20, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer, inventory(), content);
  try {
    ui.mockInput.pressKey('?'); await ui.renderOnce();
    const frame = text(ui.captureCharFrame());
    // The 46-cell dialog begins at x=2. Its 40-cell inner body has 39 text
    // cells (x=5..43) and an independently reserved scrollbar at x=44.
    assert.equal(frame[6]!.slice(5, 44), 'overflow row 0 ends here'.padEnd(39));
    assert.match(frame[6]![44]!, /[█▀]/, `missing reserved scrollbar: ${frame[6]}`);
    assert.equal(frame[5]![44], '─'); // title divider owns its complete final cell
    assert.equal(frame[14]![44], '─'); // action divider is outside the scrollbar viewport
    assert.equal(frame[6]![47], '│'); // dialog border remains untouched
    ui.mockInput.pressArrow('down'); await ui.renderOnce();
    assert.match(text(ui.captureCharFrame())[6]!, /overflow row [1-9]/, 'the constrained body remains scrollable');
  } finally { shell.close(); }
});

test('memory renderer binds refresh to its command row and applies real async results coherently', async () => {
  let complete!: (rows: NonNullable<Settings['harnesses']>) => void;
  const discovered = new Promise<NonNullable<Settings['harnesses']>>(resolve => { complete = resolve; });
  const ui = await createTestRenderer({ width: 120, height: 40, exitOnCtrlC: false });
  const controller = inventoryWith([], () => discovered);
  const shell = new OpenTuiShell(ui.renderer, controller);
  try {
    ui.mockInput.pressArrow('right'); ui.mockInput.pressArrow('right'); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.ok(ui.captureCharFrame().includes('Saved local harness inventory'));
    ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.equal(shell.state.focus, 'detail', 'the command row opens its owned Details action without executing');
    assert.ok(ui.captureCharFrame().includes('Refresh harnesses'));
    ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.ok(ui.captureCharFrame().includes('Refreshing local harness inventory'));
    complete([{ id: 'codex', label: 'Codex', state: 'incompatible', providers: [], reason: 'Codex ACP 1.10.0 or newer required; version unknown/outdated' }]);
    await new Promise(resolve => setTimeout(resolve, 0)); await ui.renderOnce();
    const frame = ui.captureCharFrame();
    assert.ok(frame.includes('Codex · Incompatible')); assert.ok(frame.includes('Refresh harnesses'));
    assert.equal(shell.state.harnessSelection, 'command:refresh', 'surviving command identity and its completed operation Details remain selected');
  } finally { shell.close(); }
});

test('renderer shows refresh failure, permits recovery, and fences completion after leaving Harnesses', async () => {
  let attempts = 0;
  let lateResolve!: (rows: NonNullable<Settings['harnesses']>) => void;
  const late = new Promise<NonNullable<Settings['harnesses']>>(resolve => { lateResolve = resolve; });
  const controller = inventoryWith([], async () => {
    attempts++;
    if (attempts === 1) throw Error('/private/diagnostic');
    if (attempts === 2) return [{ id: 'buzz-agent', label: 'Buzz Agent', state: 'available', providers: ['openai'], reason: 'Detected; provider/model access unverified', executable: '/fixture/buzz-agent' }];
    return late;
  });
  const ui = await createTestRenderer({ width: 120, height: 40, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer, controller);
  try {
    ui.mockInput.pressArrow('right'); ui.mockInput.pressArrow('right'); ui.mockInput.pressEnter(); await ui.renderOnce();
    ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await new Promise(resolve => setTimeout(resolve, 0)); await ui.renderOnce();
    assert.ok(ui.captureCharFrame().includes('Harness refresh failed'));
    assert.doesNotMatch(ui.captureCharFrame(), /private\/diagnostic/);
    ui.mockInput.pressEnter(); await new Promise(resolve => setTimeout(resolve, 0)); await ui.renderOnce();
    assert.ok(ui.captureCharFrame().includes('Buzz Agent · Available'));
    ui.mockInput.pressArrow('down'); ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await ui.renderOnce();
    ui.mockInput.pressArrow('up'); ui.mockInput.pressArrow('up'); ui.mockInput.pressArrow('right'); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.equal(shell.state.activeSection, 3);
    lateResolve([{ id: 'late', label: 'Late', state: 'available', providers: [], reason: 'late', executable: '/fixture/late' }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(controller.snapshot().harnesses.some(row => row.id === 'late'), false);
  } finally { shell.close(); }
});

test('pointer selection does not execute a command and its Details action dispatches once', async () => {
  let attempts = 0;
  const ui = await createTestRenderer({ width: 120, height: 40, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer, inventoryWith([], async () => { attempts++; return []; }));
  try {
    ui.mockInput.pressArrow('right'); ui.mockInput.pressArrow('right'); ui.mockInput.pressEnter(); await ui.renderOnce();
    await ui.mockMouse.click(3, 6); await ui.renderOnce();
    assert.equal(attempts, 0, 'a List click only selects the command row');
    ui.mockInput.pressEnter(); await ui.renderOnce();
    await ui.mockMouse.click(40, 15); await new Promise(resolve => setTimeout(resolve, 0)); await ui.renderOnce();
    assert.equal(attempts, 1, 'mouse bubbling cannot double-dispatch the Details action');
  } finally { shell.close(); }
});

test('virtual list click mapping targets the currently visible row after overflow scroll', async () => {
  const harnesses = Array.from({ length: 20 }, (_, index) => ({ id: `fixture-${index}`, label: `Harness ${index}`, state: 'available' as const, providers: [], reason: 'Synthetic test executable detected', executable: `/fixture/${index}` }));
  const ui = await createTestRenderer({ width: 50, height: 20, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer, inventoryWith(harnesses));
  try {
    ui.mockInput.pressArrow('right'); ui.mockInput.pressArrow('right'); ui.mockInput.pressEnter(); await ui.renderOnce();
    for (let index = 0; index < 14; index++) ui.mockInput.pressArrow('down');
    await ui.renderOnce();
    assert.ok(shell.state.listOffset > 0);
    const expected = shell.state.harnessRows[shell.state.listOffset]!.id;
    await ui.mockMouse.click(3, 6); await ui.renderOnce();
    assert.equal(shell.state.harnessSelection, expected, 'the slot maps through the current virtual offset, never a stale absolute index');
  } finally { shell.close(); }
});

test('memory renderer preserves the 50x20 narrow shell, help, keyboard, and pointer activation', async () => {
  const ui = await createTestRenderer({ width: 50, height: 20, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer, inventory());
  try {
    await ui.renderOnce(); let frame = ui.captureCharFrame();
    assert.equal(text(frame).length, 20); assert.ok(frame.includes(footerGuides.compact)); assert.ok(frame.includes('PROVIDERS'));
    // Click Harnesses in the centered destination strip.
    const navLine = text(frame)[1]!; const x = navLine.indexOf('HARNESSES');
    await ui.mockMouse.click(x, 1); await ui.renderOnce();
    assert.equal(shell.state.activeSection, 2); assert.equal(shell.state.narrowPane, 'list');
    ui.mockInput.pressEnter(); await ui.renderOnce(); assert.equal(shell.state.narrowPane, 'detail');
    ui.mockInput.pressEscape(); await waitForEscape(); await ui.renderOnce(); assert.equal(shell.state.narrowPane, 'list');
    ui.mockInput.pressKey('?'); await ui.renderOnce(); frame = ui.captureCharFrame();
    assert.ok(frame.includes('HELP')); assert.ok(frame.includes('Shift-Tab'));
    // The fitting body is a plain box: every truthful navigation line and its
    // last cell are visible, with neither OpenTUI's scrollbar nor a replacement glyph.
    assert.doesNotMatch(frame, /[█▀�]/);
    for (const line of ['Header: ←→ destination; Enter / ↓ opens', 'List: ↑ header; → / Enter Details', 'Details: ↑ header; ← List', 'Tab / Shift-Tab  visible regions', 'Esc  active header', '? / Enter / Esc  close help', 'q  quit Beehive']) assert.ok(frame.includes(line), `missing complete help line: ${line}`);
    ui.mockInput.pressEscape(); await waitForEscape(); await ui.renderOnce(); assert.ok(!ui.captureCharFrame().includes('Shift-Tab'));
    ui.resize(49, 19); await ui.renderOnce(); assert.ok(ui.captureCharFrame().includes(footerGuides.minimum));
    ui.mockInput.pressKey('q'); await ui.renderOnce(); assert.equal(shell.state.belowMinimum, true);
    ui.mockInput.pressKey('q', { ctrl: true }); await shell.done;
  } finally { shell.close(); }
});
