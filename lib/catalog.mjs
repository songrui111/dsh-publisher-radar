/**
 * Catalog access: one ~8 MB JSON document, cached on disk, with several mirrors.
 *
 * Design rules the rest of the plugin depends on:
 *
 *   1. Nothing is fetched at load. A DSH start must not wait on the network, so the
 *      first tool call or page view pays for the download; every later call reads the
 *      cache.
 *   2. A stale cache beats no cache, and a mirror beats an error. The canonical host
 *      is GitHub Pages, which is routinely unreachable from mainland China, so the
 *      same document is also published as the npm package `dsh-plugin-catalog` —
 *      reachable through unpkg, jsDelivr, and the two npm registries. Users never run
 *      a script to make this work.
 *   3. A truncated or non-JSON download is rejected, never half-counted.
 */
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json';
const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** The same catalog, published as a package so a CDN/mirror can carry it. */
const CATALOG_PACKAGE = 'dsh-plugin-catalog';

/** Where snapshots live. `DSH_HOME` first, same as the host. */
export function defaultCacheDir(env = process.env) {
  const home = env.DSH_HOME && env.DSH_HOME.trim() !== '' ? env.DSH_HOME : join(homedir(), '.dsh');
  return join(home, 'publisher-radar');
}

function descOf(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return [value.zh, value['zh-CN'], value.en].filter((x) => typeof x === 'string' && x !== '').join(' ');
  }
  return '';
}

/** Reduce one raw catalog record to the fields this plugin reports on. */
function normalizeEntry(raw) {
  const category = Array.isArray(raw?.category)
    ? raw.category.filter((c) => typeof c === 'string')
    : typeof raw?.category === 'string' ? [raw.category] : [];
  return {
    name: typeof raw?.name === 'string' ? raw.name : '',
    owner: typeof raw?.owner === 'string' ? raw.owner : '',
    url: typeof raw?.url === 'string' ? raw.url : '',
    page: typeof raw?.page === 'string' ? raw.page : '',
    category,
    description: descOf(raw?.description),
    npm: typeof raw?.npm === 'string' ? raw.npm : null,
    version: typeof raw?.version === 'string' ? raw.version : null,
    stars: typeof raw?.stars === 'number' ? raw.stars : null,
    downloads: typeof raw?.downloads === 'number' ? raw.downloads : null,
    install: typeof raw?.install === 'string' ? raw.install : '',
    added: typeof raw?.added === 'string' ? raw.added : null,
    capabilities: Array.isArray(raw?.capabilities) ? raw.capabilities.filter((c) => typeof c === 'string') : [],
  };
}

/** Validate and normalize a parsed catalog document. Throws on a bad shape. */
export function parseCatalog(value) {
  const plugins = value?.plugins;
  if (!Array.isArray(plugins) || plugins.length === 0) {
    throw new Error('not a catalog: `plugins` is missing or empty');
  }
  const entries = plugins.map(normalizeEntry).filter((e) => e.name !== '');
  if (entries.length === 0) throw new Error('not a catalog: no usable entries');
  return { entries, source: typeof value?.source === 'string' ? value.source : null, updated: typeof value?.updated === 'string' ? value.updated : null };
}

