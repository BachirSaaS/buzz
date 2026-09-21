import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readPrivate, writePrivate } from './storage.ts';
import { readCredentialManifest } from './credential-slots.ts';
import { loadNativeEntry, type NativeEntry } from './native-credentials.ts';
import { type CredentialBackend, credentialReference, createCredential, readCredential } from './credential-store.ts';
import { nip19 } from 'nostr-tools';
import { publicKey } from './protocol.ts';
import { readSettings, saveSettings, settingsId, settingsLock, type ProviderReference, type RegisteredAgent, type SavedProvider, validateSettings, replaceProvider } from './settings.ts';

/** Decode hidden nsec input on Node, never in the renderer's display state. */
export function agentNsec(input: string): string {
  try { const value = nip19.decode(input.trim()); if (value.type !== 'nsec') throw Error(); const secret = Buffer.from(value.data).toString('hex'); publicKey(secret); return secret; }
  catch { throw Error('Enter a valid nsec private key'); }
}
/** Verify custody and commit identity plus selected immutable runtime in one public
 * snapshot. Legacy identity-only callers remain supported; references are never repaired. */
export function registerAgent(directory: string, secret: string, credentials: CredentialBackend, profile: Pick<RegisteredAgent, 'profile' | 'profileState'>, runtimeId?: string, expectedRevision?: number): RegisteredAgent {
  const key = credentialReference('agent', publicKey(secret));
  // This outer operation cannot nest saveSettings's lock. The credential import is
  // serialized separately; public CAS catches competing catalog saves afterwards.
  const previous = readSettings(directory);
  if (expectedRevision !== undefined && previous.revision !== expectedRevision) throw Error('Settings changed. Open the form again.');
  if (runtimeId !== undefined && !previous.runtimes.some(r => r.id === runtimeId)) throw Error('Select a saved runtime');
  const retained = previous.agents.find(a => a.publicKey === key.publicKey);
  const retainedSlot = existsSync(join(directory,'setup.json')) ? readCredentialManifest(directory).agents[key.publicKey] : undefined;
  settingsLock(directory, () => {
    if (retained || retainedSlot) { if (readCredential(key, credentials) !== secret) throw Error('Retained key mismatch'); }
    else if (credentials.read(key) !== null) { if (readCredential(key, credentials) !== secret) throw Error('Existing key mismatch'); }
    else { retainCredentialAttempt(directory,key); createCredential('agent', secret, credentials); }
  });
  if (retained && (!runtimeId || retained.runtimeId)) return retained;
  const row: RegisteredAgent = { ...(retained ?? { publicKey: key.publicKey, key, ...profile }), ...(runtimeId ? { runtimeId } : {}) };
  saveSettings(directory, { ...previous, agents: retained ? previous.agents.map(a => a.publicKey === key.publicKey ? row : a) : [...previous.agents, row] }, previous.revision);
  return row;
}
/** Exact-entry provider backend. No Desktop account, enumeration, cache or fallback. */
export type ProviderCredentials = { read(ref: ProviderReference): string | null; create(ref: ProviderReference, value: string): void };
export function providerCredentials(load = loadNativeEntry): ProviderCredentials {
  const entry = (ref: ProviderReference): NativeEntry => {
    if (ref.service !== 'beehive' || !/^provider:[0-9a-f-]{36}$/.test(ref.account)) throw Error('Invalid provider reference');
    return new (load())('beehive', ref.account);
  };
  const protect = <T>(fn: () => T): T => { try { return fn(); } catch { throw Error('Provider OS credential access failed; no plaintext fallback'); } };
  return { read: ref => protect(() => entry(ref).getPassword()), create: (ref, value) => protect(() => { const e = entry(ref); if (e.getPassword() !== null) throw Error(); e.setPassword(value); if (e.getPassword() !== value) throw Error(); }) };
}
/** Read-back precedes public persistence. Failed commit retains the exact key entry. */
export function addOpenAI(directory: string, name: string, secret: string, backend: ProviderCredentials) {
  return addProvider(directory,name,secret,backend,'openai','https://api.openai.com/v1');
}
/** Verified immutable OS entry for each supported API-key provider. */
export function addProvider(directory: string, name: string, secret: string, backend: ProviderCredentials, type: SavedProvider['type'], endpoint: string, wire?: SavedProvider['wire'], expected?: number) {
  if (!name || name.length > 128 || /[\x00-\x1f\x7f]/.test(name)) throw Error('Enter a provider name');
  if (!secret || secret.length > 16384 || /\s/.test(secret)) throw Error('Enter an API key');
  const previous = readSettings(directory), id = settingsId();
  if (expected !== undefined && previous.revision !== expected) throw Error('Settings changed. Open the form again.');
  const key: ProviderReference = { service: 'beehive', account: `provider:${id}` };
  const candidate = validateSettings({ ...previous, providers: [...previous.providers, { id, name, type, endpoint, key, ...(wire ? {wire} : {}) }] });
  settingsLock(directory, () => { retainCredentialAttempt(directory,key); backend.create(key, secret); });
  if (backend.read(key) !== secret) throw Error('Provider credential verification failed');
  return saveSettings(directory, candidate, previous.revision);
}

/** Public recovery references precede OS writes. Cancellation may leave a stored
 * key; do not delete it or claim rollback. Retained attempts are bounded. */
export function retainCredentialAttempt(directory: string, key: object) {
  const path = join(directory,'credential-attempts.json');
  const rows = existsSync(path) ? readPrivate(path) as object[] : [];
  if (!Array.isArray(rows) || rows.length >= 100) throw Error('Credential recovery log needs attention');
  if (!rows.some(row => JSON.stringify(row) === JSON.stringify(key))) writePrivate(path,[...rows,key]);
}

/** Verified credential rotation uses a fresh exact entry; active runs keep the old
 * reference. Empty secret preserves the existing credential without reading it. */
export function editProvider(directory: string, id: string, expected: number, name: string, endpoint: string, wire: SavedProvider['wire'], secret: string, backend: ProviderCredentials) {
  const previous = readSettings(directory);
  if (previous.revision !== expected) throw Error('Settings changed. Open the form again.');
  const current = previous.providers.find(row => row.id === id);
  if (!current || current.type === 'databricks_v2') throw Error('Select an API-key provider');
  if (secret && (secret.length > 16384 || /\s/.test(secret))) throw Error('Enter an API key');
  const key: ProviderReference = secret ? { service: 'beehive', account: `provider:${settingsId()}` } : current.key;
  const provider: SavedProvider = { ...current, name, endpoint, key, ...(current.type === 'openai-compat' ? { wire } : {}) };
  validateSettings({ ...previous, providers: previous.providers.map(row => row.id === id ? provider : row) });
  if (secret) {
    settingsLock(directory, () => { retainCredentialAttempt(directory, key); backend.create(key, secret); });
    if (backend.read(key) !== secret) throw Error('Provider credential verification failed');
  }
  return replaceProvider(directory, provider, expected);
}
