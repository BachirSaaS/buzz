import { randomUUID } from 'node:crypto';
import { schnorr } from '@noble/curves/secp256k1';
import { finalizeEvent, verifyEvent, type Event } from 'nostr-tools/pure';
import { digest, publicKey } from './protocol.ts';
import { metadataRelay } from './public-metadata.ts';

/** Discovery only: neither public ownership nor liveness grants host execution. */
export type DirectoryAgent = { publicKey: string; name: string; owner?: string; status: 'online' | 'away' | 'offline' | 'unknown'; channels: string[] };
/** Explicit synthetic seam; production queries use the authenticated HTTP bridge. */
export type DirectoryQuery = { self(signal: AbortSignal): Promise<string>; query(filters: DirectoryFilter[], signal: AbortSignal): Promise<Event[]> };
export type DirectoryFilter = { kinds: number[]; authors: string[]; limit?: number; until?: number; before_id?: string; '#p'?: string[]; '#d'?: string[] };
const key = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const tag = (e: Event, name: string) => e.tags.find(t => t[0] === name)?.[1];
const newer = (a: Event, b: Event) => a.created_at > b.created_at || a.created_at === b.created_at && a.id < b.id;
const clean = (v: unknown, fallback: string) => typeof v === 'string' && v.length <= 128 && !/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(v) ? v : fallback;
function valid(e: Event) { try { return verifyEvent({ id:e.id, pubkey:e.pubkey, kind:e.kind, created_at:e.created_at, tags:e.tags, content:e.content, sig:e.sig }); } catch { return false; } }
function content(e: Event): Record<string, unknown> | undefined { try { const v = JSON.parse(e.content); return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined; } catch { return undefined; } }
function latest(events: Event[], coordinate: (e: Event) => string | undefined) {
  const rows = new Map<string, Event>();
  for (const e of events) { const id = coordinate(e); if (id && (!rows.has(id) || newer(e,rows.get(id)!))) rows.set(id,e); }
  return rows;
}
/** Desktop profile provenance: exactly one auth tag; clauses apply to profile time,
 * not the current clock. This is deliberately not metadata publication authority. */
export function directoryProfileOwner(e: Event): string | undefined {
  if (e.kind !== 0 || !valid(e)) return;
  const tags = e.tags.filter(t => t[0] === 'auth'), a = tags[0];
  if (tags.length !== 1 || !a || a.length !== 4 || !key(a[1]) || a[1] === e.pubkey || !/^[0-9a-f]{128}$/.test(a[3]!)) return;
  const conditions = a[2]!;
  for (const clause of conditions ? conditions.split('&') : []) {
    const match = /^(kind=|created_at<|created_at>)(0|[1-9][0-9]*)$/.exec(clause); if (!match) return;
    const n = Number(match[2]);
    if (!Number.isSafeInteger(n) || n > (match[1] === 'kind=' ? 65535 : 4294967295)) return;
    if (match[1] === 'kind=' ? e.kind !== n : match[1] === 'created_at<' ? e.created_at >= n : e.created_at <= n) return;
  }
  try { if (schnorr.verify(a[3]!,digest(`nostr:agent-auth:${e.pubkey}:${conditions}`),a[1])) return a[1]; } catch { /* Invalid public signature is not ownership. */ }
}

/** Full Desktop directory rebuild semantics, with explicit finite resource bounds.
 * Failure never becomes an authoritative empty list. No kind0 enumeration, no
 * host reports as discovery seeds, and no retry loop. */
