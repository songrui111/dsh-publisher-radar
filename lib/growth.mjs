/**
 * Growth series derived from the catalog's own `added` dates.
 *
 * The catalog records when each plugin was added, so the market's history is already
 * inside today's snapshot: "how many plugins covered topic X at the end of each
 * month" is a cumulative count over `added <= that month`. That means a brand-new
 * install can show a twelve-month trend immediately — no waiting, no local state,
 * no file to accumulate.
 *
 * What this cannot see: a plugin that was *removed* or renamed. A cumulative curve
 * therefore never goes down, and a flat segment means "nothing new", not "nothing
 * changed". The report says so.
 *
 * Months are bucketed in UTC and anchored to the last month present in the data, so
 * a stale snapshot still produces a coherent curve instead of trailing empty months.
 */

const MONTH_RE = /^(\d{4})-(\d{2})/;

/** `2026-10-25` → `2026-10`. Invalid or missing dates are ignored. */
export function monthOf(added) {
  if (typeof added !== 'string') return null;
  const match = MONTH_RE.exec(added);
  return match === null ? null : `${match[1]}-${match[2]}`;
}

/** Step a `YYYY-MM` label by whole months. */
export function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number);
  const index = year * 12 + (mon - 1) + delta;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** Whole months from `a` to `b` (positive when `b` is later). */
function monthDistance(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by * 12 + bm) - (ay * 12 + am);
}

/**
 * Build a monthly cumulative series.
 *
 * @param entries  Normalized catalog entries (needs `added`).
 * @param options.months  Window size, default 12.
 * @param options.topics  Topic rows from `gapIndex` — the per-topic curve is computed
 *                        for these ids, using the same matchers.
 * @param options.topicMatchers  `{ id: RegExp }` override (tests).
 * @returns `{ months: [{month,total,topics:{id:count}}], first, last, coverage }`
 */
export function growthSeries(entries, options = {}) {
  const windowSize = Math.max(2, Math.min(options.months ?? 12, 60));
  const dated = [];
  for (const entry of entries) {
    const month = monthOf(entry.added);
    if (month !== null) dated.push({ entry, month });
  }
  if (dated.length === 0) {
    return { months: [], first: null, last: null, coverage: 0, total: entries.length };
  }
  dated.sort((a, b) => a.month.localeCompare(b.month));
  const lastMonth = dated[dated.length - 1].month;
  const earliestMonth = dated[0].month;
  // Never start the window before the catalog has data: a leading run of empty
  // months would read as "0 → 6896", which is a property of the snapshot's coverage,
  // not of the market.
  const windowStart = shiftMonth(lastMonth, -(windowSize - 1));
  const firstMonth = windowStart < earliestMonth ? earliestMonth : windowStart;
  const span = monthDistance(firstMonth, lastMonth) + 1;

  const matchers = options.topicMatchers ?? null;
  const topics = Array.isArray(options.topics) ? options.topics : [];

  const months = [];
  for (let i = 0; i < span; i += 1) {
    months.push({ month: shiftMonth(firstMonth, i), total: 0, topics: {} });
  }
  const index = new Map(months.map((m) => [m.month, m]));

  // One pass over the dated entries, one bucket per entry: accumulate into every
  // month at or after the entry's own month (cumulative by construction).
  for (const { entry, month } of dated) {
    const hay = `${entry.name} ${entry.description ?? ''}`;
    for (const topic of topics) {
      const re = matchers?.[topic.id] ?? topic.re;
      if (re === undefined || !re.test(hay)) continue;
      for (let i = 0; i < months.length; i += 1) {
        if (months[i].month >= month) months[i].topics[topic.id] = (months[i].topics[topic.id] ?? 0) + 1;
      }
    }
    const start = index.has(month) ? month : firstMonth;
    for (let i = 0; i < months.length; i += 1) {
      if (months[i].month >= start) months[i].total += 1;
    }
  }

  return {
    months,
    first: months[0]?.month ?? null,
    last: lastMonth,
    coverage: dated.length,
    total: entries.length,
  };
}

/**
 * Per-topic deltas across the window: the last month minus the first.
 *
 * Only topics that actually moved are returned, biggest first, so the report answers
 * "what is filling up" rather than listing 75 numbers.
 */
export function growthDeltas(series) {
  if (series.months.length < 2) return [];
  const first = series.months[0];
  const last = series.months[series.months.length - 1];
  const rows = [];
  for (const [id, now] of Object.entries(last.topics)) {
    const before = first.topics[id] ?? 0;
    if (now !== before) rows.push({ id, before, now, delta: now - before });
  }
  rows.sort((a, b) => b.delta - a.delta || a.id.localeCompare(b.id));
  return rows;
}
