import { runtimeEnvironment } from './runtime-environment.ts';
import { piEfforts } from './pi.ts';
import { runtimeEfforts } from './runtime-effort.ts';
import type { ManagerSnapshot, ManagerResult } from './manager-controller.ts';

/** Same short form used by the actual renderer and synthetic key/form fixtures. */
export async function runtimeForm(screen: {
  choose(label: string, options: string[]): Promise<string | undefined>;
  input(label: string, initial?: string): Promise<string | undefined>;
  confirm(label: string): Promise<boolean>;
  notice(text: string): void;
}, snapshot: () => ManagerSnapshot, request: (action: string, values?: Record<string,string>) => Promise<ManagerResult>) {
  if ((await request('runtime-form')).state !== 'completed') return;
  const harnesses = snapshot().harnesses ?? [];
  if (!harnesses.length) { screen.notice(snapshot().status); return; }
  const labels = harnesses.map(h => `${h.label} · ${h.providers.length ? 'Available' : h.state === 'available' ? 'Provider integration unavailable' : h.state}`);
  const harness = await screen.choose('Harness', labels); if (!harness) return;
  const selected = harnesses[labels.indexOf(harness)];
  if (!selected?.providers.length) { screen.notice(selected?.reason ?? 'Unsupported harness'); return; }
  const providers = (snapshot().settings?.providers ?? []).filter(p => selected.providers.includes(p.type));
  if (!providers.length) { screen.notice('Add a supported provider first.'); return; }
  const choice = await screen.choose('Provider', providers.map(p => `${p.name} · ${p.id}`)); if (!choice) return;
  const provider = providers.find(p => choice === `${p.name} · ${p.id}`)!;
  const modelResult = await request('models', { provider: provider.id });
  if (modelResult.state === 'cancelled' || modelResult.state === 'ignored') return;
  const models = snapshot().models;
  const labelsById = snapshot().modelLabels ?? {};
  const modelLabels = (models ?? []).map(id=>labelsById[id] && labelsById[id] !== id ? `${labelsById[id]} · ${id}` : id);
  const choiceModel = await screen.choose(models ? 'Model' : 'Model · Custom model', [...modelLabels, 'Custom model']); if (!choiceModel) return;
  const model = choiceModel === 'Custom model' ? await screen.input('Custom model\nExact model ID') : models?.[modelLabels.indexOf(choiceModel)]; if (!model) return;
  const efforts = selected.id === 'buzz-agent' ? runtimeEfforts(provider.type, model) : selected.id === 'pi' ? piEfforts(provider.type, model) : [];
  const effort = efforts.length ? await screen.choose('Effort · new runs only', ['Inherit', ...efforts]) : 'Inherit'; if (!effort) return;
  const entry = await screen.input('Environment\nJSON name/value map · no secrets', '{}'); if (entry === undefined) return;
  let environment: string;
  try { environment = JSON.stringify(runtimeEnvironment(JSON.parse(entry))); }
  catch { screen.notice('Invalid environment. Use nonsecret name/value pairs; identity, provider and loader variables are reserved. Nothing saved.'); return; }
  const name = await screen.input('Runtime name', model); if (!name) return;
  if (await screen.confirm(`Save runtime\n${name}\n${selected.label} · ${provider.name} · ${model}\n${efforts.length ? `Effort: ${effort}` : ''}\nEnvironment: ${Object.keys(JSON.parse(environment)).join(', ') || 'None'}\nSaved for new runs.`)) await request('add-runtime', { name, model, environment, provider: provider.id, harness: selected.id, ...(effort !== 'Inherit' ? { effort } : {}) });
}
