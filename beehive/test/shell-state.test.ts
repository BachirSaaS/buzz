import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brand, destinations, listWidth, ownerLabel, ShellState } from '../src/shell-state.ts';

// Keep product text and interaction truth at the state owner.
test('never-signed-in shell labels and initial state are exact', () => {
  const state = new ShellState();
  assert.deepEqual(destinations, ['HOST', 'AGENTS', 'HARNESSES', 'PROVIDERS']);
  assert.equal(brand, '⬢ BEEHIVE'); assert.equal(ownerLabel, 'SIGNED OUT');
  assert.deepEqual({ active: state.activeSection, focus: state.focus, mode: state.mode, help: state.helpOpen }, { active: 0, focus: 'header', mode: 'section', help: false });
});

test('focus stays distinct from activation and protected/local geometry stays empty-capable', () => {
  const state = new ShellState();
  assert.equal(state.key('right'), 'render'); assert.equal(state.headerIndex, 1); assert.equal(state.activeSection, 0);
  state.key('right'); state.key('return');
  assert.equal(state.activeSection, 2); assert.equal(state.focus, 'list'); assert.equal(state.splitPane, true);
  state.key('tab'); assert.equal(state.focus, 'detail');
  state.key('tab', { shift: true }); assert.equal(state.focus, 'list');
  state.key('escape'); assert.equal(state.focus, 'header'); assert.equal(state.headerIndex, 2);
  state.headerIndex = 0; state.activateHeader(); assert.equal(state.protectedSection, true); assert.equal(state.splitPane, false); assert.equal(state.focus, 'detail');
});

test('help, q semantics, minimum guard and narrow return are deterministic', () => {
  const state = new ShellState();
  assert.equal(state.key('?'), 'render'); assert.equal(state.helpOpen, true);
  assert.equal(state.key('q'), 'none'); assert.equal(state.helpOpen, true);
  assert.equal(state.key('escape'), 'render'); assert.equal(state.helpOpen, false);
  assert.equal(state.key('q'), 'quit');
  state.resize(49, 20); assert.equal(state.key('q'), 'none'); assert.equal(state.key('c', { ctrl: true }), 'none'); assert.equal(state.key('q', { ctrl: true }), 'quit');
  state.resize(50, 20); state.activateHeader(2); assert.equal(state.splitPane, false); assert.equal(state.narrowPane, 'list');
  state.key('return'); assert.equal(state.narrowPane, 'detail'); state.key('escape'); assert.equal(state.narrowPane, 'list'); assert.equal(state.focus, 'list');
});

test('prototype breakpoint formulas are exact', () => {
  assert.equal(listWidth(120), 35); assert.equal(listWidth(90), 28); assert.equal(listWidth(72), 25); assert.equal(listWidth(50), 50);
});
