import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { managerCredential } from '../src/manager-credential.ts';

const key = 'a'.repeat(64);
function helper(source: string) {
  const path = join(mkdtempSync(join(tmpdir(), 'beehive-receipt-')), 'helper.mjs');
  writeFileSync(path, source, { mode: 0o600 });
  return pathToFileURL(path);
}

test('registration helper completion requires a matching durable public receipt', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    managerCredential({ action: 'register-agent', publicKey: key }, signal,
      helper("process.once('message',()=>{process.send({ok:true});process.disconnect()})")),
    /completion was not verified/,
  );
  await assert.rejects(
    managerCredential({ action: 'register-agent', publicKey: key }, signal,
      helper("process.once('message',()=>{process.send({ok:true,registration:{publicKey:'b'.repeat(64),settingsRevision:2}});process.disconnect()})")),
    /completion was not verified/,
  );
  const result = await managerCredential({ action: 'register-agent', publicKey: key }, signal,
    helper(`process.once('message',()=>{process.send({ok:true,registration:{publicKey:'${key}',settingsRevision:2}});process.disconnect()})`));
  assert.deepEqual(result.registration, { publicKey: key, settingsRevision: 2 });
});