async function getText(url, fetchImpl, timeoutMs) {
  const res = await fetchImpl(url, {
    headers: { accept: 'application/json', 'user-agent': 'dsh-publisher-radar' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith('<')) throw new Error(`${url} → not JSON (got HTML)`);
  return text;
}

/**
 * Pull one file out of a gzipped npm tarball.
 *
 * npm tarballs are ustar; this reads the header fields it needs (name, size,
 * typeflag) and skips the padding. No dependency, no full extraction, no disk.
 */
export function tarEntry(gzipped, wanted) {
  const buffer = gunzipSync(gzipped);
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const name = buffer.toString('utf8', offset, offset + 100).replace(/\0.*$/s, '').trim();
    const sizeField = buffer.toString('utf8', offset + 124, offset + 136).replace(/\0.*$/s, '').trim();
    const type = buffer.toString('utf8', offset + 156, offset + 157);
    if (name === '') break; // end-of-archive block
    const size = Number.parseInt(sizeField, 8);
    if (!Number.isFinite(size)) break;
    const dataStart = offset + 512;
    if ((type === '0' || type === '\0' || type === '') && (name === wanted || name === `./${wanted}`)) {
      return buffer.subarray(dataStart, dataStart + size).toString('utf8');
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`tarball has no ${wanted}`);
}

/** `https://registry/<pkg>/latest` → the tarball URL. */
async function latestTarball(registry, fetchImpl, timeoutMs = 15_000) {
  const text = await getText(`${registry}/${CATALOG_PACKAGE}/latest`, fetchImpl, timeoutMs);
  const meta = JSON.parse(text);
  const tarball = meta?.dist?.tarball;
  if (typeof tarball !== 'string') throw new Error(`${registry} → no dist.tarball`);
  return tarball;
}

/**
 * Every route to the same document.
 *
 * Three are raced first — the canonical host, a CDN, and the npm China mirror —
 * because which one answers fastest depends entirely on the network the user is on:
 * the origin wins on a good link, the mirror wins behind the GFW. Racing them means
 * the common case is "fastest of three" rather than "wait out the slowest".
 *
 * A second group covers the rest before giving up.
 */
async function fetchCatalog(fetchImpl, log) {
  const attempts = [];

  const tarballSource = (registry) => ({
    label: `tarball:${new URL(registry).host}`,
    run: async () => {
      const tarball = await latestTarball(registry, fetchImpl);
      const res = await fetchImpl(tarball, {
        headers: { accept: 'application/octet-stream', 'user-agent': 'dsh-publisher-radar' },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`tarball → HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      return tarEntry(bytes, 'package/plugins.json');
    },
  });

  const urlSource = (label, url, timeoutMs) => ({
    label,
    run: () => getText(url, fetchImpl, timeoutMs),
  });

  const race = async (sources) => {
    const errors = [];
    const results = await Promise.all(sources.map(async (source) => {
      try {
        return { text: await source.run(), source };
      } catch (error) {
        errors.push(`${source.label}: ${error?.message ?? error}`);
        return null;
      }
    }));
    const won = results.find((r) => r !== null);
    if (won) return won;
    throw new Error(errors.join(' | '));
  };

  const groups = [
    [
      urlSource('origin', CATALOG_URL, 7000),
      urlSource('unpkg', `https://unpkg.com/${CATALOG_PACKAGE}/plugins.json`, 25_000),
      tarballSource('https://registry.npmmirror.com'),
    ],
    [
      urlSource('jsdelivr', `https://cdn.jsdelivr.net/npm/${CATALOG_PACKAGE}/plugins.json`, 25_000),
      tarballSource('https://registry.npmjs.org'),
    ],
  ];

  for (const group of groups) {
    try {
      return await race(group);
    } catch (error) {
      attempts.push(error?.message ?? String(error));
    }
  }

  log?.(`publisher-radar: every catalog source failed (${attempts.join(' | ')})`);
  throw new Error(`all catalog sources failed: ${attempts.join(' | ')}`);
}

/**
 * Load the catalog: explicit file → fresh cache → network mirrors → stale cache.
 *
 * @param options.catalogPath  Read this file and skip the network entirely.
 * @param options.cacheDir     Where snapshots are written. Defaults to DSH_HOME.
 * @param options.maxAgeMs     Age at which a cache is no longer "fresh".
 * @param options.fetchImpl    Injectable for tests.
 * @param options.force        Ignore the fresh cache and refetch.
 */
export async function loadCatalog(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const cacheFile = join(cacheDir, 'catalog.json');
  const metaFile = join(cacheDir, 'catalog.meta.json');
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  if (typeof options.catalogPath === 'string' && options.catalogPath !== '') {
    const text = readFileSync(options.catalogPath, 'utf8');
    return {
      catalog: parseCatalog(JSON.parse(text)),
      fetchedAt: statSync(options.catalogPath).mtime.toISOString(),
      bytes: Buffer.byteLength(text, 'utf8'),
      from: 'file',
      sourceUrl: options.catalogPath,
    };
  }

  const meta = readMeta(metaFile);
  if (!options.force && existsSync(cacheFile) && meta.fetchedAt) {
    const age = Date.now() - Date.parse(meta.fetchedAt);
    if (Number.isFinite(age) && age >= 0 && age < maxAgeMs) {
      try {
        const text = readFileSync(cacheFile, 'utf8');
        return {
          catalog: parseCatalog(JSON.parse(text)),
          fetchedAt: meta.fetchedAt,
          bytes: meta.bytes ?? Buffer.byteLength(text, 'utf8'),
          from: 'cache',
          sourceUrl: meta.sourceUrl ?? null,
        };
      } catch { /* fall through to the network */ }
    }
  }

  if (typeof fetchImpl === 'function') {
    try {
      const { text, source } = await fetchCatalog(fetchImpl, options.log);
      const catalog = parseCatalog(JSON.parse(text));
      const fetchedAt = new Date().toISOString();
      const bytes = Buffer.byteLength(text, 'utf8');
      try {
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(cacheFile, text, 'utf8');
        writeFileSync(metaFile, JSON.stringify({ fetchedAt, bytes, entries: catalog.entries.length, sourceUrl: source.label }, null, 2), 'utf8');
      } catch (error) {
        options.log?.(`publisher-radar: could not write the cache: ${error?.message ?? error}`);
      }
      return { catalog, fetchedAt, bytes, from: 'network', sourceUrl: source.label };
    } catch (error) {
      if (existsSync(cacheFile) && meta.fetchedAt) {
        try {
          const text = readFileSync(cacheFile, 'utf8');
          return {
            catalog: parseCatalog(JSON.parse(text)),
            fetchedAt: meta.fetchedAt,
            bytes: meta.bytes ?? Buffer.byteLength(text, 'utf8'),
            from: 'stale-cache',
            sourceUrl: meta.sourceUrl ?? null,
          };
        } catch { /* fall through */ }
      }
      throw new Error(
        `publisher-radar: could not reach any catalog mirror and no snapshot is cached (${error?.message ?? error})`,
      );
    }
  }

  throw new Error('publisher-radar: no fetch implementation and no cached catalog');
}

function readMeta(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Aggregate facts a publisher cares about. */
export function catalogStats(entries) {
  const categories = new Map();
  const months = new Map();
  for (const entry of entries) {
    for (const category of entry.category) categories.set(category, (categories.get(category) ?? 0) + 1);
    if (entry.added) {
      const month = entry.added.slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month)) months.set(month, (months.get(month) ?? 0) + 1);
    }
  }
  const byDownloads = [...entries].filter((e) => typeof e.downloads === 'number' && e.downloads > 0)
    .sort((a, b) => b.downloads - a.downloads);
  const byStars = [...entries].filter((e) => typeof e.stars === 'number' && e.stars > 0)
    .sort((a, b) => b.stars - a.stars);
  return {
    total: entries.length,
    categories: [...categories.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    months: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
    topDownloads: byDownloads.slice(0, 10),
    topStars: byStars.slice(0, 10),
    withNpm: entries.filter((e) => e.npm !== null).length,
    newest: [...entries].filter((e) => e.added).sort((a, b) => String(b.added).localeCompare(String(a.added))).slice(0, 10),
  };
}

/** Entries whose name, owner or description contains the query. */
export function searchEntries(entries, query, limit = 20) {
  const q = String(query ?? '').trim().toLowerCase();
  if (q === '') return [];
  const scored = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const owner = entry.owner.toLowerCase();
    const desc = entry.description.toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 60;
    else if (name.includes(q)) score = 40;
    if (owner.includes(q)) score = Math.max(score, 30);
    if (desc.includes(q)) score = Math.max(score, 20);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.entry.downloads ?? 0) - (a.entry.downloads ?? 0));
  return scored.slice(0, limit).map((s) => s.entry);
}
