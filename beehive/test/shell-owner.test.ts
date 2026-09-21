import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { OpenTuiShell } from '../src/opentui-shell.ts';
import { HarnessInventoryController } from '../src/harness-inventory.ts';
import type { OwnerClient, OwnerRequest, OwnerSnapshot } from '../src/owner-protocol.ts';
function fixture() {
  const snapshot: OwnerSnapshot = { signedIn: false, desktop: 'available', desktopReason: 'Uses the Buzz Desktop identity in Keychain.', phase: 'idle', message: 'Sign in to manage Host and Agents.', secretLength: 0, relay: 'wss://relay.example' };
  const requests: OwnerRequest[] = [], listeners = new Set<(s: OwnerSnapshot) => void>();
  const emit = () => { for (const fn of listeners) fn(structuredClone(snapshot)); };
  const client: OwnerClient = {
    snapshot: () => structuredClone(snapshot), subscribe(fn) { listeners.add(fn); fn(structuredClone(snapshot)); return () => { listeners.delete(fn); }; },
    async request(r) { requests.push(r); if (r.action.startsWith('signin')) { snapshot.signedIn = true; snapshot.owner = 'npub1fixture'; snapshot.secretLength = 0; snapshot.message = 'Signed in. No operation was started.'; } else if (r.action === 'signout') { snapshot.signedIn = false; snapshot.owner = undefined; snapshot.message = 'Signed out. Host and agents keep running.'; } emit(); return true; },
    secret(action, value) { snapshot.secretLength = action === 'clear' ? 0 : action === 'backspace' ? Math.max(0, snapshot.secretLength - 1) : snapshot.secretLength + (value?.length ?? 0); emit(); },
    cancel() {}, dispose() {},
  };
  const inventory = new HarnessInventoryController({ read: () => ({ version: 1, revision: 0, agents: [], providers: [], runtimes: [] }), save: candidate => candidate }, async () => []);
  return { snapshot, requests, client, inventory, emit };
}
for (const [width, height] of [[120,40],[60,20]]) test(`owner standalone sign-in, explicit contextual continuation, and signout at ${width}x${height}`, async () => {
  const ui = await createTestRenderer({ width, height, exitOnCtrlC: false }), f = fixture();
  const shell = new OpenTuiShell(ui.renderer, f.inventory, undefined, undefined, f.client);
  try {
    await ui.renderOnce(); assert.match(ui.captureCharFrame(), /Sign in to view and manage Host/);
    assert.equal(f.requests.length, 0);
    ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.match(ui.captureCharFrame(), /SIGN-IN REQUIRED/); assert.match(ui.captureCharFrame(), /Use Buzz Desktop identity/);
    ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.equal(shell.state.focus, 'header'); assert.match(ui.captureCharFrame(), /SIGNED IN/);
    assert.match(ui.captureCharFrame(), /Continue to Host/); assert.equal(shell.state.mode, 'owner');
    ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.match(ui.captureCharFrame(), /not implemented/); assert.equal(shell.state.activeSection, 0);
    ui.mockInput.pressKey('\x1b'); await new Promise(r => setTimeout(r, 50));
    for (let i=0;i<4;i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.equal(shell.state.signedIn, false); assert.match(ui.captureCharFrame(), /Use Buzz Desktop identity/);
    ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.equal(shell.state.signedIn, true); assert.equal(shell.state.mode, 'owner');
    assert.doesNotMatch(ui.captureCharFrame(), /Continue to/);
    assert.deepEqual(f.requests.map(r=>r.action), ['signin-desktop','signout','signin-desktop']);
  } finally { shell.close(); }
});
for (const [width,height] of [[120,40],[60,20]]) test(`owner unavailable identity, masked input, cancellation and pointer at ${width}x${height}`, async () => {
  const ui=await createTestRenderer({width,height,exitOnCtrlC:false}),f=fixture();
  f.snapshot.desktop='unavailable'; f.snapshot.desktopReason='No usable Buzz Desktop identity. Open Buzz or use nsec.';
  const shell=new OpenTuiShell(ui.renderer,f.inventory,undefined,undefined,f.client);
  try {
    for(let i=0;i<4;i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await ui.renderOnce();
    assert.equal(f.requests.length,0); assert.match(ui.captureCharFrame(),/No usable Buzz/);
    const lines=ui.captureCharFrame().split('\n'),y=lines.findIndex(l=>l.includes('Provide owner nsec'));
    await ui.mockMouse.click(lines[y]!.indexOf('Provide owner nsec'),y);await ui.renderOnce();
    assert.match(ui.captureCharFrame(),/PROVIDE OWNER NSEC/); assert.match(ui.captureCharFrame(),/Enter owner nsec/);
    ui.mockInput.typeText('nsec1never-show');await ui.renderOnce();
    assert.doesNotMatch(ui.captureCharFrame(),/nsec1never-show/); assert.match(ui.captureCharFrame(),/••/);
    ui.mockInput.pressEscape();await new Promise(r=>setTimeout(r,50)); await ui.renderOnce();
    assert.equal(f.snapshot.secretLength,0);assert.equal(f.requests.length,0);
    ui.mockInput.pressEnter();await ui.renderOnce();ui.mockInput.typeText('fixture');ui.mockInput.pressTab();ui.mockInput.pressEnter();await ui.renderOnce();
    assert.equal(f.requests.at(-1)?.action,'signin-nsec');assert.equal(shell.state.signedIn,true);
  }finally{shell.close();}
});
for (const [width,height] of [[120,40],[60,20]]) for (const target of [0,1]) test(`contextual request fact and decline keep owner screen at ${width}x${height}, target ${target}`, async () => {
  for (const decline of ['action','escape','left']) {
    const ui=await createTestRenderer({width,height,exitOnCtrlC:false}),f=fixture();
    const shell=new OpenTuiShell(ui.renderer,f.inventory,undefined,undefined,f.client);
    try {
      if(target) ui.mockInput.pressArrow('right');
      ui.mockInput.pressEnter();ui.mockInput.pressEnter();await ui.renderOnce();
      assert.match(ui.captureCharFrame(),new RegExp(`Requested section\\s+${target?'Agents':'Host'}`));
      ui.mockInput.pressEnter();await ui.renderOnce();
      assert.equal(shell.state.signedIn,true);assert.match(ui.captureCharFrame(),/Stay here/);
      if(decline==='action') { ui.mockInput.pressEnter();ui.mockInput.pressArrow('down');ui.mockInput.pressEnter(); }
      else if(decline==='escape') {ui.mockInput.pressEscape();await new Promise(r=>setTimeout(r,50));}
      else {ui.mockInput.pressEnter();ui.mockInput.pressArrow('left');}
      await ui.renderOnce();
      assert.equal(shell.state.mode,'owner');assert.equal(shell.state.signedIn,true);assert.equal(shell.state.focus,'header');
      assert.doesNotMatch(ui.captureCharFrame(),/Continue to|Requested section|not implemented/);
      assert.deepEqual(f.requests.map(r=>r.action),['signin-desktop']);
    }finally{shell.close();}
  }
});
