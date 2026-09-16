import type { ManagerAction } from './opentui-screen.ts';
import type { ManagerItem, ManagerSnapshot } from './manager-controller.ts';

export type ActionObject = { id: string; kind: 'host' | 'agent' | 'command' | 'provider' | 'harness' };
export type ObjectAction = ManagerAction & { object: ActionObject };

const commands: Record<string, string> = {
  'signin-buzz': 'Sign in with Buzz key', 'signin-saved': 'Sign in with saved owner key',
  'signin-import': 'Import matching owner key and sign in', 'register-agent': 'Register agent',
  'refresh-agents': 'Refresh agents', 'inspect-operations': 'Inspect operations',
  'check-results': 'Check operation results', 'sign-out': 'Sign out',
  'publish-profile': 'Publish profile or instructions', 'refresh-harnesses': 'Refresh harnesses',
  'add-provider': 'Add provider',
};
const dividers = new Set(['registered-agents', 'other-agents', 'management']);

/** Enforces the Details-object contract at the production composition seam. */
export function actionsForRow(snapshot: ManagerSnapshot, section: number, row: ManagerItem | undefined, candidates: ManagerAction[]): ObjectAction[] {
  if (!row || dividers.has(row.id)) return [];
  const command = commands[row.id];
  if (command) return candidates.filter(a => a.label === command).map(a => ({ ...a, object: { id: row.id, kind: 'command' } }));
  let labels: string[] = [];
  let kind: ActionObject['kind'];
  if (section === 0) {
    kind = 'host';
    if (row.id === 'host') labels = ['Start', 'Stop'];
    else if (row.id === 'host-missing') labels = ['Configure this computer'];
  } else if (section === 1) {
    kind = 'agent';
    const actual = snapshot.agents.some(a => a.id === row.id);
    const registered = snapshot.settings?.agents.some(a => a.publicKey === row.id);
    if (actual) labels = registered ? ['Configure', 'Start', 'Stop', 'Restart', 'Move…'] : ['Register agent', 'Start', 'Stop', 'Restart', 'Move…'];
    else if (registered) labels = ['Configure'];
  } else if (section === 2) { kind = 'harness'; }
  else { kind = 'provider'; labels = ['Models']; }
  return candidates.filter(a => labels.includes(a.label)).map(a => ({ ...a, object: { id: row.id, kind } }));
}
