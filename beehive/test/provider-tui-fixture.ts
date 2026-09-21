// Real OpenTUI + real Node IPC/controller; synthetic external authorization only.
import { createCliRenderer } from '@opentui/core';
import { OpenTuiShell } from '../src/opentui-shell.ts';
import { localHarnessInventory } from '../src/harness-inventory.ts';
import { localProviders } from '../src/provider-client.ts';
if (!process.env.BEEHIVE_HOME?.includes('provider-tui-fixture-')) throw Error('Explicit fixture root required');
const renderer = await createCliRenderer({ exitOnCtrlC: false, screenMode: 'alternate-screen', consoleMode: 'disabled', openConsoleOnError: false });
const shell = new OpenTuiShell(renderer, localHarnessInventory(), undefined, localProviders({ helper: new URL('./provider-tui-fixture-child.ts', import.meta.url) }));
try { await shell.done; } finally { shell.close(); }
