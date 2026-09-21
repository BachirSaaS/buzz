import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBuzzOwnerKey } from './buzz-owner-key.ts';

/** Bounded exact-entry read. The no-UI native probe and explicit read never write Keychain. */
export async function desktopOwnerKey(probe: boolean, signal: AbortSignal, executable = fileURLToPath(new URL('../bin/beehive-owner-key', import.meta.url))): Promise<{ available?: boolean; secret?: string; reason?: string }> {
  signal.throwIfAborted();
  return new Promise(resolve => {
    const child = spawn(executable, [], {
      stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin', ...(process.env.HOME ? { HOME: process.env.HOME } : {}) },
    });
    let output = '', failed = false;
    const stop = () => { failed = true; output = ''; child.kill('SIGKILL'); };
    const timer = setTimeout(stop, 10000); signal.addEventListener('abort', stop, { once: true });
    child.on('error', () => { failed = true; }); child.stdin.on('error', stop);
    child.stdout.on('data', chunk => { if (failed) return; if (output.length + chunk.length > 4096) stop(); else output += chunk.toString(); });
    child.on('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', stop);
      if (failed || signal.aborted || code !== 0) { resolve({ reason: 'access' }); return; }
      try {
        const value = JSON.parse(output); output = '';
        if (value.reason) { resolve({ reason: value.reason }); return; }
        if (probe) { resolve({ available: value.available === true }); return; }
        const result = readBuzzOwnerKey(null, () => JSON.stringify({ identity: value.identity }));
        resolve(result.ok ? { secret: result.secret } : { reason: result.reason });
      } catch { resolve({ reason: 'malformed' }); }
    });
    child.stdin.end(probe ? 'probe' : 'read');
    if (signal.aborted) stop();
  });
}
