import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { desktopOwnerKey } from '../src/owner-key.ts';
import { nip19 } from 'nostr-tools';
test('native adapter handles metadata, explicit identity, malformed/denied output and abort without a real Keychain', async () => {
  const home = mkdtempSync('/tmp/owner-key-adapter-'), executable = home+'/helper';
  const nsec = nip19.nsecEncode(Buffer.from('1'.repeat(64),'hex'));
  const helper = (body: string) => writeFileSync(executable, `#!${process.execPath}\n${body}`, {mode:0o700});
  try {
    helper(`let input='';process.stdin.on('data',v=>input+=v);process.stdin.on('end',()=>console.log(JSON.stringify(input==='probe'?{available:true}:{identity:${JSON.stringify(nsec)}})));`);
    assert.deepEqual(await desktopOwnerKey(true,new AbortController().signal,executable),{available:true});
    assert.deepEqual(await desktopOwnerKey(false,new AbortController().signal,executable),{secret:'1'.repeat(64)});
    for(const value of [{reason:'access'},{identity:'malformed'},{agent:nsec}]) {
      helper(`console.log(${JSON.stringify(JSON.stringify(value))})`);
      assert.equal((await desktopOwnerKey(false,new AbortController().signal,executable)).secret,undefined);
    }
    helper(`process.stdin.resume();setTimeout(()=>console.log(JSON.stringify({identity:${JSON.stringify(nsec)}})),30000);`);
    const abort = new AbortController(), pending=desktopOwnerKey(false,abort.signal,executable);
    abort.abort(); assert.deepEqual(await pending,{reason:'access'});
    helper(`console.log('x'.repeat(5000))`);
    assert.equal((await desktopOwnerKey(false,new AbortController().signal,executable)).secret,undefined);
  } finally {rmSync(home,{recursive:true,force:true});}
});
