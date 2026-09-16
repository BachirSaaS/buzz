import { registerHooks } from 'node:module';
// Explicit child fixture: replaces only the native bridge, then runs the actual
// production IPC dispatch. No environment-selected product credential backend.
process.prependOnceListener('message', (input: any) => { (globalThis as any).__buzzFixture = input.fixture; });
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/src/native-credentials.ts')) return result;
  return { ...result, source: `
    export function nativeCredentials() { return {read() {throw Error('Beehive read forbidden');},create() {throw Error('Beehive write forbidden');},remove() {throw Error('Beehive delete forbidden');}}; }
    export function loadNativeEntry() { return class {
      constructor(service, account) { if (service !== 'buzz-desktop' || account !== 'secrets') throw Error('Wrong Keychain target'); }
      getPassword() { const f = globalThis.__buzzFixture; if (f.denied) throw Error(f.denied); return f.blob; }
      setPassword() { throw Error('Buzz write forbidden'); }
      deleteCredential() { throw Error('Buzz delete forbidden'); }
    }; }
  ` };
} });
await import('../src/manager-credential-child.ts');
