import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Resolve supported Buzz Agent executable without running an installed harness.
 * Other Desktop adapters require separate native launch contracts. */
export function detectBuzzAgent(path = process.env.PATH ?? ''): string | undefined {
  for (const folder of path.split(delimiter).filter(p => p.startsWith('/')).slice(0,128)) {
    try { const executable = realpathSync(join(folder,'buzz-agent')); accessSync(executable,constants.X_OK); if (statSync(executable).isFile()) return executable; } catch { /* Missing PATH candidates are not authentication failures. */ }
  }
  return undefined;
}
/** A provider label never substitutes for the exact launch ID. */
export type ProviderModel = { id: string; name: string };
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_.:/-]{1,200}$/.test(id);
function openAILabel(id: string) {
  const canonical = id.replace(/-\d{4}-\d{2}-\d{2}$/,'');
  const suffix = (s: string) => s.split('-').map(v => /^pro$/i.test(v) ? 'Pro' : /^(mini|nano)$/i.test(v) ? v.toLowerCase() : v).join(' ');
  return canonical.startsWith('chatgpt-') ? `ChatGPT ${suffix(canonical.slice(8))}` : canonical.startsWith('gpt-') ? `GPT-${suffix(canonical.slice(4))}` : canonical;
}
async function page(url: string, headers: Record<string,string>, signal: AbortSignal, fetcher: typeof fetch): Promise<any> {
  const response = await fetcher(url,{headers,signal,redirect:'error'});
  if (!response.ok || !response.body) throw Error('Provider model list unavailable');
  const reader = response.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 1048576) throw Error('Provider model list exceeds limit'); chunks.push(next.value); } }
  finally { await reader.cancel(); reader.releaseLock(); }
  try { const json = JSON.parse(Buffer.concat(chunks).toString()); if (!Array.isArray(json.data) || json.data.length > 10000) throw Error(); return json; }
  catch { throw Error('Provider model list is invalid'); }
}
/** Desktop provider-specific discovery, bounded by response bytes, rows and pages.
 * Errors never include response bodies, endpoints or credentials. */
export async function providerModelOptions(provider: {type:string;endpoint:string}, secret: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ProviderModel[]> {
  try {
    if (!['openai','openai-compat','anthropic','openrouter'].includes(provider.type)) throw Error();
    const base = provider.endpoint.replace(/\/$/,'');
    const url = `${base}${provider.type === 'anthropic' && !base.endsWith('/v1') ? '/v1' : ''}/models`;
    const headers: Record<string,string> = provider.type === 'anthropic' ? {'x-api-key':secret,'anthropic-version':'2023-06-01'} : {Authorization:`Bearer ${secret}`};
    const rows: any[] = []; const cursors = new Set<string>(); let cursor: string | undefined;
    for (let i=0;i<20;i++) {
      const json = await page(url + (cursor ? `?after_id=${encodeURIComponent(cursor)}` : ''),headers,signal,fetcher);
      rows.push(...json.data); if (rows.length > 10000) throw Error();
      if (provider.type !== 'anthropic' || !json.has_more) break;
      if (!validId(json.last_id) || cursors.has(json.last_id) || i === 19) throw Error();
      cursor=json.last_id; cursors.add(cursor!);
    }
    const all = new Set(rows.map(v=>v.id)); const seen = new Set<string>();
    if (['openai','openai-compat'].includes(provider.type)) rows.sort((a,b)=>(Number.isFinite(b.created) ? b.created : -Infinity)-(Number.isFinite(a.created) ? a.created : -Infinity) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    return rows.filter(v=>validId(v.id)).filter(v=>provider.type !== 'openai' || /^(gpt-|o|chatgpt-)/i.test(v.id) && !/(audio|dall-e|embedding|image|moderation|realtime|speech|transcribe|tts|whisper)/i.test(v.id) && (v.id.replace(/-\d{4}-\d{2}-\d{2}$/,'') === v.id || !all.has(v.id.replace(/-\d{4}-\d{2}-\d{2}$/,''))))
      .filter(v=>provider.type !== 'openrouter' || Array.isArray(v.supported_parameters) && v.supported_parameters.includes('tools'))
      .filter(v=>!seen.has(v.id) && !!seen.add(v.id)).slice(0,1000)
      .map(v=>({id:v.id,name:provider.type === 'anthropic' && typeof v.display_name === 'string' && v.display_name.length <= 200 && !/[\x00-\x1f\x7f]/.test(v.display_name) ? v.display_name : ['openai','openai-compat'].includes(provider.type) ? openAILabel(v.id) : v.id}));
  } catch { throw Error('Provider model list unavailable or invalid'); }
}
/** Compatibility ID-only API; UI receives labels separately. */
export async function providerModels(provider: {type:string;endpoint:string}, secret: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  return (await providerModelOptions(provider,secret,signal,fetcher)).map(v=>v.id);
}
export async function openAIModels(secret: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  return providerModels({type:'openai',endpoint:'https://api.openai.com/v1'},secret,signal,fetcher);
}
