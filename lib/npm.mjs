/**
 * npm facts for the publisher's own packages: last-month downloads and the
 * published version.
 *
 * Both endpoints are public and keyless. A package that does not exist is not an
 * error — it is the answer "you have not published yet", which the report states
 * plainly instead of failing the whole run.
 */
const DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-month';
const REGISTRY = 'https://registry.npmjs.org';

async function getJson(url, fetchImpl, timeoutMs = 20_000) {
  const res = await fetchImpl(url, {
    headers: { 'accept': 'application/json', 'user-agent': 'dsh-publisher-radar' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * @param packages npm package names.
 * @returns One row per package; `missing` marks a name the registry does not know.
 */
export async function npmFacts(packages, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const names = [...new Set(packages.map((p) => String(p).trim()).filter(Boolean))];
  const rows = [];
  const queue = [...names];
  const worker = async () => {
    for (;;) {
      const name = queue.shift();
      if (name === undefined) return;
      const row = { package: name, downloads: null, period: null, version: null, missing: false, error: null, repository: null };

      // The REGISTRY decides whether a package exists. The downloads endpoint does
      // not: for a freshly published package it answers 404 with
      // {"error":"package … not found"} until download statistics exist, which used to
      // make a live package look unpublished.
      try {
        const latest = await getJson(`${REGISTRY}/${encodeURIComponent(name)}/latest`, fetchImpl);
        if (latest?.missing) {
          row.missing = true;
        } else {
          if (typeof latest?.version === 'string') row.version = latest.version;
          row.repository = normalizeRepository(latest?.repository);
        }
      } catch (error) {
        row.error = error?.message ?? String(error);
      }

      if (!row.missing) {
        try {
          const stats = await getJson(`${DOWNLOADS}/${encodeURIComponent(name)}`, fetchImpl);
          // A 404 here means "no download data yet", never "no package".
          if (!stats?.missing) {
            row.downloads = typeof stats?.downloads === 'number' ? stats.downloads : null;
            row.period = stats?.start && stats?.end ? `${stats.start}~${stats.end}` : null;
          }
        } catch { /* downloads are optional; the registry answer stands */ }
      }

      rows.push(row);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, Math.max(1, names.length)) }, worker));
  return rows;
}

/**
 * The repository URL npm publishes for a package, in either of its two shapes
 * (`"git+https://..."` or `{ type, url }`).
 *
 * This matters when the package is not in the market catalog: without it there is no
 * way to know which GitHub repo to ask for stars, and the "my plugins" row would show
 * a permanent dash.
 */
export function normalizeRepository(value) {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (value !== null && typeof value === 'object' && typeof value.url === 'string' && value.url.trim() !== '') {
    return value.url.trim();
  }
  return null;
}
