import { ShellApp } from './shell-app.ts';

const app = new ShellApp({ stdin: process.stdin, stdout: process.stdout });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => app.close());
await app.start();
