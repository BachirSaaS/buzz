import { join } from 'node:path';
import { homedir } from 'node:os';
import { readSettings, saveSettings, settingsId, replaceProvider, type SavedProvider } from './settings.ts';
import { managerCredential } from './manager-credential.ts';
import { databricksHost, databricksNative } from './databricks.ts';
import { retainCredentialAttempt } from './settings-credentials.ts';
import type { ProviderClient, ProviderRequest, ProviderRow, ProviderSnapshot } from './provider-protocol.ts';

export const providerEndpoints: Record<string, string> = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', openrouter: 'https://openrouter.ai/api/v1' };
export type ProviderDependencies = { credential: typeof managerCredential; native: typeof databricksNative };
type Catalog = { identity: string; state: string; detail: string; modelCount?: number };
const identity = (provider: SavedProvider) => JSON.stringify(provider);

/** Node-only local authority. No owner credentials, relay client, or Host service. */
export class ProviderService implements ProviderClient {
  private current: ProviderSnapshot = { revision: 0, rows: [], phase: 'idle', message: 'Select a provider to configure it.', secretLength: 0 };
  private catalogs = new Map<string, Catalog>();
  private listeners = new Set<(snapshot: ProviderSnapshot) => void>();
  private secretValue = '';
  private active?: AbortController;
  private generation = 0;
  private disposed = false;
  private readonly directory: string;
  constructor(home = homedir(), private readonly environment: NodeJS.ProcessEnv = process.env, private readonly deps: ProviderDependencies = { credential: managerCredential, native: databricksNative }) {
    this.directory = join(home, '.beehive', 'host');
    try { this.reload(); } catch { this.current.phase = 'error'; this.current.message = 'Saved providers could not be read. Existing data was not changed.'; }
  }
  snapshot() { return structuredClone(this.current); }
  subscribe(listener: (snapshot: ProviderSnapshot) => void) { this.listeners.add(listener); listener(this.snapshot()); return () => { this.listeners.delete(listener); }; }
  private publish() { if (!this.disposed) for (const listener of this.listeners) listener(this.snapshot()); }
  private reload() {
    const settings = readSettings(this.directory);
    let workspace: string | undefined;
    try { if (this.environment.DATABRICKS_HOST) workspace = databricksHost(this.environment.DATABRICKS_HOST); } catch { /* Invalid defaults never override saved workspaces. */ }
    for (const [id, catalog] of this.catalogs) {
      if (!settings.providers.some(p => p.id === id && identity(p) === catalog.identity)) this.catalogs.delete(id);
    }
    this.current = { ...this.current, revision: settings.revision, databricksHost: workspace, rows: settings.providers.map(p => {
      const catalog = this.catalogs.get(p.id);
      return { id: p.id, name: p.name, type: p.type, endpoint: p.endpoint, ...(p.wire ? { wire: p.wire } : {}), state: catalog?.state ?? 'Not checked', detail: catalog?.detail ?? 'Saved configuration. Model access has not been checked.', ...(catalog?.modelCount === undefined ? {} : { modelCount: catalog.modelCount }) };
    }) };
    this.publish();
    return settings;
  }
  private status(provider: SavedProvider, status: Pick<ProviderRow, 'state' | 'detail' | 'modelCount'>) {
    this.catalogs.set(provider.id, { identity: identity(provider), ...status });
    this.reload();
  }
  private async catalog(provider: SavedProvider, signal: AbortSignal, check: () => void) {
    this.status(provider, { state: 'Checking…', detail: 'Checking model catalog…' });
    try {
      const result = provider.type === 'databricks_v2'
        ? await this.deps.native({ action: 'models', host: provider.endpoint, key: provider.key }, signal)
        : await this.deps.credential({ action: 'models', directory: this.directory, provider: provider.id }, signal);
      check();
      if (!Array.isArray(result.models) || !result.models.every((model: unknown) => typeof model === 'string')) throw Error('Invalid catalog');
      this.status(provider, { state: 'Connected', modelCount: result.models.length, detail: 'Model catalog reachable. Model execution has not been tested.' });
      return true;
    } catch {
      check();
      this.status(provider, { state: 'Failed', detail: provider.type === 'databricks_v2'
        ? 'Could not load models. Check the workspace and network, then Sign in to Databricks and retry Refresh models.'
        : 'Could not load models. Check the API key, endpoint, network and model access, then retry Refresh models.' });
      return false;
    }
  }
  secret(action: 'append' | 'backspace' | 'clear', value = '') {
    if (this.disposed || this.active) return;
    if (action === 'clear') this.secretValue = '';
    else if (action === 'backspace') this.secretValue = [...this.secretValue].slice(0, -1).join('');
    else this.secretValue = (this.secretValue + value.replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 16384);
    this.current.secretLength = [...this.secretValue].length; this.publish();
  }
  async request(request: ProviderRequest) {
    if (this.active || this.disposed) return false;
    const abort = new AbortController(), generation = ++this.generation;
    this.active = abort; this.current.resultTarget = request.provider ?? 'reload'; this.current.phase = 'busy'; this.current.message = 'Working… Esc stops waiting; changes may already be saved.'; this.publish();
    const check = () => { abort.signal.throwIfAborted(); if (generation !== this.generation || this.disposed) throw Error('Cancelled'); };
    let message = '';
    try {
      const before = readSettings(this.directory), values = request.values ?? {};
      if (request.revision !== undefined && before.revision !== request.revision) throw Error('Settings changed');
      let provider = before.providers.find(row => row.id === request.provider);
      if (['models', 'login'].includes(request.action) && !provider) throw Error('Select provider');
      let connected = true;
      if (request.action === 'reload') {
        const settings = this.reload();
        const results = await Promise.all(settings.providers.map(p => this.catalog(p, abort.signal, check)));
        connected = results.every(Boolean);
        message = connected ? 'Provider catalogs checked.' : 'Some catalogs could not be loaded. Select a failed account for recovery steps.';
      } else if (request.action === 'save') {
        if (request.provider && !request.provider.startsWith('type:') && !provider) throw Error('Provider removed');
        if (values.type === 'databricks_v2' || provider?.type === 'databricks_v2') {
          const endpoint = databricksHost(values.endpoint ?? provider?.endpoint ?? this.current.databricksHost ?? '');
          if (provider) replaceProvider(this.directory, { ...provider, name: values.name || provider.name, endpoint, key: endpoint === provider.endpoint ? provider.key : { service: 'beehive', account: `provider:${settingsId()}` } }, before.revision);
          else {
            const id = settingsId();
            saveSettings(this.directory, { ...before, providers: [...before.providers, { id, name: values.name || 'Databricks', type: 'databricks_v2', endpoint, key: { service: 'beehive', account: `provider:${id}` } }] }, before.revision);
          }
        } else {
          const type = provider?.type ?? values.type;
          await this.deps.credential({ action: provider ? 'edit-provider' : 'add-provider', directory: this.directory, provider: provider?.id, revision: before.revision, name: values.name, type, endpoint: providerEndpoints[type ?? ''] ?? values.endpoint, ...(type === 'openai-compat' ? { wire: values.wire || 'auto' } : {}), secret: this.secretValue }, abort.signal);
        }
        check();
        provider = this.reload().providers.find(p => provider ? p.id === provider.id : !before.providers.some(old => old.id === p.id));
        if (!provider) throw Error('Saved provider missing');
        this.current.resultTarget = provider.id;
        message = 'Provider saved. Existing runs are unchanged.';
        connected = await this.catalog(provider, abort.signal, check);
      } else if (request.action === 'login') {
        if (provider!.type !== 'databricks_v2') throw Error('Not Databricks');
        this.status(provider!, { state: 'Checking…', detail: 'Waiting for explicit Databricks sign-in…' });
        retainCredentialAttempt(this.directory, provider!.key);
        await this.deps.native({ action: 'login', host: provider!.endpoint, key: provider!.key }, abort.signal); check();
        message = 'Databricks sign-in completed.';
        connected = await this.catalog(provider!, abort.signal, check);
      } else if (request.action === 'models') {
        connected = await this.catalog(provider!, abort.signal, check);
      } else throw Error('Unsupported provider action');
      check(); this.current.phase = connected ? 'idle' : 'error';
      this.current.message = message + (request.action === 'reload' ? '' : connected ? ' Model catalog checked.' : ' Model catalog failed. See account details for recovery steps.');
      this.reload(); return connected;
    } catch {
      if (generation === this.generation && !this.disposed) {
        this.current.phase = 'error';
        this.current.message = 'Could not complete the operation. Check configuration and access. Databricks needs an HTTPS workspace origin. Changes may already be saved; reload before retrying.';
        for (const [id, catalog] of this.catalogs) if (catalog.state === 'Checking…') this.catalogs.set(id, { identity: catalog.identity, state: 'Failed', detail: 'Operation failed. Check configuration and access, then retry. Databricks sign-in must be explicit.' });
        try { this.reload(); } catch { this.current.message = 'Saved providers could not be read. Existing data was not changed.'; }
      }
      return false;
    } finally {
      this.secretValue = ''; this.current.secretLength = 0;
      if (this.active === abort) this.active = undefined;
      this.publish();
    }
  }
  cancel() {
    this.generation++; this.active?.abort(); this.secretValue = ''; this.current.secretLength = 0;
    for (const [id, catalog] of this.catalogs) if (catalog.state === 'Checking…') this.catalogs.set(id, { identity: catalog.identity, state: 'Not checked', detail: 'Check cancelled. Refresh models to retry.' });
    this.current.phase = 'idle'; this.current.message = 'Stopped waiting. Changes or OS credentials may already be saved. Reload providers before retrying.';
    try { this.reload(); } catch { this.publish(); }
  }
  dispose() { this.cancel(); this.disposed = true; this.listeners.clear(); }
}
