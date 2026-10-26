/**
 * Publish-readiness checkup for one plugin folder.
 *
 * This is the part of the product that answers "will this upload survive the
 * market, and will a stranger trust it?" — argued from files, never from taste.
 * Every finding carries the file it came from and a concrete fix, so a failing
 * check is actionable rather than a score.
 *
 * The checks encode what the catalog actually requires: `dsh.bundle.patch` must
 * exist and resolve, a relative `name:` in the patch is what makes a `file:`
 * install and an npm install both work, and an install-time lifecycle script is
 * the single strongest signal reviewers and scanners both flag.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function stripYamlComments(text) {
  return text.split(/\r?\n/).map((line) => line.replace(/(^|\s)#.*$/, '')).join('\n');
}

/**
 * @param dir Plugin folder.
 * @returns {{ dir, score, verdict, checks: Array<{id,level,message,fix?}> }}
 */
export function checkup(dir) {
  const checks = [];
  const add = (id, level, message, fix) => checks.push({ id, level, message, ...(fix ? { fix } : {}) });

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { dir, score: 0, verdict: 'fail', checks: [{ id: 'dir', level: 'error', message: `not a directory: ${dir}` }] };
  }

  const pkgFile = join(dir, 'package.json');
  const pkg = readJson(pkgFile);
  if (pkg === null) {
    add('manifest', 'error', 'package.json is missing or not valid JSON', 'Create package.json with name, version, description and license.');
    return finish(dir, checks);
  }

  // ---- identity -------------------------------------------------------------
  if (typeof pkg.name !== 'string' || pkg.name.trim() === '') {
    add('name', 'error', 'package.json has no `name`', 'Set a lowercase npm-safe name.');
  } else if (pkg.name !== pkg.name.toLowerCase() || /[^a-z0-9._-]/.test(pkg.name)) {
    add('name', 'warn', `\`${pkg.name}\` is not a lowercase npm-safe name`, `Rename to something like ${pkg.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-')}.`);
  } else {
    add('name', 'ok', `name: ${pkg.name}`);
  }

  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+/.test(pkg.version)) {
    add('version', 'error', 'version is missing or not semver', 'Set `"version": "0.1.0"`.');
  } else {
    add('version', 'ok', `version: ${pkg.version}`);
  }

  const desc = typeof pkg.description === 'string' ? pkg.description.trim() : '';
  if (desc.length === 0) {
    add('description', 'error', 'description is empty', 'One sentence that states the capability, not the category.');
  } else if (desc.length < 40) {
    add('description', 'warn', `description is short (${desc.length} chars)`, 'The listing line is built from this; aim for 60–200 chars.');
  } else {
    add('description', 'ok', `description: ${desc.length} chars`);
  }

  if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes('dsh-plugin')) {
    add('keywords', 'warn', 'keywords does not include `dsh-plugin`', 'Add it: the GitHub topic and the catalog both key off this vocabulary.');
  } else {
    add('keywords', 'ok', 'keywords includes dsh-plugin');
  }

  if (pkg.license !== 'MIT' && pkg.license !== 'Apache-2.0' && pkg.license !== 'BSD-3-Clause' && pkg.license !== 'ISC') {
    add('license', 'warn', `license is ${pkg.license ?? 'absent'}`, 'Use a recognised SPDX id; reviewers ask about absent licenses.');
  } else {
    add('license', 'ok', `license: ${pkg.license}`);
  }

  // ---- DSH contract ---------------------------------------------------------
  const patchRel = pkg?.dsh?.bundle?.patch;
  if (typeof patchRel !== 'string') {
    add('bundle-patch', 'error', '`dsh.bundle.patch` is not declared', 'Point it at ./cordis.patch.yml so the market can compose the plugin.');
  } else {
    const patchFile = join(dir, patchRel.replace(/^\.\//, ''));
    if (!existsSync(patchFile)) {
      add('bundle-patch', 'error', `dsh.bundle.patch points at ${patchRel}, which does not exist`, 'Create the file or fix the path.');
    } else {
      add('bundle-patch', 'ok', `dsh.bundle.patch: ${patchRel}`);
      const text = stripYamlComments(readFileSync(patchFile, 'utf8'));
      if (!/^\s*-\s*id\s*:/m.test(text) || !/^\s*name\s*:/m.test(text)) {
        add('patch-shape', 'error', 'the patch file has no `insert:` row with id and name', 'A bundle patch must insert a loader row: `- insert: [{ id, name }]`.');
      } else if (!/name:\s*['"]?\.\//.test(text)) {
        add('patch-relative', 'warn', 'the patch `name:` is not a relative path', "Use `name: './index.js'` — DSH anchors a relative name beside the patch, so both npm and file: installs resolve.");
      } else {
        add('patch-relative', 'ok', 'patch name is relative');
      }
    }
  }

  if (pkg?.dsh?.client !== undefined) {
    const clientExport = typeof pkg?.exports === 'object' ? pkg.exports?.['./client'] : undefined;
    const clientPath = typeof clientExport === 'string' ? join(dir, clientExport.replace(/^\.\//, '')) : null;
    if (clientPath === null) {
      add('client', 'error', '`dsh.client` is declared but `exports["./client"]` is not', 'Point `"./client"` at the browser bundle so the host can load it.');
    } else if (!existsSync(clientPath)) {
      add('client', 'error', `the client bundle does not exist: ${clientExport}`, 'Ship the browser half, or drop `dsh.client`.');
    } else {
      const source = readFileSync(clientPath, 'utf8');
      if (!source.includes('__ModuleLoader__')) {
        add('client', 'error', 'the client bundle is not wrapped in `window.__ModuleLoader__.load({...})`', 'The host loads the browser half through the module loader; a plain ESM file will not mount.');
      } else if (!/exports\.apply\s*=/.test(source)) {
        add('client', 'warn', 'the client bundle does not export `apply`', 'The host calls `apply(ctx)` to mount the panel.');
      } else {
        add('client', 'ok', 'client bundle exports apply and uses the module loader');
      }
    }
  } else {
    add('client', 'warn', 'no `dsh.client` declared', 'Skip only if the plugin is tool-only; otherwise the market listing has no UI to show.');
  }

  if (typeof pkg?.engines?.dsh !== 'string') {
    add('engines', 'warn', '`engines.dsh` is absent', 'State the host range you tested, e.g. `>=0.1.7-rc.2`.');
  } else {
    add('engines', 'ok', `engines.dsh: ${pkg.engines.dsh}`);
  }

  // ---- supply chain ---------------------------------------------------------
  const scripts = pkg.scripts ?? {};
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare', 'prepack'].filter((k) => typeof scripts[k] === 'string');
  if (lifecycle.length > 0) {
    add('install-script', 'warn', `install-time scripts present: ${lifecycle.join(', ')}`, 'Every security scanner in the market flags these; a shipped `lib/` avoids the build step entirely.');
  } else {
    add('install-script', 'ok', 'no install-time lifecycle scripts');
  }

  if (Array.isArray(pkg.dependencies) && pkg.dependencies.length > 0) {
    add('deps', 'warn', 'dependencies is an array (invalid)', 'dependencies must be an object of name → range.');
  } else {
    const deps = Object.keys(pkg.dependencies ?? {});
    if (deps.length === 0) add('deps', 'ok', 'zero runtime dependencies');
    else add('deps', 'info', `${deps.length} runtime dependencies: ${deps.slice(0, 5).join(', ')}${deps.length > 5 ? ' …' : ''}`);
  }

  // ---- packaging ------------------------------------------------------------
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    add('files', 'warn', '`files` whitelist is absent', 'Without it the tarball carries test fixtures and screenshots.');
  } else {
    add('files', 'ok', `files whitelist: ${pkg.files.length} entries`);
  }

  const entry = typeof pkg.main === 'string' ? join(dir, pkg.main) : join(dir, 'index.js');
  if (!existsSync(entry)) {
    add('entry', 'error', `entry file not found: ${pkg.main ?? 'index.js'}`, 'Ship the built entry, or point `main` at the real file.');
  } else {
    add('entry', 'ok', `entry: ${pkg.main ?? 'index.js'}`);
  }

  if (!existsSync(join(dir, 'README.md'))) {
    add('readme', 'error', 'README.md is missing', 'The catalog renders it; an empty listing gets no installs.');
  } else {
    add('readme', 'ok', 'README.md present');
  }
  if (!existsSync(join(dir, 'README.zh-CN.md')) && !existsSync(join(dir, 'README.zh.md'))) {
    add('readme-zh', 'info', 'no Chinese README', 'A very large share of the catalog is bilingual; the listing reads better with both.');
  } else {
    add('readme-zh', 'ok', 'Chinese README present');
  }

  // ---- code hygiene ---------------------------------------------------------
  const top = readdirSync(dir);
  if (top.includes('node_modules')) {
    add('node-modules', 'info', 'node_modules is present in the source tree', '`.npmignore`/`files` keeps it out of the tarball; never commit it.');
  } else {
    add('node-modules', 'ok', 'no node_modules in the source tree');
  }

  return finish(dir, checks);
}

function finish(dir, checks) {
  const penalty = checks.reduce((sum, c) => sum + (c.level === 'error' ? 30 : c.level === 'warn' ? 8 : 0), 0);
  const score = Math.max(0, 100 - penalty);
  const verdict = checks.some((c) => c.level === 'error') ? 'fail' : checks.some((c) => c.level === 'warn') ? 'warn' : 'pass';
  return { dir, score, verdict, checks };
}
