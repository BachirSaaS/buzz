import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
const walkthrough = process.env.BEEHIVE_TEST_REGISTRATION_WALKTHROUGH === '1';
const registration = fileURLToPath(new URL('./registration-fixture.ts', import.meta.url));
const fixture = fileURLToPath(new URL('./manager-installed-fixture.ts', import.meta.url));
// Explicit test-only seam. No production environment switch or OS-store fallback.
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (url.endsWith('/src/harness-discovery.ts')) return { ...result, source: "import {realpathSync} from 'node:fs'; export async function discoverHarnesses(_signal, options = {}) { return [{id:'buzz-agent',label:'Buzz Agent',executable:process.env.BEEHIVE_TEST_REGISTRATION_WALKTHROUGH === '1' ? realpathSync((options.home ?? process.env.HOME) + '/synthetic-acp') : process.execPath,state:'available',providers:['openai','anthropic','openai-compat','openrouter','databricks_v2'],reason:'Synthetic only'}]; }" };
  if (url.endsWith('/src/databricks-runtime.ts') || url.endsWith('/src/databricks-runtime-child.ts')) return { ...result, source: "throw Error('Runtime auth disabled by installed fixture');" };
  if (url.endsWith('/src/databricks.ts')) {
    const source = String(result.source), start = source.indexOf('export async function databricksNative('), end = source.indexOf('/** Save the workspace',start);
    if (start < 0 || end < 0) throw Error('Databricks fixture fence failed closed');
    return { ...result, source: source.slice(0,start) + "export async function databricksNative() { throw Error('Native OAuth disabled by installed fixture'); }\n" + source.slice(end) };
  }
  if (!walkthrough && url.endsWith('/src/relay-directory.ts')) return { ...result, source: "export async function fetchRelayDirectory() { throw Error('Directory disabled by installed fixture'); }" };
  if (url.endsWith('/src/agent-profile.ts')) return { ...result, source: "export async function fetchAgentProfile() { return {profileState:'none'}; }" };
  if (url.endsWith('/src/host-service.ts')) return { ...result, source: "export async function serviceStatus() { return {state:'stopped',relay:'disconnected'}; } export async function startService() { throw Error('Service start disabled by installed fixture'); } export async function stopService() { throw Error('Service stop disabled by installed fixture'); }" };
  if (url.endsWith('/src/settings-models.ts')) return { ...result, source: "export function detectBuzzAgent() { return process.execPath; } export async function providerModels() { throw Error('Direct provider access disabled by installed fixture'); } export async function providerModelOptions() { throw Error('Direct provider access disabled by installed fixture'); } export async function openAIModels() { throw Error('Direct provider access disabled by installed fixture'); }" };
  if (url.endsWith('/src/relay-name.ts')) return { ...result, source: "export function relayNameFromDocument() { return undefined; } export async function fetchRelayName() { return undefined; }" };
  if (!url.endsWith('/src/manager-entry.ts')) return result;
  const source = String(result.source);
  const original = 'new ManagerController(homedir(), snapshot => send({ snapshot }))';
  if (!source.includes(original)) throw Error('Installed manager fixture failed closed');
  if (walkthrough) return { ...result, source: `import { walkthroughController } from ${JSON.stringify(registration)};\n` + source.replace(original,'await walkthroughController(homedir(), snapshot => send({ snapshot }))') };
  return { ...result, source: `import { fixtureCredential, disconnectedTransport } from ${JSON.stringify(fixture)};\n` + source.replace(original, 'new ManagerController(homedir(), snapshot => send({ snapshot }), fixtureCredential, disconnectedTransport)') };
} });
