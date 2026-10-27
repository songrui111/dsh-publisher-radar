#!/usr/bin/env node
/**
 * Local-first release.
 *
 * Publishes to npm from this machine, THEN commits and tags, so the CI run only has to
 * attach the Release asset — its npm step finds the version already on the registry and
 * exits green (see `.github/workflows/release.yml`). Tagging first is the other order,
 * and that is the order that produced the red runs: CI reaches a registry that does not
 * have the version yet, and whatever the token cannot do becomes a failed step.
 *
 *   node scripts/release.mjs 1.0.3
 *   node scripts/release.mjs patch --dry-run
 *
 * Every precondition is checked before anything is written. If the publish fails, the
 * version bump is reverted and no tag is created.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pkgPath = join(root, 'package.json');
const REGISTRY = 'https://registry.npmjs.org/';
const PACKAGE = 'dsh-publisher-radar';

const isWindows = process.platform === 'win32';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const target = args.find((arg) => !arg.startsWith('--'));

const npm = (argv, opts = {}) => execFileSync(isWindows ? 'npm.cmd' : 'npm', argv, {
  cwd: root, encoding: 'utf8', shell: isWindows, ...opts,
});
const git = (argv, opts = {}) => execFileSync('git', argv, { cwd: root, encoding: 'utf8', ...opts });

const fail = (message, hint) => {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  → ${hint}`);
  process.exit(1);
};
const step = (message) => console.log(`\n▸ ${message}`);
const ok = (message) => console.log(`  ✓ ${message}`);

// ---------------------------------------------------------------- target version
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;
let next;

if (target === undefined) fail('missing target version', 'node scripts/release.mjs 1.0.3   or   patch | minor | major');
if (['patch', 'minor', 'major'].includes(target)) {
  const [major, minor, patch] = current.split('.').map(Number);
  next = target === 'patch' ? `${major}.${minor}.${patch + 1}`
    : target === 'minor' ? `${major}.${minor + 1}.0`
      : `${major + 1}.0.0`;
} else if (/^\d+\.\d+\.\d+$/.test(target)) {
  next = target;
} else {
  fail(`"${target}" is not a version`, 'use x.y.z, or patch | minor | major');
}

console.log(`package : ${PACKAGE}`);
console.log(`current : ${current}`);
console.log(`next    : ${next}${dryRun ? '   (dry run)' : ''}`);

// ------------------------------------------------------------------- preconditions
step('preconditions');

const registry = npm(['config', 'get', 'registry']).trim();
if (registry !== REGISTRY) fail(`npm registry is ${registry}`, `npm config set registry ${REGISTRY}`);
ok(`registry ${registry}`);

let whoami = '';
try {
  whoami = npm(['whoami']).trim();
} catch {
  fail('not logged in to npm', 'run: npm login');
}
ok(`logged in as ${whoami}`);

const status = git(['status', '--porcelain']).trim();
if (status !== '') {
  // `--tag-only` is defined below but the flag decides what a dirty tree means: a
  // resumed release is *supposed* to have the bumped package.json uncommitted, and
  // must not be blocked by it. Anything else is still an error.
  const resumed = args.includes('--tag-only') || args.includes('--resume');
  const unexpected = status.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[AM]\s+package\.json$/.test(line));
  if (!resumed || unexpected.length > 0) {
    fail('working tree is dirty', `commit or stash first:\n${status}`);
  }
  ok('working tree clean except the bumped package.json');
} else {
  ok('working tree clean');
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
if (branch !== 'main') fail(`on branch ${branch}, not main`, 'git switch main');
ok('on branch main');

try {
  git(['remote', 'get-url', 'origin']);
} catch {
  fail('no origin remote', 'git remote add origin https://github.com/songrui111/dsh-publisher-radar.git');
}
ok('origin configured');

// `--tag-only` picks up after a publish that npm accepted but this script did not see
// replicate in time: it skips bump and publish, proves the version is on the registry,
// then does the commit + tag + push that were left undone.
const tagOnly = args.includes('--tag-only') || args.includes('--resume');

// The whole point of this script: never tag a version that is not on npm yet.
const onRegistry = (() => {
  try {
    npm(['view', `${PACKAGE}@${next}`, 'version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

if (tagOnly) {
  if (pkg.version !== next) fail(`package.json says ${pkg.version}, not ${next}`, 'run without --tag-only for a fresh release');
  if (!onRegistry) fail(`${PACKAGE}@${next} is still not on the registry`, 'the publish may still be processing — check npmjs.com, or publish again');
  ok(`${PACKAGE}@${next} is on the registry — resuming at commit + tag`);
} else {
  if (onRegistry) fail(`${PACKAGE}@${next} is already on the registry`, `use: node scripts/release.mjs ${next} --tag-only`);
  ok(`${PACKAGE}@${next} is not on the registry yet`);
}

if (git(['tag', '-l', `v${next}`]).trim() !== '') fail(`tag v${next} already exists locally`, 'delete it or pick another version');
ok(`tag v${next} is free`);

if (dryRun) {
  console.log('\nDry run: every check passed. Nothing was written.');
  process.exit(0);
}

// ------------------------------------------------------------------------ publish
if (!tagOnly) {
  step(`bump ${current} → ${next}`);
  npm(['version', next, '--no-git-tag-version'], { stdio: 'inherit' });

  step('npm publish');
  try {
    npm(['publish', '--access', 'public'], { stdio: 'inherit' });
  } catch {
    step('publish failed — reverting the version bump and stopping before any tag');
    git(['checkout', '--', 'package.json']);
    fail('nothing was published and nothing was tagged', 'fix the npm error above, then run this again');
  }
}

// ------------------------------------------------------------------------ verify
// npm answers the upload with 202 ("accepted, may take a few minutes") and the read
// replicas follow later. Tagging before the registry can see the version is what makes
// the CI run red, so this waits — and if it gives up, it says how to resume without
// publishing twice.
step('verify on the registry (npm answers 202 first; replicas lag)');
let published = null;
for (let attempt = 1; attempt <= 20; attempt += 1) {
  try {
    const res = await fetch(`${REGISTRY}${PACKAGE}`, { headers: { accept: 'application/json' } });
    if (res.ok) {
      const doc = await res.json();
      const version = doc.versions?.[next];
      if (version !== undefined) {
        published = { ...version, latest: doc['dist-tags']?.latest };
        break;
      }
    }
  } catch { /* registry hiccup; retry */ }
  process.stdout.write(`  … waiting for ${PACKAGE}@${next} (${attempt}/20)\n`);
  await new Promise((resolve) => setTimeout(resolve, 6000));
}
if (published === null) {
  fail(
    `npm accepted the upload, but the registry still does not show ${next} after ~2 minutes`,
    `check https://www.npmjs.com/package/${PACKAGE} — once it appears, finish with:\n     node scripts/release.mjs ${next} --tag-only`,
  );
}
if (published.dist.fileCount < 10) fail(`only ${published.dist.fileCount} files in the published tarball — that is a stub, not the plugin`, 'fix and republish under a new version');
ok(`latest ${published.latest} · ${published.dist.fileCount} files · ${published.dist.unpackedSize} bytes · shasum ${published.dist.shasum}`);

// ---------------------------------------------------------------- commit + tag + push
step('commit, tag, push');
git(['add', '-A'], { stdio: 'inherit' });
git(['commit', '-m', `release v${next}`], { stdio: 'inherit' });
git(['push', 'origin', 'main'], { stdio: 'inherit' });
git(['tag', '-a', `v${next}`, '-m', `插件雷达 ${next}`], { stdio: 'inherit' });
git(['push', 'origin', `v${next}`], { stdio: 'inherit' });
ok(`tag v${next} pushed`);

console.log(`
Done. The CI run for v${next} will:
  - run the tests and pack the tarball
  - attach dsh-publisher-radar.tgz to the GitHub Release
  - find ${PACKAGE}@${next} already on npm and skip publishing (green)

Verify:
  https://github.com/songrui111/dsh-publisher-radar/releases/tag/v${next}
  https://github.com/songrui111/dsh-publisher-radar/actions
`);
