/**
 * 插件雷达 (Publisher Radar) — host entry.
 *
 * Registers five read-only tools and exposes the JSON the sidebar panel renders
 * from. Nothing is fetched at load: the catalog is downloaded on the first tool call
 * or the first panel paint, so a DSH start never waits on GitHub Pages.
 */
import { createRadar } from './lib/radar.mjs';
import { createTools } from './lib/tools.mjs';
import { repoOf } from './lib/github.mjs';
import { defaultCacheDir } from './lib/catalog.mjs';
import { loadPrefs, savePrefs, statusOf } from './lib/prefs.mjs';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'publisher-radar';
export const inject = ['tools'];

const API_ROUTE = '/radar/api.json';
const CONFIG_ROUTE = '/radar/config';

export function apply(ctx, settings = {}) {
  // A broken plugin must never take the profile's composition down with it. Every
  // failure here degrades to "the panel and tools are missing", never to "DSH will
  // not start".
  try {
    mount(ctx, settings);
  } catch (error) {
    console.warn('publisher-radar: mount failed; the plugin stays dormant', error);
  }
}

function mount(ctx, settings) {
  const cacheDir = settings.cacheDir ?? defaultCacheDir();
  const prefs = loadPrefs(cacheDir);
  // The profile patch wins where it sets something; the panel's own config fills the
  // rest. `settings` is mutated in place on save, so a running radar sees it too.
  const merged = {
    ...settings,
    myPlugins: Array.isArray(settings.myPlugins) && settings.myPlugins.length > 0 ? settings.myPlugins : prefs.myPlugins,
    githubToken: (typeof settings.githubToken === 'string' && settings.githubToken !== '') ? settings.githubToken : prefs.githubToken,
  };
  const radar = createRadar({ settings: merged, log: (message) => console.warn(message) });
  const tools = createTools(radar, merged);
  const profile = detectProfile(ctx, settings);
  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register(tool), `publisher-radar: ${tool.name} tool`);
  }

  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (inner) => {
        const webServer = inner?.webServer;
        if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') return;

        const publish = (path, handler, label) => {
          const disposer = webServer.register({ kind: 'exact', path, handler });
          if (typeof inner.effect === 'function') inner.effect(() => disposer, label);
        };

        publish(API_ROUTE, async (request, response) => {
          if (!allowGet(request, response)) return;
          if (!hostAllowed(request, settings)) return forbid(response);
          try {
            const url = new URL(request.url ?? API_ROUTE, 'http://127.0.0.1');
            // `force` is the Refresh button: bypass the disk cache, the memo, and the
            // GitHub star cache.
            const force = (url.searchParams.get('force') ?? '') !== '';
            if (force) await radar.refresh();
            const overview = await radar.overview();
            const query = (url.searchParams.get('q') ?? '').trim();
            const topicId = (url.searchParams.get('topic') ?? '').trim();
            const catName = (url.searchParams.get('cat') ?? '').trim();
            const browseMode = (url.searchParams.get('browse') ?? '') !== '';
            const [mine, search, topic, category, browse] = await Promise.all([
              radar.mine(undefined, { forceGithub: force }),
              browseMode || query === '' ? Promise.resolve(null) : radar.search(query, 12),
              // `cat` narrows `topic`: with both, the answer is the plugins in that
              // intersection; with only `cat`, it is the topics that category covers.
              browseMode || catName !== '' ? Promise.resolve(null) : (topicId === '' ? Promise.resolve(null) : radar.topicDetail(topicId, 20)),
              browseMode || catName === '' ? Promise.resolve(null) : radar.browseCategory(catName, topicId, 30),
              browseMode
                ? radar.browse({
                  query,
                  category: catName,
                  topic: topicId,
                  sort: url.searchParams.get('sort') ?? 'downloads',
                  dir: url.searchParams.get('dir') ?? 'desc',
                  page: url.searchParams.get('page') ?? 1,
                  pageSize: url.searchParams.get('pageSize') ?? 30,
                })
                : Promise.resolve(null),
            ]);
            // Every entry block goes through the same shaping step (description cap,
            // install command for this profile), so it lives here once.
            const views = (list) => list.map((entry) => entryView(entry, profile));
            send(response, 200, 'application/json; charset=utf-8', JSON.stringify({
              schema: 'dsh-publisher-radar/v1',
              profile,
              fetchedAt: overview.fetchedAt,
              from: overview.from,
              sourceUrl: overview.sourceUrl,
              total: overview.stats.total,
              counts: overview.counts,
              categories: overview.stats.categories,
              gaps: overview.gaps,
              browse: browse === null ? null : {
                ...browse,
                entries: views(browse.entries),
              },
              search: search === null ? null : {
                query,
                entries: views(search.entries),
                topics: search.topics,
              },
              topic: topic === null ? null : {
                id: topic.topic.id,
                label: topic.topic.label,
                count: topic.topic.count,
                level: topic.topic.level,
                total: topic.total,
                entries: views(topic.entries),
              },
              category: category === null ? null : (category.kind === 'topics'
                ? {
                  name: category.category.name,
                  count: category.category.count,
                  topics: category.topics,
                }
                : {
                  name: category.category.name,
                  count: category.category.count,
                  topic: category.topic,
                  total: category.total,
                  entries: views(category.entries),
                }),
              mine: mine.rows.map((row) => ({
                package: row.package,
                version: row.version,
                downloads: row.downloads,
                period: row.period,
                missing: row.missing === true,
                local: row.local === true,
                error: row.error ?? null,
                inCatalog: row.inCatalog,
                name: row.entry?.name ?? null,
                repo: row.repo ?? null,
                stars: row.stars,
                starsFrom: row.starsFrom,
                pushedAt: row.pushedAt,
                rank: row.rank,
              })),
              detected: mine.detected,
              config: statusOf({ myPlugins: merged.myPlugins ?? [], githubToken: merged.githubToken ?? '' }),
            }, null, 2));
          } catch (error) {
            send(response, 503, 'application/json; charset=utf-8', JSON.stringify({ schema: 'dsh-publisher-radar/v1', error: error?.message ?? String(error) }));
          }
        }, 'publisher-radar: api route');

        // Saving the panel's own settings. `githubToken` is tri-state: omitted keeps
        // the stored one, '' clears it, a string replaces it. It is never returned.
        publish(CONFIG_ROUTE, async (request, response) => {
          if (!hostAllowed(request, settings)) return forbid(response);
          if (request?.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' });
            response.end();
            return;
          }
          try {
            const body = await readJsonBody(request);
            const patch = {};
            if (Array.isArray(body?.myPlugins)) patch.myPlugins = body.myPlugins;
            if (typeof body?.githubToken === 'string') patch.githubToken = body.githubToken;
            const result = savePrefs(cacheDir, patch);
            if (result.ok) {
              if (patch.myPlugins !== undefined) merged.myPlugins = result.myPlugins;
              if (patch.githubToken !== undefined) merged.githubToken = patch.githubToken.trim();
            }
            send(response, result.ok ? 200 : 500, 'application/json; charset=utf-8',
              JSON.stringify({ ok: result.ok, myPlugins: result.myPlugins, hasToken: result.hasToken }));
          } catch (error) {
            send(response, 400, 'application/json; charset=utf-8', JSON.stringify({ ok: false, error: error?.message ?? String(error) }));
          }
        }, 'publisher-radar: config route');
      });
    }
  } catch (error) {
    console.warn('publisher-radar: could not publish the panel routes', error);
  }
}

