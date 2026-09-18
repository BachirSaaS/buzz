import test from 'node:test';
import assert from 'node:assert/strict';
import { listWidth, renderFrame } from '../src/shell-frame.ts';
import { ShellState, shortcutGuide } from '../src/shell-state.ts';

const plain = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');

test('wide shell follows frame geometry, label order, and literal empty panes', () => {
  const state = new ShellState();
  state.headerIndex = 2; state.openHeader();
  const lines = plain(renderFrame(state, 120, 40)).split('\n');
  assert.equal(lines.length, 40);
  assert.match(lines[0]!, /⬢ BEEHIVE.*SIGNED OUT/);
  assert.ok(lines[1]!.indexOf('HOST') < lines[1]!.indexOf('AGENTS'));
  assert.ok(lines[1]!.indexOf('AGENTS') < lines[1]!.indexOf('HARNESSES'));
  assert.ok(lines[1]!.indexOf('HARNESSES') < lines[1]!.indexOf('PROVIDERS'));
  assert.equal(lines[2], '─'.repeat(120));
  assert.equal(lines[38], '─'.repeat(120));
  assert.equal(lines[39]!.trim(), shortcutGuide);
  assert.equal(listWidth(120), 35);
  assert.equal(lines.slice(3, 38).some(line => /[A-Za-z0-9]/.test(line)), false, 'pane body gained placeholder or product copy');
  assert.equal(lines[4]![35], '│');
});

test('minimum 50x20 shell keeps every header destination and an empty one-pane body', () => {
  const state = new ShellState();
  state.headerIndex = 3; state.openHeader();
  const lines = plain(renderFrame(state, 50, 20)).split('\n');
  assert.equal(lines.length, 20);
  for (const label of ['HOST', 'AGENTS', 'HARNESSES', 'PROVIDERS']) assert.ok(lines[1]!.includes(label));
  assert.ok(lines[0]!.includes('SIGNED OUT'));
  assert.equal(lines.slice(3, 18).some(line => /[A-Za-z0-9]/.test(line)), false);
  assert.equal(lines[19]!.trim(), '←→ nav ↵ open Tab panes Esc back ? help q quit');
  assert.equal(lines.some(line => line.length !== 50), false, 'frame clipped or overflowed');
});

test('protected destinations and owner state never render section content', () => {
  for (const index of [0, 1, 4]) {
    const state = new ShellState(); state.headerIndex = index; state.openHeader();
    const body = plain(renderFrame(state, 90, 30)).split('\n').slice(3, 28).join('\n');
    assert.equal(/[A-Za-z0-9]/.test(body), false);
  }
});
