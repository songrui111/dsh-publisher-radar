/**
 * Offline smoke test: no network, no DSH host.
 *
 * It covers the parts where a bug would be silent — the coverage math, the checkup
 * verdict, the tool surface, and the HTML escaping — rather than the download, which
 * `scripts/snapshot.mjs` exercises for real.
 *
 * Run: node test/smoke.mjs
 * With a real catalog: node test/smoke.mjs --catalog ../market/plugins.json
 */
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gapIndex, levelOf, TOPICS } from '../lib/topics.mjs';
import { catalogStats, loadCatalog, parseCatalog, searchEntries, tarEntry } from '../lib/catalog.mjs';
import { repoOf } from '../lib/github.mjs';
import { normalizeRepository, npmFacts } from '../lib/npm.mjs';
import { checkup } from '../lib/checkup.mjs';
import { createTools } from '../lib/tools.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
let passed = 0;
const test = async (label, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${label}`);
};

const fixture = {
  plugins: [
    { name: 'dsh-trello-bridge', owner: 'a', category: 'tools', description: { zh: '把 Trello 看板接进来', en: 'Trello boards' }, stars: 0 },
    { name: 'dsh-kanban', owner: 'b', category: 'workflow', description: { en: 'a local kanban board' }, stars: 16 },
    { name: 'dsh-plugin-doctor', owner: 'c', category: 'dev', description: { zh: '插件诊断' }, stars: 5, npm: '@c/doctor', downloads: 4898 },
  ],
};

console.log('publisher-radar smoke');

await test('parseCatalog rejects an empty document', () => {
  assert.throws(() => parseCatalog({}), /not a catalog/);
  assert.throws(() => parseCatalog({ plugins: [] }), /not a catalog/);
});

await test('parseCatalog normalizes bilingual descriptions', () => {
  const { entries } = parseCatalog(fixture);
  assert.equal(entries.length, 3);
  assert.match(entries[0].description, /Trello/);
  assert.match(entries[0].description, /看板/);
});

await test('gapIndex reports zero-coverage topics as empty', () => {
  const { entries } = parseCatalog(fixture);
  const rows = gapIndex(entries);
  const logistics = rows.find((r) => r.id === 'logistics');
  assert.equal(logistics.count, 0);
  assert.equal(logistics.level, 'empty');
  // Emptiest first: the first row must be an empty topic.
  assert.equal(rows[0].level, 'empty');
});

await test('gapIndex counts a topic that the fixture covers', () => {
  const { entries } = parseCatalog(fixture);
  const rows = gapIndex(entries);
  const trello = rows.find((r) => r.id === 'trello');
  assert.equal(trello.count, 1);
  assert.deepEqual(trello.samples, ['dsh-trello-bridge']);
});

await test('levelOf thresholds are monotonic', () => {
  assert.deepEqual([0, 1, 3, 4, 10, 11].map(levelOf), ['empty', 'thin', 'thin', 'warming', 'warming', 'crowded']);
});

await test('catalogStats aggregates categories and adds', () => {
  const { entries } = parseCatalog(fixture);
  const stats = catalogStats(entries);
  assert.equal(stats.total, 3);
  assert.equal(stats.withNpm, 1);
  assert.deepEqual(stats.categories.map((c) => c.name).sort(), ['dev', 'tools', 'workflow']);
});

await test('searchEntries ranks an exact name first', () => {
  const { entries } = parseCatalog(fixture);
  const hits = searchEntries(entries, 'dsh-kanban');
  assert.equal(hits[0].name, 'dsh-kanban');
});

await test('loadCatalog reads an explicit file without the network', async () => {
  const result = await loadCatalog({
    catalogPath: join(here, 'fixture-catalog.json'),
    fetchImpl: () => { throw new Error('network must not be used'); },
  });
  assert.equal(result.from, 'file');
  assert.ok(result.catalog.entries.length >= 3);
});

await test('force bypasses the cache; a plain load serves it', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'radar-cache-'));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const count = calls === 1 ? 3 : 4;
    return {
      ok: true,
      text: async () => JSON.stringify({
        plugins: Array.from({ length: count }, (_, i) => ({ name: `p${i}`, owner: 'o', category: 'tools' })),
      }),
    };
  };

  const first = await loadCatalog({ cacheDir: dir, fetchImpl });
  assert.equal(first.from, 'network');
  assert.equal(first.catalog.entries.length, 3);
  // The mirror race fans out, so count calls relative to this point rather than
  // assuming one request per load.
  const callsAfterFirst = calls;
  assert.ok(callsAfterFirst >= 1);

  const second = await loadCatalog({ cacheDir: dir, fetchImpl });
  assert.equal(second.from, 'cache');
  assert.equal(second.catalog.entries.length, 3);
  assert.equal(calls, callsAfterFirst, 'a fresh cache must not hit the network');

  // This is what the Refresh button does: ignore the cache and download again.
  const forced = await loadCatalog({ cacheDir: dir, fetchImpl, force: true });
  assert.equal(forced.from, 'network');
  assert.equal(forced.catalog.entries.length, 4);
  assert.ok(calls > callsAfterFirst, 'force must go back to the network');

  rmSync(dir, { recursive: true, force: true });
});

await test('checkup passes on this plugin with no blocking findings', () => {
  const result = checkup(root);
  assert.ok(result.score > 0, 'score');
  const errors = result.checks.filter((c) => c.level === 'error');
  assert.deepEqual(errors, [], `unexpected errors: ${JSON.stringify(errors)}`);
  assert.equal(result.checks.find((c) => c.id === 'bundle-patch').level, 'ok');
  assert.equal(result.checks.find((c) => c.id === 'patch-relative').level, 'ok');
  assert.equal(result.checks.find((c) => c.id === 'install-script').level, 'ok');
});

await test('checkup flags a missing patch', () => {
  const result = checkup(join(here, 'fixture-broken-plugin'));
  assert.equal(result.verdict, 'fail');
  assert.ok(result.checks.some((c) => c.id === 'bundle-patch' && c.level === 'error'));
});

await test('tools expose the documented surface', () => {
  const radar = { gaps: async () => ({ rows: [], counts: { empty: 0, thin: 0, warming: 0, crowded: 0 }, fetchedAt: null, from: 'file', total: 0 }), overview: async () => null, search: async () => ({ query: '', entries: [], topics: [], fetchedAt: null, from: 'file' }), mine: async () => ({ rows: [], fetchedAt: null, from: 'file', total: 0, detected: null }), checkup };
  const tools = createTools(radar, { myPlugins: [] });
  assert.deepEqual(tools.map((t) => t.name), ['radar_gaps', 'radar_market', 'radar_plugin', 'radar_checkup', 'radar_mine']);
  for (const tool of tools) {
    assert.equal(typeof tool.execute, 'function', tool.name);
    assert.equal(tool.parameters.type, 'object', tool.name);
    assert.equal(typeof tool.output.schema, 'object', tool.name);
  }
});

await test('a downloads 404 must not make a published package look unpublished', async () => {
  // Exactly the shape npm returns for a fresh package: the registry knows it, the
  // downloads endpoint 404s until statistics exist.
  const fetchImpl = async (url) => {
    if (url.includes('api.npmjs.org/downloads')) return { status: 404, ok: false, json: async () => ({}) };
    if (url.includes('registry.npmjs.org')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          version: '0.1.1',
          repository: { type: 'git', url: 'git+https://github.com/songrui111/dsh-agent-bench.git' },
        }),
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  const rows = await npmFacts(['dsh-agent-bench'], { fetchImpl });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].missing, false, 'the package exists');
  assert.equal(rows[0].version, '0.1.1');
  assert.equal(rows[0].downloads, null, 'no statistics yet');
  assert.equal(repoOf(rows[0].repository), 'songrui111/dsh-agent-bench');
});

await test('a registry 404 is what "missing" means', async () => {
  const fetchImpl = async () => ({ status: 404, ok: false, json: async () => ({}) });
  const rows = await npmFacts(['does-not-exist-anywhere'], { fetchImpl });
  assert.equal(rows[0].missing, true);
});

await test('tarEntry reads one file out of a gzipped npm tarball', async () => {
  const { gzipSync } = await import('node:zlib');
  const body = Buffer.from('{"plugins":[{"name":"x"}]}', 'utf8');
  const header = Buffer.alloc(512);
  header.write('package/plugins.json', 0, 'utf8');
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
  header.write('0', 156, 'utf8');
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);
  const tar = Buffer.concat([header, padded, Buffer.alloc(1024)]);
  assert.equal(tarEntry(gzipSync(tar), 'package/plugins.json'), body.toString('utf8'));
  assert.throws(() => tarEntry(gzipSync(tar), 'package/missing.json'), /no package\/missing/);
});

await test('repoOf understands the shapes the catalog stores', () => {
  assert.equal(repoOf('https://github.com/owner/repo'), 'owner/repo');
  assert.equal(repoOf('https://github.com/owner/repo.git'), 'owner/repo');
  assert.equal(repoOf('git+https://github.com/owner/repo#readme'), 'owner/repo');
  assert.equal(repoOf('https://example.com/x'), null);
  assert.equal(repoOf(null), null);
});

await test('normalizeRepository accepts both npm shapes, and repoOf reads them', () => {
  assert.equal(normalizeRepository('git+https://github.com/a/b.git'), 'git+https://github.com/a/b.git');
  assert.equal(normalizeRepository({ type: 'git', url: 'git+https://github.com/a/b.git' }), 'git+https://github.com/a/b.git');
  assert.equal(normalizeRepository({}), null);
  assert.equal(normalizeRepository(null), null);
  // The point of the pair: a package outside the catalog can still yield a repo.
  assert.equal(repoOf(normalizeRepository({ url: 'git+https://github.com/a/b.git' })), 'a/b');
});

const catalogFlag = process.argv.indexOf('--catalog');
if (catalogFlag !== -1 && process.argv[catalogFlag + 1]) {
  await test('live catalog: gap ranking over the real market', async () => {
    const result = await loadCatalog({ catalogPath: process.argv[catalogFlag + 1], fetchImpl: () => { throw new Error('no network'); } });
    const rows = gapIndex(result.catalog.entries);
    assert.equal(rows.length, TOPICS.length);
    const empties = rows.filter((r) => r.level === 'empty');
    assert.ok(empties.length > 0, 'a 6.9k-plugin market should still have empty topics');
    console.log(`      ${result.catalog.entries.length} plugins · ${empties.length} empty topics · emptiest: ${empties.slice(0, 5).map((r) => r.label).join(', ')}`);
  });
}

console.log(`\n${passed} checks passed`);
