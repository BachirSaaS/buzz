import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGenesis } from './assignment.ts';
import { readCredentialManifest } from './credential-slots.ts';
import { type CredentialBackend, credentialReference } from './credential-store.ts';
import { initialState, validateSetup, type Setup } from './host.ts';
import { semanticHash } from './handoff.ts';
import { fields, publicKey, text, type Message } from './protocol.ts';
import { readSettings } from './settings.ts';
import { runtimeBindings } from './settings-runtime.ts';
import { readPrivate, writePrivate } from './storage.ts';
import type { SlotEntry } from './slots.ts';

type Attempt = { request: Message; setup: Setup; state: ReturnType<typeof initialState> };
/** Called only by the serialized, authenticated host owner, while it owns host.lock.
 * Persist an inert exact recovery prefix before journal/manifest activation. Never
 * generate credentials, overwrite retained journals, or infer remote absence.
 * Activation does not start a process; ordinary revision-fenced Start is separate.
 */
export async function prepareLocalEnrollment(directory: string, owner: string, request: Message, credentials: CredentialBackend, signal: AbortSignal) {
  fields(request.body, ['runtime', 'settingsRevision']);
  if (request.type !== 'enroll' || request.revision !== 0 || !/^[0-9a-f]{64}$/.test(request.agent)) throw Error('Invalid local enrollment');
  const runtime = text(request.body.runtime);
  const settings = readSettings(directory);
  const ref = credentialReference('agent', request.agent);
  if (!settings.agents.some(a => a.publicKey === request.agent) || !settings.runtimes.some(r => r.id === runtime)) throw Error('Register the matching identity and runtime locally first');
  const recordPath = join(directory, 'agents', request.agent, 'enrollment.json');
  const path = join(directory, 'agents', request.agent, 'journal.json');
  const manifestPath = join(directory, 'setup.json');
  const previous = existsSync(manifestPath) ? readCredentialManifest(directory) : undefined;
  if (previous && (previous.host !== request.host || previous.ownerPublic !== owner)) throw Error('Enrollment host authority differs');
  if (!previous?.agents[request.agent] && Object.keys(previous?.agents ?? {}).length >= 32) throw Error('Installation full');
  let attempt: Attempt | undefined = existsSync(recordPath) ? readPrivate(recordPath) as Attempt : undefined;
  if (attempt && (attempt.request.host !== request.host || attempt.request.agent !== request.agent || attempt.state.binding.owner !== owner || attempt.request.body.runtime !== runtime)) throw Error('Retained enrollment differs; refusing reset');
  if (previous?.agents[request.agent]) {
    if (!attempt) throw Error('Retained slot exists; use ordinary local operations');
    return { existing: true as const };
  }
  if (!attempt && (settings.revision !== request.body.settingsRevision || existsSync(path))) throw Error('Settings changed or retained journal exists; refusing reset');
  const secret = credentials.readAsync ? await credentials.readAsync(ref, signal) : credentials.read(ref);
  signal.throwIfAborted();
  if (!secret || publicKey(secret) !== request.agent) throw Error('Matching local agent credential required');
  if (semanticHash(readSettings(directory)) !== semanticHash(settings)) throw Error('Settings changed during enrollment');
  if (!attempt) {
    const context = join(directory, 'agents', request.agent, 'runtime');
    mkdirSync(context, { recursive: true, mode: 0o700 });
    const base: Setup = { host: request.host, ownerPublic: owner, runner: process.execPath, args: [], mode: 'fixture', workspace: context, serviceHome: context, configDirectory: context };
    const setup = runtimeBindings(base, settings, request.agent)[`runtime:${runtime}`];
    if (!setup) throw Error('Runtime unavailable');
    const state = initialState({ ...setup, agentSecret: secret }, createGenesis(owner, request.agent, request.host));
    attempt = { request, setup, state };
    writePrivate(recordPath, attempt, true);
  }
  // Recovery permits a new explicit intent but only the exact retained inert state.
  if (existsSync(path)) {
    if (semanticHash(readPrivate(path)) !== semanticHash(attempt.state)) throw Error('Retained journal changed; refusing enrollment reset');
  } else writePrivate(path, attempt.state, true);
  const setupId = request.agent, setup = { ...attempt.setup, agentSecret: secret };
  const entry: SlotEntry = { agent: request.agent, path, setupId, setup, keyPresent: true, bindings: { [setupId]: setup, ...runtimeBindings(setup, settings, request.agent) } };
  const manifest = previous ?? { version: 3 as const, host: request.host, ownerPublic: owner, setups: {}, agents: {} };
  const { host: _host, ownerPublic: _owner, ...harness } = attempt.setup;
  manifest.setups[setupId] = harness;
  manifest.agents[request.agent] = { key: ref, setup: setupId };
  const bindingsFor = (base: Setup) => Object.fromEntries(Object.entries(manifest.setups).map(([id,harness]) => [id,validateSetup({...harness,host:request.host,ownerPublic:owner,...(base.agentSecret ? {agentSecret:base.agentSecret} : {})})]));
  Object.assign(entry.bindings,bindingsFor(setup));
  return { existing: false as const, entry, bindingsFor, commit() {
    signal.throwIfAborted();
    writePrivate(manifestPath, manifest);
  } };
}
