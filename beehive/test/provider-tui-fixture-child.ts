// Explicit test executable only. No native credential or network operations.
import { ProviderService } from '../src/provider-service.ts';
import { addProvider, editProvider, type ProviderCredentials } from '../src/settings-credentials.ts';
import { join } from 'node:path';
import { readSettings } from '../src/settings.ts';
const home = process.env.BEEHIVE_HOME;
if (!home || !home.includes('provider-tui-fixture-')) throw Error('Explicit fixture root required');
const directory = join(home, '.beehive', 'host');
const keys = new Map<string, string>();
const backend: ProviderCredentials = { read: ref => keys.get(ref.account) ?? null, create: (ref, value) => { keys.set(ref.account, value); } };
const service = new ProviderService(home, process.env, {
  credential: async (input: any, signal) => {
    if (input.action === 'add-provider') addProvider(directory, input.name, input.secret, backend, input.type, input.endpoint, input.wire, input.revision);
    else if (input.action === 'edit-provider') editProvider(directory, input.provider, input.revision, input.name, input.endpoint, input.wire, input.secret ?? '', backend);
    else if (input.action === 'models') {
      await new Promise(resolve => setTimeout(resolve, 400)); signal.throwIfAborted();
      // A deterministic failure enables real TUI retry/correction exercise.
      if (keys.get(readSettings(directory).providers.find(p => p.id === input.provider)!.key.account) === 'deny') throw Error('Fixture denial');
      return { models: ['gpt-fixture', 'gpt-other'] };
    } else throw Error('Unexpected fixture operation');
    return { ok: true };
  },
  native: async (input, signal) => {
    await new Promise(resolve => setTimeout(resolve, 400)); signal.throwIfAborted();
    if (input.action === 'login') keys.set(input.key.account, input.host);
    else if (keys.get(input.key.account) !== input.host) throw Error('Synthetic explicit sign-in required');
    return { ok: true, models: ['databricks-fixture'] };
  },
});
service.subscribe(snapshot => process.send?.({ type: 'snapshot', snapshot }));
process.on('message', async (message: any) => {
  if (message.type === 'secret') service.secret(message.action, message.value);
  else if (message.type === 'cancel') service.cancel();
  else if (message.type === 'request') process.send?.({ type: 'result', id: message.id, ok: await service.request(message.request) });
});
process.on('disconnect', () => { service.dispose(); process.exit(); });
