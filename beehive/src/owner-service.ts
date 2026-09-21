import { existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { nip19 } from 'nostr-tools';
import { readControllerConfig, createControllerConfig } from './controller-config.ts';
import { readHostIdentityPublic } from './host-identity.ts';
import { agentNsec } from './settings-credentials.ts';
import { publicKey } from './protocol.ts';
import { desktopOwnerKey } from './owner-key.ts';
import { managerCredential } from './manager-credential.ts';
import { serviceStatus, startService, stopService } from './host-service.ts';
import { hostResetRevision, pendingHostReset, resetHost } from './host-reset.ts';
import type { OwnerClient, OwnerRequest, OwnerSnapshot } from './owner-protocol.ts';

export type HostDependencies = { credential: typeof managerCredential; status: typeof serviceStatus; start: typeof startService; stop: typeof stopService; reset: typeof resetHost };
const hostDependencies: HostDependencies = { credential: managerCredential, status: serviceStatus, start: startService, stop: stopService, reset: resetHost };
const missing = 'Desktop identity unavailable. Open and unlock Buzz, then check again or provide an owner nsec.';
/** Offline Node authority. Session keys have no persistence, snapshot, or relay path. */
export class OwnerService implements OwnerClient {
  private current: OwnerSnapshot = { signedIn: false, desktop: 'unknown', desktopReason: 'Identity availability has not been checked.', phase: 'idle', message: 'Sign in to manage Host and Agents.', secretLength: 0 };
  private listeners = new Set<(snapshot: OwnerSnapshot) => void>();
  private input = '';
  private session?: string;
  private active?: AbortController;
  private generation = 0;
  private hostOperation = false;
  private disposed = false;
  constructor(private home = homedir(), private desktop = desktopOwnerKey, private hosts: HostDependencies = hostDependencies) {
    try { this.projectBinding(); } catch { this.current.phase = 'error'; this.current.message = 'Saved owner routing is invalid. Repair the retained configuration; nothing was reset.'; }
  }
  private binding() {
    const controller = readControllerConfig(join(this.home, '.beehive', 'owner'));
    const directory = join(this.home, '.beehive', 'host');
    const pending = pendingHostReset(directory);
    const host = existsSync(join(directory, 'host-identity.json')) ? readHostIdentityPublic(directory).pairing : undefined;
    if (existsSync(join(directory, 'setup.json')) && !host) throw Error('Legacy Host needs explicit migration');
    if (controller && host && (controller.owner !== host.owner || controller.relay !== host.relay)) throw Error('Conflicting bindings');
    if (pending && ((controller && (controller.owner !== pending.owner || controller.relay !== pending.relay)) || (host && (host.owner !== pending.owner || host.relay !== pending.relay)))) throw Error('Conflicting reset binding');
    return controller ?? (host ? { owner: host.owner, relay: host.relay } : pending ? { owner: pending.owner, relay: pending.relay } : undefined);
  }
  private projectBinding() { const b = this.binding(); this.current.boundOwner = b ? nip19.npubEncode(b.owner) : undefined; this.current.relay = b?.relay; }
  snapshot() { return structuredClone(this.current); }
  subscribe(listener: (snapshot: OwnerSnapshot) => void) { this.listeners.add(listener); listener(this.snapshot()); return () => { this.listeners.delete(listener); }; }
  private publish() { if (!this.disposed) for (const listener of this.listeners) listener(this.snapshot()); }
  secret(action: 'append' | 'backspace' | 'clear', value = '') {
    if (this.disposed || this.active || this.current.signedIn) return;
    if (action === 'clear') this.input = '';
    else if (action === 'backspace') this.input = this.input.slice(0, -1);
    else if (action === 'append') this.input = (this.input + value.replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 256);
    this.current.secretLength = this.input.length; this.publish();
  }
  async request(request: OwnerRequest) {
    if (this.disposed) return false;
    if (request.action.startsWith('host-')) return this.hostRequest(request);
    if (request.action === 'signout') {
      this.cancel(); this.session = undefined; this.current.signedIn = false; this.current.owner = undefined; this.current.host = undefined; this.current.hostMessage = undefined; this.current.hostPhase = 'idle';
      this.current.message = 'Signed out. Host and agents keep running.'; this.publish(); return true;
    }
    if (this.active || this.current.signedIn) return false;
    const abort = new AbortController(), generation = ++this.generation;
    this.active = abort; this.current.phase = 'busy'; this.current.message = request.action === 'probe' ? 'Checking Desktop identity…' : 'Signing in… Esc cancels.'; this.publish();
    let error = 'Sign-in failed. No session was opened. Check the retained owner configuration and try again.';
    const check = () => { abort.signal.throwIfAborted(); if (generation !== this.generation || this.disposed) throw Error('Cancelled'); };
    try {
      if (request.action === 'probe') {
        const result = await this.desktop(true, abort.signal); check();
        this.current.desktop = result.available ? 'available' : 'unavailable';
        this.current.desktopReason = result.available ? 'Desktop entry detected. Sign-in checks identity and access.' : missing;
        this.current.message = result.available ? 'Buzz Desktop identity is available.' : missing;
      } else {
        const before = this.binding();
        const relay = before?.relay ?? request.relay?.trim();
        error = 'Enter a relay URL using wss:// (or ws://localhost for local testing). Nothing was changed.';
        if (!relay) throw Error();
        const url = new URL(relay);
        if (url.username || url.password || url.hash || !(url.protocol === 'wss:' || (url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw Error();
        let secret: string;
        if (request.action === 'signin-desktop') {
          error = 'Desktop key access failed or was cancelled. Unlock Keychain or provide owner nsec. No session opened.';
          const result = await this.desktop(false, abort.signal); check();
          if (!result.secret) throw Error();
          secret = result.secret;
        } else if (request.action === 'signin-nsec') {
          error = 'Enter a valid owner nsec. No session was opened and nothing was saved.';
          secret = agentNsec(this.input);
        } else throw Error('Unsupported action');
        const owner = publicKey(secret); check();
        error = 'Identity does not match this owner. Use the matching key. Owner and relay were not changed.';
        const now = this.binding();
        if (before && !now || now && (now.owner !== owner || now.relay !== relay)) throw Error();
        error = 'Owner routing changed or was not saved. Reopen sign-in and check configuration. No session opened.';
        if (!now) createControllerConfig(join(this.home, '.beehive', 'owner'), owner, relay);
        // Read back the sole public authority after first-use activation.
        const saved = this.binding();
        if (saved?.owner !== owner || saved.relay !== relay) throw Error();
        check();
        const directory = join(this.home, '.beehive', 'host');
        error = 'Host identity creation failed. Binding may be saved. Retry sign-in with the same owner and relay; no Host was started.';
        if (!existsSync(join(directory, 'host-identity.json')) && !pendingHostReset(directory)) {
          await this.hosts.credential({ action: 'configure', directory, ownerDirectory: join(this.home, '.beehive', 'owner'), label: hostname().slice(0, 128), owner, relay }, abort.signal);
          check();
        }
        const finalBinding = this.binding();
        if (finalBinding?.owner !== owner || finalBinding.relay !== relay) throw Error('Binding changed');
        check(); this.session = secret; this.current.signedIn = true; this.current.owner = nip19.npubEncode(owner); this.projectBinding();
        this.current.message = pendingHostReset(directory) ? 'Signed in. Reset incomplete; open Host to finish Reset Host.' : 'Signed in. Host is configured. No service or agent was started.';
      }
      this.current.phase = 'idle'; return true;
    } catch {
      if (generation === this.generation && !this.disposed) { this.current.phase = 'error'; this.current.message = error; }
      return false;
    } finally {
      if (generation === this.generation) { this.input = ''; this.current.secretLength = 0; }
      if (this.active === abort) this.active = undefined;
      this.publish();
    }
  }
  private async hostRequest(request: OwnerRequest) {
    if (!this.session || !this.current.signedIn || this.active) return false;
    const abort = new AbortController(), generation = ++this.generation;
    this.active = abort; this.hostOperation = true; this.current.hostPhase = 'busy'; this.current.hostMessage = 'Working…'; this.publish();
    const directory = join(this.home, '.beehive', 'host');
    const check = () => {
      abort.signal.throwIfAborted();
      if (generation !== this.generation || !this.session || this.disposed) throw Error('Session ended');
      const binding = this.binding();
      if (!binding || binding.owner !== publicKey(this.session)) throw Error('Owner binding changed');
      return binding;
    };
    const project = async () => {
      const status = await this.hosts.status(directory); const binding = check();
      const pending = pendingHostReset(directory);
      const identity = existsSync(join(directory, 'host-identity.json')) ? readHostIdentityPublic(directory).pairing : undefined;
      if (!identity && !pending) throw Error('Missing Host identity');
      this.current.host = { name: identity?.label ?? 'Reset incomplete', host: identity?.host ?? pending!.host, owner: binding.owner, relay: binding.relay, state: status.state, agents: status.state === 'stopped' ? 0 : status.agents, connection: status.relay, instance: status.instance, revision: hostResetRevision(directory), resetPending: !!pending };
      this.publish(); return status;
    };
    try {
      const binding = check();
      if (request.action !== 'host-status' && request.revision !== hostResetRevision(directory)) throw Error('Host changed');
      const status = await project(); check();
      if (request.action === 'host-reset') {
        if (!request.confirmed || status.state !== 'stopped') throw Error('Reset requires stopped Host and confirmation');
        await this.hosts.reset(directory, join(this.home, '.beehive', 'owner'), binding.owner, binding.relay, request.revision!, abort.signal);
        abort.signal.throwIfAborted();
        if (generation !== this.generation || this.disposed) return false;
        this.session = undefined; this.current.signedIn = false; this.current.owner = undefined; this.current.host = undefined;
        this.projectBinding(); this.current.message = 'Host reset. Sign in to bind this computer again.';
        this.current.hostMessage = undefined; this.current.hostPhase = 'idle'; this.publish(); return true;
      }
      if (request.action === 'host-start') {
        if (status.state !== 'stopped' || pendingHostReset(directory)) throw Error('Host not ready');
        await this.hosts.start(directory); check();
      } else if (request.action === 'host-stop') {
        if (!request.confirmed || status.state !== 'running' || !request.instance || status.instance !== request.instance) throw Error('Host instance changed');
        await this.hosts.stop(directory, request.instance); check();
      } else if (request.action !== 'host-status') throw Error('Unsupported Host action');
      const final = await project();
      if (request.action === 'host-start' && final.state !== 'running' || request.action === 'host-stop' && final.state !== 'stopped') throw Error('Unconfirmed result');
      this.current.hostPhase = 'idle';
      this.current.hostMessage = pendingHostReset(directory) ? 'Reset incomplete. Retry Reset Host to finish.' : final.state === 'unknown' ? 'Status unknown. Check the local service, then Refresh status. Start and Reset are blocked.' : request.action === 'host-start' ? 'Host started. No agent was started.' : request.action === 'host-stop' ? 'Host and its agents stopped.' : '';
      return true;
    } catch {
      if (generation === this.generation && !this.disposed && this.current.signedIn) {
        try { await project(); } catch { if (generation === this.generation) this.current.host = undefined; }
        if (generation !== this.generation || this.disposed || !this.current.signedIn) return false;
        this.current.hostPhase = 'error';
        this.current.hostMessage = pendingHostReset(directory) ? 'Reset incomplete. Keep local files. Retry Reset Host.' : 'Operation unconfirmed. Refresh status before retrying.';
      }
      return false;
    } finally { if (this.active === abort) this.active = undefined; this.hostOperation = false; this.publish(); }
  }
  cancel() { this.generation++; this.active?.abort(); if (!this.hostOperation) this.active = undefined; this.input = ''; this.current.secretLength = 0; this.current.phase = 'idle'; if (this.current.hostPhase === 'busy') { this.current.hostPhase = 'idle'; this.current.hostMessage = 'Stopped waiting. Changes may already be saved. Refresh status before retrying.'; } this.current.message = 'Stopped waiting. Configuration may already be saved; sign in again with the same owner and relay.'; this.publish(); }
  dispose() { this.cancel(); this.session = undefined; this.current.owner = undefined; this.current.signedIn = false; this.current.host = undefined; this.disposed = true; this.listeners.clear(); }
}
