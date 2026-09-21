import { createCliRenderer } from '@opentui/core';
import { OpenTuiShell } from './opentui-shell.ts';
import { localProviders } from './provider-client.ts';
import { localHarnessInventory } from './harness-inventory.ts';

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  screenMode: 'alternate-screen',
  consoleMode: 'disabled',
  openConsoleOnError: false,
});
const inventory = localHarnessInventory();
const shell = new OpenTuiShell(renderer, inventory, undefined, localProviders());
void inventory.refresh();
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
