import { serviceStatus, startService, stopService } from '../src/host-service.ts';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { bootstrapHostIdentity } from '../src/host-identity.ts';
import { resetHost } from '../src/host-reset.ts';
import type { HostDependencies } from '../src/owner-service.ts';
import type { CredentialBackend } from '../src/credential-store.ts';
/** Explicit fixture only: no OS credentials or relay. File survives child restart. */
export function fixtureHostDependencies(home: string): HostDependencies {
  const path = join(home, 'synthetic-host-keys.json');
  const read = (): Record<string, string> => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const credentials: CredentialBackend = {
    read: ref => read()[`${ref.role}:${ref.publicKey}`] ?? null,
    create: (ref, secret) => { const keys = read(); keys[`${ref.role}:${ref.publicKey}`] = secret; writeFileSync(path, JSON.stringify(keys), { mode: 0o600 }); },
    remove: ref => { const keys = read(); delete keys[`${ref.role}:${ref.publicKey}`]; writeFileSync(path, JSON.stringify(keys), { mode: 0o600 }); },
  };
  const realService = existsSync(join(home, 'host-service-mode'));
  return {
    credential: async (input: any, signal) => { signal.throwIfAborted(); bootstrapHostIdentity(input.directory, input.label, input.owner, input.relay, credentials, input.ownerDirectory); return { ok: true }; },
    status: realService ? serviceStatus : async () => ({ state: 'stopped' }),
    start: realService ? directory => startService(directory, new URL('./host-tui-service-child.ts', import.meta.url)) : async () => { throw Error('Fixture start not configured'); },
    stop: realService ? stopService : async () => { throw Error('Fixture stop not configured'); },
    reset: (directory, ownerDirectory, owner, relay, revision, signal) => resetHost(directory, ownerDirectory, owner, relay, revision, signal, async ref => { if (existsSync(join(home, 'reset-denied'))) throw Error('Synthetic OS denial'); credentials.remove(ref); if (credentials.read(ref) !== null) throw Error('Deletion failed'); }),
  };
}
