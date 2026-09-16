import type { DetectedHarness } from './harness-discovery.ts';
import { validateBuzzProvider } from './buzz-provider.ts';
import { runtimeEnvironment } from './runtime-environment.ts';
import { piEfforts } from './pi.ts';
import { validateRuntimeEffort } from './runtime-effort.ts';
import { databricksHost } from './databricks.ts';
import { existsSync, mkdirSync, rmdirSync, lstatSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readPrivate, writePrivate } from './storage.ts';
import { credentialReference, type CredentialReference } from './credential-store.ts';

/** Public-only local catalog. runtimeId records the initial registration choice only;
 * the authenticated host selectedNext owns subsequent configuration. Registration
 * does not create assignment or a journal. */
export type RegisteredAgent = { runtimeId?: string; publicKey: string; key: CredentialReference; profile?: { relay: string; name?: string; about?: string; picture?: string }; profileState: 'found' | 'none' | 'unavailable' };
/** Each provider version owns an exact immutable OS credential entry. */
export type ProviderReference = { service: 'beehive'; account: string };
export type SavedProvider = { id: string; name: string; type: 'openai' | 'anthropic' | 'openai-compat' | 'openrouter' | 'databricks_v2'; endpoint: string; wire?: 'auto' | 'chat' | 'responses'; key: ProviderReference };
export type SavedRuntime = { environment?: Record<string, string>; id: string; name: string; harness: 'buzz-agent' | 'codex' | 'pi'; cli?: string; executable: string; providerId: string; model: string; effort?: string };
export type Settings = { harnesses?: DetectedHarness[]; version: 1; revision: number; agents: RegisteredAgent[]; providers: SavedProvider[]; runtimes: SavedRuntime[] };
const path = (directory: string) => join(directory, 'settings.json');
const label = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 128 && !/[\x00-\x1f\x7f]/.test(s);
/** Validate catalog references without touching an OS store or network. */
export function validateSettings(value: Settings): Settings {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw Error('Invalid settings version or revision');
  for (const rows of [value.agents, value.providers, value.runtimes]) if (!Array.isArray(rows) || rows.length > 100) throw Error('Settings catalog limit');
  const unique = (keys: string[]) => { if (new Set(keys).size !== keys.length) throw Error('Duplicate settings record'); };
  unique(value.agents.map(a => a.publicKey)); unique(value.providers.map(p => p.id)); unique(value.runtimes.map(r => r.id));
  for (const a of value.agents) {
    if (JSON.stringify(a.key) !== JSON.stringify(credentialReference('agent', a.publicKey)) || !['found','none','unavailable'].includes(a.profileState)) throw Error('Invalid registered agent');
    if (a.runtimeId !== undefined && !value.runtimes.some(r => r.id === a.runtimeId)) throw Error('Registered runtime missing');
    if (a.profile && (typeof a.profile.relay !== 'string' || Object.values(a.profile).some(v => typeof v !== 'string' || v.length > 2048 || /[\x00-\x1f\x7f]/.test(v)))) throw Error('Invalid public profile');
  }
  for (const p of value.providers) {
    if (!label(p.name) || !label(p.id) || !['openai','anthropic','openai-compat','openrouter','databricks_v2'].includes(p.type) || (p.type === 'openai' && p.endpoint !== 'https://api.openai.com/v1') || (p.type === 'databricks_v2' && databricksHost(p.endpoint) !== p.endpoint) || (p.type !== 'openai-compat' && p.wire !== undefined)) throw Error('Invalid saved provider');
    validateBuzzProvider({provider:p.type === 'openai' ? 'openai-compat' : p.type, baseUrl:p.endpoint, credential:p.key, models:['validation-custom'], ...(p.type === 'databricks_v2' ? {auth:'token'} : {}), ...(['openai','openai-compat'].includes(p.type) ? {wire:p.wire ?? 'auto'} : {})});
  }
  for (const r of value.runtimes) if (!label(r.id) || !label(r.name) || !['buzz-agent','codex','pi'].includes(r.harness) || !isAbsolute(r.executable) || !/^[a-zA-Z0-9_.:/-]{1,200}$/.test(r.model) || !value.providers.some(p => p.id === r.providerId)) throw Error('Invalid saved runtime');
  for (const r of value.runtimes) {
    if (r.environment !== undefined) runtimeEnvironment(r.environment);
    if (r.harness === 'codex' ? !r.cli || !isAbsolute(r.cli) || r.effort !== undefined || value.providers.find(p => p.id === r.providerId)?.type !== 'openai' : r.harness === 'pi' ? !['openai','databricks_v2'].includes(value.providers.find(p => p.id === r.providerId)!.type) || !r.cli || !isAbsolute(r.cli) || r.effort !== undefined && !piEfforts(value.providers.find(p => p.id === r.providerId)!.type, r.model).includes(r.effort) : r.cli !== undefined) throw Error('Unsupported runtime provider/CLI/effort combination');
  }
  for (const r of value.runtimes) validateRuntimeEffort(value.providers.find(p => p.id === r.providerId)!.type, r.model, r.effort);
  if (value.harnesses !== undefined && (!Array.isArray(value.harnesses) || value.harnesses.length > 32 || value.harnesses.some(h => typeof h.id !== 'string' || typeof h.label !== 'string' || typeof h.reason !== 'string' || !['available','not-installed','cli-missing','incompatible'].includes(h.state) || !Array.isArray(h.providers) || h.providers.some(p => typeof p !== 'string') || (h.executable !== undefined && !isAbsolute(h.executable)) || (h.cli !== undefined && !isAbsolute(h.cli))))) throw Error('Invalid harness inventory');
  // Reject unknown fields, including accidental secret-bearing input.
  const fields = (o: object, allowed: string[]) => { if (Object.keys(o).some(k => !allowed.includes(k))) throw Error('Unexpected settings field'); };
  fields(value, ['version','revision','agents','providers','runtimes','harnesses']);
  for (const a of value.agents) { fields(a, ['publicKey','key','profile','profileState','runtimeId']); if (a.profile) fields(a.profile, ['relay','name','picture','about']); }
  for (const p of value.providers) { fields(p, ['id','name','type','endpoint','key','wire']); fields(p.key, ['service','account']); }
  for (const r of value.runtimes) fields(r, ['id','name','harness','executable','providerId','model','effort','cli','environment']);
  return structuredClone(value);
}
/** Absent settings means an empty catalog, never reconstructed credentials. */
export function readSettings(directory: string): Settings {
  if (!existsSync(path(directory))) return { version: 1, revision: 0, agents: [], providers: [], runtimes: [] };
  if (lstatSync(path(directory)).size > 256000) throw Error('Settings file exceeds limit');
  return validateSettings(readPrivate(path(directory)) as Settings);
}
/** Short cross-process catalog lock; independent of the host lifetime lock. */
export function settingsLock<T>(directory: string, action: () => T): T {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, 'settings.lock'); mkdirSync(lock, { mode: 0o700 });
  try { return action(); } finally { rmdirSync(lock); }
}
/** One complete CAS snapshot; failures preserve the previous revision. */
export function saveSettings(directory: string, candidate: Settings, expected: number): Settings {
  return settingsLock(directory, () => {
    const previous = readSettings(directory);
    if (previous.revision !== expected) throw Error('Settings changed. Open the form again.');
    const next = validateSettings({ ...candidate, revision: expected + 1 });
    // Catalogs are append-only in this prototype: old intents retain exact versions.
    for (const collection of ['agents','providers','runtimes'] as const) for (const row of previous[collection]) {
      if (!next[collection].some(n => retainedSettingsRow(row,n,collection))) throw Error('Retained settings cannot be replaced');
    }
    writePrivate(path(directory), next); return next;
  });
}
/** Fresh public IDs never encode credentials. */
export const settingsId = () => randomUUID();

/** Identity-only legacy registration may gain its first immutable runtime link.
 * Identity/profile/credential bytes and all existing runtime links stay retained. */
export function retainedSettingsRow(previous: object, next: object, collection: string): boolean {
  if (JSON.stringify(previous) === JSON.stringify(next)) return true;
  if (collection !== 'agents' || Object.hasOwn(previous,'runtimeId') || !Object.hasOwn(next,'runtimeId')) return false;
  const { runtimeId: _, ...identity } = next as RegisteredAgent;
  return JSON.stringify(previous) === JSON.stringify(identity);
}
