import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { OpenTuiScreen } from '../src/opentui-screen.ts';

test('host shows selected details and controls with hidden ordinary-key entry', async () => {
  const ui = await createTestRenderer({ width: 100, height: 30, exitOnCtrlC: false });
  const view = new OpenTuiScreen(ui.renderer);
  try {
    let calls = 0;
    view.show(['Agents','Providers','Runtimes'].map(label => ({ id: label,label,detail: 'Host name: Fixture' })),['Register agent','Add provider','Add runtime','Start','Stop'].map(label => ({ label,run: () => { calls++; } })));
    view.setRelay('wss://fixture.invalid','disconnected'); await ui.renderOnce();
    const frame = ui.captureCharFrame();
    assert.match(frame,/\[Host\]/); assert.match(frame,/Register agent/); assert.match(frame,/wss:\/\/fixture.invalid.*disconnected/);
    assert.ok(!frame.includes('Inspect')); assert.ok(frame.includes('Host name: Fixture')); assert.ok(!frame.includes('Actions (a)'));
    ui.mockInput.pressTab(); ui.mockInput.pressEnter(); await ui.renderOnce(); assert.equal(calls,1);
    const secret = 'synthetic-aq?io-private-value';
    const entered = view.input('Hidden fixture key','',true);
    await ui.mockInput.typeText(secret); await ui.renderOnce(); assert.ok(!ui.captureCharFrame().includes(secret)); assert.equal(calls,1);
    ui.mockInput.pressEnter(); assert.equal(await entered,secret);
    const cancelled = view.input('Cancel key','',true); await ui.mockInput.pasteBracketedText(secret); ui.mockInput.pressEscape(); assert.equal(await cancelled,undefined);
    const ordinary = view.input('Public text'); await ui.mockInput.typeText('aq?io'); ui.mockInput.pressEnter(); assert.equal(await ordinary,'aq?io');
    ui.resize(44,24); await ui.renderOnce(); assert.match(ui.captureCharFrame(),/Enter Open/); assert.match(ui.captureCharFrame(),/Register/);
    ui.resize(30,10); await ui.renderOnce(); assert.match(ui.captureCharFrame(),/Resize to at least 40 × 16/);
  } finally { view.close(); }
});

test('disabled host control and pending cancellation never run an operation; multiline/quit retain editor ownership', async () => {
  const ui = await createTestRenderer({ width: 100,height: 30,exitOnCtrlC: false }); const view = new OpenTuiScreen(ui.renderer);
  try {
    let calls = 0, cancelled = 0; view.onCancel = () => { cancelled++; };
    view.show([{id:'agents',label:'Agents',detail:''}],[{label:'Stop',disabled:'Ownership unknown.',run:()=>{calls++;}}]);
    ui.mockInput.pressTab(); ui.mockInput.pressEnter(); await ui.renderOnce(); assert.equal(calls,0); assert.match(ui.captureCharFrame(),/Ownership unknown/);
    view.setPending(true); ui.mockInput.pressEscape(); await new Promise(resolve => setTimeout(resolve,50)); await ui.renderOnce(); assert.equal(cancelled,1); view.setPending(false);
    const edit = view.input('Draft','line one',false,true); ui.mockInput.pressKey('s',{ctrl:true}); assert.equal(await edit,'line one');
    const quitting = view.input('Hidden','',true); await ui.mockInput.typeText('q');
    assert.equal(await Promise.race([view.done.then(()=>'quit'),new Promise(resolve=>setTimeout(resolve,40,'open'))]),'open');
    ui.mockInput.pressKey('q',{ctrl:true}); await view.done; assert.equal(await quitting,undefined);
  } finally { view.close(); }
});

