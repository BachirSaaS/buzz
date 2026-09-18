import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { OpenTuiShell, footerGuides, palette } from '../src/opentui-shell.ts';

const text = (frame: string) => frame.endsWith('\n') ? frame.slice(0, -1).split('\n') : frame.split('\n');
const waitForEscape = () => new Promise(resolve => setTimeout(resolve, 50));

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
