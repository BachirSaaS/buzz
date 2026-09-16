import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { schnorr } from '@noble/curves/secp256k1';
import { finalizeEvent, verifyEvent, type Event } from 'nostr-tools/pure';
import { directoryHttp, directoryProfileOwner, relayDirectory, type DirectoryFilter, type DirectoryQuery } from '../src/relay-directory.ts';
import { digest, newKey, publicKey } from '../src/protocol.ts';
const viewerSecret = newKey(), viewer = publicKey(viewerSecret), relaySecret = newKey(), relay = publicKey(relaySecret);
const aSecret = newKey(), a = publicKey(aSecret), bSecret = newKey(), b = publicKey(bSecret), otherSecret = newKey(), other = publicKey(otherSecret);
const event = (secret: string, kind: number, tags: string[][], value: unknown, created_at = 100) => finalizeEvent({kind,tags,content:JSON.stringify(value),created_at},Buffer.from(secret,'hex'));
const policy = (secret: string, agent: string, name: string) => event(secret,30177,[['d',agent]],{ name,parallelism:1,respond_to:'owner-only' });
const profile = (secret: string, ownerSecret: string, conditions = '') => {
  const sig = Buffer.from(schnorr.sign(digest(`nostr:agent-auth:${publicKey(secret)}:${conditions}`),ownerSecret)).toString('hex');
  return event(secret,0,[['auth',publicKey(ownerSecret),conditions,sig]],{});
};
const member = (tags = [['p',viewer],['p',b,'','bot']]) => event(relaySecret,39002,[['d','channel'],...tags],{});
function queryFixture(events: Event[], calls: DirectoryFilter[][] = []): DirectoryQuery {
  return { async self() { return relay; }, async query(filters,signal) {
    signal.throwIfAborted(); calls.push(structuredClone(filters));
    return filters.flatMap(f => events.filter(e => f.kinds.includes(e.kind) && f.authors.includes(e.pubkey) && (!f['#d'] || e.tags.some(t => t[0] === 'd' && f['#d']!.includes(t[1]!))) && (!f['#p'] || e.tags.some(t => t[0] === 'p' && f['#p']!.includes(t[1]!))) && (f.until === undefined || e.created_at < f.until || e.created_at === f.until && (!f.before_id || e.id < f.before_id))).sort((a,b) => b.created_at-a.created_at || b.id.localeCompare(a.id)).slice(0,f.limit));
  } };
}
const signal = () => new AbortController().signal;

test('full canonical discovery finds viewer-owned channel-less and cross-owner membership-visible agents, not arbitrary kind0 or host metadata', async () => {
  const calls: DirectoryFilter[][] = [];
  const result = await relayDirectory(viewer,queryFixture([
    policy(viewerSecret,a,'Owned'), profile(aSecret,viewerSecret),
    member(), profile(bSecret,otherSecret),policy(otherSecret,b,'Shared'),
    event(bSecret,10100,[],{name:'Old name',status:'online',host:'fake-execution-authority',channel_ids:['forged']}),
    profile(newKey(),viewerSecret),policy(otherSecret,a,'Forged policy'),
  ],calls),signal());
  assert.deepEqual(result,[{publicKey:a,name:'Owned',owner:viewer,status:'unknown',channels:[]},{publicKey:b,name:'Shared',owner:other,status:'online',channels:['channel']}]);
  assert.deepEqual(calls[0],[{kinds:[30177],authors:[viewer],limit:500}]);
  assert.deepEqual(calls[1],[{kinds:[39002],authors:[relay],'#p':[viewer],limit:500}]);
  for (const batch of calls.slice(2)) { assert.ok(batch.length <= 10); for (const f of batch) { assert.equal(f.authors.length,1); assert.equal(f.limit,1); } }
  const policies = calls.flat().filter(f => f.kinds[0] === 30177 && f['#d']);
  assert.deepEqual(new Set(policies.map(f => JSON.stringify(f))),new Set([{kinds:[30177],authors:[viewer],'#d':[a],limit:1},{kinds:[30177],authors:[other],'#d':[b],limit:1}].map(v=>JSON.stringify(v))));
});

test('membership role, current membership removal, verified owner and malformed latest policy control discovery', async () => {
  const legacy = event(bSecret,10100,[],{name:'Legacy',status:'running'});
  assert.equal((await relayDirectory(viewer,queryFixture([legacy,member([['p',viewer],['p',b]])]),signal())).length,0);
  const known = policy(viewerSecret,b,'Seed only');
  const result = await relayDirectory(viewer,queryFixture([known,legacy,member([['p',viewer],['p',b]])]),signal());
  assert.equal(result[0]?.status,'unknown'); assert.equal(result[0]?.owner,undefined);
  assert.equal((await relayDirectory(viewer,queryFixture([known,legacy]),signal())).length,0,'unverified owned coordinate alone does not retain a legacy agent');
  const removed = event(relaySecret,39002,[['d','channel'],['p',viewer]],{},101);
  assert.equal((await relayDirectory(viewer,queryFixture([legacy,member(),removed]),signal())).length,0);
  const malformed = event(otherSecret,30177,[['d',b]],{name:'Missing required fields'});
  assert.equal((await relayDirectory(viewer,queryFixture([legacy,member(),profile(bSecret,otherSecret),malformed]),signal())).length,0,'malformed authenticated policy reserves identity instead of reviving legacy');
});

