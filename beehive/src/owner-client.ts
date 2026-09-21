import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { OwnerClient, OwnerRequest, OwnerSnapshot } from './owner-protocol.ts';

/** Renderer transport: only public projections return from the Node authority. */
export function localOwner(options: { helper?: URL; environment?: NodeJS.ProcessEnv } = {}): OwnerClient {
  const environment = options.environment ?? process.env;
  const packagedNode = fileURLToPath(new URL('../runtime/node', import.meta.url));
  const child = fork(fileURLToPath(options.helper ?? new URL('./owner-child.ts', import.meta.url)), [], {
    execPath: existsSync(packagedNode) ? packagedNode : process.env.BEEHIVE_NODE || 'node',
    execArgv: ['--experimental-transform-types'], silent: true,
    env: { PATH: environment.PATH ?? '/usr/bin:/bin', ...(environment.HOME ? { HOME: environment.HOME } : {}), ...(environment.BEEHIVE_HOME ? { BEEHIVE_HOME: environment.BEEHIVE_HOME } : {}), ...(environment.DATABRICKS_HOST ? { DATABRICKS_HOST: environment.DATABRICKS_HOST } : {}) },
  });
  let snapshot: OwnerSnapshot = { signedIn: false, desktop: 'unknown', desktopReason: 'Checking identity availability.', phase: 'idle', message: 'Loading owner session…', secretLength: 0 };
  let serial = 0, disposed = false;
  const listeners = new Set<(snapshot: OwnerSnapshot) => void>();
  const pending = new Map<number, (ok: boolean) => void>();
  const emit = () => { for (const listener of listeners) listener(structuredClone(snapshot)); };
  const unavailable = () => {
    for (const resolve of pending.values()) resolve(false); pending.clear();
    if (disposed) return;
    snapshot = { ...snapshot, signedIn: false, owner: undefined, phase: 'error', secretLength: 0, message: 'Owner controller stopped. Reopen Beehive. Saved data was not reset.' }; emit();
  };
  child.stdout?.resume(); child.stderr?.resume(); child.on('error', unavailable); child.on('close', unavailable);
  child.on('message', (message: any) => {
    if (disposed) return;
    if (message.type === 'snapshot') { snapshot = message.snapshot; emit(); }
    else if (message.type === 'result') { pending.get(message.id)?.(message.ok === true); pending.delete(message.id); }
  });
  const send = (message: object) => { if (!disposed && child.connected) child.send(message, error => { if (error) unavailable(); }); else unavailable(); };
  return {
    snapshot: () => structuredClone(snapshot),
    subscribe(listener) { listeners.add(listener); listener(structuredClone(snapshot)); return () => { listeners.delete(listener); }; },
    request(request: OwnerRequest) { return new Promise(resolve => { const id = ++serial; pending.set(id, resolve); send({ type: 'request', id, request }); }); },
    secret(action, value) { send({ type: 'secret', action, value }); },
    cancel() { send({ type: 'cancel' }); },
    dispose() { if (disposed) return; disposed = true; for (const resolve of pending.values()) resolve(false); pending.clear(); listeners.clear(); if (child.connected) child.disconnect(); else child.kill('SIGTERM'); },
  };
}