test('footer shows the optional sanitized relay name before the exact URL and state', async () => {
  const ui = await createTestRenderer({ width: 100, height: 30, exitOnCtrlC: false });
  const view = new OpenTuiScreen(ui.renderer);
  try {
    view.setRelay('wss://fixture.invalid','connected','Fixture Relay'); await ui.renderOnce();
    assert.match(ui.captureCharFrame(),/Relay: Fixture Relay · wss:\/\/fixture\.invalid · connected/);
    view.setRelay('wss://fixture.invalid','disconnected','Bad\u001b[31mName'); await ui.renderOnce();
    const sanitized = ui.captureCharFrame();
    assert.match(sanitized,/Relay: BadName · wss:\/\/fixture\.invalid · disconnected/);
    assert.ok(!sanitized.includes('\u001b[31m'));
    view.setRelay('wss://fixture.invalid','connected'); await ui.renderOnce();
    assert.match(ui.captureCharFrame(),/Relay: wss:\/\/fixture\.invalid · connected/);
    view.setRelay(undefined,'unknown'); await ui.renderOnce();
    assert.match(ui.captureCharFrame(),/Relay: Not configured · disconnected/);
  } finally { view.close(); }
});


test('agent controls stay visible beside long details and user scroll survives unchanged snapshot pushes', async () => {
  const ui = await createTestRenderer({ width: 100, height: 30, exitOnCtrlC: false });
  const view = new OpenTuiScreen(ui.renderer);
  try {
    const detail = Array.from({ length: 40 }, (_, index) => `Report line ${String(index).padStart(2, '0')}`).join('\n');
    const rows = [{ id: 'agent-one', label: 'Agent one', detail }, { id: 'agent-two', label: 'Agent two', detail: `Second agent\n${detail}` }];
    const runs: string[] = [];
    const routed: string[] = [];
    view.onSelect = id => { routed.push(id); };
    const actions = ['Start', 'Stop', 'Restart', 'Move', 'Inspect'].map(label => ({ label, run: () => { runs.push(label); } }));
    view.show(rows, actions); await ui.renderOnce();
    // Controls are a bounded always-visible region: the action list renders beside
    // long detail text, without scrolling the Details pane to reach it.
    const initial = ui.captureCharFrame();
    assert.ok(initial.includes('Controls')); assert.ok(initial.includes('Restart')); assert.ok(initial.includes('Report line 00'));
    // The advertised 'a' key focuses controls and the focused region stays on screen.
    ui.mockInput.pressKey('a'); await ui.renderOnce();
    const focused = ui.captureCharFrame();
    assert.ok(focused.includes('[Controls]')); assert.ok(focused.includes('Restart'));
    // User wheel scroll over Details moves the long report off its first lines.
    for (let wheel = 0; wheel < 10; wheel++) await ui.mockMouse.scroll(60, 8, 'down');
    await ui.renderOnce();
    const scrolled = ui.captureCharFrame();
    assert.ok(!scrolled.includes('Report line 00'), 'wheel never scrolled Details'); assert.ok(scrolled.includes('Report line 10'));
    // Repeated unchanged snapshot pushes must preserve that scroll and must not
    // re-route selection: background refreshes cannot wipe the reading position.
    view.show(rows, actions); await ui.renderOnce();
    view.show(rows, actions); await ui.renderOnce();
    const pushed = ui.captureCharFrame();
    assert.ok(!pushed.includes('Report line 00'), 'unchanged snapshot push reset Details scroll');
    assert.ok(pushed.includes('Report line 10')); assert.deepEqual(routed, ['agent-one']); assert.deepEqual(runs, []);
    // Pointer wheel over the bounded Controls moves the focused action selection.
    await ui.mockMouse.scroll(40, 22, 'down'); await ui.mockMouse.scroll(40, 22, 'down'); await ui.renderOnce();
    assert.ok(ui.captureCharFrame().includes('▶ Restart'));
    // A click on a visible control runs exactly that action, never an offset-mapped stranger.
    await ui.mockMouse.click(40, 24); await ui.renderOnce();
    assert.deepEqual(runs, ['Inspect']);
    // A genuine item selection change still routes, swaps details and resets scroll.
    ui.mockInput.pressTab(); await ui.renderOnce();
    ui.mockInput.pressArrow('down'); await ui.renderOnce();
    const changed = ui.captureCharFrame();
    assert.ok(changed.includes('Second agent')); assert.ok(changed.includes('Report line 00'), 'genuine selection did not reset Details scroll');
    assert.deepEqual(routed, ['agent-one', 'agent-two']);
    // A genuine section change also presents its details from the top.
    view.onScope = () => { view.show(rows, actions); };
    ui.mockInput.pressArrow('right'); await ui.renderOnce();
    const switched = ui.captureCharFrame();
    assert.ok(switched.includes('[Agents]')); assert.ok(switched.includes('Report line 00'), 'section switch did not reset Details scroll');
  } finally { view.close(); }
});

