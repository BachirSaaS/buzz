import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { OpenTuiShell, footerGuides, helpDialogGeometry, palette } from '../src/opentui-shell.ts';

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
  const shell = new OpenTuiShell(ui.renderer);
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
    assert.equal(text(frame).slice(3, 38).join('').replace(/[│─┌┐└┘ ]/g, ''), '');
    const spans = JSON.stringify(ui.captureSpans());
    assert.ok(spans.includes('"0":255,"1":211,"2":78'), `focus color missing from ${spans.slice(0, 300)}`);
  } finally { shell.close(); }
});

test('memory renderer owns split geometry, flat hierarchy, and focus inset without width shifts', async () => {
  const ui = await createTestRenderer({ width: 120, height: 40, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer);
  try {
    ui.mockInput.pressArrow('right'); ui.mockInput.pressArrow('right'); ui.mockInput.pressEnter(); await ui.renderOnce();
    let frame = text(ui.captureCharFrame());
    // 35 list cells, exactly one neutral divider, then 84 detail cells (35 + 1 + 84 = 120).
    assert.equal(frame[3]!.length, 120); assert.equal(frame[3]![35], '│');
    assert.equal(frame[3]!.slice(0, 35).length, 35); assert.equal(frame[3]!.slice(36).length, 84);
    assert.doesNotMatch(frame[3]!, /┐┌/); assert.equal(rgb(cell(ui, 35, 4).fg), '74,81,73');
    assert.equal(rgb(cell(ui, 0, 3).fg), '255,211,78'); // focused list's inset perimeter
    ui.mockInput.pressTab(); await ui.renderOnce(); frame = text(ui.captureCharFrame());
    assert.equal(frame[3]![35], '│'); assert.equal(frame[3]!.slice(36).length, 84);
    assert.equal(rgb(cell(ui, 36, 3).fg), '255,211,78'); // detail focus moves the perimeter only
    ui.mockInput.pressEscape(); await waitForEscape(); await ui.renderOnce(); frame = text(ui.captureCharFrame());
    assert.equal(frame[3]![35], '│'); assert.doesNotMatch(frame.slice(3, 38).join('\n'), /[┌┐└┘]/); // unfocused panes remain flat
  } finally { shell.close(); }
});

test('memory renderer layers a full scrim and naturally sized help surface with constrained-body geometry', async () => {
  const ui = await createTestRenderer({ width: 120, height: 40, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer);
  try {
    ui.mockInput.pressKey('?'); await ui.renderOnce();
    const geometry = helpDialogGeometry(120, 40);
    assert.deepEqual(geometry, { width: 62, maxHeight: 36, naturalHeight: 14, height: 14, bodyHeight: 6 });
    assert.equal(rgb(cell(ui, 0, 0).bg), '7,9,7'); // scrim covers cells outside the dialog
    assert.equal(rgb(cell(ui, 30, 14).bg), '13,16,14'); // surface is above the scrim
    assert.equal(rgb(cell(ui, 29, 13).fg), '156,164,155'); // centered dialog boundary
    // A longer body is constrained to H - 4 while title/actions retain their fixed rows.
    assert.deepEqual(helpDialogGeometry(50, 20, 12), { width: 46, maxHeight: 16, naturalHeight: 20, height: 16, bodyHeight: 8 });
    assert.equal(helpDialogGeometry(50, 20).height, 15); // short help stays natural, below its max of 16
  } finally { shell.close(); }
});

test('memory renderer preserves the 50x20 narrow shell, help, keyboard, and pointer activation', async () => {
  const ui = await createTestRenderer({ width: 50, height: 20, exitOnCtrlC: false });
  const shell = new OpenTuiShell(ui.renderer);
  try {
    await ui.renderOnce(); let frame = ui.captureCharFrame();
    assert.equal(text(frame).length, 20); assert.ok(frame.includes(footerGuides.compact)); assert.ok(frame.includes('PROVIDERS'));
    // Click Harnesses in the centered destination strip.
    const navLine = text(frame)[1]!; const x = navLine.indexOf('HARNESSES');
    await ui.mockMouse.click(x, 1); await ui.renderOnce();
    assert.equal(shell.state.activeSection, 2); assert.equal(shell.state.narrowPane, 'list');
    ui.mockInput.pressEnter(); await ui.renderOnce(); assert.equal(shell.state.narrowPane, 'detail');
    ui.mockInput.pressEscape(); await waitForEscape(); await ui.renderOnce(); assert.equal(shell.state.narrowPane, 'list');
    ui.mockInput.pressKey('?'); await ui.renderOnce(); frame = ui.captureCharFrame(); assert.ok(frame.includes('HELP')); assert.ok(frame.includes('Shift-Tab'));
    ui.mockInput.pressEscape(); await waitForEscape(); await ui.renderOnce(); assert.ok(!ui.captureCharFrame().includes('Shift-Tab'));
    ui.resize(49, 19); await ui.renderOnce(); assert.ok(ui.captureCharFrame().includes(footerGuides.minimum));
    ui.mockInput.pressKey('q'); await ui.renderOnce(); assert.equal(shell.state.belowMinimum, true);
    ui.mockInput.pressKey('q', { ctrl: true }); await shell.done;
  } finally { shell.close(); }
});
