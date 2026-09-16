// Synthetic ACP adapter: deterministic, no model credentials or relay needed.
const fs = require('node:fs');
const cp = require('node:child_process');
const net = require('node:net');
const readline = require('node:readline');
const rootIndex = process.argv.indexOf("--root");
const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : process.env.BUZZ_SANDBOX_FIXTURE;
function attempt(action) {
  try { action(); return 'allowed'; } catch (error) { return error.code; }
}
async function probe() {
  const childProcess = process.argv.includes('--probe') ? null : cp.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
  const result = {
    descendant_pid: childProcess?.pid ?? null,
    read: attempt(() => fs.readFileSync(root + '/protected/secret')),
    write: attempt(() => fs.writeFileSync(root + '/protected/keep', 'changed')),
    allowed_write: attempt(() => fs.writeFileSync(root + '/work/result.txt', 'Work completed inside Buzz’s sandbox.\n')),
    outside_write: attempt(() => fs.writeFileSync(root + '/outside/escape', 'changed')),
    hardlink: attempt(() => fs.linkSync(root + '/protected/secret', root + '/work/alias')),
    symlink_read: attempt(() => fs.readFileSync(root + '/work/secret-link')),
    policy_tamper: process.env.SANDPIT_CONFIG ? attempt(() => fs.writeFileSync(process.env.SANDPIT_CONFIG, '[files]\n')) : 'unprotected',
    ambient_secret: process.env.BUZZ_SANDBOX_UNGRANTED_SECRET ? 'leaked' : 'absent',
  };
  const child = cp.spawnSync('/bin/sh', ['-c', 'exec /usr/bin/env -i "$1" -e "$2" "$3"', 'probe', process.execPath,
    `const fs=require('fs'); try {fs.readFileSync(process.argv[1]); console.log('allowed')} catch(e) {console.log(e.code)}`,
    root + '/protected/secret'], {encoding:'utf8'});
  result.empty_environment_read = child.stdout.trim();
  result.socket = await new Promise(resolve => {
    const s = net.connect(9, '127.0.0.1');
    s.setTimeout(1000, () => { s.destroy(); resolve('timeout'); });
    s.on('connect', () => { s.destroy(); resolve('allowed'); });
    s.on('error', e => resolve(e.code));
  });
  fs.writeFileSync(root + '/work/report.json', JSON.stringify(result, null, 2));
  return result;
}
if (process.argv.includes('--probe')) { probe().then(r => console.log(JSON.stringify(r))); }
else {
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  readline.createInterface({input:process.stdin}).on('line', async line => {
    const req = JSON.parse(line);
    let result;
    if (req.method === 'initialize') result = {protocolVersion:2, agentInfo:{name:'sandpit-probe', version:'1'}, agentCapabilities:{}};
    else if (req.method === 'session/new') result = {sessionId:'probe-session'};
    else if (req.method === 'session/prompt') {
      const report = await probe();
      send({jsonrpc:'2.0', method:'session/update', params:{sessionId:'probe-session', update:{sessionUpdate:'agent_message_chunk', content:{type:'text', text:JSON.stringify(report)}}}});
      result = {stopReason:'end_turn'};
    } else if (req.method === 'session/cancel') return;
    else result = {};
    if (req.id !== undefined) send({jsonrpc:'2.0', id:req.id, result});
  });
}
