import { hash, selection } from './handoff.ts';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchRelayDirectory, type DirectoryAgent } from './relay-directory.ts';
import { runtimeEnvironment } from './runtime-environment.ts';
import { addDatabricks, databricksNative } from './databricks.ts';
import { existsSync } from 'node:fs';
import { readSettings, saveSettings, settingsId, type Settings, type RegisteredAgent } from './settings.ts';
import { agentNsec } from './settings-credentials.ts';
import { publicKey } from './protocol.ts';
import { fetchAgentProfile } from './agent-profile.ts';
import { serviceStatus, startService, stopService, type ServiceStatus } from './host-service.ts';
import { discoverHarnesses, type DetectedHarness } from './harness-discovery.ts';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { managerCredential } from './manager-credential.ts';
export { managerCredential } from './manager-credential.ts';
import { readHostIdentityPublic } from './host-identity.ts';
import { createControllerConfig, readControllerConfig } from './controller-config.ts';
import { ownerPublicInput } from './host-setup.ts';
import { managementClient } from './intents.ts';
import { fetchRelayName } from './relay-name.ts';
import { message, type Message } from './protocol.ts';
import { profileDrafts, editProfileDraft } from './profile-drafts.ts';

/** Controller completion is not a host receipt: submitted work remains pending. */
export type ManagerResult =
  | { state: 'completed' }
  | { state: 'submitted'; operationId: string }
  | { state: 'registration-required'; continuation: string; agent: string }
  | { state: 'failed' | 'cancelled' | 'ignored'; reason: string };

export type ManagerRequest = { id: number; action: string; values?: Record<string, string>; target?: string; revision?: number };
export type ManagerItem = { startTarget?: string; startRevision?: number; target?: string; id: string; label: string; detail: string; evidence?: string; disabled?: Record<string, string> };
export type MoveDestination = { target: string; revision: number; label: string; reason?: string };
export type ManagerSnapshot = { managementRelay?: 'connected' | 'disconnected'; diagnostics?: ManagerItem[]; local: ManagerItem[]; agents: (ManagerItem & { revision: number; configurations: string[]; destinations?: MoveDestination[] })[]; routing?: { owner: string; relay: string }; owner?: string; status: string; settings?: Settings; service?: ServiceStatus; hostRelay?: string; relayName?: string; profilePreview?: RegisteredAgent; models?: string[]; runtimeExecutable?: string; harnesses?: DetectedHarness[]; databricksHost?: string };
const short = (s: string) => s.length > 22 ? `${s.slice(0,8)}…${s.slice(-6)}` : s;

/** Final plain display text thrown by this boundary; never rewrapped or retranslated. */
class PlainStatus extends Error {}
const plain = (text: string) => new PlainStatus(text);
/** Shared backend validation/protocol sentinels are translated here, at the manager
 * display boundary only. Legacy CLI text, tests and result sentinels stay exact;
 * unknown diagnostics are retained after a plain failure context, never replaced. */
const backendMessages: Record<string, string> = {
  'Unsupported Beehive controller configuration': 'Saved Beehive configuration uses an unsupported version.',
  'Invalid retained management relay URL': 'The saved relay URL is invalid.',
  'Controller already configured; use Settings for deliberate changes': 'Owner and relay are already configured. They cannot be changed in this view.',
  'Management relay requires wss:// (ws://127.0.0.1 for fixtures)': 'Enter a relay URL that starts with ws:// or wss://.',
  'Owner PUBLIC npub or 64-character hex key required; never enter a private key': 'Enter the owner’s public key as an npub or 64 hex characters. Do not enter a private key.',
  'Legacy identity retained; explicit consent required for migration': 'The saved host identity uses an older format. It has not been changed. Migration requires explicit permission.',
  'Invalid host credential reference': 'The saved host key reference is invalid.',
  'Explicit stopped migrate-slots required': 'This installation needs migration. Stop its agents before you use migrate-slots.',
  'Installation requires 1..32 slots': 'The installation must contain 1 to 32 agent records.',
  'Invalid slot identity': 'An agent record has an invalid identity.',
  'Invalid slot binding': 'An agent record refers to an invalid local setup.',
  'Public slot binding mismatch': 'The saved agent record does not match its host, owner or agent identity.',
  'Shared harness inventory must not copy key material': 'Shared local setups must not contain identity keys.',
  'Binding cannot carry identity': 'A local setup must not contain host or agent identity fields.',
  'Binding cannot change conversation authority': 'A local setup cannot change permission to use the conversation.',
  'Invalid retired binding definition': 'A retired local setup does not match its saved definition.',
  'Public credential installation required; no automatic plaintext migration': 'This installation must use secure key references. Plain-text keys will not be migrated automatically.',
  'Invalid agent credential reference': 'The saved agent key reference is invalid.',
  'Draft directory must be owner-only': 'Only the local user may access the draft folder.',
  'Draft storage exceeds limit': 'The draft file exceeds the size limit.',
  'Invalid draft storage': 'The saved draft file is invalid.',
  'Invalid draft identity': 'A saved draft has an invalid or duplicate ID.',
  'Draft changed; resume again': 'The draft changed. Open it again before you edit.',
  'Draft storage full; discard unused drafts': 'Draft storage is full. Discard unused drafts through beehive drafts.',
  'Invalid profile name/parent': 'The instructions name or previous revision is invalid. Do not use default as the name.',
  'Invalid nonsecret instructions': 'Enter instructions of no more than 2048 UTF-8 bytes. Do not use control characters.',
  'Profile revision conflict': 'The instructions do not match their revision.',
  'Management journal directory must be owner-only': 'Only the local user may access the operation records folder.',
  'Management journal full': 'Operation storage is full.',
  'Management journal full; no operation submitted': 'Operation storage is full. No operation was submitted.',
  'Oversized intent': 'A saved operation request exceeds the size limit.',
  'Oversized receipt': 'A saved host result exceeds the size limit.',
  'Oversized blocked intent': 'A saved blocked request exceeds the size limit.',
  'Wrong journal scope': 'Saved operation records do not match this owner and relay.',
  'Invalid intent': 'A saved operation request is invalid.',
  'Unmatched journal receipt': 'A saved host result does not match its operation.',
  'Invalid blocked intent': 'A saved blocked request is invalid.',
  'Unmatched durable receipt': 'A saved host result does not match its operation.',
  'Operation ID already prepared': 'This operation ID is already saved.',
  'UI closed': 'Beehive is closed.',
  'Relay disconnected; result unknown': 'The relay disconnected. The operation result is unknown.',
};
const plainBackendMessage = (message: string) => backendMessages[message] ?? `Could not complete the operation: ${message}`;

