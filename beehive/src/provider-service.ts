import { join } from 'node:path';
import { homedir } from 'node:os';
import { readSettings, saveSettings, settingsId, replaceProvider } from './settings.ts';
import { managerCredential } from './manager-credential.ts';
import { databricksHost, databricksNative, rememberEnvironmentDatabricks } from './databricks.ts';
import { discoverHarnesses } from './harness-discovery.ts';
import { retainCredentialAttempt } from './settings-credentials.ts';
import type { ProviderClient, ProviderRequest, ProviderSnapshot } from './provider-protocol.ts';

export const providerEndpoints: Record<string, string> = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', openrouter: 'https://openrouter.ai/api/v1' };
export type ProviderDependencies = { credential: typeof managerCredential; native: typeof databricksNative; discover: typeof discoverHarnesses };

/** Node-only local authority. No owner credentials, relay client, or Host service. */
export class ProviderService implements ProviderClient {
  private current: ProviderSnapshot = { revision: 0, rows: [], phase: 'idle', message: 'Select a provider or add one.', secretLength: 0, models: [] };
  private listeners = new Set<(snapshot: ProviderSnapshot) => void>();
  private secretValue = '';
  private active?: AbortController;
  private generation = 0;
  private disposed = false;
  private readonly directory: string;
  constructor(private readonly home = homedir(), private readonly environment: NodeJS.ProcessEnv = process.env, private readonly deps: ProviderDependencies = { credential: managerCredential, native: databricksNative, discover: discoverHarnesses }) {
    this.directory = join(home, '.beehive', 'host');
    this.reload();
  }
  snapshot() { return structuredClone(this.current); }
  subscribe(listener: (snapshot: ProviderSnapshot) => void) { this.listeners.add(listener); listener(this.snapshot()); return () => { this.listeners.delete(listener); }; }
  private publish() { if (!this.disposed) for (const listener of this.listeners) listener(this.snapshot()); }
  private reload() {
    try {
      const settings = readSettings(this.directory);
      let workspace: string | undefined;
      try { if (this.environment.DATABRICKS_HOST) workspace = databricksHost(this.environment.DATABRICKS_HOST); } catch { /* Expose actionable public status, never raw input. */ }
      this.current = { ...this.current, revision: settings.revision, databricksHost: workspace, rows: settings.providers.map(p => ({ id: p.id, name: p.name, type: p.type, endpoint: p.endpoint, ...(p.wire ? { wire: p.wire } : {}), state: p.type === 'databricks_v2' && p.endpoint !== workspace ? 'ENV MISSING' : 'SAVED', detail: p.type === 'databricks_v2' ? p.endpoint === workspace ? 'Sign in explicitly, then test or load models.' : 'Set DATABRICKS_HOST to this workspace HTTPS origin.' : 'Credential stored securely. Access has not been tested in this session.' })) };
    } catch { this.current.phase = 'error'; this.current.message = 'Saved providers could not be read. Existing data was not changed.'; }
    this.publish();
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
    this.active = abort; this.current.phase = 'busy'; this.current.message = 'Working… Esc stops waiting; changes may already be saved.'; this.publish();
    const check = () => { abort.signal.throwIfAborted(); if (generation !== this.generation || this.disposed) throw Error('Cancelled'); };
    try {
      const before = readSettings(this.directory), values = request.values ?? {};
      if (request.revision !== undefined && before.revision !== request.revision) throw Error('Settings changed');
      const provider = before.providers.find(row => row.id === request.provider);
      if (['test', 'models', 'login', 'setup'].includes(request.action) && !provider) throw Error('Select provider');
      if (provider?.type === 'databricks_v2' && request.action !== 'save' && this.current.databricksHost !== provider.endpoint) throw Error('Databricks workspace environment missing');
      let message = '';
      if (request.action === 'reload') {
        rememberEnvironmentDatabricks(this.directory, this.environment.DATABRICKS_HOST);
        message = this.environment.DATABRICKS_HOST ? 'Local providers loaded.' : 'Local providers loaded. Set DATABRICKS_HOST to add a Databricks workspace.';
      } else if (request.action === 'save') {
        if (values.type === 'databricks_v2' || provider?.type === 'databricks_v2') {
          const endpoint = databricksHost(this.environment.DATABRICKS_HOST ?? '');
          if (provider) replaceProvider(this.directory, { ...provider, name: values.name || provider.name, endpoint, key: endpoint === provider.endpoint ? provider.key : { service: 'beehive', account: `provider:${settingsId()}` } }, before.revision);
          else rememberEnvironmentDatabricks(this.directory, endpoint);
        } else {
          const type = provider?.type ?? values.type;
          await this.deps.credential({ action: provider ? 'edit-provider' : 'add-provider', directory: this.directory, provider: provider?.id, revision: before.revision, name: values.name, type, endpoint: providerEndpoints[type ?? ''] ?? values.endpoint, ...(type === 'openai-compat' ? { wire: values.wire || 'auto' } : {}), secret: this.secretValue }, abort.signal);
        }
        check(); readSettings(this.directory); message = 'Provider saved. Existing runs are unchanged.';
      } else if (request.action === 'login') {
        if (provider!.type !== 'databricks_v2') throw Error('Not Databricks');
        retainCredentialAttempt(this.directory, provider!.key);
        await this.deps.native({ action: 'login', host: provider!.endpoint, key: provider!.key }, abort.signal); check(); message = 'Databricks sign-in completed. Test access or load models.';
      } else if (request.action === 'test' || request.action === 'models') {
        this.current.models = []; this.current.modelProvider = undefined;
        const result = provider!.type === 'databricks_v2'
          ? await this.deps.native({ action: 'models', host: provider!.endpoint, key: provider!.key }, abort.signal)
          : await this.deps.credential({ action: 'models', directory: this.directory, provider: provider!.id }, abort.signal);
        check(); this.current.models = result.models ?? []; this.current.modelProvider = provider!.id;
        message = request.action === 'test' ? 'Provider model catalog is reachable. Model execution has not been tested.' : `${this.current.models.length} models loaded. Custom model IDs are also supported.`;
      } else if (request.action === 'discover') {
        const rows = await this.deps.discover(abort.signal, { home: this.home }); check();
        this.current.setup = rows.filter(row => ['codex', 'pi'].includes(row.id)).map(({ id, label, state, reason, providers }) => ({ id, label, state, reason, providers }));
        message = 'Choose an available harness and exact model ID. Saving does not start an agent.';
      } else if (request.action === 'setup') {
        const rows = await this.deps.discover(abort.signal, { home: this.home }); check();
        const row = rows.find(row => row.id === values.harness);
        if (!row || !['codex', 'pi'].includes(row.id) || row.state !== 'available' || !row.executable || !row.cli || !row.providers.includes(provider!.type)) throw Error('Harness unavailable or unsupported provider');
        const current = readSettings(this.directory);
        if (current.revision !== before.revision) throw Error('Settings changed');
        saveSettings(this.directory, { ...current, runtimes: [...current.runtimes, { id: settingsId(), name: values.name || `${row.label} configuration`, harness: row.id as 'codex' | 'pi', executable: row.executable, cli: row.cli, providerId: provider!.id, model: values.model ?? '', ...(values.effort && values.effort !== 'Inherit' ? { effort: values.effort } : {}) }] }, current.revision);
        message = 'Runtime configuration saved for future use. No agent was started.';
      }
      check(); this.current.phase = 'idle'; this.current.message = message; this.reload(); return true;
    } catch {
      if (generation === this.generation && !this.disposed) { this.current.phase = 'error'; this.current.message = 'Could not complete the operation. Check fields, provider access, and DATABRICKS_HOST if needed. Changes may already be saved; reload before retrying.'; this.reload(); }
      return false;
    } finally {
      this.secretValue = ''; this.current.secretLength = 0;
      if (this.active === abort) this.active = undefined;
      this.publish();
    }
  }
  cancel() { this.generation++; this.active?.abort(); this.secretValue = ''; this.current.secretLength = 0; this.current.phase = 'idle'; this.current.message = 'Stopped waiting. Changes or OS credentials may already be saved. Reload providers before retrying.'; this.publish(); }
  dispose() { this.cancel(); this.disposed = true; this.listeners.clear(); }
}
