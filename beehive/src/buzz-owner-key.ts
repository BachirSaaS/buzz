import { loadNativeEntry } from './native-credentials.ts';
import { agentNsec } from './settings-credentials.ts';
import { publicKey } from './protocol.ts';

/** Release Desktop source contract: secret_store.rs BLOB_KEY; app_state.rs
 * IDENTITY_KEY_NAME; app_state_keyring.rs keyring_service (6d1f488d).
 * The containing item also holds agent keys. Never return it, enumerate its
 * members, migrate legacy entries, or call a write API. Explicit sign-in only. */
export function readBuzzOwnerKey(owner: string, read: () => string | null = () => new (loadNativeEntry())('buzz-desktop', 'secrets').getPassword()): { ok: true; secret: string } | { ok: false; reason: 'missing' | 'access' | 'malformed' | 'mismatch' } {
  let raw: string | null;
  try { raw = read(); } catch { return { ok: false, reason: 'access' }; }
  if (raw === null) return { ok: false, reason: 'missing' };
  let secret: string;
  try {
    if (raw.length > 1024 * 1024) throw Error();
    const blob = JSON.parse(raw);
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) throw Error();
    if (!Object.hasOwn(blob, 'identity')) return { ok: false, reason: 'missing' };
    if (typeof blob.identity !== 'string') throw Error();
    secret = agentNsec(blob.identity);
  } catch { return { ok: false, reason: 'malformed' }; }
  if (publicKey(secret) !== owner) return { ok: false, reason: 'mismatch' };
  return { ok: true, secret };
}

/** Fixed messages only: native/parser errors may contain secrets. */
export const buzzOwnerKeyErrors: Record<string, string> = {
  missing: 'No Buzz owner key found in Keychain. No fallback was used. Sign in to Buzz or choose a saved/imported Beehive key.',
  access: 'Buzz key access did not complete: Keychain may be locked, denied, cancelled, or unavailable. No key was changed.',
  malformed: 'Buzz Keychain owner key is malformed. No key or configured owner was changed.',
  mismatch: 'Buzz key does not match the configured Beehive owner. No owner, relay, or key was changed.',
};
