import { homedir } from 'node:os';
import { join } from 'node:path';
import { discoverHarnesses, type DetectedHarness } from './harness-discovery.ts';
import { readSettings, saveSettings, type Settings } from './settings.ts';

export type HarnessInventoryPhase = 'idle' | 'refreshing' | 'error';
export type HarnessInventorySnapshot = Readonly<{
  harnesses: readonly DetectedHarness[];
  savedConfigurations: Readonly<Record<string, number>>;
  phase: HarnessInventoryPhase;
  message: string;
  generation: number;
}>;
export type HarnessInventoryStore = {
  read(): Settings;
  save(candidate: Settings, expectedRevision: number): Settings;
};
export type HarnessInventoryDiscovery = (signal: AbortSignal) => Promise<DetectedHarness[]>;

const counts = (settings: Settings) => Object.freeze(settings.runtimes.reduce<Record<string, number>>((result, runtime) => {
  result[runtime.harness] = (result[runtime.harness] ?? 0) + 1;
  return result;
}, {}));

/** Harness-only controller. It owns durable inventory refresh without constructing
 * owner, relay, Host, provider, credential, or agent state. */
export class HarnessInventoryController {
  private current: HarnessInventorySnapshot;
  private active?: AbortController;
  private serial = 0;
  private disposed = false;
  private listener?: (snapshot: HarnessInventorySnapshot) => void;

  constructor(private readonly store: HarnessInventoryStore, private readonly discover: HarnessInventoryDiscovery) {
    try {
      const settings = store.read();
      this.current = Object.freeze({ harnesses: Object.freeze([...(settings.harnesses ?? [])]), savedConfigurations: counts(settings), phase: 'idle', message: settings.harnesses ? 'Saved local harness inventory.' : 'No saved harness inventory. Run Refresh harnesses.', generation: 0 });
    } catch {
      this.current = Object.freeze({ harnesses: Object.freeze([]), savedConfigurations: Object.freeze({}), phase: 'error', message: 'Saved harness inventory could not be read. Repair the local settings file, then try again.', generation: 0 });
    }
  }

  snapshot() { return this.current; }
  subscribe(listener: (snapshot: HarnessInventorySnapshot) => void) { this.listener = listener; listener(this.current); return () => { if (this.listener === listener) this.listener = undefined; }; }
  private publish(next: Omit<HarnessInventorySnapshot, 'generation'>) {
    if (this.disposed) return;
    this.current = Object.freeze({ ...next, harnesses: Object.freeze([...next.harnesses]), savedConfigurations: Object.freeze({ ...next.savedConfigurations }), generation: this.serial });
    this.listener?.(this.current);
  }

  /** One bounded refresh at a time. Completion is fenced before durable commit
   * and again before presentation, so leaving the screen or disposal wins. */
  async refresh(): Promise<boolean> {
    if (this.disposed || this.active) return false;
    const abort = new AbortController();
    this.active = abort;
    const generation = ++this.serial;
    this.publish({ ...this.current, phase: 'refreshing', message: 'Refreshing local harness inventory…' });
    try {
      const harnesses = await this.discover(abort.signal);
      if (this.disposed || abort.signal.aborted || generation !== this.serial) return false;
      const previous = this.store.read();
      if (this.disposed || abort.signal.aborted || generation !== this.serial) return false;
      const committed = this.store.save({ ...previous, harnesses: [...harnesses] }, previous.revision);
      if (this.disposed || abort.signal.aborted || generation !== this.serial) return false;
      this.publish({ harnesses, savedConfigurations: counts(committed), phase: 'idle', message: `Harness inventory refreshed. ${harnesses.length} harnesses checked.` });
      return true;
    } catch (error) {
      if (this.disposed || abort.signal.aborted || generation !== this.serial) return false;
      const changed = error instanceof Error && error.message === 'Settings changed. Open the form again.';
      this.publish({ ...this.current, phase: 'error', message: changed ? 'Local settings changed during refresh. Existing inventory was kept; try Refresh harnesses again.' : 'Harness refresh failed. Existing inventory was kept; check local executable access and try again.' });
      return false;
    } finally {
      if (this.active === abort) this.active = undefined;
    }
  }

  cancel() {
    if (!this.active) return;
    this.serial++;
    this.active.abort();
    this.active = undefined;
    this.publish({ ...this.current, phase: 'idle', message: 'Harness refresh stopped. Existing inventory was kept.' });
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.serial++; this.active?.abort(); this.active = undefined; this.listener = undefined; }
}

/** Production adapter. BEEHIVE_HOME and the isolated switch are explicit seams
 * for product-shaped tests; normal launch uses the ordinary local HOME/PATH. */
export function localHarnessInventory(environment: NodeJS.ProcessEnv = process.env) {
  const isolated = environment.BEEHIVE_HARNESS_ISOLATED === '1';
  if (isolated && (!environment.BEEHIVE_HOME || environment.BEEHIVE_HARNESS_PATH === undefined)) throw Error('Isolated harness discovery requires an explicit BEEHIVE_HOME and BEEHIVE_HARNESS_PATH');
  const home = environment.BEEHIVE_HOME || homedir();
  const path = environment.BEEHIVE_HARNESS_PATH ?? environment.PATH ?? '';
  const directory = join(home, '.beehive', 'host');
  return new HarnessInventoryController(
    { read: () => readSettings(directory), save: (candidate, revision) => saveSettings(directory, candidate, revision) },
    signal => discoverHarnesses(signal, { home, path, ...(isolated ? { bundled: [], common: [], loginShells: [] } : {}) }),
  );
}
