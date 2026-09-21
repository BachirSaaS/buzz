import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { createTestRenderer } from '@opentui/core/testing';
import { OpenTuiShell } from '../src/opentui-shell.ts';
import { HarnessInventoryController } from '../src/harness-inventory.ts';
import { localOwner } from '../src/owner-client.ts';
import { serviceStatus, stopService } from '../src/host-service.ts';

for (const [width, height] of [[120,40],[60,20]]) test(`Host real IPC and detached lifecycle, confirmation, reset recovery at ${width}x${height}`, async () => {
  const home = mkdtempSync('/tmp/owner-tui-fixture-host-'), directory = home+'/.beehive/host';
  writeFileSync(home+'/desktop-mode','available'); writeFileSync(home+'/host-service-mode','real');
  const client=localOwner({helper:new URL('./owner-tui-fixture-child.ts',import.meta.url),environment:{HOME:home,BEEHIVE_HOME:home,PATH:process.env.PATH}});
  const ui=await createTestRenderer({width,height,exitOnCtrlC:false});
  const inventory=new HarnessInventoryController({read:()=>({version:1,revision:0,agents:[],providers:[],runtimes:[]}),save:c=>c},async()=>[]);
  const shell=new OpenTuiShell(ui.renderer,inventory,undefined,undefined,client);
  const wait=async(fn:()=>boolean)=>{for(let i=0;i<400;i++){if(fn()){await ui.renderOnce();return;}await new Promise(r=>setTimeout(r,10));}assert.fail(JSON.stringify(client.snapshot()));};
  const click=async(label:string)=>{await ui.renderOnce();const lines=ui.captureCharFrame().split('\n'),y=lines.findIndex(l=>l.includes(label));assert.ok(y>=0,ui.captureCharFrame());await ui.mockMouse.click(lines[y]!.indexOf(label),y);};
  const esc=async()=>{ui.mockInput.pressEscape();await new Promise(r=>setTimeout(r,50));await ui.renderOnce();};
  try {
    await wait(()=>!client.snapshot().message.includes('Loading'));
    assert.equal(await client.request({action:'signin-desktop',relay:'wss://fixture.example'}),true);
    await wait(()=>client.snapshot().host?.state==='stopped' && client.snapshot().hostPhase==='idle');
    assert.equal(shell.state.splitPane,false);assert.match(ui.captureCharFrame(),/Agents running\s+0/);
    await click('Reset Host');assert.match(ui.captureCharFrame(),/RESET HOST/);await esc();assert.ok(existsSync(directory+'/host-identity.json'));
    await click('Start Host');await wait(()=>client.snapshot().host?.state==='running' && client.snapshot().hostPhase==='idle');
    assert.match(ui.captureCharFrame(),/Stop Host/);assert.doesNotMatch(ui.captureCharFrame(),/Reset Host/);assert.equal(client.snapshot().host!.agents,0);
    await click('Stop Host');assert.match(ui.captureCharFrame(),/every agent/);await click('Keep running');await ui.renderOnce();assert.equal((await serviceStatus(directory)).state,'running');
    await client.request({action:'signout'});await ui.renderOnce();assert.equal((await serviceStatus(directory)).state,'running');assert.doesNotMatch(ui.captureCharFrame(),/Stop Host/);
    assert.equal(await client.request({action:'signin-desktop'}),true);await wait(()=>client.snapshot().host?.state==='running' && client.snapshot().hostPhase==='idle');
    await click('Stop Host');ui.mockInput.pressEnter();await wait(()=>client.snapshot().host?.state==='stopped' && client.snapshot().hostPhase==='idle');
    mkdirSync(directory+'/host.lock');await client.request({action:'host-status'});await ui.renderOnce();assert.match(ui.captureCharFrame(),/UNKNOWN/);assert.doesNotMatch(ui.captureCharFrame(),/Start Host|Reset Host/);
    rmSync(directory+'/host.lock',{recursive:true});await click('Refresh status');await wait(()=>client.snapshot().host?.state==='stopped' && client.snapshot().hostPhase==='idle');
    writeFileSync(home+'/reset-denied','true');await click('Reset Host');await click('Reset Host');await wait(()=>client.snapshot().hostPhase==='error');assert.match(ui.captureCharFrame(),/Reset incomplete/);assert.doesNotMatch(ui.captureCharFrame(),/Start Host/);
    rmSync(home+'/reset-denied');await click('Reset Host');ui.mockInput.pressEnter();await wait(()=>!client.snapshot().signedIn);assert.match(ui.captureCharFrame(),/Sign in to view/);assert.equal(client.snapshot().relay,undefined);assert.equal(existsSync(directory+'/host-identity.json'),false);
  } finally {
    const status=await serviceStatus(directory);if(status.instance)await stopService(directory,status.instance);
    shell.close();rmSync(home,{recursive:true,force:true});
  }
});
