#!/usr/bin/env node
/**
 * Render the dashboard to a standalone HTML file, using a catalog on disk.
 *
 * Useful before the plugin is installed, for sharing a screenshot, or as a CI
 * artifact. The page is the same document the host serves, so what you see here is
 * what the route returns — except that the search form points at `/radar`, which
 * only resolves once the plugin is mounted.
 *
 *   node scripts/preview.mjs --catalog ../market/plugins.json --out radar-preview.html
 */
import { writeFileSync } from 'node:fs';
import { catalogStats, loadCatalog } from '../lib/catalog.mjs';
import { TOPICS, gapIndex } from '../lib/topics.mjs';
import { growthDeltas, growthSeries } from '../lib/growth.mjs';
import { renderDashboard } from '../lib/dashboard.mjs';

const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const catalogPath = arg('--catalog', '');
const out = arg('--out', 'radar-preview.html');
const query = arg('--q', '');

const loaded = await loadCatalog({ catalogPath, fetchImpl: () => { throw new Error('offline preview'); } });
const entries = loaded.catalog.entries;
const stats = catalogStats(entries);
const gaps = gapIndex(entries);
const counts = { empty: 0, thin: 0, warming: 0, crowded: 0 };
for (const row of gaps) counts[row.level] += 1;

const growth = growthSeries(entries, { months: 12, topics: TOPICS });
const window = 6;
const series = growthSeries(entries, { months: window, topics: TOPICS });
const trend = {
  window,
  first: series.first,
  last: series.last,
  months: series.months.map((m) => ({ month: m.month, total: m.total })),
  deltas: growthDeltas(series),
  coverage: growth.coverage,
};

const overview = { stats, gaps, counts, fetchedAt: loaded.fetchedAt, from: loaded.from, bytes: loaded.bytes, growth };
const mine = { rows: [], detected: null };

writeFileSync(out, renderDashboard({ overview, mine, query: query || null, search: null, trend }), 'utf8');
console.log(`wrote ${out}: ${stats.total} plugins, ${counts.empty} empty topics, ${trend.deltas.length} rising topics over ${window}mo`);
