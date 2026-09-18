import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagedBun = join(root, 'runtime', 'bun');
const bun = existsSync(packagedBun) ? packagedBun : process.env.BEEHIVE_BUN || 'bun';
const version = spawnSync(bun, ['--version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
  console.error('beehive: Bun 1.4.2 is required to run the manager. Set BEEHIVE_BUN to the pinned executable or complete the packaged runtime installation.');
  process.exit(1);
}
if (version.stdout.trim() !== '1.4.2') {
  console.error(`beehive: Bun 1.4.2 is required; ${bun} reported ${version.stdout.trim() || 'an unknown version'}.`);
  process.exit(1);
}
const child = spawnSync(bun, [join(root, 'src', 'manager-view.ts')], { stdio: 'inherit' });
if (child.error) {
  console.error(`beehive: cannot start the OpenTUI manager: ${child.error.message}`);
  process.exit(1);
}
if (child.status !== null) process.exit(child.status);
if (child.signal) process.kill(process.pid, child.signal);
process.exit(1);
