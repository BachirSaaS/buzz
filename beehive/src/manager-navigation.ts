import type { ManagerSnapshot, ManagerItem } from './manager-controller.ts';

/** Section order is shared by pointer hit testing and keyboard navigation. */
export const managerSections = ['Host', 'Agents', 'Harnesses', 'Providers'] as const;

/** Public presentation only. A catalog item never becomes management authority. */
export function sectionRows(snapshot: ManagerSnapshot, section: number): ManagerItem[] {
  const settings = snapshot.settings;
  if (section === 0) return snapshot.local.map(row => row.id !== 'host' ? row : ({ ...row, detail: `Host name: ${row.label}\nRelay URL: ${snapshot.hostRelay ?? snapshot.routing?.relay ?? '—'}\nState: ${snapshot.service?.state ?? 'unknown'}\nSaved revision: ${settings?.revision ?? 0}\nLoaded revision: ${snapshot.service?.revision ?? '—'}` }));
  if (section === 1) return snapshot.agents;
  if (section === 2) return [
    ...(snapshot.harnesses ?? []).map(h => ({ id: `harness:${h.id}`, label: `${h.label} · ${h.state}`, detail: `Harness: ${h.label}\nState: ${h.state}\nExecutable: ${h.executable ?? '—'}\nCLI: ${h.cli ?? '—'}` })),
    ...(settings?.runtimes ?? []).map(r => ({ id: `runtime:${r.id}`, label: r.name, detail: `Runtime: ${r.name}\nHarness: ${r.harness}\nProvider: ${settings?.providers.find(p => p.id === r.providerId)?.name ?? '—'}\nModel: ${r.model}\nEffort: ${r.effort ?? 'Inherit'}` })),
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
