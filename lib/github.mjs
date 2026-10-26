/**
 * Live GitHub facts, with the catalog snapshot as the fallback.
 *
 * The catalog carries a `stars` number, but it is a number from whenever the
 * catalog was built — a plugin's real trajectory can be weeks ahead of it. This
 * module asks GitHub directly for the repositories the publisher actually cares
 * about (their own), caches answers for six hours, and degrades to the catalog
 * value whenever the API refuses (rate limit, no token, offline).
 *
 * A token is optional: unauthenticated GitHub allows 60 requests an hour, which is
 * plenty for a handful of repositories. `GITHUB_TOKEN` raises it when present.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CACHE_FILE = 'github-cache.json';
export const CACHE_MS = 6 * 60 * 60 * 1000;

/** `https://github.com/owner/repo` → `owner/repo`, or null. */
export function repoOf(url) {
  if (typeof url !== 'string') return null;
  const match = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?]|$)/.exec(url);
  if (match === null) return null;
  return `${match[1]}/${match[2]}`;
}

function readCache(cacheDir) {
  try {
    const parsed = JSON.parse(readFileSync(join(cacheDir, CACHE_FILE), 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cacheDir, cache) {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, CACHE_FILE), JSON.stringify(cache, null, 2), 'utf8');
  } catch { /* optional */ }
}

/**
 * Stars and activity for a set of repositories.
 *
 * @param repos     `owner/repo` strings.
 * @param options.cacheDir, options.fetchImpl, options.token, options.maxAgeMs
 * @returns `{ repo → { stars, pushedAt, openIssues, fetchedAt, from, error? } }`
 */
export async function githubFacts(repos, options = {}) {
  const cacheDir = options.cacheDir ?? '';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = options.token ?? process.env.GITHUB_TOKEN ?? '';
  const maxAgeMs = options.maxAgeMs ?? CACHE_MS;
  const cache = cacheDir === '' ? {} : readCache(cacheDir);
  const now = Date.now();
  const result = {};
  const queue = [...new Set(repos.filter(Boolean))];

  const worker = async () => {
    for (;;) {
      const repo = queue.shift();
      if (repo === undefined) return;
      const cached = cache[repo];
      if (cached && Number.isFinite(cached.at) && now - cached.at < maxAgeMs) {
        result[repo] = { ...cached.value, fetchedAt: new Date(cached.at).toISOString(), from: 'cache' };
        continue;
      }
      try {
        const res = await fetchImpl(`https://api.github.com/repos/${repo}`, {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'dsh-publisher-radar',
            ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 404) {
          result[repo] = { error: 'not-found', stars: null, from: 'live' };
          continue;
        }
        if (!res.ok) throw new Error(`GitHub ${res.status}`);
        const body = await res.json();
        const value = {
          stars: typeof body.stargazers_count === 'number' ? body.stargazers_count : null,
          pushedAt: typeof body.pushed_at === 'string' ? body.pushed_at : null,
          openIssues: typeof body.open_issues_count === 'number' ? body.open_issues_count : null,
        };
        cache[repo] = { at: now, value };
        result[repo] = { ...value, fetchedAt: new Date(now).toISOString(), from: 'live' };
      } catch (error) {
        // Never fail the caller over a star count: fall back to whatever we have.
        if (cached?.value) {
          result[repo] = { ...cached.value, fetchedAt: new Date(cached.at).toISOString(), from: 'stale', error: error?.message ?? String(error) };
        } else {
          result[repo] = { stars: null, from: 'unavailable', error: error?.message ?? String(error) };
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(3, Math.max(1, queue.length)) }, worker));
  // Only persist when this run actually learned something. An offline lookup that
  // cached nothing must not create an empty file on the user's disk.
  if (cacheDir !== '' && Object.keys(cache).length > 0) writeCache(cacheDir, cache);
  return result;
}
