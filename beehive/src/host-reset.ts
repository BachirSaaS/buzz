import { existsSync, mkdirSync, rmdirSync, rmSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { managerCredential } from './manager-credential.ts';
import { semanticHash } from './handoff.ts';
import { readPrivate, writePrivate } from './storage.ts';
import { readHostIdentityPublic } from './host-identity.ts';
import { readControllerConfig } from './controller-config.ts';
import { readSettings, validateSettings } from './settings.ts';
import { readCredentialManifest } from './credential-slots.ts';
import { credentialReference, type CredentialReference } from './credential-store.ts';

export const resetPath = (directory: string) => join(directory, 'host-reset.json');
type Reset = { version: 1; owner: string; relay: string; host: string; references: CredentialReference[] };
export function pendingHostReset(directory: string): Reset | undefined {
  if (!existsSync(resetPath(directory))) return;
  const value = readPrivate(resetPath(directory)) as Reset;
  if (value.version !== 1 || !/^[0-9a-f]{64}$/.test(value.owner) || !/^[0-9a-f]{64}$/.test(value.host) || typeof value.relay !== 'string' || !Array.isArray(value.references)) throw Error('Invalid reset recovery');
  for (const ref of value.references) if (!['host', 'agent'].includes(ref.role) || JSON.stringify(ref) !== JSON.stringify(credentialReference(ref.role, ref.publicKey))) throw Error('Invalid reset credential');
  return value;
}
/** Public confirmation token covers the exact identity, catalog and custody manifest. */
export function hostResetRevision(directory: string) {
  return semanticHash(['host-identity.json', 'settings.json', 'setup.json', 'credential-attempts.json', 'host-reset.json'].map(file => existsSync(join(directory, file)) ? readPrivate(join(directory, file)) : null));
}
/** Explicit destructive operation only. The recovery record precedes any deletion.
 * OS failures keep binding + recovery scope; retries remove exact entries idempotently.
 * Locks are shared with detached launch, foreground Host, provisioning and catalog writes.
 */
export async function resetHost(directory: string, ownerDirectory: string, owner: string, relay: string, expected: string, signal: AbortSignal, remove = async (reference: CredentialReference, signal: AbortSignal) => { await managerCredential({ action: 'remove-host-credential', reference }, signal); }) {
  const acquired: string[] = [];
  const lock = (path: string) => { mkdirSync(path, { mode: 0o700 }); acquired.push(path); };
  try {
    signal.throwIfAborted();
    lock(join(directory, 'service.lock'));
    if (existsSync(join(directory, 'service.json')) || existsSync(join(directory, 'service.sock'))) throw Error('Service not verified stopped');
    lock(join(directory, 'host.lock')); lock(join(directory, 'settings.lock'));
    mkdirSync(ownerDirectory, { recursive: true, mode: 0o700 }); lock(join(ownerDirectory, 'controller.lock'));
    if (hostResetRevision(directory) !== expected) throw Error('Host changed');
    const binding = readControllerConfig(ownerDirectory);
    if (binding && (binding.owner !== owner || binding.relay !== relay)) throw Error('Owner binding changed');
    const settings = readSettings(directory);
    let reset = pendingHostReset(directory);
    if (!reset) {
      const identity = readHostIdentityPublic(directory);
      if (identity.pairing.owner !== owner || identity.pairing.relay !== relay) throw Error('Host binding changed');
      const references = [credentialReference('host', identity.pairing.host), ...settings.agents.map(agent => agent.key)];
      if (existsSync(join(directory, 'setup.json'))) {
        const manifest = readCredentialManifest(directory);
        if (manifest.host !== identity.pairing.host || manifest.ownerPublic !== owner) throw Error('Foreign manifest');
        for (const agent of Object.keys(manifest.agents)) references.push(credentialReference('agent', agent));
      }
      // Interrupted registration/provisioning may have custody but no catalog row.
      const attempts = existsSync(join(directory, 'credential-attempts.json')) ? readPrivate(join(directory, 'credential-attempts.json')) as any[] : [];
      if (!Array.isArray(attempts)) throw Error('Invalid recovery references');
      for (const ref of attempts) if (ref.role === 'agent' || ref.role === 'host') {
        if (JSON.stringify(ref) !== JSON.stringify(credentialReference(ref.role, ref.publicKey))) throw Error('Invalid recovery reference');
        references.push(ref);
      }
      if (existsSync(join(directory, 'agents'))) for (const agent of readdirSync(join(directory, 'agents'))) {
        if (!/^[0-9a-f]{64}$/.test(agent)) throw Error('Unrecognized agent directory');
        references.push(credentialReference('agent', agent));
      }
      reset = { version: 1, owner, relay, host: identity.pairing.host, references: [...new Map(references.map(ref => [JSON.stringify(ref), ref])).values()] };
      writePrivate(resetPath(directory), reset, true);
    }
    if (reset.owner !== owner || reset.relay !== relay) throw Error('Reset belongs to another owner');
    for (const ref of reset.references) {
      signal.throwIfAborted(); await remove(ref, signal);
    }
    signal.throwIfAborted();
    // Keep machine-scoped providers, harnesses and reusable runtime definitions intact.
    writePrivate(join(directory, 'settings.json'), validateSettings({ ...settings, revision: settings.revision + 1, agents: [] }));
    const attemptsPath = join(directory, 'credential-attempts.json');
    if (existsSync(attemptsPath)) writePrivate(attemptsPath, (readPrivate(attemptsPath) as any[]).filter(ref => ref.role !== 'agent' && ref.role !== 'host'));
    for (const file of ['setup.json', 'journal.json', 'agents', 'host-identity.json']) rmSync(join(directory, file), { recursive: true, force: true });
    // Release the durable owner binding last. No owner secret or relay history is touched.
    rmSync(join(ownerDirectory, 'controller.json'), { force: true });
    unlinkSync(resetPath(directory));
  } finally { for (const path of acquired.reverse()) rmdirSync(path); }
}
