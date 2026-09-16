import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schnorr } from '@noble/curves/secp256k1';
import { finalizeEvent, verifyEvent, type Event } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';
import { newKey, publicKey, digest } from '../src/protocol.ts';
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
export async function registrationFixture(home: string, changed: (s: ManagerSnapshot) => void, assigned = true) {
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
  if (assigned) provisionCredentialSlot(directory,setup,agentSecret,createGenesis(owner,agent,identity.pairing.host),credentials);
  let providerKey: string | null = null;
  addOpenAI(directory,'Review OpenAI','synthetic-provider-key',{read:()=>providerKey,create:(_r,v)=>{providerKey=v;}});
  const executable = join(home,'synthetic-acp');
  writeFileSync(executable,`#!/bin/sh\n[ "$REVIEW_MODE" = synthetic ] || exit 9\nexec '${process.execPath}' '${fileURLToPath(new URL('./acp-fixture.ts',import.meta.url))}' openai\n`,{mode:0o700});
  const settings = readSettings(directory), runtimeId = 'review-runtime';
  saveSettings(directory,{...settings,runtimes:[{id:runtimeId,name:'Review runtime',harness:'buzz-agent',executable,providerId:settings.providers[0]!.id,model:'gpt-5',effort:'high',environment:{REVIEW_MODE:'synthetic'}}]},settings.revision);
  let providerFailure = false;
  const service = await host(directory,url,undefined,privateHostTransport(identity.pairing,identity.secret),credentials,async (_input,signal) => { signal.throwIfAborted(); if (providerFailure) throw Error('Synthetic provider failure'); return {ok:true,secret:'synthetic-provider-key'}; });
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
  const close = () => closing ??= (async()=>{ originalClose(); await service.close(); await relay.close(); })();
  controller.close = () => { void close(); };
  return {controller,close,directory,agent,host:identity.pairing.host,runtimeId,nsec:nsecEncode(Buffer.from(agentSecret,'hex')),errors,credentials,relay,service,setCredentialFailure(v:boolean){credentialFailure=v;},setProviderFailure(v:boolean){providerFailure=v;},beforeCredential(fn?:()=>Promise<void>){beforeCredential=fn;},afterCredential(fn?:()=>Promise<void>){afterCredential=fn;}};
}

/** Installed walkthrough uses the same real synthetic lifecycle fixture as tests. */
export async function walkthroughController(home: string, changed: (s: ManagerSnapshot) => void) {
  const fixture = await registrationFixture(home,changed);
  return fixture.controller;
}
