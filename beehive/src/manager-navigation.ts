import type { ManagerSnapshot, ManagerItem } from './manager-controller.ts';

/** Section order is shared by pointer hit testing and keyboard navigation. */
export const managerSections = ['Host', 'Agents', 'Harnesses', 'Providers'] as const;

/** Public presentation only. A catalog item never becomes management authority. */
export function sectionRows(snapshot: ManagerSnapshot, section: number): ManagerItem[] {
  const settings = snapshot.settings;
  if (section === 0) return snapshot.local.map(row => row.id !== 'host' ? row : ({ ...row, detail: `Host name: ${row.label}\nRelay URL: ${snapshot.hostRelay ?? snapshot.routing?.relay ?? '—'}\nState: ${snapshot.service?.state ?? 'unknown'}\nSaved revision: ${settings?.revision ?? 0}\nLoaded revision: ${snapshot.service?.revision ?? '—'}` }));
  if (section === 1) {
    if (!snapshot.owner) return [
      { id: 'signin-buzz', label: 'Sign in with Buzz key', detail: 'Sign in with Buzz key' },
      { id: 'signin-saved', label: 'Sign in with saved owner key', detail: 'Sign in with saved owner key' },
      { id: 'signin-import', label: 'Import matching owner key', detail: 'Import matching owner key' },
    ];
    const registered = new Set(settings?.agents.map(agent => agent.publicKey) ?? []);
    return [
      { id: 'registered-agents', label: 'Registered agents', detail: 'Registered agents' },
      { id: 'register-agent', label: '  Register agent', detail: 'Register agent' },
      ...snapshot.agents.filter(agent => registered.has(agent.id)),
      ...(settings?.agents ?? []).filter(agent => !snapshot.agents.some(row => row.id === agent.publicKey)).map(agent => ({ id: agent.publicKey, label: agent.profile?.name ?? agent.publicKey, detail: 'Registered here · Host unavailable' })),
      { id: 'other-agents', label: 'Other agents', detail: 'Other agents' },
      ...snapshot.agents.filter(agent => !registered.has(agent.id)),
    ];
  }
  if (section === 2) return [
    ...(snapshot.harnesses ?? []).map(h => ({ id: `harness:${h.id}`, label: `${h.label} · ${h.state}`, detail: `Harness: ${h.label}\nState: ${h.state}\nExecutable: ${h.executable ?? '—'}\nCLI: ${h.cli ?? '—'}` })),

  ];
  if (section === 3) return (settings?.providers ?? []).map(p => ({ id: p.id, label: p.name, detail: `Provider: ${p.name}\nType: ${p.type}\nEndpoint: ${p.endpoint}` }));
  return [];
}

/** Exact per-section selection retention; removal never selects a replacement. */
export class ManagerNavigation {
  section = 0;
  private selected = new Map<number, string>();
  select(id: string) { this.selected.set(this.section, id); }
  switch(section: number) { if (Number.isInteger(section) && section >= 0 && section < managerSections.length) this.section = section; }
  selection(rows: ManagerItem[]) {
    if (!this.selected.has(this.section) && rows.length) this.select(rows[0]!.id);
    return this.selected.get(this.section) ?? '';
  }
}
