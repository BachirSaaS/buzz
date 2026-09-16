import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schnorr } from '@noble/curves/secp256k1';
import { finalizeEvent, verifyEvent, type Event } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';
import { message, newKey, publicKey, digest, type Message } from '../src/protocol.ts';
import { ManagerController, type ManagerSnapshot } from '../src/manager-controller.ts';
import { fetchRelayDirectory } from '../src/relay-directory.ts';
import { managementClient } from '../src/intents.ts';
import { bootstrapHostIdentity } from '../src/host-identity.ts';
import { privateHostTransport } from '../src/host-transport.ts';
import { createControllerConfig } from '../src/controller-config.ts';
import { provisionCredentialSlot } from '../src/credential-slots.ts';
import { createGenesis } from '../src/assignment.ts';
import { createCredential } from '../src/credential-store.ts';
import { registerAgent, agentNsec, addOpenAI } from '../src/settings-credentials.ts';
import { readSettings, saveSettings } from '../src/settings.ts';
import { host } from '../src/host.ts';
import { isolatedFileCredentials } from './isolated-file-credentials.ts';
import { nostrFixture } from './nostr-fixture.ts';

/** Product-shaped synthetic fixture. Real private relay, owner authentication,
 * host and owned ACP process. Public assignment is pre-provisioned explicitly by
 * this test, NOT derived by registration from directory metadata or nsec custody. */
