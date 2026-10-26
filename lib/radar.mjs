/**
 * The service the tools and the dashboard share: one lazily-loaded catalog, one
 * measurement of it, and the readings a publisher needs from it.
 *
 * Two rules:
 *   - The catalog and the measurement are memoized, so several tool calls in a
 *     session pay for one download and one pass over the entries.
 *   - Nothing is written. The trend is derived from the catalog's own `added` dates,
 *     so a fresh install has a twelve-month curve immediately — no local history to
 *     accumulate, no file under `$DSH_HOME` to back up or clean.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { catalogStats, defaultCacheDir, loadCatalog, searchEntries } from './catalog.mjs';
import { TOPICS, findTopics, gapIndex, levelOf } from './topics.mjs';
import { growthDeltas, growthSeries } from './growth.mjs';
import { githubFacts, repoOf } from './github.mjs';
import { npmFacts, normalizeRepository } from './npm.mjs';
import { checkup } from './checkup.mjs';

/** A plugin folder that declares itself a DSH bundle, or null. */
function detectOwnPackage(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (typeof pkg?.name !== 'string' || pkg.name === '') return null;
    if (pkg?.dsh?.bundle === undefined) return null;
    return { name: pkg.name, version: typeof pkg.version === 'string' ? pkg.version : null };
  } catch {
    return null;
  }
}

