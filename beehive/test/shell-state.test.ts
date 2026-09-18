import test from 'node:test';
import assert from 'node:assert/strict';
import { destinations, ownerLabel, ShellState, shortcutGuide } from '../src/shell-state.ts';

const press = (state: ShellState, name: string, options = {}) => state.key(name, options);

test('never-signed-in shell starts on the complete gated header', () => {
  const state = new ShellState();
  assert.deepEqual(destinations, ['HOST', 'AGENTS', 'HARNESSES', 'PROVIDERS']);
  assert.equal(ownerLabel, 'SIGNED OUT');
  assert.equal(state.headerIndex, 0);
  assert.equal(state.activeSection, 0);
  assert.equal(state.focus, 'header');
  assert.equal(state.protectedSection, true);
});

test('header arrows clamp, preserve active selection, and Enter opens separately from focus', () => {
  const state = new ShellState();
  assert.equal(press(state, 'left'), 'none');
  press(state, 'right');
  assert.equal(state.headerIndex, 1);
  assert.equal(state.activeSection, 0, 'focus must not activate a destination');
  press(state, 'return');
  assert.equal(state.activeSection, 1);
  assert.equal(state.focus, 'detail');
  assert.equal(state.splitPane, false, 'owner-scoped destination must not pretend protected content loaded');
  press(state, 'escape');
  assert.equal(state.focus, 'header');
  assert.equal(state.headerIndex, 1);
  for (let index = 0; index < 10; index++) press(state, 'right');
  assert.equal(state.headerIndex, destinations.length);
  assert.equal(press(state, 'right'), 'none');
});

test('host-local sections expose empty list/detail focus regions and Esc returns to initiator', () => {
  const state = new ShellState();
  state.headerIndex = 2;
  press(state, 'return');
  assert.equal(state.activeSection, 2);
  assert.equal(state.focus, 'list');
  press(state, 'tab'); assert.equal(state.focus, 'detail');
  press(state, 'tab'); assert.equal(state.focus, 'header');
  press(state, 'tab', { shift: true }); assert.equal(state.focus, 'detail');
  press(state, 'escape');
  assert.equal(state.focus, 'header');
  assert.equal(state.headerIndex, 2);
});

test('owner control opens an empty owner pane and Esc restores its header control', () => {
  const state = new ShellState();
  state.headerIndex = destinations.length;
  press(state, 'return');
  assert.equal(state.activeOwner, true);
  assert.equal(state.focus, 'detail');
  press(state, 'escape');
  assert.equal(state.focus, 'header');
  assert.equal(state.headerIndex, destinations.length);
});

test('q-only advertised quit semantics and truthful guide', () => {
  const state = new ShellState();
  assert.equal(shortcutGuide, '←→ header  Enter open  Tab panes  Esc return  ? help  q quit');
  assert.equal(press(state, 'x'), 'none');
  assert.equal(press(state, 'q'), 'quit');
  assert.equal(press(state, 'c', { ctrl: true }), 'quit');
  assert.equal(press(state, 'q', { ctrl: true }), 'quit');
  assert.equal(press(state, 'q', { belowMinimum: true }), 'none');
  assert.equal(press(state, 'q', { ctrl: true, belowMinimum: true }), 'quit');
  assert.equal(press(state, '?'), 'render'); assert.equal(state.helpOpen, true);
  assert.equal(press(state, 'escape'), 'render'); assert.equal(state.helpOpen, false);
});