test('overflowing real Agents controls map every visible click to its own action and keep the tail reachable', async () => {
  const ui = await createTestRenderer({ width: 100, height: 30, exitOnCtrlC: false });
  const view = new OpenTuiScreen(ui.renderer);
  try {
    const runs: string[] = [];
    // The actual signed-in Agents menu from manager-view.ts is the longest list in
    // the product: it overflows the bounded Controls region at 100x30.
    const labels = ['Register agent', 'Refresh agents', 'Choose runtime…', 'Choose configuration…', 'Start', 'Stop', 'Restart', 'Move…', 'Inspect operations', 'Check operation results', 'Sign out', 'Publish profile or instructions', 'Quit Beehive'];
    const actions = labels.map(label => ({ label, run: () => { runs.push(label); } }));
    view.show([{ id: 'review-agent', label: 'Review agent', detail: 'Agent detail' }], actions);
    await ui.renderOnce();
    const initial = ui.captureCharFrame();
    assert.ok(initial.includes('Register agent'), 'first Agents action must be visible');
    assert.ok(!initial.includes('Sign out'), 'the overflowed tail starts outside the bounded window');
    // With the window on the first ten actions, each visible row runs exactly itself.
    await ui.mockMouse.click(40, 15); await ui.renderOnce();
    await ui.mockMouse.click(40, 24); await ui.renderOnce();
    assert.deepEqual(runs, ['Register agent', 'Check operation results']);
    // The wheel moves the selection to the tail; the window follows and the tail
    // becomes visible and clickable through the same offset-aware mapping.
    ui.mockInput.pressKey('a'); await ui.renderOnce();
    for (let wheel = 0; wheel < 12; wheel++) await ui.mockMouse.scroll(40, 20, 'down');
    await ui.renderOnce();
    const tailed = ui.captureCharFrame();
    assert.ok(tailed.includes('Quit Beehive'), 'keyboard/wheel must keep the tail reachable');
    assert.ok(!tailed.includes('Register agent'), 'window should have followed the selection');
    await ui.mockMouse.click(40, 22); await ui.renderOnce();
    await ui.mockMouse.click(40, 24); await ui.renderOnce();
    assert.deepEqual(runs, ['Register agent', 'Check operation results', 'Sign out', 'Quit Beehive']);
    // Keyboard selection movement recentres the window on the head again.
    for (let step = 0; step < 12; step++) ui.mockInput.pressArrow('up');
    await ui.renderOnce();
    assert.ok(ui.captureCharFrame().includes('Register agent'));
    await ui.mockMouse.click(40, 15); await ui.renderOnce();
    assert.deepEqual(runs, ['Register agent', 'Check operation results', 'Sign out', 'Quit Beehive', 'Register agent']);
  } finally { view.close(); }
});

test('four sections navigate in both directions and remain readable at narrow width', async () => {
  const ui = await createTestRenderer({ width: 100, height: 30, exitOnCtrlC: false });
  const view = new OpenTuiScreen(ui.renderer);
  const scopes: number[] = [];
  view.onScope = scope => { scopes.push(scope); view.show([{ id: String(scope), label: 'Selected', detail: `Section ${scope}` }], []); };
  try {
    for (const name of ['Agents', 'Harnesses', 'Providers', 'Host']) {
      ui.mockInput.pressArrow('right'); await ui.renderOnce();
      assert.ok(ui.captureCharFrame().includes(`[${name}]`), JSON.stringify({name,scopes,frame:ui.captureCharFrame()}));
    }
    ui.mockInput.pressArrow('left'); await ui.renderOnce();
    assert.deepEqual(scopes, [1, 2, 3, 0, 3]);
    ui.resize(40, 24); await ui.renderOnce();
    assert.match(ui.captureCharFrame(), /Host Agents Harnesses \[Providers\]/);
    await ui.mockMouse.click(13,0); await ui.renderOnce();
    assert.equal(scopes.at(-1),2);
    await ui.mockMouse.click(25,0); await ui.renderOnce();
    assert.equal(scopes.at(-1),3);
  } finally { view.close(); }
});
