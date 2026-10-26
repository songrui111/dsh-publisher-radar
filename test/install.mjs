/**
 * End-to-end installability check for dsh-publisher-radar.
 *
 * Installs the published artifact the way the market does — a tarball into a
 * node_modules tree — then boots that installed copy against a stub host and asserts
 * it registers its tools and routes. Nothing from the source checkout is used.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, '.install-test');
const repoPkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
// Default: the local pack for this version (identical bytes to the release asset —
// see the sha256 check in the docs). Fall back to the published release URL.
const localPack = join(here, '..', `dsh-publisher-radar-${repoPkg.version}.tgz`);
const tarball = process.argv[2]
  ?? (existsSync(localPack) ? localPack : `https://github.com/songrui111/dsh-publisher-radar/releases/latest/download/dsh-publisher-radar.tgz`);
// `npm` from PATH: the bundled node runtime does not ship a matching npm.cmd.
const npmCli = process.platform === 'win32' ? 'npm.cmd' : 'npm';

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'install-probe', private: true, version: '0.0.0' }, null, 2));

// A local path, an http(s) URL, or an npm spec (`dsh-publisher-radar@1.0.1`).
const localTgz = join(work, 'publisher-radar.tgz');
const isLocalFile = !/^https?:/i.test(tarball) && existsSync(tarball);
const isSpec = !/^https?:/i.test(tarball) && !isLocalFile;
let installTarget = './publisher-radar.tgz';

if (isSpec) {
  // Installs from the registry — the path a user's `dsh plugin add dsh-publisher-radar` takes.
  installTarget = tarball;
  console.log(`using spec      : ${tarball}`);
} else if (/^https?:/i.test(tarball)) {
  console.log(`downloading     : ${tarball}`);
  const response = await fetch(tarball, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(localTgz, bytes);
  console.log(`downloaded      : ${bytes.length} bytes`);
} else {
  const bytes = readFileSync(tarball);
  writeFileSync(localTgz, bytes);
  console.log(`using local     : ${tarball} (${bytes.length} bytes)`);
}

console.log(`installing      : npm install ${installTarget}`);
execFileSync(npmCli, ['install', installTarget, '--no-audit', '--no-fund', '--loglevel=error'], {
  cwd: work,
  stdio: 'inherit',
  shell: true,
});

const pkgDir = join(work, 'node_modules', 'dsh-publisher-radar');
console.log(`installed at   : ${pkgDir}`);

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
console.log(`name/version   : ${pkg.name}@${pkg.version}`);
console.log(`bundle patch   : ${pkg.dsh?.bundle?.patch}`);
console.log(`client         : ${JSON.stringify(pkg.dsh?.client)}`);
console.log(`install scripts: ${JSON.stringify(pkg.scripts ?? {})}`);

const patchFile = join(pkgDir, pkg.dsh.bundle.patch);
const patch = readFileSync(patchFile, 'utf8');
console.log(`patch exists   : ${existsSync(patchFile)}`);
const nameLine = patch.split(/\r?\n/).find((line) => /^\s*name:/.test(line));
console.log(`patch name     :${nameLine ?? ' (none)'}`);

// --- boot the installed copy against a stub host -------------------------------
const tools = [];
const routes = new Map();
const ctx = {
  tools: { register(tool) { tools.push(tool); return () => {}; } },
  effect(fn) { fn(); return () => {}; },
  inject(_deps, callback) {
    callback({
      webServer: {
        register(route) { routes.set(route.path, route.handler); return () => {}; },
      },
      effect(fn) { fn(); return () => {}; },
    });
    return () => {};
  },
};

const mod = await import(pathToFileURL(join(pkgDir, 'index.js')).href);
mod.apply(ctx, { cacheDir: join(work, 'cache'), myPlugins: [], fetchImpl: () => { throw new Error('offline'); } });

console.log(`tools          : ${tools.map((tool) => tool.name).join(', ')}`);
console.log(`routes         : ${[...routes.keys()].join(', ')}`);

const clientPath = join(pkgDir, 'client', 'client.js');
const client = readFileSync(clientPath, 'utf8');
console.log(`client present : ${existsSync(clientPath)} · __ModuleLoader__=${client.includes('__ModuleLoader__')} · apply=${client.includes('exports.apply')}`);

// --- assertions ---------------------------------------------------------------
const problems = [];
if (pkg.version !== repoPkg.version) problems.push(`version is ${pkg.version}, expected ${repoPkg.version}`);
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') problems.push('dsh.bundle.patch is wrong');
if (!/name:\s*['"]?\.\/index\.js['"]?/.test(patch)) problems.push('patch name is not relative ./index.js');
if (Object.keys(pkg.scripts ?? {}).some((key) => /^(pre|post)?install$/.test(key))) problems.push('install-time script present');
if (mod.name !== 'publisher-radar') problems.push('module name mismatch');
if (tools.length !== 5) problems.push(`expected 5 tools, got ${tools.length}`);
if (routes.size !== 2) problems.push(`expected 2 routes, got ${routes.size}`);
if (!client.includes('__ModuleLoader__') || !client.includes('exports.apply')) problems.push('client bundle is not loadable');

if (problems.length > 0) {
  console.log('\nFAIL');
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\nPASS: the published artifact installs and boots with 5 tools + 2 routes.');
}

if (process.argv.includes('--keep')) {
  console.log(`kept ${work}`);
} else {
  rmSync(work, { recursive: true, force: true });
}
