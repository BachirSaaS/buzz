import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { OpenTuiShell } from '../src/opentui-shell.ts';
import { HarnessInventoryController } from '../src/harness-inventory.ts';
import type { OwnerClient, OwnerRequest, OwnerSnapshot } from '../src/owner-protocol.ts';
// Flush the request promise and Host status refresh before capturing the frame.
async function render(ui: Awaited<ReturnType<typeof createTestRenderer>>) {
  await new Promise<void>(resolve => setImmediate(resolve));
  await ui.renderOnce();
}
function fixture() {
  const snapshot: OwnerSnapshot = { signedIn: false, desktop: 'available', desktopReason: 'Uses the Buzz Desktop identity in Keychain.', phase: 'idle', message: 'Sign in to manage Host and Agents.', secretLength: 0, relay: 'wss://relay.example' };
  const requests: OwnerRequest[] = [], listeners = new Set<(s: OwnerSnapshot) => void>();
  const emit = () => { for (const fn of listeners) fn(structuredClone(snapshot)); };
  const client: OwnerClient = {
    snapshot: () => structuredClone(snapshot), subscribe(fn) { listeners.add(fn); fn(structuredClone(snapshot)); return () => { listeners.delete(fn); }; },
    async request(r) { if (r.action === 'probe') return true; requests.push(r); if (r.action === 'host-status') { snapshot.host = { name: 'Fixture Host', host: 'a'.repeat(64), owner: 'b'.repeat(64), relay: snapshot.relay!, state: 'stopped', agents: 0, revision: 'fixture', resetPending: false }; } else if (r.action.startsWith('signin')) { snapshot.signedIn = true; snapshot.owner = 'npub1fixture'; snapshot.secretLength = 0; snapshot.message = 'Signed in. No operation was started.'; } else if (r.action === 'signout') { snapshot.signedIn = false; snapshot.owner = undefined; snapshot.message = 'Signed out. Host and agents keep running.'; } emit(); return true; },
    secret(action, value) { snapshot.secretLength = action === 'clear' ? 0 : action === 'backspace' ? Math.max(0, snapshot.secretLength - 1) : snapshot.secretLength + (value?.length ?? 0); emit(); },
    cancel() {}, dispose() {},
  };
  const inventory = new HarnessInventoryController({ read: () => ({ version: 1, revision: 0, agents: [], providers: [], runtimes: [] }), save: candidate => candidate }, async () => []);
  return { snapshot, requests, client, inventory, emit };
}
for (const [width, height] of [[120,40],[60,20]]) test(`owner standalone sign-in, direct Host navigation, and signout at ${width}x${height}`, async () => {
  const ui = await createTestRenderer({ width, height, exitOnCtrlC: false }), f = fixture();
  const shell = new OpenTuiShell(ui.renderer, f.inventory, undefined, undefined, f.client);
  try {
    await render(ui); assert.match(ui.captureCharFrame(), /Sign in to view and manage Host/);
    assert.equal(f.requests.length, 0);
    ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await render(ui);
    assert.match(ui.captureCharFrame(), /SIGN-IN REQUIRED/); assert.match(ui.captureCharFrame(), /Use Buzz Desktop identity/);
    ui.mockInput.pressEnter(); await render(ui);
    assert.equal(shell.state.focus, 'detail'); assert.equal(shell.state.mode, 'section');
    assert.doesNotMatch(ui.captureCharFrame(), /Continue to|Stay here/);
    assert.match(ui.captureCharFrame(), /Fixture Host/); assert.match(ui.captureCharFrame(), /Start Host/); assert.match(ui.captureCharFrame(), /Reset Host/); assert.equal(shell.state.activeSection, 0);
    ui.mockInput.pressKey('\x1b'); await new Promise(r => setTimeout(r, 50));
    for (let i=0;i<4;i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await render(ui);
    assert.equal(shell.state.signedIn, false); assert.match(ui.captureCharFrame(), /Use Buzz Desktop identity/);
    ui.mockInput.pressEnter(); await render(ui);
    assert.equal(shell.state.signedIn, true); assert.equal(shell.state.mode, 'section');
    assert.equal(shell.state.activeSection, 0); assert.match(ui.captureCharFrame(), /Start Host/); assert.match(ui.captureCharFrame(), /Reset Host/);
    assert.doesNotMatch(ui.captureCharFrame(), /Continue to/);
    assert.deepEqual(f.requests.map(r=>r.action), ['signin-desktop','host-status','signout','signin-desktop','host-status']);
  } finally { shell.close(); }
});
for (const [width,height] of [[120,40],[60,20]]) test(`owner unavailable identity, masked input, cancellation and pointer at ${width}x${height}`, async () => {
  const ui=await createTestRenderer({width,height,exitOnCtrlC:false}),f=fixture();
  f.snapshot.desktop='unavailable'; f.snapshot.desktopReason='No usable Buzz Desktop identity. Open Buzz or use nsec.';
  const shell=new OpenTuiShell(ui.renderer,f.inventory,undefined,undefined,f.client);
  try {
    for(let i=0;i<4;i++) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await render(ui);
    assert.doesNotMatch(ui.captureCharFrame(),/Check Desktop identity/);assert.equal(f.requests.length,0); assert.match(ui.captureCharFrame(),/No usable Buzz/);
    const lines=ui.captureCharFrame().split('\n'),y=lines.findIndex(l=>l.includes('Provide owner nsec'));
    await ui.mockMouse.click(lines[y]!.indexOf('Provide owner nsec'),y);await render(ui);
    assert.match(ui.captureCharFrame(),/PROVIDE OWNER NSEC/); assert.match(ui.captureCharFrame(),/Enter owner nsec/);
    ui.mockInput.typeText('nsec1never-show');await render(ui);
    assert.doesNotMatch(ui.captureCharFrame(),/nsec1never-show/); assert.match(ui.captureCharFrame(),/••/);
    ui.mockInput.pressEscape();await new Promise(r=>setTimeout(r,50)); await render(ui);
    assert.equal(f.snapshot.secretLength,0);assert.equal(f.requests.length,0);
    ui.mockInput.pressEnter();await render(ui);ui.mockInput.typeText('fixture');ui.mockInput.pressTab();ui.mockInput.pressEnter();await render(ui);
    assert.deepEqual(f.requests.map(r=>r.action),['signin-nsec','host-status']);assert.equal(shell.state.signedIn,true);
    assert.equal(shell.state.activeSection,0); assert.equal(shell.state.mode,'section'); assert.match(ui.captureCharFrame(),/Start Host/);
  }finally{shell.close();}
});
for (const [width,height] of [[120,40],[60,20]]) for (const target of [0,1]) test(`contextual sign-in opens requested section and cancellation stays signed out at ${width}x${height}, target ${target}`, async () => {
  const ui=await createTestRenderer({width,height,exitOnCtrlC:false}),f=fixture();
  const shell=new OpenTuiShell(ui.renderer,f.inventory,undefined,undefined,f.client);
  try {
    if(target) ui.mockInput.pressArrow('right');
    ui.mockInput.pressEnter();ui.mockInput.pressEnter();await render(ui);
    assert.match(ui.captureCharFrame(),new RegExp(`Requested section\\s+${target?'Agents':'Host'}`));
    ui.mockInput.pressEscape();await new Promise(r=>setTimeout(r,50));await render(ui);
    assert.equal(shell.state.mode,'section');assert.equal(shell.state.activeSection,target);
    assert.equal(shell.state.signedIn,false);assert.equal(f.requests.length,0);
    ui.mockInput.pressEnter();ui.mockInput.pressEnter();await render(ui);
    assert.equal(shell.state.mode,'section');assert.equal(shell.state.activeSection,target);assert.equal(shell.state.signedIn,true);
    assert.doesNotMatch(ui.captureCharFrame(),/Continue to|Stay here|Requested section/);
    assert.match(ui.captureCharFrame(),target ? /Owner access granted/ : /Start Host/);
    assert.deepEqual(f.requests.map(r=>r.action),target ? ['signin-desktop'] : ['signin-desktop','host-status']);
  }finally{shell.close();}
});
for (const cancel of ['escape', 'navigate']) test(`late successful sign-in does not redirect after ${cancel}`, async () => {
  const ui=await createTestRenderer({width:60,height:20,exitOnCtrlC:false}),f=fixture();
  let finish!: (ok:boolean)=>void;
  f.client.request=async r=>{ if(r.action==='probe') return true; f.requests.push(r); f.snapshot.phase='busy'; f.emit(); return new Promise<boolean>(resolve=>{finish=resolve;}); };
  const shell=new OpenTuiShell(ui.renderer,f.inventory,undefined,undefined,f.client);
  try {
    ui.mockInput.pressEnter();ui.mockInput.pressEnter();ui.mockInput.pressEnter();await render(ui);
    if(cancel==='escape') {ui.mockInput.pressEscape();await new Promise(r=>setTimeout(r,50));}
    else {ui.mockInput.pressArrow('up');ui.mockInput.pressArrow('left');}
    f.snapshot.phase='idle';f.snapshot.signedIn=true;f.emit();finish(true);await render(ui);
    assert.equal(shell.state.mode,cancel==='escape'?'owner':'section');
    if(cancel==='navigate') assert.equal(shell.state.activeSection,3);
    assert.deepEqual(f.requests.map(r=>r.action),['signin-desktop']);
    assert.doesNotMatch(ui.captureCharFrame(),/Start Host|Continue to|Stay here/);
  }finally{shell.close();}
});