function allowGet(request, response) {
  if (request?.method === 'GET' || request?.method === 'HEAD') return true;
  response.writeHead(405, { allow: 'GET, HEAD' });
  response.end();
  return false;
}

/**
 * A browser trust fence.
 *
 * A plugin route sits outside the host's own auth gate, so without this check the
 * panel's API would be readable by anything that can reach the port. The payload
 * carries only public catalog data, but "public data behind the same door as
 * everything else" is the host's decision, not ours — so the default is loopback
 * only, and a profile that is deliberately exposed can opt in.
 */
function hostAllowed(request, settings) {
  if (settings?.allowRemote === true) return true;
  const raw = String(request?.headers?.host ?? '').toLowerCase();
  const name = raw.replace(/:\d+$/, '').replace(/^\[/, '').replace(/\]$/, '');
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

function forbid(response) {
  response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  response.end('publisher-radar: this panel is served to the local host only (set config.allowRemote to expose it).');
}

/** A JSON request body, capped. An oversized or malformed body is a 400, not a crash. */
function readJsonBody(request, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        request.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') { resolve({}); return; }
      try { resolve(JSON.parse(text)); } catch { reject(new Error('body is not JSON')); }
    });
    request.on('error', reject);
  });
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    'content-type': contentType,
    // The catalog moves; a cached page would report yesterday's market.
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body, 'utf8'),
  });
  response.end(body);
}