export async function relayDirectory(viewer: string, transport: DirectoryQuery, signal: AbortSignal): Promise<DirectoryAgent[]> {
  if (!key(viewer)) throw Error('Invalid directory viewer');
  signal.throwIfAborted();
  const authority = await transport.self(signal); signal.throwIfAborted();
  if (!key(authority)) throw Error('Relay membership authority unavailable');
  let requests = 0;
  async function query(filters: DirectoryFilter[]) {
    signal.throwIfAborted(); if (++requests > 650) throw Error('Directory query budget exceeded');
    const events = await transport.query(filters,signal); signal.throwIfAborted();
    if (!Array.isArray(events) || events.length > filters.reduce((n,f) => n + (f.limit ?? 500),0)) throw Error('Directory page exceeds limit');
    // Recheck exact scopes even on a synthetic/untrusted HTTP transport.
    if (!events.every(e => valid(e) && filters.some(f => f.kinds.includes(e.kind) && f.authors.includes(e.pubkey) && (!f['#p'] || e.tags.some(t => t[0] === 'p' && f['#p']!.includes(t[1]!))) && (!f['#d'] || f['#d'].includes(tag(e,'d')!))))) throw Error('Invalid directory event or query scope');
    return events;
  }
  async function pages(filter: DirectoryFilter) {
    const all: Event[] = [], cursors = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const page = await query([{ ...filter, limit:500 }]); all.push(...page);
      if (page.length < 500) return all;
      const last = page.at(-1)!, cursor = `${last.created_at}:${last.id}`;
      if (cursors.has(cursor)) throw Error('Directory cursor did not advance');
      cursors.add(cursor); filter = { ...filter, until:last.created_at, before_id:last.id };
    }
    throw Error('Directory pagination limit exceeded');
  }
  const owned = await pages({ kinds:[30177], authors:[viewer] });
  const known = new Set(owned.map(e => tag(e,'d')).filter(key));
  const membership = latest(await pages({ kinds:[39002], authors:[authority], '#p':[viewer] }),e => tag(e,'d'));
  const channels = new Map<string, Set<string>>();
  for (const [channel,e] of membership) for (const t of e.tags) {
    if (t[0] !== 'p' || !key(t[1]) || t[3] !== 'bot' && !known.has(t[1])) continue;
    if (!channels.has(t[1])) channels.set(t[1],new Set()); channels.get(t[1])!.add(channel);
  }
  const candidates = [...new Set([...known,...channels.keys()])];
  if (candidates.length > 1000) throw Error('Directory candidate limit exceeded');
  async function batches(filters: DirectoryFilter[]) {
    const events: Event[] = [];
    // Sequential batches are intentionally below Desktop's 8-request concurrency ceiling.
    for (let i = 0; i < filters.length; i += 10) events.push(...await query(filters.slice(i,i+10)));
    return events;
  }
  const exact = (kind: number) => candidates.map(author => ({ kinds:[kind],authors:[author],limit:1 }));
  const runtimes = latest(await batches(exact(10100)),e => e.pubkey);
  const profiles = latest(await batches(exact(0)),e => e.pubkey);
  const owners = new Map<string,string>();
  for (const [agent,e] of profiles) { const owner = directoryProfileOwner(e); if (owner) owners.set(agent,owner); }
  const policies = latest(await batches([...owners].map(([agent,owner]) => ({ kinds:[30177],authors:[owner],'#d':[agent],limit:1 }))),e => owners.get(tag(e,'d')!) === e.pubkey ? tag(e,'d') : undefined);
  const result: DirectoryAgent[] = [];
  for (const agent of candidates) {
    const runtime = runtimes.get(agent), policy = policies.get(agent), r = runtime ? content(runtime) : undefined;
    let row: DirectoryAgent | undefined;
    if (runtime) row = { publicKey:agent,name:clean(r?.name,clean(r?.display_name,agent)), status:['online','away','offline'].includes(String(r?.status)) ? r!.status as DirectoryAgent['status'] : 'unknown',channels:[] };
    if (policy) {
      const p = content(policy), status = row?.status ?? 'unknown';
      // A verified malformed current coordinate reserves the identity. Never revive
      // a legacy entry after malformed policy or tombstone-like empty content.
      row = undefined;
      if (p && typeof p.name === 'string' && Number.isInteger(p.parallelism) && Number(p.parallelism) >= 0 && Number(p.parallelism) <= 4294967295 && ['owner-only','allowlist','anyone'].includes(String(p.respond_to)) && (p.respond_to_allowlist === undefined || Array.isArray(p.respond_to_allowlist) && p.respond_to_allowlist.every(v => typeof v === 'string')) && ['persona_id','system_prompt','model','provider','persona_source_version'].every(k => p[k] === undefined || p[k] === null || typeof p[k] === 'string')) row = { publicKey:agent,name:clean(p.name,agent),owner:policy.pubkey,status,channels:[] };
    }
    if (row && (channels.has(agent) || row.owner === viewer)) result.push({ ...row,channels:[...(channels.get(agent) ?? [])].sort() });
  }
  return result.sort((a,b) => a.name.localeCompare(b.name) || a.publicKey.localeCompare(b.publicKey));
}

/** Actual canonical relay /query adapter. Owner credential stays inside Node;
 * signed NIP-98 includes payload hash and unique nonce, never a URL credential. */
export function directoryHttp(relay: string, secret: string, fetcher: typeof fetch = fetch): DirectoryQuery {
  const base = metadataRelay(relay); publicKey(secret);
  async function read(url: string, signal: AbortSignal, filters?: DirectoryFilter[]) {
    const body = filters ? JSON.stringify(filters) : undefined;
    const headers: Record<string,string> = { Accept:'application/nostr+json' };
    if (body) {
      const auth = finalizeEvent({ kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags:[['u',url],['method','POST'],['payload',digest(body).toString('hex')],['nonce',randomUUID()]] },Buffer.from(secret,'hex'));
      headers.Authorization = `Nostr ${Buffer.from(JSON.stringify(auth)).toString('base64')}`; headers['Content-Type'] = 'application/json';
    }
    const response = await fetcher(url,{ method:body ? 'POST' : 'GET',headers,body,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]) });
    if (!response.ok) { await response.body?.cancel(); throw Error(`Directory unavailable (HTTP ${response.status})`); }
    const reader = response.body?.getReader(); if (!reader) throw Error('Directory response missing');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { signal.throwIfAborted(); const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > (body ? 4_000_000 : 32768)) throw Error('Directory response exceeds limit'); chunks.push(part.value); } } finally { await reader.cancel(); reader.releaseLock(); }
    signal.throwIfAborted(); return JSON.parse(Buffer.concat(chunks).toString());
  }
  return { async self(signal) { const doc = await read(base,signal); const self = typeof doc?.self === 'string' ? doc.self.toLowerCase() : undefined; if (!key(self)) throw Error('Relay membership authority unavailable'); return self; }, async query(filters,signal) { return read(`${base}/query`,signal,filters); } };
}

/** One bounded rebuild; callers generation-fence publication and own refresh. */
export function fetchRelayDirectory(relay: string, secret: string, signal: AbortSignal) {
  return relayDirectory(publicKey(secret),directoryHttp(relay,secret),AbortSignal.any([signal,AbortSignal.timeout(30000)]));
}
