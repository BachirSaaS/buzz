import { serveHost } from '../src/host-service.ts';
import { host } from '../src/host.ts';
import { readHostIdentityPublic } from '../src/host-identity.ts';
const directory = process.argv[2]!;
if (!directory.includes('owner-tui-fixture-')) throw Error('Isolated Host fixture required');
await serveHost(directory, process.argv[3]!, async () => {
  const { pairing } = readHostIdentityPublic(directory);
  const running = await host(directory, pairing.relay, undefined, {
    binding: { host: pairing.host, owner: pairing.owner }, validate() {},
    connect() { return { ready: Promise.resolve(), send() {}, close() {} }; },
  });
  return { close: () => running.close(), status: () => ({ agents: running.runningAgents, revision: running.settingsRevision, relay: 'disconnected' }) };
});