/** Raw management values keep their exact protocol/evidence bytes; only the default
 * summary gets plain labels. Unknown nested fields stay technical, never discarded. */
const plainValues: Record<string, string> = {
  'immutable publication observed; no agent application': 'Private instructions published. Not applied to an agent.',
  'host terminal receipt': 'Host result received.',
  'relay policy failure; automatic retry disabled; reconcile, then retry after policy repair': 'Relay policy blocked the operation. Automatic retry is disabled. Check operation results. Correct the policy problem before you retry through the CLI.',
  'relay observed; not host admission': 'Relay publication confirmed. Host acceptance not confirmed.',
  'unconfirmed': 'Not confirmed.',
  'accepted': 'Accepted by host.',
  'saved; running configuration unchanged': 'Configuration saved. Current run unchanged.',
  'interrupted-reconcile-locally': 'Operation interrupted. Result unknown. Inspect and repair the saved state on the host before you try again.',
};
const plainStates: Record<string, string> = { pending: 'Pending', completed: 'Completed', failed: 'Failed', unknown: 'Unknown' };
const plainTypes: Record<string, string> = { enroll: 'Enroll locally', 'authorize-move': 'Authorize destination', start: 'Start', stop: 'Stop', restart: 'Restart', move: 'Move', metadata: 'Publish profile', profile: 'Publish instructions' };
const plainOperationType = (request: Message) => request.type === 'save' && request.body.configurationAction === 'select' ? 'Choose configuration' : plainTypes[request.type] ?? request.type;
const operationText = (value: unknown) => typeof value === 'string' ? plainValues[value] ?? value : describe(value);
/** Named launch choice: the model/workspace/instruction selection of one agent. */
const selectionLabels: Record<string, string> = {
  'model': 'Model', 'workspace': 'Workspace', 'profile': 'Instructions revision',
  'harnessSetup.id': 'Local setup', 'harnessSetup.fingerprint': 'Local setup fingerprint',
  'configuration.name': 'Configuration name', 'configuration.revision': 'Configuration revision',
  'behavior.name': 'Instructions name', 'behavior.instructions': 'Private instructions',
  'behavior.revision': 'Instructions revision', 'behavior.parent': 'Previous instructions revision',
};
const runLabels: Record<string, string> = { ...selectionLabels, ...Object.fromEntries(Object.entries(selectionLabels).map(([key, value]) => [`selection.${key}`, value])) };
/** Host availability pairing: host infrastructure, not agent configuration. */
const availabilityLabels: Record<string, string> = {
  'configuration': 'Host configuration', 'configuration.host': 'Host', 'configuration.owner': 'Owner',
  'configuration.relay': 'Relay', 'configuration.label': 'Host name', 'configuration.observedAt': 'Report time', 'observedAt': 'Report time',
};
/** These containers hold only labelled choice fields; their children speak alone. */
const inlineChoice = new Set(['harnessSetup', 'configuration', 'behavior', 'selection', 'selection.harnessSetup', 'selection.configuration', 'selection.behavior']);
const describe = (v: unknown, labels: Record<string, string> = {}, path = ''): string => {
  if (v === undefined || v === null) return 'Not reported';
  if (typeof v !== 'object') {
    if (typeof v !== 'string') return String(v);
    if ((path === 'profile' || path.endsWith('.profile')) && v === 'default') return 'Default instructions';
    return /^[0-9a-f]{32,}$/i.test(v) ? short(v) : v;
  }
  if (!Object.keys(v).length) return 'Not reported';
  return Object.entries(v).map(([k, value]) => {
    const child = path ? `${path}.${k}` : k;
    const rendered = describe(value, labels, child);
    if (labels !== availabilityLabels && inlineChoice.has(child) && value !== null && !Array.isArray(value) && typeof value === 'object') return rendered;
    return `${labels[child] ?? k}: ${rendered}`;
  }).join('\n');
};

/** Domain controller stays on Node. Existing management intent journal owns remote
 * operation identity, CAS, receipts, reconnect and unknown outcomes. */
