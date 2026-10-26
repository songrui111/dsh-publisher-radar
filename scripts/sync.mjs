#!/usr/bin/env node
/**
 * Copy this plugin into a DSH profile for local testing.
 *
 * `dsh plugin add file:...` is the supported route, but it runs the profile's
 * package manager and can be slow while a profile is booted. This script is the
 * blunt alternative: it copies the shipped files into the profile's node_modules
 * under the folder name the loader row expects, so a restart picks them up.
 *
 *   node scripts/sync.mjs            # desktop profile (default)
 *   node scripts/sync.mjs web        # another profile
 *   node scripts/sync.mjs desktop D:\custom\.dsh
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.argv[2] ?? 'desktop';
const home = process.argv[3] ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
const target = join(home, 'profiles', profile, 'node_modules', 'dsh-publisher-radar');

if (!existsSync(join(home, 'profiles', profile))) {
  console.error(`no such profile: ${join(home, 'profiles', profile)}`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const SHIP = ['index.js', 'package.json', 'cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'LICENSE', 'lib', 'client'];
for (const entry of SHIP) {
  cpSync(join(here, entry), join(target, entry), { recursive: true });
}

console.log(`synced → ${target}`);
console.log('restart the profile for the loader row and the panel to appear.');

// A quick reminder of what a fresh row looks like, so the next step is obvious.
const patch = join(home, 'profiles', profile, 'cordis.patch.yml');
if (existsSync(patch)) {
  const rows = readdirSync(join(target)).length;
  console.log(`profile patch: ${patch} (${rows} entries copied)`);
}