export function createRadar({ settings = {}, log = () => {}, cwd = process.cwd() } = {}) {
  const cacheDir = settings.cacheDir ?? defaultCacheDir();
  let loaded = null;
  let measured = null;

  async function catalog(force = false) {
    if (loaded !== null && !force) return loaded;
    loaded = await loadCatalog({
      catalogPath: settings.catalogPath,
      cacheDir,
      maxAgeMs: typeof settings.cacheMinutes === 'number' && settings.cacheMinutes > 0
        ? settings.cacheMinutes * 60_000
        : undefined,
      // A user pressing Refresh is asking for a new download, not for the memo again.
      force,
      log,
    });
    return loaded;
  }

  /**
   * A package that is installed locally but not published to npm.
   *
   * A plugin under development is a `file:` dependency in the profile, so npm has
   * never heard of it — which used to make its "my plugins" row a dead end showing
   * "未发布". The manifest DSH actually loads is right there in the profile; read it.
   */
  function localPackageInfo(name) {
    const home = settings.dshHome ?? (process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
      ? process.env.DSH_HOME
      : join(homedir(), '.dsh'));
    const files = [join(settings.pluginDir ?? cwd, 'package.json')];
    try {
      for (const entry of readdirSync(join(home, 'profiles'), { withFileTypes: true })) {
        if (entry.isDirectory()) files.push(join(home, 'profiles', entry.name, 'node_modules', ...name.split('/'), 'package.json'));
      }
    } catch { /* no profiles yet */ }
    for (const file of files) {
      if (!existsSync(file)) continue;
      try {
        const pkg = JSON.parse(readFileSync(file, 'utf8'));
        if (pkg?.name !== name) continue;
        return {
          name,
          version: typeof pkg.version === 'string' ? pkg.version : null,
          repository: normalizeRepository(pkg.repository),
        };
      } catch { /* a broken manifest is skipped, not fatal */ }
    }
    return null;
  }

  /**
   * Re-download and re-measure, ignoring both the disk cache and the in-memory copy.
   *
   * This is what the panel's Refresh button means. Passive loads (opening the panel,
   * calling a tool) still respect the six-hour TTL — pulling 8.7 MB on every paint
   * would be the wrong default.
   */
  async function refresh() {
    measured = null;
    loaded = null;
    const fresh = await catalog(true);
    return fresh;
  }

  /** Stats, gap rows and the growth series, computed once per mount. */
  async function measure() {
    if (measured !== null) return measured;
    const load = await catalog();
    const entries = load.catalog.entries;
    const stats = catalogStats(entries);
    const gaps = gapIndex(entries);
    const counts = { empty: 0, thin: 0, warming: 0, crowded: 0 };
    for (const row of gaps) counts[row.level] += 1;
    const growth = growthSeries(entries, { months: 12, topics: TOPICS });
    measured = { load, stats, gaps, counts, growth };
    return measured;
  }

  /** Keyword-gap ranking, emptiest first. */
  async function gaps({ level, limit = 20 } = {}) {
    const { load, gaps: rows, counts } = await measure();
    let filtered = rows;
    if (typeof level === 'string' && ['empty', 'thin', 'warming', 'crowded'].includes(level)) {
      filtered = rows.filter((row) => row.level === level);
    }
    return {
      rows: filtered.slice(0, Math.max(1, Math.min(limit, 100))),
      counts,
      fetchedAt: load.fetchedAt,
      from: load.from,
      total: load.catalog.entries.length,
    };
  }

  /** Catalog-level facts plus the twelve-month curve. */
  async function overview() {
    const { load, stats, gaps: rows, counts, growth } = await measure();
    return {
      stats,
      counts,
      fetchedAt: load.fetchedAt,
      from: load.from,
      sourceUrl: load.sourceUrl ?? null,
      bytes: load.bytes,
      gaps: rows,
      growth,
    };
  }

  /**
   * One topic's plugins, for browsing inside the panel.
   *
   * The panel must not need a web page to drill from "this corner is empty" to "who
   * exactly is in it", so this returns the full records (description, install line,
   * stars, downloads) rather than names.
   */
  async function topicDetail(id, limit = 20) {
    const { load } = await measure();
    const topic = TOPICS.find((t) => t.id === id);
    if (topic === undefined) return null;
    const hits = load.catalog.entries.filter((entry) => topic.re.test(`${entry.name} ${entry.description}`));
    hits.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0) || (b.stars ?? 0) - (a.stars ?? 0));
    return {
      topic: { id: topic.id, label: topic.label, count: hits.length, level: levelOf(hits.length) },
      entries: hits.slice(0, Math.max(1, Math.min(limit, 50))),
      total: hits.length,    };
  }

  /**
   * The three-level drill the panel exposes: a market category, the topics inside it,
   * then the plugins in that intersection.
   *
   * The marketplace's own `category` and this plugin's topics are independent axes, so
   * "small classes" here means "topics that actually have plugins inside this
   * category" — an empty topic inside `ui` is not a finding, it is noise.
   *
   * @returns `{ kind: 'topics', category, topics }` or `{ kind: 'plugins', ... }`
   */
  async function browseCategory(name, topicId, limit = 30) {
    const { load } = await measure();
    const entries = load.catalog.entries.filter((entry) => entry.category.includes(name));
    const countOf = (topic) => entries.filter((entry) => topic.re.test(`${entry.name} ${entry.description}`)).length;

    if (typeof topicId === 'string' && topicId !== '') {
      const topic = TOPICS.find((t) => t.id === topicId);
      if (topic === undefined) return null;
      const hits = entries.filter((entry) => topic.re.test(`${entry.name} ${entry.description}`));
      hits.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0) || (b.stars ?? 0) - (a.stars ?? 0));
      return {
        kind: 'plugins',
        category: { name, count: entries.length },
        topic: { id: topic.id, label: topic.label, count: hits.length, level: levelOf(hits.length) },
        entries: hits.slice(0, Math.max(1, Math.min(limit, 60))),
        total: hits.length,
      };
    }

    const topics = TOPICS
      .map((topic) => ({ id: topic.id, label: topic.label, count: countOf(topic) }))
      .filter((topic) => topic.count > 0)
      .map((topic) => ({ ...topic, level: levelOf(topic.count) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'));
    return { kind: 'topics', category: { name, count: entries.length }, topics, total: entries.length };
  }

  /**
   * The whole catalog, paged.
   *
   * 6,896 records cannot be one payload — with descriptions that is several megabytes
   * per panel refresh — so this is the only path that touches every plugin: filter,
   * sort, then slice. The total is always the filtered total, so the pager says "1 of
   * 230" rather than "1 of 230" of an unfiltered set it is not showing.
   *
   * @param options.query    Substring over name, owner and description.
   * @param options.category Market category (one of the 23).
   * @param options.topic    A topic id from the taxonomy.
   * @param options.sort     `downloads` | `stars` | `added` | `name`.
   * @param options.dir      `asc` | `desc`.
   */
  async function browse(options = {}) {
    const { load } = await measure();
    const query = String(options.query ?? '').trim().toLowerCase();
    const category = String(options.category ?? '').trim();
    const topicId = String(options.topic ?? '').trim();
    const sort = ['downloads', 'stars', 'added', 'name'].includes(options.sort) ? options.sort : 'downloads';
    const dir = options.dir === 'asc' ? 'asc' : 'desc';
    const pageSize = Math.max(10, Math.min(Number(options.pageSize) || 30, 100));

    let rows = load.catalog.entries;
    if (category !== '') rows = rows.filter((entry) => entry.category.includes(category));
    if (topicId !== '') {
      const topic = TOPICS.find((t) => t.id === topicId);
      if (topic === undefined) return null;
      rows = rows.filter((entry) => topic.re.test(`${entry.name} ${entry.description}`));
    }
    if (query !== '') {
      rows = rows.filter((entry) => `${entry.name} ${entry.owner} ${entry.description}`.toLowerCase().includes(query));
    }

    const keyed = (entry) => sort === 'stars' ? (entry.stars ?? -1)
      : sort === 'added' ? (entry.added ?? '')
        : sort === 'name' ? entry.name.toLowerCase()
          : (entry.downloads ?? -1);
    const sorted = rows.slice().sort((a, b) => {
      const ka = keyed(a); const kb = keyed(b);
      const cmp = typeof ka === 'string' ? ka.localeCompare(kb) : ka - kb;
      const stable = cmp !== 0 ? cmp : String(a.name).localeCompare(String(b.name));
      return dir === 'asc' ? stable : -stable;
    });

    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.max(1, Math.min(Number(options.page) || 1, pages));
    const start = (page - 1) * pageSize;
    return {
      entries: sorted.slice(start, start + pageSize),
      total,
      page,
      pages,
      pageSize,
      sort,
      dir,
      filters: { query: String(options.query ?? ''), category, topic: topicId },
    };
  }

  /** How each topic filled up over the last N months, from `added` dates. */
  async function trend(months = 6) {
    const { load } = await measure();
    const window = Math.max(2, Math.min(Math.round(months), 24));
    const series = growthSeries(load.catalog.entries, { months: window, topics: TOPICS });
    return {
      months: series.months.map((m) => ({ month: m.month, total: m.total })),
      window,
      first: series.first,
      last: series.last,
      coverage: series.coverage,
      total: load.catalog.entries.length,
      deltas: growthDeltas(series),
      labels: Object.fromEntries(TOPICS.map((t) => [t.id, t.label])),
      fetchedAt: load.fetchedAt,
      from: load.from,
    };
  }

  /** Who already does this? Free-text over names, owners and descriptions. */
  async function search(query, limit = 20) {
    const { load, gaps: rows } = await measure();
    const entries = searchEntries(load.catalog.entries, query, limit);
    const topics = findTopics(query).map((topic) => {
      const row = rows.find((r) => r.id === topic.id);
      return { id: topic.id, label: topic.label, count: row?.count ?? 0, level: levelOf(row?.count ?? 0), samples: row?.samples ?? [] };
    });
    return { query, entries, topics, fetchedAt: load.fetchedAt, from: load.from };
  }

  /** Packages to track: explicit → configured → this folder's own plugin. */
  function resolvePackages(packages) {
    const explicit = Array.isArray(packages) ? packages.filter((p) => typeof p === 'string' && p.trim() !== '') : [];
    if (explicit.length > 0) return explicit;
    if (Array.isArray(settings.myPlugins) && settings.myPlugins.length > 0) return settings.myPlugins;
    const own = detectOwnPackage(settings.pluginDir ?? cwd);
    return own === null ? [] : [own.name];
  }

  /** The publisher's own packages: downloads, version, catalog presence, rank, live stars. */
  async function mine(packages, options = {}) {
    const list = resolvePackages(packages);
    const { load } = await measure();
    const own = detectOwnPackage(settings.pluginDir ?? cwd);
    if (list.length === 0) {
      return { rows: [], fetchedAt: load.fetchedAt, from: load.from, total: load.catalog.entries.length, detected: null };
    }
    // npm 404 is not the end of the story: a plugin under development lives in the
    // profile as a `file:` dependency and has never been published. A failed npm
    // lookup is treated the same way — being offline must not lose a package whose
    // manifest is sitting on this disk.
    const facts = (await npmFacts(list, { fetchImpl: settings.fetchImpl })).map((fact) => {
      if (!fact.missing && fact.error === null) return fact;
      const local = localPackageInfo(fact.package);
      if (local === null) return fact;
      return { ...fact, missing: false, local: true, error: null, version: local.version, repository: local.repository };
    });

    const repos = [];
    const found = facts.map((fact) => {
      const entry = load.catalog.entries.find((e) => e.npm === fact.package || e.name === fact.package) ?? null;
      // Catalog first, then the repository npm itself publishes. Without the second
      // source, a package that is not (yet) in the catalog could never show live
      // stars — it has no entry to read a URL from.
      const repo = (entry === null ? null : repoOf(entry.url)) ?? repoOf(fact.repository);
      if (repo !== null) repos.push(repo);
      return { fact, entry, repo };
    });

    let live = {};
    if (repos.length > 0 && settings.github !== false) {
      try {
        live = await githubFacts(repos, {
          cacheDir,
          fetchImpl: settings.fetchImpl,
          token: settings.githubToken,
          // `forceGithub` is the Refresh button: a star that cannot be refreshed by
          // asking for it is indistinguishable from a broken one.
          maxAgeMs: options.forceGithub === true
            ? 0
            : (settings.githubCacheMinutes ? settings.githubCacheMinutes * 60_000 : undefined),
        });
      } catch (error) {
        log(`publisher-radar: GitHub lookup failed: ${error?.message ?? error}`);
      }
    }

    const rows = found.map(({ fact, entry, repo }) => {
      let rank = null;
      if (entry !== null && typeof fact.downloads === 'number' && entry.category.length > 0) {
        const peers = load.catalog.entries
          .filter((e) => typeof e.downloads === 'number' && e.downloads > 0 && e.category.some((cat) => entry.category.includes(cat)))
          .sort((a, b) => b.downloads - a.downloads);
        const position = peers.findIndex((e) => e.name === entry.name);
        if (position >= 0) rank = { position: position + 1, of: peers.length, category: entry.category[0] };
      }
      const gh = repo === null ? null : live[repo] ?? null;
      return {
        ...fact,
        inCatalog: entry !== null,
        entry,
        repo,
        rank,
        stars: gh?.stars ?? entry?.stars ?? null,
        starsFrom: gh?.stars != null ? gh.from : entry?.stars != null ? 'catalog' : null,
        pushedAt: gh?.pushedAt ?? null,
      };
    });

    return { rows, fetchedAt: load.fetchedAt, from: load.from, total: load.catalog.entries.length, detected: own };
  }

  return { catalog, measure, refresh, gaps, overview, trend, search, topicDetail, browseCategory, browse, mine, checkup, resolvePackages };
}