export async function registrationFixture(home: string, changed: (s: ManagerSnapshot) => void, assigned = true, move = false) {
  home = realpathSync(home);
  if (!home.includes('beehive-pairing-cli-')) throw Error('Fresh explicit fixture HOME required');
  const credentials = isolatedFileCredentials(join(home,'credentials.json'));
  const ownerSecret = '1'.repeat(64), owner = publicKey(ownerSecret), agentSecret = '2'.repeat(64), agent = publicKey(agentSecret), relaySecret = newKey();
  const now = Math.floor(Date.now()/1000);
  const policy = finalizeEvent({kind:30177,created_at:now,tags:[['d',agent]],content:JSON.stringify({name:'Review agent',parallelism:1,respond_to:'owner-only'})},Buffer.from(ownerSecret,'hex'));
  const profile = finalizeEvent({kind:0,created_at:now,tags:[['auth',owner,'',Buffer.from(schnorr.sign(digest(`nostr:agent-auth:${agent}:`),ownerSecret)).toString('hex')]],content:JSON.stringify({name:'Review agent'})},Buffer.from(agentSecret,'hex'));
  const errors: unknown[] = [], ids = new Set<string>();
  const members = new Set([owner]); let url = '';
  const relay = await nostrFixture(owner,members,{open:true},(req,res) => {
    if (req.method === 'GET' && req.url === '/') { res.end(JSON.stringify({self:publicKey(relaySecret),name:'Synthetic relay'})); return true; }
    if (req.method !== 'POST' || req.url !== '/query') return false;
    let body = ''; req.on('data',chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('end',() => {
      try {
        const auth = JSON.parse(Buffer.from(String(req.headers.authorization).slice(6),'base64').toString()) as Event;
        if (!verifyEvent(auth) || auth.pubkey !== owner || auth.kind !== 27235 || ids.has(auth.id) || !auth.tags.some(t => t[0] === 'u' && t[1] === url.replace('ws:','http:')+'/query') || !auth.tags.some(t => t[0] === 'method' && t[1] === 'POST') || !auth.tags.some(t => t[0] === 'payload' && t[1] === digest(body).toString('hex'))) throw Error('Invalid synthetic directory authentication');
        ids.add(auth.id);
        const filters = JSON.parse(body); if (!Array.isArray(filters) || filters.length > 10) throw Error('Invalid fixture filters');
        const events = filters.flatMap(f => [policy,profile].filter(e => f.kinds.includes(e.kind) && f.authors.includes(e.pubkey) && (!f['#d'] || e.tags.some(t => t[0] === 'd' && f['#d'].includes(t[1])))));
        res.end(JSON.stringify(events));
      } catch (error) { errors.push(error); res.writeHead(403); res.end('{}'); }
    }); return true;
  });
  url = relay.url;
  const directory = join(home,'.beehive','host');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const identity = bootstrapHostIdentity(directory,'Review host',owner,url,credentials);
  createCredential('owner',ownerSecret,credentials);
  createControllerConfig(join(home,'.beehive','owner'),owner,url);
  const setup = {host:identity.pairing.host,ownerPublic:owner,runner:realpathSync(process.execPath),args:['-e','setInterval(()=>{},1000)'],workspace:home,mode:'fixture' as const,serviceHome:home,configDirectory:home};
  const genesis = createGenesis(owner,agent,identity.pairing.host);
  if (assigned) provisionCredentialSlot(directory,setup,agentSecret,genesis,credentials);
  let providerKey: string | null = null;
  addOpenAI(directory,'Review OpenAI','synthetic-provider-key',{read:()=>providerKey,create:(_r,v)=>{providerKey=v;}});
  const executable = join(home,'synthetic-acp');
  writeFileSync(executable,`#!/bin/sh\n[ "$REVIEW_MODE" = synthetic ] || exit 9\nexec '${process.execPath}' '${fileURLToPath(new URL('./acp-fixture.ts',import.meta.url))}' openai\n`,{mode:0o700});
  const settings = readSettings(directory), runtimeId = 'review-runtime';
  saveSettings(directory,{...settings,runtimes:[{id:runtimeId,name:'Review runtime',harness:'buzz-agent',executable,providerId:settings.providers[0]!.id,model:'gpt-5',effort:'high',environment:{REVIEW_MODE:'synthetic'}}]},settings.revision);
  let providerFailure = false;
  let holdPrepared = false, dropGrant = false, holdEnrollment = false;
  const held: (()=>void)[] = [];
  const faultTransport = (transport: ReturnType<typeof privateHostTransport>) => {
    const original = transport.connect.bind(transport);
    transport.connect = (...args) => {
      const wire = original(...args), send = wire.send.bind(wire);
      wire.send = (m: Message) => {
        if (m.type === 'grant' && dropGrant) return;
        if (m.type === 'receipt' && m.revision === 0 && holdEnrollment) { held.push(()=>send(m)); return; }
        if (m.type === 'prepared' && holdPrepared) { held.push(()=>send(m)); return; }
        send(m);
      };
      return wire;
    };
    return transport;
  };
  const service = await host(directory,url,undefined,faultTransport(privateHostTransport(identity.pairing,identity.secret)),credentials,async (_input,signal) => { signal.throwIfAborted(); if (providerFailure) throw Error('Synthetic provider failure'); return {ok:true,secret:'synthetic-provider-key'}; });
  let destination: {directory:string; host:string; credentials:ReturnType<typeof isolatedFileCredentials>; service: Awaited<ReturnType<typeof host>>} | undefined;
  if (move) {
    const directory = join(home,'destination'); mkdirSync(directory,{mode:0o700});
    const peerCredentials = isolatedFileCredentials(join(directory,'credentials.json'));
    const peer = bootstrapHostIdentity(directory,'Destination host',owner,url,peerCredentials);
    if (assigned) provisionCredentialSlot(directory,{...setup,host:peer.pairing.host},agentSecret,genesis,peerCredentials);
    else {
      saveSettings(directory,{...readSettings(directory),providers:readSettings(join(home,'.beehive','host')).providers,runtimes:readSettings(join(home,'.beehive','host')).runtimes},0);
      registerAgent(directory,agentSecret,peerCredentials,{profileState:'none'},runtimeId,readSettings(directory).revision);
    }
    destination = {directory,host:peer.pairing.host,credentials:peerCredentials,service:await host(directory,url,undefined,faultTransport(privateHostTransport(peer.pairing,peer.secret)),peerCredentials,async()=>({ok:true,secret:'synthetic-provider-key'}))};
    if (!assigned) {
      let report: Message | undefined;
      const c = managementClient(join(home,'destination-enrollment'),url,ownerSecret,m=>{if(m.type==='inventory' && m.host===peer.pairing.host) report=m;},()=>{},{catalog:{version:1,owner,relay:url,registrations:[]}});
      try {
        await c.ready;
        const send = async (m:Message) => {
          c.submit(m);
          for(let n=0;n<400;n++) {
            const result=c.status().find(s=>s.request.id===m.id);
            if(result?.state==='failed') throw Error(String(result.result));
            if(result?.state==='completed' && report) return;
            await delay(20);
          }
          throw Error('Destination local enrollment evidence missing');
        };
        await send(message('enroll',peer.pairing.host,agent,0,{runtime:runtimeId,settingsRevision:readSettings(directory).revision}));
        await send(message('start',peer.pairing.host,agent,report!.revision));
        for(let n=0;n<400 && report?.body.phase!=='running';n++) await delay(20);
        await send(message('stop',peer.pairing.host,agent,report!.revision));
        for(let n=0;n<400 && report?.body.phase!=='stopped';n++) await delay(20);
      } finally { c.close(); }
    }
  }
  let credentialFailure = false, beforeCredential: (() => Promise<void>) | undefined, afterCredential: (() => Promise<void>) | undefined;
  const credential = async (input: any, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (input.action === 'signin') return {ok:true,secret:ownerSecret};
    if (input.action === 'models') return {ok:true,models:['gpt-5']};
    if (input.action !== 'register-agent') throw Error('Fixture denies external credential operation');
    await beforeCredential?.(); signal.throwIfAborted();
    if (credentialFailure) throw Error('Synthetic credential failure');
    registerAgent(directory,agentNsec(input.secret),credentials,input.profile,input.runtimeId,input.expectedRevision);
    await afterCredential?.();
    return {ok:true};
  };
  const controller = new ManagerController(home,changed,credential,managementClient,async()=> 'Synthetic relay',fetchRelayDirectory,async()=>({profileState:'found',profile:{relay:url,name:'Review agent'}}));
  const originalClose = controller.close.bind(controller); let closing: Promise<void> | undefined;
  const close = () => closing ??= (async()=>{ originalClose(); await service.close(); await destination?.service.close(); await relay.close(); })();
  controller.close = () => { void close(); };
  return {controller,close,directory,agent,destination,ownerSecret,url,setHoldEnrollment(v:boolean){holdEnrollment=v;},setHoldPrepared(v:boolean){holdPrepared=v;},setDropGrant(v:boolean){dropGrant=v;},get heldPrepared(){return held.length;},releasePrepared(){holdPrepared=false;holdEnrollment=false;for(const send of held.splice(0))send();},host:identity.pairing.host,runtimeId,nsec:nsecEncode(Buffer.from(agentSecret,'hex')),errors,credentials,relay,service,setCredentialFailure(v:boolean){credentialFailure=v;},setProviderFailure(v:boolean){providerFailure=v;},beforeCredential(fn?:()=>Promise<void>){beforeCredential=fn;},afterCredential(fn?:()=>Promise<void>){afterCredential=fn;}};
}

/** Installed walkthrough uses the same real synthetic lifecycle fixture as tests. */
export async function walkthroughController(home: string, changed: (s: ManagerSnapshot) => void) {
  const fixture = await registrationFixture(home,changed,false,true);
  return fixture.controller;
}
