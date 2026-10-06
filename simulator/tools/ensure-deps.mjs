// Called by both double-click launchers (spec §13, step 4) so the
// install-only-when-needed logic exists once for Windows and macOS.
//
// Installs npm dependencies when node_modules/ is missing or package-lock.json
// has changed since the last install, then records the lockfile hash in
// node_modules/.tactura-install-stamp. Exits non-zero if the install fails.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(root, 'package-lock.json');
const modulesDir = path.join(root, 'node_modules');
const stampPath = path.join(modulesDir, '.tactura-install-stamp');

const hashFile = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const readStamp = () => (existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : null);

const hasLock = existsSync(lockPath);
const hasModules = existsSync(modulesDir);

if (hasLock && hasModules && readStamp() === hashFile(lockPath)) {
  console.log('  DEPS ......... UP TO DATE');
  process.exit(0);
}

const reason = !hasModules ? 'first run' : 'dependencies changed';
console.log(`  DEPS ......... INSTALLING (${reason}, this takes a minute)\n`);

// `npm ci` installs exactly what the committed lockfile says.
const command = hasLock ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund';
const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });

if (result.status !== 0) {
  console.error(`\n  DEPS ......... FAILED (\`${command}\` exited with ${result.status ?? result.signal})`);
  process.exit(1);
}

writeFileSync(stampPath, `${hashFile(lockPath)}\n`);
console.log('\n  DEPS ......... INSTALLED');