export class ManagerController {
  private client?: ReturnType<typeof managementClient>;
  private inventory = new Map<string, Message>();
  private directory: DirectoryAgent[] = [];
  private directoryState = 'Sign in to load the relay directory.';
  private directoryRead: typeof fetchRelayDirectory;
  private profileRead: typeof fetchAgentProfile;
  private offers = new Map<string, Message>();
  private owner?: string;
  private generation = 0;
  private active?: AbortController;
  private continuation?: { enroll?: boolean; token: string; agent: string; target: string; revision: number; settingsRevision: number; owner: string };
  private closed = false;
  private service: ServiceStatus = { state: 'unknown' };
  private probing = false;
  private profilePreview?: RegisteredAgent;
  private models?: string[];
  private runtimeExecutable?: string;
  private harnesses?: DetectedHarness[];
  private databricksHost?: string;
  private lastId = 0;
  private relayName?: { relay: string; name?: string };
  private relayNamePending?: { relay: string; abort: AbortController };
  private status = 'Local Host does not require owner sign-in. Quitting or signing out does not stop hosts or agents.';
  readonly home: string;
  readonly changed: (snapshot: ManagerSnapshot) => void;
  private credential: typeof managerCredential;
  private connect: typeof managementClient;
  private fetchName: typeof fetchRelayName;
  constructor(home: string, changed: (snapshot: ManagerSnapshot) => void,
    credential = managerCredential, connect = managementClient, fetchName = fetchRelayName, directoryRead = fetchRelayDirectory, profileRead = fetchAgentProfile) {
    this.home = home; this.changed = changed; this.credential = credential; this.connect = connect; this.fetchName = fetchName; this.directoryRead = directoryRead; this.profileRead = profileRead;
  }
  private get hostDirectory() { return join(this.home, '.beehive', 'host'); }
  private get ownerDirectory() { return join(this.home, '.beehive', 'owner'); }
  snapshot(): ManagerSnapshot {
    const local: ManagerSnapshot['local'] = [];
    try {
      if (existsSync(join(this.hostDirectory, 'host-identity.json'))) {
        const identity = readHostIdentityPublic(this.hostDirectory);
        local.push({ id: 'host', label: identity.pairing.label, detail: 'Host configured. Agent registration is not execution authority.' });
      } else local.push({ id: 'missing', label: 'Configure this computer', detail: 'No local host configuration. Save the owner’s public key and relay URL. Beehive creates a host identity in the secure credential store. No owner sign-in is needed. This does not create an agent or start a host.' });
    } catch (error) { local.push({ id: 'error', label: 'Saved configuration needs attention', detail: (error instanceof Error ? backendMessages[error.message] ?? `Could not read saved configuration: ${error.message}` : `Could not read saved configuration: ${String(error)}`) + '\nSaved data has not been reset.' }); }
    const reports: ManagerSnapshot['agents'] = [...this.inventory].map(([id, m]) => {
      const fresh = this.fresh(m);
      const blocked = !fresh ? 'The host report is old or the host cannot be reached. Wait for a recent report before you act.' : this.client?.status().some(o => o.request.host === m.host && o.request.agent === m.agent && !['completed','failed'].includes(o.state)) ? 'An operation has no confirmed result. Inspect operations before you act.' : '';
      return { id, label: `Agent ${short(m.agent)} · ${fresh ? m.body.phase : 'Unknown'}`, revision: m.revision, configurations: Object.keys((m.body.configurations ?? {}) as object),
        disabled: { move: blocked || (m.body.assignedHost !== m.host || !['stopped','running'].includes(String(m.body.phase)) ? 'Move requires the assigned host.' : ''), 'select-config': blocked, stop: blocked, restart: blocked || (m.body.assignedHost !== m.host || !['stopped', 'running'].includes(String(m.body.phase)) ? 'Restart requires a recent report from the assigned host.' : ''), start: blocked || (m.body.phase !== 'stopped' || m.body.actualRun || m.body.assignedHost !== m.host ? 'Start requires a recent report from the assigned host. It must report the agent stopped with no current run.' : '') },
        evidence: JSON.stringify(m, null, 2), detail: `Agent ${short(m.agent)}
Host ${short(m.host)}
${fresh ? 'Recent host report' : 'Current status unknown. The report is old or the host cannot be reached. Last report:'}
Reported status: ${m.body.phase}
Assigned host: ${m.body.assignedHost === m.host ? 'Assigned to this host' : 'Not assigned to this host'}

Current run (host report)
${m.body.actualRun ? describe(m.body.actualRun, runLabels) : 'No current run in this report'}

Configuration for next start
${describe(m.body.selectedNext, selectionLabels)}
This choice does not change the current run.` };
    });
    const agents: ManagerSnapshot['agents'] = this.directory.map(agent => {
      const report = this.agentReport(agent.publicKey);
      const shown = report ? reports.find(row => row.id === JSON.stringify([report.host,report.agent])) : undefined;
      let registered = false;
      try { registered = readSettings(this.hostDirectory).agents.some(a => a.publicKey === agent.publicKey); } catch { /* Configuration error is shown in Local Host. */ }
      const local = this.localEnrollmentTarget(agent.publicKey);
      const unavailable = 'No unique assigned host report. Execution authority is unknown.';
      return { startTarget: local, startRevision: local ? -1 : undefined, destinations: report ? this.moveDestinations(report) : [], id:agent.publicKey,target:shown?.id,label:`${agent.name} · ${shown ? this.fresh(report!) ? report!.body.phase : 'Unknown' : 'Unknown'}`,revision:shown?.revision ?? -1,configurations:shown?.configurations ?? [],disabled: { ...(shown?.disabled ?? { start:unavailable,stop:unavailable,restart:unavailable,move:unavailable,'select-config':unavailable }), ...(local ? {start:''} : {}) },evidence:JSON.stringify({ discovery:agent,report },null,2),detail:`${agent.name}
Agent: ${agent.publicKey}
Registered here: ${registered ? 'Yes' : 'No'}
Relay presence: ${agent.status} (discovery only)
Profile owner: ${agent.owner ?? 'Unknown'}
${shown?.detail ?? 'Host: Unknown\nRunning state: Unknown'}
Relay metadata is not execution authority.` };
    });
    const diagnostics: ManagerItem[] = [];
    for (const [id, m] of this.offers) diagnostics.push({ id: `host:${id}`, label: `Host ${short(id)}`, evidence: JSON.stringify(m, null, 2), detail: `Host report
Host ${short(id)}
${this.fresh(m) ? 'Recent host report' : 'Current status unknown. The report is old or the host cannot be reached.'}
${describe(m.body, availabilityLabels)}
A host report does not grant permission to start an agent.` });
    for (const operation of this.operationStatus()) diagnostics.push({ id: `operation:${operation.request.id}`, label: `${plainOperationType(operation.request)} · ${plainStates[operation.state] ?? operation.state} · ${operation.request.id.slice(0,8)}`, evidence: JSON.stringify(operation, null, 2), detail: `Operation: ${plainOperationType(operation.request)}
State: ${plainStates[operation.state] ?? operation.state}
Host: ${short(operation.request.host)}
Agent: ${short(operation.request.agent)}
Revision when requested: ${operation.request.revision}
Relay status: ${operationText(operation.publication)}
${operation.request.type === 'profile' ? 'Result' : 'Host result'}: ${operationText(operation.result)}

Relay publication does not confirm that the host accepted the operation.
If the result is unknown, check operation results before you submit again.
A Stop result is not a recent host report that confirms the agent is stopped.` });
    let routing: ReturnType<typeof readControllerConfig>;
    try { routing = readControllerConfig(this.ownerDirectory); } catch { /* Invalid retained routing is refused by sign-in; never reset here. */ }
    let settings: Settings | undefined, hostRelay: string | undefined;
    try { settings = readSettings(this.hostDirectory); if (existsSync(join(this.hostDirectory,'host-identity.json'))) hostRelay = readHostIdentityPublic(this.hostDirectory).pairing.relay; } catch { /* Existing error row remains actionable; never reset settings. */ }
    const footerRelay = hostRelay ?? routing?.relay;
    this.observeRelayName(footerRelay);
    return { managementRelay:this.owner ? this.client?.connected ? 'connected' : 'disconnected' : undefined, settings, service: this.service, hostRelay, relayName: this.relayName && this.relayName.relay === footerRelay ? this.relayName.name : undefined, profilePreview: this.profilePreview, models: this.models, runtimeExecutable: this.runtimeExecutable, harnesses: this.harnesses, databricksHost: this.databricksHost, local, agents, diagnostics, routing: routing ? { owner: routing.owner, relay: routing.relay } : undefined, owner: this.owner, status: this.status + (this.owner ? `\n${this.directoryState}` : '') };
  }

