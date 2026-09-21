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

test('wide collection arrows traverse header, List and Details without activating a new destination', () => {
  const state = new ShellState();
  state.setHarnessRows([{ id: 'harness:fixture', kind: 'harness' }, { id: 'command:refresh', kind: 'command' }]);
  assert.equal(state.key('right'), 'render'); assert.equal(state.headerIndex, 1); assert.equal(state.activeSection, 0);
  state.key('right'); state.key('return');
  assert.deepEqual({ active: state.activeSection, header: state.headerIndex, focus: state.focus, split: state.splitPane }, { active: 2, header: 2, focus: 'list', split: true });
  state.key('right'); assert.deepEqual({ active: state.activeSection, focus: state.focus }, { active: 2, focus: 'detail' });
  state.key('left'); assert.equal(state.focus, 'list');
  state.key('return'); assert.equal(state.focus, 'detail', 'Enter opens the adjacent Details pane');
  state.key('up'); assert.deepEqual({ focus: state.focus, header: state.headerIndex, active: state.activeSection }, { focus: 'header', header: 2, active: 2 });
  state.key('tab'); assert.equal(state.focus, 'list');
  state.key('tab', { shift: true }); assert.equal(state.focus, 'header');
  state.headerIndex = 0; state.activateHeader(); assert.equal(state.protectedSection, true); assert.equal(state.splitPane, false); assert.equal(state.focus, 'detail');
});

test('help, q semantics, minimum guard and narrow return are deterministic', () => {
  const state = new ShellState();
  state.setHarnessRows([{ id: 'harness:fixture', kind: 'harness' }, { id: 'command:refresh', kind: 'command' }]);
  assert.equal(state.key('?'), 'render'); assert.equal(state.helpOpen, true);
  assert.equal(state.key('q'), 'none'); assert.equal(state.helpOpen, true);
  assert.equal(state.key('escape'), 'render'); assert.equal(state.helpOpen, false);
  assert.equal(state.key('q'), 'quit');
  state.resize(49, 20); assert.equal(state.key('q'), 'none'); assert.equal(state.key('c', { ctrl: true }), 'none'); assert.equal(state.key('q', { ctrl: true }), 'quit');
  state.resize(59, 20); assert.equal(state.belowMinimum, true); state.resize(120, 40); assert.equal(state.belowMinimum, false);
});

test('harness rows preserve stable identity, fall back deterministically, and virtualize overflow', () => {
  const state = new ShellState();
  const rows: Array<{ id: string; kind: 'harness' | 'command' }> = [...Array.from({ length: 20 }, (_, index) => ({ id: `harness:${index}`, kind: 'harness' as const })), { id: 'command:refresh', kind: 'command' }];
  state.setHarnessRows(rows); state.setListCapacity(5); state.activateHeader(2);
  for (let index = 0; index < 9; index++) assert.equal(state.key('down'), 'render');
  assert.equal(state.harnessSelection, 'harness:9'); assert.equal(state.listOffset, 5);
  state.setHarnessRows(rows.filter(row => row.id !== 'harness:3'));
  assert.equal(state.harnessSelection, 'harness:9', 'stable identity survives row reindexing');
  state.setHarnessRows([{ id: 'harness:replacement', kind: 'harness' }, { id: 'command:refresh', kind: 'command' }]);
  assert.equal(state.harnessSelection, 'harness:replacement', 'disappearing identity falls back to the next surviving harness');
  state.setHarnessRows([{ id: 'harness:a', kind: 'harness' }, { id: 'harness:b', kind: 'harness' }, { id: 'harness:c', kind: 'harness' }, { id: 'command:refresh', kind: 'command' }]);
  state.selectHarness('harness:b');
  state.setHarnessRows([{ id: 'harness:a', kind: 'harness' }, { id: 'harness:c', kind: 'harness' }, { id: 'command:refresh', kind: 'command' }]);
  assert.equal(state.harnessSelection, 'harness:c', 'removed row falls forward at the same harness position');
  state.setHarnessRows([{ id: 'harness:a', kind: 'harness' }, { id: 'command:refresh', kind: 'command' }]);
  assert.equal(state.harnessSelection, 'harness:a', 'then falls back to the previous surviving harness');
  state.key('down'); assert.equal(state.key('return'), 'render', 'the command row opens Details without executing');
  assert.equal(state.key('return'), 'activate', 'only the explicit command Details action activates');
});

test('prototype breakpoint formulas are exact', () => {
  assert.equal(listWidth(120), 35); assert.equal(listWidth(90), 28); assert.equal(listWidth(72), 25); assert.equal(listWidth(60), 24);
});
