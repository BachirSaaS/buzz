import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createTestRenderer } from '@opentui/core/testing';
import { OpenTuiShell } from '../src/opentui-shell.ts';
import { HarnessInventoryController } from '../src/harness-inventory.ts';
import { localOwner } from '../src/owner-client.ts';
import { nip19 } from 'nostr-tools';
for (const [width, height] of [[120,40],[60,20]]) test(`real owner IPC: form failure/recovery, Desktop denial/mismatch, navigation fencing at ${width}x${height}`, async () => {
  const home = mkdtempSync('/tmp/owner-tui-fixture-shell-');
  const mode = (value: string) => writeFileSync(home+'/desktop-mode', value);
  mode('available');
  const ui = await createTestRenderer({width,height,exitOnCtrlC:false});
  const client = localOwner({helper:new URL('./owner-tui-fixture-child.ts',import.meta.url),environment:{HOME:home,BEEHIVE_HOME:home,PATH:process.env.PATH}});
  const inventory = new HarnessInventoryController({read:()=>({version:1,revision:0,agents:[],providers:[],runtimes:[]}),save:c=>c},async()=>[]);
  const shell = new OpenTuiShell(ui.renderer,inventory,undefined,undefined,client);
  const wait = async (predicate:()=>boolean) => { for(let i=0;i<200;i++) { if(predicate()) { await ui.renderOnce(); return; } await new Promise(r=>setTimeout(r,10)); } assert.fail('Owner state did not settle'); };
  const input = ui.mockInput;
  const enter = () => input.pressEnter();
  const submit = () => { input.pressTab(); enter(); };
  try {
    await wait(()=>!client.snapshot().message.includes('Loading'));
    for(let i=0;i<4;i++) input.pressArrow('right');
    await wait(()=>client.snapshot().desktop==='available');
    enter(); enter(); await ui.renderOnce();
    input.typeText('relay.example'); submit(); await new Promise(r=>setTimeout(r,0)); await ui.renderOnce(); assert.doesNotMatch(ui.captureCharFrame(),/CHOOSE A RELAY/);
    input.pressArrow('down'); enter(); input.typeText('invalid'); submit();
    await wait(()=>client.snapshot().phase==='error');
    assert.equal(shell.state.mode,'owner');
    assert.match(ui.captureCharFrame(),/valid owner nsec/);
    enter(); input.typeText(nip19.nsecEncode(Buffer.from('1'.repeat(64),'hex')));
    await wait(()=>client.snapshot().secretLength>0);
    assert.doesNotMatch(ui.captureCharFrame(),/nsec1/); assert.match(ui.captureCharFrame(),/••/);
    submit(); await wait(()=>client.snapshot().signedIn && shell.state.mode==='section' && shell.state.activeSection===0 && client.snapshot().host?.state==='stopped');
    assert.doesNotMatch(ui.captureCharFrame(),/Continue to/);
    assert.match(ui.captureCharFrame(),/Start Host/); assert.match(ui.captureCharFrame(),/Reset Host/);
    input.pressEscape(); await new Promise(r=>setTimeout(r,50));
    for(let i=0;i<4;i++) input.pressArrow('right');
    enter(); enter(); await wait(()=>!client.snapshot().signedIn);
    mode('denied'); enter(); await wait(()=>client.snapshot().phase==='error');
    assert.equal(shell.state.mode,'owner');
    assert.match(ui.captureCharFrame(),/key access failed/);
    mode('mismatch'); enter(); await wait(()=>client.snapshot().phase==='error' && client.snapshot().message.includes('does not match'));
    assert.match(ui.captureCharFrame(),/does not match/);
    mode('delayed'); enter(); await wait(()=>client.snapshot().phase==='busy');
    input.pressArrow('up'); input.pressArrow('left');
    assert.equal(shell.state.activeSection,3);
    await new Promise(r=>setTimeout(r,1400));
    assert.equal(client.snapshot().signedIn,false); assert.equal(shell.state.activeSection,3);
    input.pressArrow('right'); mode('available'); enter(); enter();
    await wait(()=>client.snapshot().signedIn && shell.state.mode==='section' && shell.state.activeSection===0 && client.snapshot().host?.state==='stopped');
    assert.match(ui.captureCharFrame(),/Start Host/); assert.doesNotMatch(ui.captureCharFrame(),/Continue to|Stay here/);
  } finally {shell.close();rmSync(home,{recursive:true,force:true});}
});

for (const [width, height] of [[120,40],[60,20]]) test(`Desktop availability updates automatically in the open sign-in screen at ${width}x${height}`, { timeout: 15000 }, async () => {
  const home=mkdtempSync('/tmp/owner-tui-fixture-detect-');
  const mode=(value:string)=>writeFileSync(home+'/desktop-mode',value);
  mode('missing');
  const client=localOwner({helper:new URL('./owner-tui-fixture-child.ts',import.meta.url),environment:{HOME:home,BEEHIVE_HOME:home,PATH:process.env.PATH}});
  const ui=await createTestRenderer({width,height,exitOnCtrlC:false});
  const inventory=new HarnessInventoryController({read:()=>({version:1,revision:0,agents:[],providers:[],runtimes:[]}),save:c=>c},async()=>[]);
  const shell=new OpenTuiShell(ui.renderer,inventory,undefined,undefined,client);
  const wait=async(fn:()=>boolean)=>{for(let i=0;i<450;i++){if(fn()){await ui.renderOnce();return;}await new Promise(r=>setTimeout(r,10));}assert.fail(JSON.stringify(client.snapshot()));};
  try {
    await wait(()=>!client.snapshot().message.includes('Loading'));
    for(let i=0;i<4;i++)ui.mockInput.pressArrow('right');
    await wait(()=>client.snapshot().desktop==='unavailable');
    assert.doesNotMatch(ui.captureCharFrame(),/Check Desktop identity/);
    // Choose a relay, then Enter on unavailable Desktop must not sign in.
    ui.mockInput.pressEnter();ui.mockInput.pressEnter();await ui.renderOnce();
    ui.mockInput.typeText('fixture.example');ui.mockInput.pressTab();ui.mockInput.pressEnter();
    await new Promise(r=>setTimeout(r,0));ui.mockInput.pressEnter();
    assert.equal(client.snapshot().signedIn,false);
    mode('available');await wait(()=>client.snapshot().desktop==='available');
    mode('missing');await wait(()=>client.snapshot().desktop==='unavailable');
    ui.mockInput.pressEnter();assert.equal(client.snapshot().signedIn,false);
    mode('available');await wait(()=>client.snapshot().desktop==='available');
    ui.mockInput.pressEnter();await wait(()=>client.snapshot().signedIn && client.snapshot().host?.state==='stopped');
    assert.match(ui.captureCharFrame(),/Start Host/);assert.doesNotMatch(ui.captureCharFrame(),/Refresh status|Check Desktop identity/);
  } finally {shell.close();rmSync(home,{recursive:true,force:true});}
});
