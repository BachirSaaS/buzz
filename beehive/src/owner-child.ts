import { OwnerService } from './owner-service.ts';
const service = new OwnerService(process.env.BEEHIVE_HOME);
service.subscribe(snapshot => { if (process.connected) process.send?.({ type: 'snapshot', snapshot }); });
const pending = new Set<Promise<boolean>>();
let exiting = false;
process.on('message', async (message: any) => {
  if (message.type === 'secret') service.secret(message.action, message.value);
  else if (message.type === 'cancel') service.cancel();
  else if (message.type === 'request') {
    const work = service.request(message.request);
    pending.add(work);
    const ok = await work.finally(() => pending.delete(work));
    if (process.connected && !exiting) process.send?.({ type: 'result', id: message.id, ok });
  }
});
const stop = () => {
  if (exiting) return; exiting = true; service.dispose();
  void Promise.allSettled([...pending]).finally(() => process.exit());
};
process.on('disconnect', stop);
process.on('SIGTERM', stop);