/**
 * One catalog record, shaped for the panel's detail view.
 *
 * The description is the only field that can be huge, so it is the only one capped —
 * everything a publisher decides on (stars, downloads, category, install line, npm
 * name, age) travels whole.
 */
function entryView(entry, profile = null) {
  const description = typeof entry.description === 'string' ? entry.description : '';
  return {
    name: entry.name,
    owner: entry.owner,
    categories: entry.category,
    stars: entry.stars,
    downloads: entry.downloads,
    added: entry.added,
    npm: entry.npm,
    version: entry.version,
    install: entry.install,
    installCommand: installCommandFor(entry, profile),
    page: entry.page,
    capabilities: entry.capabilities,
    description: description.length > 420 ? `${description.slice(0, 420)}…` : description,
  };
}

/**
 * The command that installs one entry, with this profile filled in.
 *
 * A package manager is not something a read-only panel should run on the user's
 * behalf: the profile it must target is not knowable from the browser half, a failed
 * install leaves the next boot broken, and the market's own installer carries a
 * verification pipeline this plugin deliberately does not reproduce. So the panel
 * produces the exact command instead — copy, paste, restart — and says so.
 */
function installCommandFor(entry, profile) {
  const target = profile === null || profile === undefined || profile === ''
    ? '--profile <你的 profile>'
    : `--profile ${profile}`;
  const repo = repoOf(entry.url);
  const spec = typeof entry.npm === 'string' && entry.npm !== ''
    ? entry.npm
    : repo !== null ? `github:${repo}` : null;
  if (spec === null) return typeof entry.install === 'string' ? entry.install : '';
  return `dsh plugin ${target} add ${spec}`;
}

/**
 * Which profile this host is serving.
 *
 * Three independent sources, because none of them is reliably present: the loader
 * config, the launcher's argv, and the `profileContext` service the desktop app
 * publishes. `null` is an honest answer — the command then shows a placeholder
 * instead of guessing a profile name and writing into the wrong one.
 */
function detectProfile(ctx, settings) {
  if (typeof settings?.profile === 'string' && settings.profile.trim() !== '') return settings.profile.trim();
  const argv = Array.isArray(process.argv) ? process.argv : [];
  const index = argv.indexOf('--profile');
  if (index !== -1 && typeof argv[index + 1] === 'string' && !argv[index + 1].startsWith('-')) return argv[index + 1];
  try {
    const context = typeof ctx?.get === 'function' ? ctx.get('profileContext') : null;
    if (context !== null && context !== undefined && typeof context.name === 'string' && context.name !== '') return context.name;
  } catch { /* the service is optional */ }
  // Last resort: exactly one profile on disk means there is nothing to guess wrong.
  // Two or more and we keep the placeholder rather than install into the wrong one.
  try {
    const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh');
    const names = readdirSync(join(home, 'profiles'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    if (names.length === 1) return names[0];
  } catch { /* no home yet */ }
  return null;
}