test('NIP-OA requires one canonical tag and checks every condition against profile timestamp', () => {
  assert.equal(directoryProfileOwner(profile(aSecret,viewerSecret,'kind=0&created_at>99&created_at<101')),viewer);
  for (const condition of ['kind=1','kind=0&kind=1','created_at<100','created_at>100','kind=00','created_at<4294967296']) assert.equal(directoryProfileOwner(profile(aSecret,viewerSecret,condition)),undefined);
  const signed = profile(aSecret,viewerSecret);
  assert.equal(directoryProfileOwner(event(aSecret,0,[...signed.tags,['auth']],{})),undefined);
  assert.equal(directoryProfileOwner({...signed,content:'changed'}),undefined);
  assert.equal(directoryProfileOwner(event(aSecret,0,[['auth',viewer,'','0'.repeat(128)]],{})),undefined);
});

test('latest kind0 revocation prevents an older association from authorizing policy', async () => {
  const revoked = event(aSecret,0,[],{},101);
  const result = await relayDirectory(viewer,queryFixture([policy(viewerSecret,a,'Owned'),profile(aSecret,viewerSecret),revoked]),signal());
  assert.deepEqual(result,[]);
});

test('pagination uses equal-time before_id cursor and rejects repeated pages rather than claiming an empty directory', async () => {
  const rows = Array.from({length:501},(_,n) => event(viewerSecret,30177,[['d',String(n)]],{},100));
  const calls: DirectoryFilter[][] = [];
  assert.deepEqual(await relayDirectory(viewer,queryFixture(rows,calls),signal()),[]);
  assert.equal(calls[1]![0]!.until,100); assert.match(calls[1]![0]!.before_id!,/^[a-f0-9]{64}$/);
  const base = queryFixture(rows);
  await assert.rejects(relayDirectory(viewer,{...base,query: async filters => filters[0]!.kinds[0] === 30177 ? rows.slice(0,500) : []},signal()),/cursor did not advance/);
});

test('query scope, forged signatures, transport failures and late cancellation fail closed', async () => {
  const base = queryFixture([]);
  await assert.rejects(relayDirectory(viewer,{...base,self:async()=>''},signal()),/authority/);
  await assert.rejects(relayDirectory(viewer,{...base,query:async()=>[policy(otherSecret,a,'Foreign')]},signal()),/scope/);
  await assert.rejects(relayDirectory(viewer,{...base,query:async()=>[{...policy(viewerSecret,a,'Owned'),content:'forged'}]},signal()),/scope/);
  await assert.rejects(relayDirectory(viewer,{...base,query:async()=>{throw Error('synthetic unavailable');}},signal()),/synthetic unavailable/);
  const abort = new AbortController();
  await assert.rejects(relayDirectory(viewer,{...base,query:async()=>{abort.abort(); return [];}},abort.signal),/abort/i);
});

test('actual HTTP relay adapter signs each exact query with viewer NIP-98, payload hash and unique nonce; bounded response and cancellation', async t => {
  const events = [policy(viewerSecret,a,'Owned'),profile(aSecret,viewerSecret)];
  const fixture = queryFixture(events), requests: Event[] = [], errors: unknown[] = [];
  let origin = '';
  const server = createServer(async (req,res) => {
    try {
      assert.ok(req.url === '/' || req.url === '/query');
      if (req.method === 'GET') { assert.equal(req.headers.authorization,undefined); assert.equal(req.headers.accept,'application/nostr+json'); res.end(JSON.stringify({self:relay,name:'Synthetic'})); return; }
      const bytes: Buffer[] = []; for await (const chunk of req) bytes.push(chunk);
      const body = Buffer.concat(bytes).toString();
      const signed = JSON.parse(Buffer.from(req.headers.authorization!.slice(6),'base64').toString()) as Event;
      assert.ok(verifyEvent(signed)); assert.equal(signed.pubkey,viewer); assert.equal(signed.kind,27235);
      assert.ok(signed.tags.some(t => t[0] === 'u' && t[1] === origin+'/query'));
      assert.ok(signed.tags.some(t => t[0] === 'method' && t[1] === 'POST'));
      assert.ok(signed.tags.some(t => t[0] === 'payload' && t[1] === digest(body).toString('hex')));
      assert.ok(signed.tags.some(t => t[0] === 'nonce' && t[1])); requests.push(signed);
      res.end(JSON.stringify(await fixture.query(JSON.parse(body),signal())));
    } catch (error) { errors.push(error); res.writeHead(500);res.end(); }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const adapter = directoryHttp(origin.replace('http:','ws:'),viewerSecret);
  assert.equal((await relayDirectory(viewer,adapter,signal()))[0]?.name,'Owned');
  assert.deepEqual(errors,[]); assert.equal(new Set(requests.map(e=>e.id)).size,requests.length);
  const denied = directoryHttp('wss://fixture.invalid',viewerSecret,async()=>new Response('',{status:403}));
  await assert.rejects(denied.self(signal()),/HTTP 403/);
  const oversized = directoryHttp('wss://fixture.invalid',viewerSecret,async()=>new Response('x'.repeat(32769)));
  await assert.rejects(oversized.self(signal()),/exceeds limit/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(adapter.self(aborted.signal),/abort/i);
});
