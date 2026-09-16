import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDatabricks, databricksHost, databricksNative } from '../src/databricks.ts';
import { readSettings } from '../src/settings.ts';
import { buzzProviderEnvironment } from '../src/buzz-provider.ts';

// Saving the environment-provided workspace is configuration only: no browser,
// network, or OS credential access occurs until a later explicit operation needs it.
test('workspace save is immediate and keyless; cancellation before save never publishes',async () => {
  const dir=mkdtempSync(join(tmpdir(),'beehive-db-test-'));
  try {
    await addDatabricks(dir,'Fixture','https://fixture.example/',new AbortController().signal);
    const provider=readSettings(dir).providers[0]!;
    assert.equal(provider.type,'databricks_v2'); assert.equal(provider.endpoint,'https://fixture.example');
    const env=buzzProviderEnvironment({ provider:'databricks_v2',auth:'token',baseUrl:provider.endpoint,credential:provider.key,models:['fixture-model'] },'/synthetic/home','/synthetic/config','fixture-model','synthetic-bearer');
    assert.equal(env.DATABRICKS_TOKEN,'synthetic-bearer'); assert.equal(env.DATABRICKS_HOST,provider.endpoint); assert.equal(env.BUZZ_AGENT_MODEL,'fixture-model');
    const abort=new AbortController(); abort.abort();
    await assert.rejects(addDatabricks(dir,'Late','https://fixture.example',abort.signal),/abort/i);
    assert.equal(readSettings(dir).providers.length,1);
    for (const name of readdirSync(dir)) if (name.endsWith('.json')) assert.ok(!readFileSync(join(dir,name),'utf8').includes('synthetic-bearer'));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('workspace validation rejects credential and callback confusion',() => {
  for (const value of ['http://fixture.example','https://user:pass@fixture.example','https://fixture.example/a','https://fixture.example?x=y','https://fixture.example#f','https://127.0.0.1','https://fixture.example:8080']) assert.throws(() => databricksHost(value));
});
test('owned native pipe cancellation waits for close; no real native/browser/OS access',async () => {
  const dir=mkdtempSync(join(tmpdir(),'beehive-db-pipe-'));
  try {
    const helper=join(dir,'helper'); writeFileSync(helper,'#!/bin/sh\nexec /bin/sleep 60\n',{mode:0o700});
    const abort=new AbortController(); const promise=databricksNative({action:'login',host:'https://fixture.example',key:{service:'beehive',account:'provider:00000000-0000-0000-0000-000000000000'}},abort.signal,helper);
    abort.abort(); await assert.rejects(promise,/cancelled/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
