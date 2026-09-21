import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureHostDependencies } from './host-fixture-deps.ts';
import { OwnerService } from '../src/owner-service.ts';
const home = process.env.BEEHIVE_HOME!;
if (!home?.includes('owner-tui-fixture-')) throw Error('Isolated owner fixture required');
const service = new OwnerService(home, async (probe, signal) => {
  const mode = readFileSync(join(home, 'desktop-mode'), 'utf8').trim();
  if (mode === 'delayed') await new Promise(resolve => setTimeout(resolve, 1200));
  signal.throwIfAborted();
  return mode === 'missing' || mode === 'denied' ? { reason: mode === 'missing' ? 'missing' : 'access' } : probe ? { available: true } : { secret: mode === 'mismatch' ? '2'.repeat(64) : '1'.repeat(64) };
}, fixtureHostDependencies(home));
service.subscribe(snapshot => { if (process.connected) process.send?.({ type: 'snapshot', snapshot }); });
process.on('message', async (message: any) => {
  if (message.type === 'secret') service.secret(message.action, message.value);
  else if (message.type === 'cancel') service.cancel();
  else if (message.type === 'request') {
    const ok = await service.request(message.request);
    if (process.connected) process.send?.({ type: 'result', id: message.id, ok });
  }
});
process.on('disconnect', () => { service.dispose(); process.exit(); });
