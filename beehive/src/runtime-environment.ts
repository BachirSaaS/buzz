/** Local nonsecret runtime variables. Authority, credentials, loader hooks and
 * structured harness fields are never configurable through this map. */
export function runtimeEnvironment(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 32) throw Error('Environment requires at most 32 name/value entries');
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[A-Z_][A-Z0-9_]{0,99}$/.test(key) || /^(BUZZ_|BEEHIVE_|GOOSE_|CODEX_|ANTHROPIC_|CLAUDE_|OPENAI_|OPENROUTER_|DATABRICKS_|PI_|NODE_|LD_|DYLD_|XDG_|NPM_|PNPM_|BUN_)/.test(key) || /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/.test(key) || ['HOME','PATH','SHELL','ENV','BASH_ENV','ZDOTDIR','USER','LOGNAME','TMPDIR','TMP','TEMP'].includes(key)) throw Error('Environment name is reserved or secret-bearing');
    if (typeof entry !== 'string' || Buffer.byteLength(entry) > 2048 || /[\x00-\x1f\x7f-\x9f]/.test(entry)) throw Error('Invalid environment value');
    result[key] = entry;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 8192) throw Error('Environment exceeds 8192 bytes');
  return result;
}
