/**
 * Host-level integration test: run the real `apply()` against a mock Cordis context,
 * then drive the real route handlers with real Requests.
 *
 * This exists because the parts that break in a plugin are not usually logic bugs —
 * they are wiring bugs: a tool registered with the wrong shape, a route that never
 * gets mounted, a handler that assumes a framework instead of Node's `req`/`res`.
 * The mock below mimics exactly the two seams index.js uses (`ctx.tools.register`
 * and `ctx.inject(['webServer'])`) and nothing else, so a passing run means the
 * plugin works on a host that provides them.
 *
 * The cache directory is redirected into the test folder: a test must never write a
 * snapshot history into the user's real `~/.dsh`.
 *
 * Run: node test/host.mjs [--catalog <path>]
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { apply, name, inject } from '../index.js';
import { TOPICS } from '../lib/topics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const catalogFlag = process.argv.indexOf('--catalog');
const catalogPath = catalogFlag !== -1 ? process.argv[catalogFlag + 1] : join(here, 'fixture-catalog.json');
const cacheDir = join(here, '.tmp-cache');
const homeDir = join(here, '.tmp-home');

rmSync(cacheDir, { recursive: true, force: true });
rmSync(homeDir, { recursive: true, force: true });

// A plugin under development: installed in a profile as a `file:` dependency and
// never published to npm. The panel must still be able to describe it.
const localPkgDir = join(homeDir, 'profiles', 'desktop', 'node_modules', 'dsh-local-fixture');
mkdirSync(localPkgDir, { recursive: true });
writeFileSync(join(localPkgDir, 'package.json'), JSON.stringify({
  name: 'dsh-local-fixture',
  version: '0.4.2',
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  repository: { type: 'git', url: 'git+https://github.com/fixture/local.git' },
}, null, 2), 'utf8');

console.log('publisher-radar host wiring');

assert.equal(name, 'publisher-radar');
assert.deepEqual(inject, ['tools']);

// ---------------------------------------------------------------- mock host
const tools = [];
const routes = new Map();
const ctx = {
  tools: {
    register(tool) {
      tools.push(tool);
      return () => {};
    },
  },
  effect(fn) {
    fn();
    return () => {};
  },
  inject(_deps, callback) {
    callback({
      webServer: {
        register(route) {
          assert.equal(route.kind, 'exact', 'routes are registered exact');
          assert.equal(typeof route.handler, 'function');
          routes.set(route.path, route.handler);
          return () => {};
        },
      },
      effect(fn) {
        fn();
        return () => {};
      },
    });
    return () => {};
  },
};

const offline = () => { throw new Error('offline test: no network allowed'); };

apply(ctx, { catalogPath, cacheDir, dshHome: homeDir, myPlugins: [], fetchImpl: offline });

assert.deepEqual(tools.map((t) => t.name), ['radar_gaps', 'radar_market', 'radar_plugin', 'radar_checkup', 'radar_mine']);
console.log(`  ok  ${tools.length} tools registered`);

assert.deepEqual([...routes.keys()].sort(), ['/radar/api.json', '/radar/config']);
console.log('  ok  both routes mounted');

// Every tool must carry the contract the platform validates before it calls it.
for (const tool of tools) {
  assert.equal(typeof tool.name, 'string');
  assert.equal(typeof tool.description, 'string');
  assert.ok(tool.description.length > 40, `${tool.name} description is thin`);
  assert.equal(tool.parameters.type, 'object');
  assert.equal(typeof tool.execute, 'function');
  assert.equal(tool.output.schema.type, 'object');
  assert.equal(typeof tool.output.render, 'function');
}
console.log('  ok  every tool satisfies {name, description, parameters, output, execute}');

// ------------------------------------------------------------- fake req/res
function call(handler, url, method = 'GET', headers = { host: '127.0.0.1:13481' }, body = null) {
  return new Promise((resolveCall, rejectCall) => {
    const chunks = [];
    const listeners = new Map();
    const req = {
      method,
      url,
      headers,
      on(event, listener) {
        listeners.set(event, listener);
        return req;
      },
      destroy() {},
    };
    const res = {
      status: 0,
      headers: {},
      writeHead(status, responseHeaders) {
        this.status = status;
        this.headers = responseHeaders ?? {};
      },
      end(chunk) {
        if (chunk !== undefined) chunks.push(String(chunk));
        resolveCall({ status: this.status, headers: this.headers, body: chunks.join('') });
      },
    };
    Promise.resolve(handler(req, res)).then(() => {}).catch(rejectCall);
    // Body delivery is asynchronous: a handler that reads a body attaches its
    // listeners synchronously and then awaits them, so delivering here would deadlock.
    if (body !== null) {
      setImmediate(() => {
        listeners.get('data')?.(Buffer.from(body, 'utf8'));
        listeners.get('end')?.();
      });
    }
  });
}

const api = await call(routes.get('/radar/api.json'), '/radar/api.json');
assert.equal(api.status, 200);
const parsed = JSON.parse(api.body);
assert.equal(parsed.schema, 'dsh-publisher-radar/v1');
assert.ok(parsed.total >= 3, 'api reports a total');
assert.ok(Array.isArray(parsed.gaps) && parsed.gaps.length > 0);
assert.equal(parsed.gaps.length, TOPICS.length, 'one row per taxonomy topic');
assert.equal(api.headers['cache-control'], 'no-store');
console.log(`  ok  GET /radar/api.json → ${parsed.total} plugins, ${parsed.gaps.length} topics`);

const post = await call(routes.get('/radar/api.json'), '/radar/api.json', 'POST');
assert.equal(post.status, 405);
assert.equal(post.headers.allow, 'GET, HEAD');
console.log('  ok  non-GET is refused with 405');

// The fence: a plugin route sits outside the host's auth gate, so anything that can
// reach the port could otherwise read it. Default is loopback only.
const guarded = await call(routes.get('/radar/api.json'), '/radar/api.json?force=1');
assert.equal(guarded.status, 200);
assert.equal(JSON.parse(guarded.body).from, 'file', 'a forced refresh still honours an explicit catalog file');
console.log('  ok  ?force=1 re-runs the load path');

const remoteApi = await call(routes.get('/radar/api.json'), '/radar/api.json', 'GET', { host: '192.168.1.5:13481' });
assert.equal(remoteApi.status, 403);
const loopback = await call(routes.get('/radar/api.json'), '/radar/api.json', 'GET', { host: 'localhost:13481' });
assert.equal(loopback.status, 200);
console.log('  ok  non-loopback Host is refused; loopback and localhost pass');

// The panel is the whole product, so the API must answer its search box directly —
// and with enough detail that a result can be opened without leaving the panel.
const searched = await call(routes.get('/radar/api.json'), '/radar/api.json?q=kanban');
assert.equal(searched.status, 200);
const searchBody = JSON.parse(searched.body);
assert.ok(searchBody.search !== null, 'search block is present');
assert.equal(searchBody.search.query, 'kanban');
assert.ok(Array.isArray(searchBody.search.entries) && searchBody.search.entries.length > 0, 'kanban has hits');
assert.ok(Array.isArray(searchBody.search.topics) && searchBody.search.topics.length > 0);
// The page route is gone, so nothing may point the panel at a URL that no longer exists.
assert.equal(searchBody.url, undefined, 'no dead link to the removed /radar page');
const hit = searchBody.search.entries[0];
for (const field of ['name', 'owner', 'categories', 'stars', 'downloads', 'install', 'installCommand', 'description']) {
  assert.ok(field in hit, `search hit carries ${field}`);
}
console.log(`  ok  GET /radar/api.json?q= → ${searchBody.search.entries.length} hits, detail fields present`);

// Drilling from "this corner is empty" into "who exactly is in it", in-panel.
const topic = await call(routes.get('/radar/api.json'), '/radar/api.json?topic=kanban');
assert.equal(topic.status, 200);
const topicBody = JSON.parse(topic.body);
assert.ok(topicBody.topic !== null);
assert.equal(topicBody.topic.id, 'kanban');
assert.ok(topicBody.topic.count > 0);
assert.ok(topicBody.topic.entries.length > 0);
assert.ok('install' in topicBody.topic.entries[0]);
assert.equal(topicBody.topic.count, topicBody.topic.total);
console.log(`  ok  GET /radar/api.json?topic= → ${topicBody.topic.label} with ${topicBody.topic.entries.length} plugins`);

// An unknown topic must be null, not a 500.
const missingTopic = await call(routes.get('/radar/api.json'), '/radar/api.json?topic=not-a-topic');
assert.equal(missingTopic.status, 200);
assert.equal(JSON.parse(missingTopic.body).topic, null);
console.log('  ok  unknown topic degrades to null');

// Level 1 → 2: a market category lists the topics it actually contains.
const cat = await call(routes.get('/radar/api.json'), '/radar/api.json?cat=dev');
assert.equal(cat.status, 200);
const catBody = JSON.parse(cat.body);
assert.ok(catBody.category !== null, 'category block present');
assert.equal(catBody.category.name, 'dev');
assert.ok(catBody.category.count > 0);
assert.ok(Array.isArray(catBody.category.topics) && catBody.category.topics.length > 0);
assert.ok(catBody.category.topics.every((topic) => topic.count > 0), 'empty topics are filtered out inside a category');
const catCounts = catBody.category.topics.map((topic) => topic.count);
assert.deepEqual(catCounts, catCounts.slice().sort((a, b) => b - a), 'topics are sorted by coverage');
console.log(`  ok  GET ?cat=dev → ${catBody.category.topics.length} topics (sorted, no zeros)`);

// Level 2 → 3: (category, topic) lists that intersection's plugins.
const firstTopic = catBody.category.topics[0].id;
const drill = await call(routes.get('/radar/api.json'), `/radar/api.json?cat=dev&topic=${encodeURIComponent(firstTopic)}`);
assert.equal(drill.status, 200);
const drillBody = JSON.parse(drill.body);
assert.equal(drillBody.category.topic.id, firstTopic);
assert.ok(drillBody.category.entries.length > 0);
assert.ok('install' in drillBody.category.entries[0]);
console.log(`  ok  GET ?cat=dev&topic=${firstTopic} → ${drillBody.category.entries.length} plugins`);

// The whole catalog, paged: every record must be reachable. The count is read from
// the payload rather than hardcoded — the market grows, and a test that pins today's
// size would fail tomorrow for no good reason.
const page1 = await call(routes.get('/radar/api.json'), '/radar/api.json?browse=1');
assert.equal(page1.status, 200);
const b1 = JSON.parse(page1.body).browse;
assert.equal(b1.pageSize, 30);
assert.equal(b1.entries.length, 30);
assert.ok(b1.total > 1000, 'a large market');
assert.equal(b1.pages, Math.ceil(b1.total / 30));
assert.ok(b1.page === 1);
assert.ok('installCommand' in b1.entries[0], 'install command travels with each entry');
console.log(`  ok  GET ?browse=1 → page ${b1.page}/${b1.pages}, ${b1.total} plugins`);

const page2 = await call(routes.get('/radar/api.json'), '/radar/api.json?browse=1&page=2');
const b2 = JSON.parse(page2.body).browse;
assert.equal(b2.page, 2);
assert.notEqual(b2.entries[0].name, b1.entries[0].name, 'page 2 is a different slice');
console.log('  ok  ?browse=1&page=2 → different slice');

const filtered = await call(routes.get('/radar/api.json'), '/radar/api.json?browse=1&cat=ui');
const bf = JSON.parse(filtered.body).browse;
assert.ok(bf.total > 0 && bf.total < b1.total, 'a category is a proper subset of the market');
console.log(`  ok  ?browse=1&cat=ui → ${bf.total} plugins`);

const starred = await call(routes.get('/radar/api.json'), '/radar/api.json?browse=1&sort=stars&dir=desc&pageSize=10');
const bs = JSON.parse(starred.body).browse;
assert.equal(bs.entries.length, 10);
for (let i = 1; i < bs.entries.length; i += 1) {
  assert.ok((bs.entries[i - 1].stars ?? -1) >= (bs.entries[i].stars ?? -1), 'stars are descending');
}
console.log(`  ok  ?browse=1&sort=stars → top is ${bs.entries[0].name} (★${bs.entries[0].stars})`);

const searched2 = await call(routes.get('/radar/api.json'), '/radar/api.json?browse=1&q=memory');
const bq = JSON.parse(searched2.body).browse;
assert.ok(bq.total > 0 && bq.total < b1.total, 'search narrows the set');
console.log(`  ok  ?browse=1&q=memory → ${bq.total} results`);

// Saving the panel's own settings: MULTIPLE packages and an optional token, token
// never returned. A list editor that silently keeps only the last item would pass a
// one-package test, so this one uses two.
const saved = await call(routes.get('/radar/config'), '/radar/config', 'POST', { host: '127.0.0.1:13481' },
  JSON.stringify({ myPlugins: ['dsh-wsl-tool', 'dsh-zotero'], githubToken: 'ghp_testtoken123' }));
assert.equal(saved.status, 200);
const savedBody = JSON.parse(saved.body);
assert.equal(savedBody.ok, true);
assert.deepEqual(savedBody.myPlugins, ['dsh-wsl-tool', 'dsh-zotero']);
assert.equal(savedBody.hasToken, true);
console.log('  ok  POST /radar/config saves a LIST of packages + token');

// The plain payload must NOT pay for npm/GitHub: that lookup is what made every
// panel click take 1–6 s. It is opt-in via ?mine=1, which the panel requests after
// its first paint.
const cheap = await call(routes.get('/radar/api.json'), '/radar/api.json?browse=1');
assert.equal(JSON.parse(cheap.body).mine, null, 'a browse request must not query npm');
console.log('  ok  the plain payload skips the network-bound mine block');

const afterSave = await call(routes.get('/radar/api.json'), '/radar/api.json?mine=1');
assert.ok(!afterSave.body.includes('ghp_testtoken123'), 'the token must never be readable through the API');
const afterBody = JSON.parse(afterSave.body);
assert.deepEqual(afterBody.config.myPlugins, ['dsh-wsl-tool', 'dsh-zotero']);
assert.equal(afterBody.config.hasToken, true);
// Both tracked packages reach the mine section — the point of a list.
assert.equal(afterBody.mine.length, 2, 'both packages are looked up');
assert.deepEqual(afterBody.mine.map((row) => row.package).sort(), ['dsh-wsl-tool', 'dsh-zotero']);
console.log('  ok  GET ?mine=1 exposes both packages and only "hasToken"');

// A `file:`-installed, never-published plugin must still be describable: npm has no
// record of it, but the profile's node_modules does.
const localSaved = await call(routes.get('/radar/config'), '/radar/config', 'POST', { host: '127.0.0.1:13481' },
  JSON.stringify({ myPlugins: ['dsh-local-fixture'] }));
assert.deepEqual(JSON.parse(localSaved.body).myPlugins, ['dsh-local-fixture']);
const localApi = await call(routes.get('/radar/api.json'), '/radar/api.json?mine=1');
const localRow = JSON.parse(localApi.body).mine.find((row) => row.package === 'dsh-local-fixture');
assert.ok(localRow, 'the local package is reported');
assert.equal(localRow.local, true, 'marked as local, not missing');
assert.equal(localRow.missing, false);
assert.equal(localRow.version, '0.4.2', 'version read from the profile manifest');
assert.equal(localRow.repo, 'fixture/local', 'repository read from the profile manifest');
console.log('  ok  a local file: plugin resolves to its manifest (version + repo)');

// Removing one later must keep the other.
const oneLeft = await call(routes.get('/radar/config'), '/radar/config', 'POST', { host: '127.0.0.1:13481' },
  JSON.stringify({ myPlugins: ['dsh-zotero'] }));
assert.deepEqual(JSON.parse(oneLeft.body).myPlugins, ['dsh-zotero']);
assert.equal(JSON.parse(oneLeft.body).hasToken, true, 'omitting the token keeps it');
console.log('  ok  removing one package keeps the other and the token');

const cleared = await call(routes.get('/radar/config'), '/radar/config', 'POST', { host: '127.0.0.1:13481' },
  JSON.stringify({ myPlugins: [], githubToken: '' }));
assert.equal(JSON.parse(cleared.body).hasToken, false);
assert.deepEqual(JSON.parse(cleared.body).myPlugins, []);
console.log('  ok  POST /radar/config can clear the token');

const getConfig = await call(routes.get('/radar/config'), '/radar/config', 'GET');
assert.equal(getConfig.status, 405);
console.log('  ok  GET /radar/config is refused');

const remoteSave = await call(routes.get('/radar/config'), '/radar/config', 'POST', { host: '10.0.0.9:13481' },
  JSON.stringify({ myPlugins: ['x'] }));
assert.equal(remoteSave.status, 403);
console.log('  ok  config writes are loopback-only');

// --------------------------------------------------------------- tool calls
const gaps = await tools[0].execute({ level: 'empty', limit: 5 });
assert.match(gaps.markdown, /关键词空位榜/);
assert.match(gaps.markdown, /数据源/);
console.log('  ok  radar_gaps runs');

const market = await tools[1].execute({});
assert.match(market.markdown, /插件市场概览/);
console.log('  ok  radar_market runs');

const lookup = await tools[2].execute({ query: 'trello' });
assert.match(lookup.markdown, /trello/i);
console.log('  ok  radar_plugin runs');

const check = await tools[3].execute({ dir: root });
assert.match(check.markdown, /发布前体检/);
assert.match(check.markdown, /PASS|WARN/);
console.log('  ok  radar_checkup runs against its own folder');

const mine = await tools[4].execute({ packages: [] });
assert.match(mine.markdown, /我的插件/);
console.log('  ok  radar_mine degrades cleanly with no network');

// A bad query must fail loudly rather than return an empty table.
await assert.rejects(() => tools[2].execute({ query: '   ' }), /non-empty/);
console.log('  ok  radar_plugin rejects an empty query');

// With a catalog file supplied there is no download, so the ONLY thing this plugin
// may leave on disk is the settings file the user explicitly saved.
assert.ok(existsSync(join(cacheDir, 'config.json')), 'the saved settings are on disk');
assert.deepEqual(readdirSync(cacheDir).sort(), ['config.json'], 'nothing else is written');
console.log('  ok  only the saved config is written; the catalog is never copied');

rmSync(cacheDir, { recursive: true, force: true });
rmSync(homeDir, { recursive: true, force: true });
console.log('\nhost wiring: all checks passed');
