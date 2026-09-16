import { ManagerNavigation, sectionRows } from './manager-navigation.ts';
import { runtimeForm } from './runtime-form.ts';
import { createCliRenderer } from '@opentui/core';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { OpenTuiScreen, type ManagerAction } from './opentui-screen.ts';
import type { ManagerItem, ManagerRequest, ManagerSnapshot, ManagerResult } from './manager-controller.ts';

function shortIdentity(value: string) { return value.length > 20 ? `${value.slice(0,8)}…${value.slice(-8)}` : value; }
function targetNames(row: ManagerItem, start = false) {
  return `Agent: ${row.names?.agent || shortIdentity(row.id)}\nHost: ${(start ? row.names?.startHost : undefined) || row.names?.host || 'Unknown'}`;
}
const renderer = await createCliRenderer({ exitOnCtrlC: false });
const screen = new OpenTuiScreen(renderer);
const output = createWriteStream('', { fd: 4 });
let snapshot: ManagerSnapshot = { local: [], agents: [], status: 'Connecting to Beehive…' };
const navigation = new ManagerNavigation();
let scope = 0, selected = '', sequence = 0, lastStatus = '';
let pending: { id: number; resolve: (result: ManagerResult) => void } | undefined;
function request(action: string, values?: Record<string,string>, target?: string, revision?: number) {
  if (pending) return Promise.resolve<ManagerResult>({ state: 'ignored', reason: 'An operation is pending.' });
  const id = ++sequence;
  const completion = new Promise<ManagerResult>(resolve => { pending = { id, resolve }; });
  const message: ManagerRequest = { id, action, values, target, revision };
  screen.setPending(true); const retire = screen.temporaryNotice(action === 'add-databricks' ? 'Signing in through your browser… Esc cancels the native helper. An OS credential write or browser window may remain; cancelled sign-in will not save a provider.' : action === 'signin-buzz' ? 'Reading the saved Buzz owner key… Keychain read only · session only · no local copy. Esc stops waiting. An OS keychain permission dialog may appear; it is separate and is not bypassed.' : 'Working… Esc stops waiting. Remote work and saved changes are not cancelled. Inspect before you try again.');
  output.write(JSON.stringify(message) + '\n');
  return completion.finally(retire);
}
async function routing(action: string, secret = false) {
  const retained = action !== 'configure' ? snapshot.routing : undefined;
  let owner = retained?.owner ?? '', relay = retained?.relay ?? '';
  if (!retained) {
    let step = 0;
    while (step < 2) {
      const label = step === 0 ? `${action === 'configure' ? 'Configure this computer' : 'Sign in'} · 1 of 3\nOwner public key (npub or 64 hex characters). Do not enter a private key.` : 'Relay · 2 of 3\nRelay URL (ws:// or wss://)';
      const answer = await screen.input(label, step === 0 ? owner : relay, false, false, value => step === 0 ? /^(?:[0-9a-fA-F]{64}|npub1[023456789acdefghjklmnpqrstuvwxyz]{58})$/.test(value.trim()) ? '' : 'Enter an npub or a public key with 64 hex characters.' : /^wss?:\/\//.test(value) ? '' : 'Enter a ws:// or wss:// relay URL.', step === 1 ? value => { relay = value; } : undefined);
      if (answer === undefined) return;
      if (answer === '\0back') { step = 0; continue; }
      if (step === 0) owner = answer; else relay = answer;
      step++;
    }
  }
  const values: Record<string,string> = { owner, relay };
  if (secret) {
    const key = await screen.input('Import owner key\nMatching private key (64 hex characters) · OS credential store', '', true);
    if (key === undefined) return;
    values.secret = key;
  }
  // Buzz-key sign-in carries no extra Beehive prompt: selecting the action is
  // itself the explicit gesture (an OS keychain permission dialog is separate
  // and still applies), so the request dispatches immediately. The saved-key
  // and import paths keep their confirmation.
  if (action !== 'signin-buzz') {
    const confirmation = `${action === 'configure' ? 'Configure this computer' : 'Sign in'}\nOwner: ${shortIdentity(owner)}\nRelay: ${relay}\n${action === 'configure' ? 'Create host identity in the OS credential store?' : 'Access owner key in the OS credential store?'}`;
    if (!await screen.confirm(confirmation)) { delete values.secret; return; }
  }
  await request(action, values); delete values.secret;
}
async function registerForm(continuation?: string, agent?: string) {
  let secret = '', settled = false;
  try {
    const runtimes = snapshot.settings?.runtimes ?? [];
    if (!runtimes.length) { screen.notice('Add a provider and runtime in Harnesses, then Start again.'); return; }
    const labels = runtimes.map(r => `${r.name} · ${r.model} · ${r.id}`);
    const choice = await screen.choose('Runtime',labels); if (choice === undefined) return;
    const runtime = runtimes[labels.indexOf(choice)]; if (!runtime) return;
    const answer = await screen.input(`Register agent${agent ? `\n${agent}` : ''}\nMatching nsec. Hidden. Saved in Beehive’s OS credential store.`, '', true);
    if (answer === undefined) return; secret = answer;
    const result = await request('profile-preview',{secret,...(continuation ? {continuation} : {})});
    if (result.state !== 'completed') { settled = true; return; }
    const preview = snapshot.profilePreview; if (!preview) return;
    if (!await screen.confirm(`Register agent\n${preview.profile?.name ?? 'Name unavailable'}\n${preview.publicKey}\n${preview.profileState === 'unavailable' ? 'Profile unavailable; public key verified locally.' : preview.profileState === 'none' ? 'No relay profile found.' : ''}\nRuntime: ${runtime.name}\nHarness: ${runtime.harness} · Model: ${runtime.model}\nProvider: ${snapshot.settings?.providers.find(p => p.id === runtime.providerId)?.name ?? 'Unknown'}\nEffort: ${runtime.effort ?? 'Inherit'} · Environment: ${Object.keys(runtime.environment ?? {}).join(', ') || 'None'}\n${continuation ? 'Register and continue Start on the selected host?' : 'Save registration?'}`)) return;
    await request('register-agent',{secret,runtime:runtime.id,...(continuation ? {continuation} : {})}); settled = true;
  } finally { secret = ''; if (continuation && !settled) await request('retire-continuation'); }
}
function eligibility(action: string) {
  const row = snapshot.agents.find(r => r.id === selected);
  if (!snapshot.owner) return 'Owner sign-in required.';
  if (!row?.disabled) return 'Select an agent.';
  return row.disabled[action] || (action === 'select-config' && !row.configurations.length ? 'The host reported no saved configurations.' : undefined);
}
function render() {
  screen.setOwner(snapshot.owner?.slice(-12));
  const rows = sectionRows(snapshot, scope);
  selected = navigation.selection(rows);
  const vanished = !!selected && !rows.some(row => row.id === selected);
  const ownerRelay = scope === 1 && snapshot.owner ? snapshot.routing?.relay : undefined;
  screen.setRelay(ownerRelay ?? snapshot.hostRelay ?? snapshot.routing?.relay, ownerRelay ? snapshot.managementRelay ?? 'unknown' : snapshot.service?.relay ?? 'unknown', ownerRelay && snapshot.hostRelay && ownerRelay !== snapshot.hostRelay ? undefined : snapshot.relayName);
  const configured = snapshot.local.some(r => r.id === 'host');
  const registerAction: ManagerAction = { label: 'Register agent', run: async () => {
      if (!configured) { await routing('configure'); return; }
      await registerForm();
    } };
  let actions: ManagerAction[] = scope !== 1 ? [
    { label: 'Add provider', run: async () => {
      await request('provider-form');
      const type = await screen.choose('Add provider',['OpenAI','Anthropic','OpenAI-compatible','OpenRouter','Databricks v2']); if (!type) return;
      if (type === 'Databricks v2') {
        const endpoint = await screen.input('Databricks workspace URL',snapshot.databricksHost ?? ''); if (!endpoint) return;
        const name = await screen.input('Provider name','Databricks'); if (!name) return;
        if (await screen.confirm(`Sign in to provider\n${name}\nBrowser sign-in · Tokens saved in the OS credential store`)) await request('add-databricks',{ name,endpoint });
        return;
      }
      const providerType = type === 'Anthropic' ? 'anthropic' : type === 'OpenRouter' ? 'openrouter' : type === 'OpenAI-compatible' ? 'openai-compat' : 'openai';
      const endpoint = providerType === 'openai-compat' ? await screen.input('HTTPS endpoint') : providerType === 'anthropic' ? 'https://api.anthropic.com' : providerType === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1'; if (!endpoint) return;
      const wire = providerType === 'openai-compat' ? await screen.choose('API',['auto','chat','responses']) : undefined; if (providerType === 'openai-compat' && !wire) return;
      const name = await screen.input('Provider name',type); if (!name) return;
      let secret = await screen.input(`Provider API key\n${type} · Hidden · OS credential store`,'',true); if (!secret) return;
      if (await screen.confirm(`Save provider\n${name}`)) await request('add-provider',{ name, secret, type:providerType, endpoint, ...(wire ? {wire} : {}) });
      secret = '';
    } },
    { label: 'Add runtime', run: () => runtimeForm(screen, () => snapshot, request) },
    { label: 'Start', disabled: snapshot.service?.state === 'unknown' ? 'Host ownership is unknown. No process will be adopted.' : undefined, run: async () => {
      if (!configured) { await routing('configure'); return; }
      if (await screen.confirm('Start host\nLocal host service · Keeps running when you quit')) await request('host-start');
    } },
    { label: 'Stop', disabled: snapshot.service?.state !== 'running' ? 'A verified running host instance is required.' : undefined, run: async () => {
      const instance = snapshot.service?.instance; if (!instance) return;
      if (await screen.confirm('Stop host\nStop this host and its running agents?')) await request('host-stop',{ instance });
    } },
  ] : snapshot.owner ? [
    { label: 'Refresh agents', run: () => request('directory-refresh') },
    { label: 'Choose runtime…', disabled: eligibility('select-config'), run: async () => {
      const row = snapshot.agents.find(r => r.id === selected); if (!row) return;
      const runtimes = snapshot.settings?.runtimes ?? [];
      const labels = runtimes.map(r => `${r.name} · ${r.model} · ${r.id}`);
      const choice = await screen.choose('Runtime for next start',labels); if (choice === undefined) return;
      const runtime = runtimes[labels.indexOf(choice)]; if (!runtime) return;
      if (await screen.confirm(`Save runtime\n${runtime.name} · Next Start\n${targetNames(row)}`)) await request('select-runtime',{runtime:runtime.id},row.target,row.revision);
    } },
    { label: 'Choose configuration…', disabled: eligibility('select-config'), run: async () => {
      const row = snapshot.agents.find(r => r.id === selected); if (!row) return;
      const name = await screen.choose('Configuration for next start', row.configurations); if (name === undefined) return;
      if (!await screen.confirm(`Save configuration\n${name} · Next Start\n${targetNames(row)}\nRevision: ${row.revision}`)) return;
      await request('select-config', { name }, row.target, row.revision);
    } },
    ...(['start','stop','restart'] as const).map(action => ({ label: action[0]!.toUpperCase() + action.slice(1), disabled: eligibility(action), run: async () => {
      const row = snapshot.agents.find(r => r.id === selected); if (!row) return;
      if (!await screen.confirm(`${action[0]!.toUpperCase() + action.slice(1)} agent?\n${targetNames(row, action === 'start')}\nRevision: ${row.revision}`)) return;
      const result = await request(action, undefined, action === 'start' ? row.startTarget ?? row.target : row.target, action === 'start' ? row.startRevision ?? row.revision : row.revision);
      if (result.state === 'registration-required') await registerForm(result.continuation,result.agent);
    } })),
    { label: 'Move…', disabled: eligibility('move'), run: async () => {
      const row = snapshot.agents.find(r => r.id === selected); if (!row) return;
      const destinations = row.destinations ?? [];
      if (!destinations.length) { screen.notice('No destination hosts. Configure and start another host for this owner and relay, then Refresh.'); return; }
      const labels = destinations.map(d => `${d.label}${d.reason ? ' · Setup required' : ''}`);
      const chosen = await screen.choose('Move · destination host / runtime',labels); if (chosen === undefined) return;
      const destination = destinations[labels.indexOf(chosen)]; if (!destination) return;
      if (destination.reason) { screen.notice(destination.reason); return; }
      if (!await screen.confirm(`Move agent\n${targetNames(row)}\nDestination: ${destination.label}
The source stops before destination launch. Workspace, session and credentials stay on their hosts.`)) return;
      await request('move',{destination:destination.target,destinationRevision:String(destination.revision)},row.target,row.revision);
    } },
    { label: 'Inspect operations', run: () => request('operations') },
    { label: 'Check operation results', run: () => request('reconcile') },
    { label: 'Sign out', run: () => request('signout') },
    { label: 'Publish profile or instructions', run: () => screen.notice('Publication forms are unavailable. Use the CLI:\nbeehive drafts ~/.beehive/owner\nbeehive tui discover <relay> ~/.beehive/owner\nThis build cannot generate owner keys.') },
  ] : [
    { label: 'Sign in with Buzz key', run: () => routing('signin-buzz') },
    { label: 'Sign in with saved owner key', run: () => routing('signin') },
    { label: 'Import matching owner key and sign in', run: () => routing('signin', true) },
  ];
  if (scope === 0) actions = actions.filter(a => a.label === (snapshot.service?.state === 'running' ? 'Stop' : 'Start'));
  if (scope === 1) actions.unshift(registerAction);
  if (scope === 2) actions = [
    ...actions.filter(a => a.label === 'Add runtime'),
    { label: 'Refresh', run: () => request('runtime-form') },
  ];
  if (scope === 3) actions = [
    ...actions.filter(a => a.label === 'Add provider'),
    { label: 'Models', disabled: rows.some(r => r.id === selected) ? undefined : 'Select provider', run: async () => {
      const provider = selected;
      await request('models', { provider });
      if (snapshot.models) await screen.choose('Models', snapshot.models.map(id=>snapshot.modelLabels?.[id] && snapshot.modelLabels[id] !== id ? `${snapshot.modelLabels[id]} · ${id}` : id));
    } },
  ];
  if (scope !== 0) actions.push({ label: 'Quit Beehive', run: () => screen.close() });
  screen.show(vanished ? [{ id: selected, label: 'Selection unavailable', detail: 'Unavailable' }, ...rows] : rows, actions, selected);
  const notice = scope === 0 ? `Host: ${snapshot.service?.state ?? 'unknown'} · Saved: ${snapshot.settings?.revision ?? 0} · Loaded: ${snapshot.service?.revision ?? 'not confirmed'}\n${snapshot.status}` : snapshot.status;
  if (lastStatus !== notice) { lastStatus = notice; screen.notice(notice); }
}
screen.onScope = value => { navigation.switch(value); scope = navigation.section; render(); if (scope === 2 && !snapshot.harnesses) void request('runtime-form'); };
screen.onSelect = id => { if (selected !== id) { navigation.select(id); selected = id; render(); } };
const input = createInterface({ input: createReadStream('', { fd: 3 }) });
input.on('line', line => {
  try {
    const value = JSON.parse(line);
    if (value.snapshot) { snapshot = value.snapshot; render(); }
    if (value.complete === pending?.id) { const old = pending; pending = undefined; screen.setPending(false); old?.resolve(value.result ?? { state: 'failed', reason: 'Missing controller result.' }); }
  } catch { screen.notice('Beehive could not read the response. Quit and inspect saved operation records before you try again.'); }
});
input.on('close', () => screen.close());
screen.onCancel = () => { if (pending) output.write(JSON.stringify({ cancel: pending.id }) + '\n'); };
await screen.done;
output.end(JSON.stringify({ quit: true }) + '\n'); input.close();
process.exit(0);
