import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { nip19 } from 'nostr-tools';
import { readControllerConfig, createControllerConfig } from './controller-config.ts';
import { readHostIdentityPublic } from './host-identity.ts';
import { agentNsec } from './settings-credentials.ts';
import { publicKey } from './protocol.ts';
import { desktopOwnerKey } from './owner-key.ts';
import type { OwnerClient, OwnerRequest, OwnerSnapshot } from './owner-protocol.ts';

const missing = 'Desktop identity unavailable. Open and unlock Buzz, then check again or provide an owner nsec.';
/** Offline Node authority. Session keys have no persistence, snapshot, or relay path. */
export class OwnerService implements OwnerClient {
  private current: OwnerSnapshot = { signedIn: false, desktop: 'unknown', desktopReason: 'Identity availability has not been checked.', phase: 'idle', message: 'Sign in to manage Host and Agents.', secretLength: 0 };
  private listeners = new Set<(snapshot: OwnerSnapshot) => void>();
  private input = '';
  private session?: string;
  private active?: AbortController;
  private generation = 0;
  private disposed = false;
  constructor(private home = homedir(), private desktop = desktopOwnerKey) {
    try { this.projectBinding(); } catch { this.current.phase = 'error'; this.current.message = 'Saved owner routing is invalid. Repair the retained configuration; nothing was reset.'; }
  }
  private binding() {
    const controller = readControllerConfig(join(this.home, '.beehive', 'owner'));
    const directory = join(this.home, '.beehive', 'host');
    const host = existsSync(join(directory, 'host-identity.json')) ? readHostIdentityPublic(directory).pairing : undefined;
    if (existsSync(join(directory, 'setup.json')) && !host) throw Error('Legacy Host needs explicit migration');
    if (controller && host && (controller.owner !== host.owner || controller.relay !== host.relay)) throw Error('Conflicting bindings');
    return controller ?? (host ? { owner: host.owner, relay: host.relay } : undefined);
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
    if (request.action === 'signout') {
      this.cancel(); this.session = undefined; this.current.signedIn = false; this.current.owner = undefined;
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
        if (now && (now.owner !== owner || now.relay !== relay)) throw Error();
        error = 'Owner routing changed or was not saved. Reopen sign-in and check configuration. No session opened.';
        if (!now) createControllerConfig(join(this.home, '.beehive', 'owner'), owner, relay);
        // Read back the sole public authority after first-use activation.
        const saved = this.binding();
        if (saved?.owner !== owner || saved.relay !== relay) throw Error();
        check(); this.session = secret; this.current.signedIn = true; this.current.owner = nip19.npubEncode(owner); this.projectBinding();
        this.current.message = 'Signed in. No Host, agent, or relay operation was started.';
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
  cancel() { this.generation++; this.active?.abort(); this.active = undefined; this.input = ''; this.current.secretLength = 0; this.current.phase = 'idle'; this.current.message = 'Sign-in cancelled. No requested action was run.'; this.publish(); }
  dispose() { this.cancel(); this.session = undefined; this.current.owner = undefined; this.current.signedIn = false; this.disposed = true; this.listeners.clear(); }
}
