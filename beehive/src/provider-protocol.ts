/** Public renderer/controller protocol. Snapshots contain no credential references or secrets. */
export type ProviderType = 'openai' | 'anthropic' | 'openai-compat' | 'openrouter' | 'databricks_v2';
export type ProviderRow = { id: string; name: string; type: ProviderType; endpoint: string; wire?: string; state: string; detail: string };
export type ProviderSnapshot = { revision: number; rows: ProviderRow[]; phase: 'idle' | 'busy' | 'error'; message: string; resultTarget?: string; secretLength: number; models: string[]; modelProvider?: string; databricksHost?: string; setup?: { id: string; label: string; state: string; reason: string; providers: string[] }[] };
export type ProviderRequest = { action: 'reload' | 'save' | 'test' | 'models' | 'login' | 'discover' | 'setup'; provider?: string; revision?: number; values?: Record<string, string> };
export interface ProviderClient {
  snapshot(): ProviderSnapshot;
  subscribe(listener: (snapshot: ProviderSnapshot) => void): () => void;
  request(request: ProviderRequest): Promise<boolean>;
  secret(action: 'append' | 'backspace' | 'clear', value?: string): void;
  cancel(): void;
  dispose(): void;
}