  private moveDestinations(source: Message): MoveDestination[] {
    return [...this.offers.values()].filter(m => m.host !== source.host).map(offer => {
      const target = JSON.stringify([offer.host,source.agent]), report = this.inventory.get(target);
      const label = String((offer.body.configuration as {label?:string})?.label ?? short(offer.host));
      let reason: string | undefined;
      if (!this.fresh(offer) || !report || !this.fresh(report)) reason = `On ${label}, register this agent with a local runtime, use local Start to enroll it, then Stop and Refresh. No credentials are transferred.`;
      else if (report.body.localKey !== 'present') reason = `On ${label}, stop its host service and run beehive import-agent-key <host-directory> ${source.agent}. Enter the matching key only there, restart that host and Refresh. Source will not stop.`;
      else if (report.body.phase !== 'stopped' || report.body.actualRun) reason = 'Destination is not an eligible stopped standby.';
      const selected = report?.body.selectedNext as {harnessSetup?:{id:string}; model?:string} | undefined;
      return {target,revision:report?.revision ?? -1,label:`${label} · ${selected?.harnessSetup?.id ?? 'default runtime'} · ${selected?.model ?? 'setup required'}`,reason};
    });
  }
  private operationStatus() { return this.client?.status() ?? []; }

  private localEnrollmentTarget(agent: string) {
    if (!this.owner || !existsSync(join(this.hostDirectory,'host-identity.json'))) return;
    const pairing = readHostIdentityPublic(this.hostDirectory).pairing;
    const target = JSON.stringify([pairing.host,agent]);
    const offer = this.offers.get(pairing.host);
    if (pairing.owner !== this.owner || !offer || !this.fresh(offer) || this.inventory.has(target) || !this.directory.some(a => a.publicKey === agent && a.owner === this.owner)) return;
    if (this.client?.status().some(o => o.request.host === pairing.host && o.request.agent === agent && !['completed','failed'].includes(o.state))) return;
    return target;
  }
  private agentReport(agent: string) {
    const rows = [...this.inventory.values()].filter(m => m.agent === agent && m.body.assignedHost === m.host);
    const local = existsSync(join(this.hostDirectory,'host-identity.json')) ? readHostIdentityPublic(this.hostDirectory).pairing.host : undefined;
    return rows.find(m => m.host === local) ?? (rows.length === 1 ? rows[0] : undefined);
  }
  private fresh(m: Message) { return Boolean(this.client?.connected && Date.now() - Number(m.body.observedAt) <= 6000); }
  /** Optional bounded footer relay name. One attempt per configured relay URL; absence,
   * failure or cancellation only omits the name. It never changes the reported
   * connection state, blocks the UI, resets configuration or invents a name, and a
   * late or stale completion is never applied to a different relay. */
  private observeRelayName(relay: string | undefined) {
    if (this.closed) return;
    if (this.relayName?.relay === relay || this.relayNamePending?.relay === relay) return;
    this.relayNamePending?.abort.abort();
    this.relayNamePending = undefined;
    this.relayName = undefined;
    if (!relay) return;
    const pending = { relay, abort: new AbortController() };
    this.relayNamePending = pending;
    void Promise.resolve().then(() => this.fetchName(relay, pending.abort.signal)).catch(() => undefined).then(name => {
      if (this.closed || this.relayNamePending !== pending) return;
      this.relayNamePending = undefined;
      this.relayName = { relay, name };
      if (!this.closed) this.changed(this.snapshot());
    });
  }
  refresh() {
    if (this.closed) return;
    this.changed(this.snapshot());
    if (!this.probing) {
      this.probing = true;
      void serviceStatus(this.hostDirectory).then(status => { this.service = status; if (!this.closed) this.changed(this.snapshot()); }).finally(() => { this.probing = false; });
    }
  }
  cancel() { this.continuation = undefined; this.generation++; this.active?.abort(); }
  close() { this.closed = true; this.cancel(); this.relayNamePending?.abort.abort(); this.client?.close(); this.client = undefined; this.owner = undefined; this.directory = []; }
  async request(request: ManagerRequest): Promise<ManagerResult> {
    if (this.closed || request.id <= this.lastId || this.active) return { state: 'ignored', reason: 'Request is closed, duplicate, or busy.' };
    this.lastId = request.id;
    const abort = new AbortController(); this.active = abort;
    const generation = ++this.generation;
    const check = () => { abort.signal.throwIfAborted(); if (this.closed || generation !== this.generation) throw plain('Stopped waiting. Changes may already be saved or submitted. Inspect before you try again.'); };
    const v = request.values ?? {};
    let result: ManagerResult = { state: 'completed' };
    try {
      if (request.action === 'retire-continuation') {
        this.continuation = undefined; this.profilePreview = undefined; this.status = 'Start cancelled. Saved credentials, if any, remain retained.';
      } else if (request.action === 'profile-preview') {
        this.profilePreview = undefined;
        const identity = readHostIdentityPublic(this.hostDirectory);
        const key = publicKey(agentNsec(v.secret ?? ''));
        if ((this.continuation || v.continuation) && (this.continuation?.token !== v.continuation || this.continuation?.agent !== key)) throw plain('The key does not match the selected agent. Start cancelled.');
        const profile = await this.profileRead(identity.pairing.relay,key,abort.signal); check();
        this.profilePreview = { publicKey: key, key: { service: 'beehive', role: 'agent', publicKey: key }, ...profile };
        this.status = profile.profileState === 'found' ? 'Signed public profile found.' : profile.profileState === 'none' ? 'No profile found. You can register with the public key.' : 'Profile lookup unavailable. You can register without a profile.';
      } else if (request.action === 'register-agent') {
        const key = publicKey(agentNsec(v.secret ?? ''));
        const pending = this.continuation;
        if ((pending || v.continuation) && (!pending || pending.token !== v.continuation || pending.agent !== key)) throw plain('Start selection changed. No operation was sent.');
        if (this.profilePreview?.publicKey !== key) throw plain('Confirm the public key first.');
        const settings = readSettings(this.hostDirectory), runtime = settings.runtimes.find(r => r.id === v.runtime);
        if (!runtime) throw plain('Select a saved runtime.');
        if (pending?.enroll) {
          if (settings.revision !== pending.settingsRevision || this.localEnrollmentTarget(key) !== pending.target) throw plain('Local enrollment selection changed. Start again.');
        } else if (pending) {
          const report = this.agentReport(key);
          if (settings.revision !== pending.settingsRevision || !report || !this.fresh(report) || JSON.stringify([report.host,report.agent]) !== pending.target || report.revision !== pending.revision || report.body.phase !== 'stopped' || report.body.actualRun) throw plain('Settings or host selection changed. Start again.');
        }
        const { profile, profileState } = this.profilePreview;
        await this.credential({ action: 'register-agent', directory: this.hostDirectory, secret: v.secret, profile: { profile, profileState }, runtimeId:runtime.id, expectedRevision:settings.revision },abort.signal); check();
        this.profilePreview = undefined;
        if (!pending) this.status = 'Agent and runtime registered. Not assigned or started.';
        else {
          const guard = () => {
            check();
            if (this.continuation !== pending || this.owner !== pending.owner || !this.directory.some(a => a.publicKey === pending.agent)) throw plain('Start selection changed. Inspect saved registration.');
            const registered = readSettings(this.hostDirectory).agents.find(a => a.publicKey === pending.agent);
            if (!registered) throw plain('Registration was not verified. No Start sent.');
          };
          if (pending.enroll) {
            guard();
            if (this.localEnrollmentTarget(key) !== pending.target) throw plain('Local enrollment target changed. No Start sent.');
            const [host] = JSON.parse(pending.target) as [string,string];
            const enroll = message('enroll',host,pending.agent,0,{runtime:runtime.id,settingsRevision:readSettings(this.hostDirectory).revision});
            this.client!.submit(enroll);
            let enrolled = false;
            for (let n=0;n<100;n++) {
              guard();
              const operation = this.client!.status().find(o => o.request.id === enroll.id);
              if (!operation || ['failed','unknown'].includes(operation.state)) throw plain('Local enrollment failed or is unknown. Inspect operations before retrying.');
              if (operation.state === 'completed' && this.inventory.has(pending.target)) { enrolled = true; break; }
              await delay(100,undefined,{signal:abort.signal});
            }
            if (!enrolled) throw plain('Enrollment submitted; Start not sent. Inspect operations.');
            pending.revision = 0;
          }
          const current = () => { guard(); const m = this.inventory.get(pending.target); if (!m || JSON.stringify([m.host,m.agent]) !== pending.target || !this.fresh(m) || m.body.phase !== 'stopped' || m.body.actualRun) throw plain('Host assignment or running state changed. No Start sent.'); return m; };
          let report = current();
          if (report.revision !== pending.revision) throw plain('Host revision changed. No Start sent.');
          let binding: { id: string; fingerprint: string } | undefined;
          // Local catalog loading is not assumed from an OS key write or Save.
          for (let n=0;n<100;n++) {
            report = current(); if (report.revision !== pending.revision) throw plain('Host revision changed. No Start sent.');
            binding = (report.body.harnessSetups as {id:string;fingerprint:string}[] | undefined)?.find(b => b.id === `runtime:${runtime.id}`);
            if (binding) break;
            await delay(100,undefined,{signal:abort.signal});
          }
          if (!binding) throw plain('Runtime is saved but not loaded by the host. No Start sent.');
          const noPending = () => { if (this.client!.status().some(o => o.request.host === report.host && o.request.agent === report.agent && !['completed','failed'].includes(o.state))) throw plain('Another operation has no confirmed result. No Start sent.'); };
          noPending();
          const selected = report.body.selectedNext as Record<string,unknown>;
          const save = message('save',report.host,report.agent,report.revision,{ ...selected, model:runtime.model, harnessSetup:{id:binding.id,fingerprint:binding.fingerprint} });
          this.client!.submit(save);
          result = {state:'submitted',operationId:save.id};
          let applied = false;
          for (let n=0;n<100;n++) {
            guard();
            const operation = this.client!.status().find(o => o.request.id === save.id);
            if (!operation || ['failed','unknown'].includes(operation.state)) throw plain('Runtime selection failed or is unknown. No Start sent. Inspect operations.');
            report = current();
            if (operation.state === 'completed' && report.revision === pending.revision+1) {
              const selection = report.body.selectedNext as {model?:string;harnessSetup?:{id?:string;fingerprint?:string}};
              if (selection.model !== runtime.model || selection.harnessSetup?.id !== binding.id || selection.harnessSetup.fingerprint !== binding.fingerprint) throw plain('Selected runtime changed. No Start sent.');
              applied = true; break;
            }
            if (report.revision > pending.revision+1) throw plain('Host revision changed. No Start sent.');
            await delay(100,undefined,{signal:abort.signal});
          }
          if (!applied) this.status = `Runtime selection submitted (${save.id}). Start was not sent. Inspect operations.`;
          else {
            guard(); report = current(); noPending();
            if (report.revision !== pending.revision+1) throw plain('Host revision changed. No Start sent.');
            const start = message('start',report.host,report.agent,report.revision);
            this.client!.submit(start); result = {state:'submitted',operationId:start.id};
            this.status = `Start submitted (${start.id}). Registration and runtime selection verified. Running state awaits a host report.`;
          }
        }
      } else if (request.action === 'provider-form') {
        this.databricksHost = process.env.DATABRICKS_HOST ?? ''; this.status = 'Provider credentials stay in Beehive’s OS store.';
      } else if (request.action === 'add-databricks') {
        await addDatabricks(this.hostDirectory,v.name,v.endpoint,abort.signal); check(); this.status = 'Databricks signed in and saved. No agent was started.';
      } else if (request.action === 'add-openai') {
        await this.credential({ action: 'add-openai', directory: this.hostDirectory, name: v.name, secret: v.secret },abort.signal); check(); this.status = 'Provider saved. No agent was started.';
      } else if (request.action === 'runtime-form') {
        this.runtimeExecutable = undefined; this.harnesses = undefined; this.models = undefined;
        const harnesses = await discoverHarnesses(abort.signal); check(); this.harnesses = harnesses;
        this.runtimeExecutable = this.harnesses.find(h => h.id === 'buzz-agent' && h.providers.length)?.executable; this.models = undefined;
        this.status = this.harnesses.map(h => `${h.label}: ${h.reason}`).join(' · ');
      } else if (request.action === 'models') {
        this.models = undefined;
        const provider = readSettings(this.hostDirectory).providers.find(p => p.id === v.provider);
        const result = provider?.type === 'databricks_v2' ? await databricksNative({ action: 'models',host:provider.endpoint,key:provider.key },abort.signal) : await this.credential({ action: 'models', directory: this.hostDirectory, provider: v.provider },abort.signal); check(); this.models = result.models; this.status = 'Model list loaded. Custom model is also available.';
      } else if (request.action === 'add-runtime') {
        const selected = this.harnesses?.find(h => h.id === (v.harness ?? 'buzz-agent'));
        const previous = readSettings(this.hostDirectory);
        const provider = previous.providers.find(p => p.id === v.provider);
        if (!selected?.executable || !provider || !selected.providers.includes(provider.type) || !['buzz-agent','codex','pi'].includes(selected.id)) throw plain('No supported executable/provider combination found.');
        saveSettings(this.hostDirectory,{ ...previous, runtimes: [...previous.runtimes,{ id: settingsId(), name: v.name ?? '', harness: selected.id as 'buzz-agent' | 'codex' | 'pi', executable: selected.executable, ...(['codex','pi'].includes(selected.id) ? { cli: selected.cli } : {}), providerId: v.provider ?? '', model: v.model ?? '', ...(v.environment ? { environment: runtimeEnvironment(JSON.parse(v.environment)) } : {}), ...(v.effort ? { effort: v.effort } : {}) }] },previous.revision);
        this.status = 'Runtime saved for new runs. Running agents did not change. Host loading is reported separately.';
      } else if (request.action === 'host-start') {
        this.service = await startService(this.hostDirectory); check(); this.status = 'Host running. Registration and settings do not start agents.';
      } else if (request.action === 'host-stop') {
        if (!v.instance) throw plain('A verified host instance is required.');
        this.service = await stopService(this.hostDirectory,v.instance); check(); this.status = this.service.state === 'stopped' ? 'Host stopped. Owned teardown completed.' : 'Host teardown is unconfirmed. Status unknown.';
      } else if (request.action === 'configure') {
        const owner = ownerPublicInput(v.owner ?? '');
        if (!/^(wss|ws):\/\//.test(v.relay ?? '')) throw plain('Enter a relay URL that starts with ws:// or wss://.');
        await this.credential({ action: 'configure', directory: this.hostDirectory, label: hostname().slice(0,128), owner, relay: v.relay }, abort.signal);
        check(); this.status = 'Configuration saved. This action did not start a service or agent.';
      } else if (request.action === 'provision') {
        await this.credential({ action: 'provision', directory: this.hostDirectory, binding: v.binding, genesis: v.genesis, secret: v.secret }, abort.signal);
        check(); this.status = 'Local agent added and stopped. Nothing was started or published to the relay.';
      } else if (request.action === 'signin') {
        const retained = readControllerConfig(this.ownerDirectory);
        const owner = retained?.owner ?? ownerPublicInput(v.owner ?? '');
        const relay = retained?.relay ?? v.relay ?? '';
        if (!/^(wss|ws):\/\//.test(relay)) throw plain('Enter a relay URL that starts with ws:// or wss://.');
        const result = await this.credential({ action: 'signin', owner, ...(v.secret ? { secret: v.secret.toLowerCase() } : {}) }, abort.signal);
        delete v.secret; check();
        if (result.secret === null) throw plain('No saved owner key. Choose Import matching owner key and sign in. Enter the matching private key with 64 hex characters.');
        if (!retained) createControllerConfig(this.ownerDirectory, owner, relay);
        this.client?.close(); this.inventory.clear(); this.offers.clear(); this.directory = [];
        this.directoryState = 'Loading relay directory…';
        this.owner = owner;
        const client = this.connect(join(this.ownerDirectory, 'management-intents'), relay, result.secret, m => {
          if (this.client !== client || this.closed) return;
          const map = m.type === 'availability' ? this.offers : m.type === 'inventory' ? this.inventory : undefined;
          if (map) {
            const key = m.type === 'availability' ? m.host : JSON.stringify([m.host, m.agent]);
            const prior = map.get(key);
            if ((prior || map.size < 1000) && (!prior || Number(m.body.observedAt) > Number(prior.body.observedAt))) map.set(key, m);
          }
          this.refresh();
        }, () => this.refresh(), { catalog: { version: 1, owner, relay, registrations: [] } });
        const directorySecret = result.secret; result.secret = undefined; this.client = client;
        abort.signal.addEventListener('abort', () => client.close(), { once: true });
        await client.ready; check();
        try { const directory = await this.directoryRead(relay,directorySecret,abort.signal); check(); this.directory = directory; this.directoryState = `Relay directory: ${this.directory.length} agents.`; }
        catch (error) { check(); this.directory = []; this.directoryState = 'Relay directory unavailable. Sign in again to retry.'; throw error; }
        this.status = 'Owner signed in. Relay discovery is separate from host execution authority.';
      } else if (request.action === 'directory-refresh') {
        const owner = this.owner, client = this.client, routing = readControllerConfig(this.ownerDirectory);
        if (!owner || !client || !routing || routing.owner !== owner) throw plain('Owner sign-in required');
        this.continuation = undefined;
        this.directoryState = 'Refreshing relay directory…'; this.refresh();
        try {
          const credential = await this.credential({action:'signin',owner},abort.signal); check();
          if (!credential.secret) throw plain('Saved owner key unavailable. Sign in again.');
          const secret = credential.secret; credential.secret = undefined;
          const directory = await this.directoryRead(routing.relay,secret,abort.signal); check();
          if (this.owner !== owner || this.client !== client) throw plain('Owner connection changed.');
          this.directory = directory;
          this.directoryState = `Relay directory: ${directory.length} agents.`;
        } catch (error) {
          this.directoryState = 'Directory refresh incomplete. Previous results retained; Refresh to retry.';
          throw error;
        }
      } else if (request.action === 'signout') {
        this.continuation = undefined;
        this.client?.close(); this.client = undefined; this.owner = undefined; this.inventory.clear(); this.offers.clear(); this.directory = [];
        this.status = 'Signed out. The owner key is still saved on this computer. Hosts and agents were not stopped.';
      } else if (request.action === 'draft') {
        await editProfileDraft(profileDrafts(this.ownerDirectory), async prompt => prompt.startsWith('Profile') ? v.name ?? '' : v.instructions ?? '');
        this.status = 'Private instructions draft saved on this computer. Not published or used by an agent. To resume, use beehive drafts ~/.beehive/owner or beehive tui.';
      } else if (request.action === 'reconcile') { this.client?.reconcile(); this.status = 'Checking operation results. Operations blocked by relay policy will not be retried.';
      } else if (request.action === 'operations') {
        this.status = this.operationStatus().slice(-5).reverse().map(o => `${plainOperationType(o.request)} · ${plainStates[o.state] ?? o.state} · ${o.request.id.slice(0,8)}\n${operationText(o.result ?? o.publication)}`).join('\n') || 'No saved operations.';
      } else if (['start', 'stop', 'restart', 'move', 'select-config', 'select-runtime'].includes(request.action)) {
        if (!this.owner || !this.client) throw plain('Owner sign-in required');
        if (request.action === 'start') {
          const agent = this.directory.find(a => this.localEnrollmentTarget(a.publicKey) === request.target);
          if (agent && request.revision === -1) {
            const settings = readSettings(this.hostDirectory);
            this.continuation = {enroll:true,token:randomUUID(),agent:agent.publicKey,target:request.target!,revision:0,settingsRevision:settings.revision,owner:this.owner};
            this.status = 'Register here, then enroll and Start on this host.';
            return {state:'registration-required',continuation:this.continuation.token,agent:agent.publicKey};
          }
        }
        const candidate = this.inventory.get(request.target ?? '');
        const current = candidate && this.directory.some(a => a.publicKey === candidate.agent) && this.agentReport(candidate.agent) === candidate ? candidate : undefined;
        if (!current || !this.fresh(current) || current.revision !== request.revision) throw plain('The selection changed, or the host report is old or unavailable. Select an agent with a recent report. No request was sent.');
        if (request.action === 'restart' && (current.body.assignedHost !== current.host || !['stopped', 'running'].includes(String(current.body.phase)))) throw plain('Restart requires a recent report from the assigned host.');
        if (request.action === 'start' && (current.body.phase !== 'stopped' || current.body.actualRun || current.body.assignedHost !== current.host)) throw plain('Start requires a recent report from the assigned host. It must report the agent stopped with no current run.');
        if (this.client.status().some(o => o.request.host === current.host && o.request.agent === current.agent && !['completed','failed'].includes(o.state))) throw plain('An operation has no confirmed result. Inspect operations and check operation results before you act again.');
        if (request.action === 'start' && existsSync(join(this.hostDirectory,'host-identity.json')) && readHostIdentityPublic(this.hostDirectory).pairing.host === current.host) {
          const settings = readSettings(this.hostDirectory);
          const registered = settings.agents.find(a => a.publicKey === current.agent);
          const selected = current.body.selectedNext as {harnessSetup?:{id?:string}};
          if (!registered || !settings.runtimes.some(r => selected?.harnessSetup?.id === `runtime:${r.id}`)) {
            this.continuation = {token:randomUUID(),agent:current.agent,target:request.target!,revision:current.revision,settingsRevision:settings.revision,owner:this.owner};
            this.status = 'Confirm registration and select a runtime before Start.';
            return {state:'registration-required',continuation:this.continuation.token,agent:current.agent};
          }
        }
        if (request.action === 'move') {
          const destination = this.moveDestinations(current).find(d => d.target === v.destination);
          if (!destination || destination.reason || destination.revision !== Number(v.destinationRevision)) throw plain(destination?.reason ?? 'Destination changed. Select it again. No Move sent.');
          if (!['stopped','running'].includes(String(current.body.phase))) throw plain('Source ownership is unknown. No Move sent.');
          const target = this.inventory.get(destination.target)!;
          const selected = selection(target.body.selectedNext), source = selection(current.body.selectedNext);
          selected.profile = source.profile;
          if (source.behavior) selected.behavior = source.behavior; else delete selected.behavior;
          const needsAuthorization = hash(target.body.genesis) !== hash(current.body.genesis) || target.body.assignedHost === target.host;
          const operation = message('move',current.host,current.agent,current.revision,{target:target.host,targetRevision:target.revision + (needsAuthorization ? 1 : 0),selection:selected});
          if (needsAuthorization) {
            const assignment = {genesis:current.body.genesis,assignedHost:current.body.assignedHost,chain:current.body.assignmentChain ?? []};
            const authorize = message('authorize-move',target.host,current.agent,target.revision,{operation,assignment});
            check(); this.client.submit(authorize);
            let accepted = false;
            for (let n=0;n<100;n++) {
              check();
              const result = this.client.status().find(o => o.request.id === authorize.id);
              if (!result || ['failed','unknown'].includes(result.state)) throw plain('Destination authorization failed or is unknown. Source Move not sent.');
              if (result.state === 'completed') { accepted = true; break; }
              await delay(100,undefined,{signal:abort.signal});
            }
            if (!accepted || this.inventory.get(request.target!)?.revision !== current.revision) throw plain('Selection changed or destination authorization pending. Source Move not sent.');
          }
          check(); this.client.submit(operation);
          this.status = `Move submitted (${operation.id}). Source remains assigned until preparation and verified Stop. Destination launch is reported separately.`;
          return {state:'submitted',operationId:operation.id};
        }
        if (request.action === 'select-runtime') {
          if (!existsSync(join(this.hostDirectory,'host-identity.json')) || readHostIdentityPublic(this.hostDirectory).pairing.host !== current.host) throw plain('Select a runtime on its local host.');
          const runtime = readSettings(this.hostDirectory).runtimes.find(r => r.id === v.runtime);
          const binding = (current.body.harnessSetups as {id:string;fingerprint:string}[] | undefined)?.find(b => b.id === `runtime:${runtime?.id}`);
          if (!runtime || !binding) throw plain('Runtime is not loaded by this host. Refresh and try again.');
          const save = message('save',current.host,current.agent,current.revision,{ ...(current.body.selectedNext as Record<string,unknown>),model:runtime.model,harnessSetup:{id:binding.id,fingerprint:binding.fingerprint} });
          this.client.submit(save);
          this.status = `Runtime Save submitted (${save.id}). Current run unchanged; inspect the host result before Start.`;
          return {state:'submitted',operationId:save.id};
        }
        const operation = message(request.action === 'select-config' ? 'save' : request.action as 'start' | 'stop' | 'restart', current.host, current.agent, current.revision, request.action === 'select-config' ? { configurationAction: 'select', name: v.name } : {});
        this.client.submit(operation);
        result = { state: 'submitted', operationId: operation.id };
        this.status = `Operation ${operation.id}: ${plainOperationType(operation)} saved and pending.\nHost: ${current.host}\nAgent: ${current.agent}\nRelay publication does not confirm host acceptance. Inspect operations. Unknown does not mean stopped.`;
      } else if (request.action !== 'refresh') throw plain('Not available in this build');
    } catch (error) { this.continuation = undefined; result = { state: abort.signal.aborted || generation !== this.generation ? 'cancelled' : 'failed', reason: 'Operation did not complete; inspect status before retrying.' }; if (!this.closed) this.status = error instanceof PlainStatus ? error.message : abort.signal.aborted && error === abort.signal.reason ? 'Stopped waiting. Changes may already be saved or submitted. Inspect before you try again.' : error instanceof Error ? plainBackendMessage(error.message) : `Could not complete the operation: ${String(error)}`; }
    finally { if (request.action === 'register-agent') this.continuation = undefined; delete v.secret; this.active = undefined; this.refresh(); }
    return result;
  }
}
