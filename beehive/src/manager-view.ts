import { createCliRenderer } from '@opentui/core';
import { OpenTuiShell } from './opentui-shell.ts';

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  screenMode: 'alternate-screen',
  consoleMode: 'disabled',
  openConsoleOnError: false,
});
const shell = new OpenTuiShell(renderer);
const stop = () => shell.close();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  await shell.done;
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  shell.close();
}
