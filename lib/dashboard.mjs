/**
 * The dashboard: one self-contained HTML document, rendered on the host.
 *
 * It is both the sidebar panel's content source and the full-page view. The panel
 * fetches `/radar/api.json` and renders its own compact version; this page is the
 * wide view, and it works with a plain browser bookmark even if the client half
 * never mounts.
 */
const LEVEL = {
  empty: '空位',
  thin: '稀少',
  warming: '有竞争',
  crowded: '红海',
};

const LEVEL_CLASS = { empty: 'lv-empty', thin: 'lv-thin', warming: 'lv-warming', crowded: 'lv-crowded' };

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sourceLine({ from, fetchedAt, total }) {
  const origin = from === 'network' ? '刚拉取' : from === 'cache' ? '本地缓存' : from === 'stale-cache' ? '过期缓存' : '本地文件';
  const when = fetchedAt ? new Date(fetchedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '未知';
  return `${origin} · ${when} · ${total} 个插件`;
}

function gapRows(rows, max, topicTrend) {
  return rows.map((row) => {
    const pct = max > 0 ? Math.round((row.count / max) * 100) : 0;
    const delta = topicTrend?.get(row.id);
    const badge = delta && delta !== 0
      ? ` <span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</span>`
      : '';
    return `<tr>
      <td class="topic">${esc(row.label)}${badge}</td>
      <td class="num">${row.count}</td>
      <td><span class="pill ${LEVEL_CLASS[row.level]}">${LEVEL[row.level] ?? esc(row.level)}</span></td>
      <td class="bar-cell"><span class="bar"><i style="width:${pct}%"></i></span></td>
      <td class="mono dim">${esc(row.samples.join('、') || '—')}</td>
    </tr>`;
  }).join('\n');
}

function sparkline(series, width = 620, height = 90) {
  if (!series || series.length < 2) {
    return '<p class="dim">目录里没有足够的收录日期，画不出走势。</p>';
  }
  const totals = series.map((p) => p.total);
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const span = Math.max(1, max - min);
  const stepX = width / (series.length - 1);
  const points = series.map((p, i) => {
    const x = (i * stepX).toFixed(1);
    const y = (height - 10 - ((p.total - min) / span) * (height - 24)).toFixed(1);
    return `${x},${y}`;
  }).join(' ');
  const first = series[0];
  const last = series[series.length - 1];
  const areaPoints = `0,${height - 4} ${points} ${width},${height - 4}`;
  return `<svg viewBox="0 0 ${width} ${height}" class="spark" role="img" aria-label="在册插件总量趋势">
    <polygon points="${areaPoints}" class="spark-area"></polygon>
    <polyline points="${points}" class="spark-line"></polyline>
    <text x="0" y="${height - 0}" class="spark-label">${esc(first.month)} · ${first.total}</text>
    <text x="${width}" y="${height - 0}" text-anchor="end" class="spark-label">${esc(last.month)} · ${last.total}</text>
  </svg>`;
}

function mineSection(mine) {
  if (!mine || mine.rows.length === 0) {
    return '<p class="dim">没有检测到本地插件。把工作区切到你要发布的插件目录，这一栏会自动出现。</p>';
  }
  const rows = mine.rows.map((r) => {
    const name = r.inCatalog ? r.entry.name : r.package;
    const stars = r.stars == null ? '—' : `${r.stars}${r.starsFrom === 'catalog' ? '<span class="dim">（目录）</span>' : ''}`;
    return `<tr>
      <td class="mono">${esc(name)}</td>
      <td class="mono">${esc(r.version ?? (r.missing ? '未发布' : '—'))}</td>
      <td class="num">${r.missing ? '—' : esc(r.downloads ?? '—')}</td>
      <td class="num">${stars}</td>
      <td>${r.inCatalog ? '✅' : '—'}</td>
      <td class="dim">${r.rank ? `${r.rank.position}/${r.rank.of} · ${esc(r.rank.category)}` : '—'}</td>
    </tr>`;
  }).join('\n');
  return `<table><thead><tr><th>包</th><th>版本</th><th>月下载</th><th>Star</th><th>已收录</th><th>同类排名</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderDashboard({ overview, mine, query, search, trend }) {
  const { stats, counts } = overview;
  const max = Math.max(1, ...overview.gaps.map((r) => r.count));
  const emptyTop = overview.gaps.filter((r) => r.level === 'empty' || r.level === 'thin').slice(0, 30);
  const topicTrend = new Map((trend?.deltas ?? []).map((d) => [d.id, d.delta]));
  const series = trend?.months ?? overview.growth?.months ?? [];

  const searchBlock = query && search
    ? `<section class="card">
        <h2>「${esc(query)}」的竞争面</h2>
        ${search.topics.length ? `<div class="chips">${search.topics.map((t) => `<span class="chip ${LEVEL_CLASS[t.level]}">${esc(t.label)} · ${t.count}</span>`).join('')}</div>` : ''}
        ${search.entries.length === 0
          ? '<p>没有任何插件的名称、作者或描述命中这个查询。</p>'
          : `<table><thead><tr><th>插件</th><th>作者</th><th>分类</th><th>Star</th><th>月下载</th></tr></thead><tbody>${search.entries.map((e) => `<tr><td class="mono">${esc(e.name)}</td><td class="dim">${esc(e.owner || '—')}</td><td class="dim">${esc(e.category.join('/') || '—')}</td><td class="num">${esc(e.stars ?? '—')}</td><td class="num">${esc(e.downloads ?? '—')}</td></tr>`).join('')}</tbody></table>`}
      </section>`
    : '';

  const trendLine = trend?.first && trend?.last
    ? `<p class="note">${esc(trend.first)} → ${esc(trend.last)}：在册插件 ${trend.months[0].total} → ${trend.months[trend.months.length - 1].total}，${(trend.deltas ?? []).length} 个主题在变挤。</p>`
    : '<p class="note">目录里没有足够的收录日期，画不出走势。</p>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>插件雷达 · DSH 插件市场情报</title>
<style>
  :root{--bg:#0f1115;--panel:#161922;--line:#252a36;--fg:#e8eaf0;--dim:#8b93a7;--accent:#5b9dff;--ok:#38b48b;--warn:#e0a03c;--bad:#e05c5c}
  @media (prefers-color-scheme:light){:root{--bg:#f5f6f9;--panel:#fff;--line:#e3e6ee;--fg:#1a1d26;--dim:#667;--accent:#2a6fd6}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:1100px;margin:0 auto;padding:28px 20px 64px}
  header h1{margin:0 0 4px;font-size:22px;letter-spacing:.2px}
  .sub{color:var(--dim);font-size:13px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:22px 0}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .stat b{display:block;font-size:24px;font-weight:650;letter-spacing:-.5px}
  .stat span{color:var(--dim);font-size:12px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 18px 6px;margin:18px 0}
  .card h2{margin:0 0 12px;font-size:15px;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;color:var(--dim);font-weight:500;font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}
  td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
  tr:last-child td{border-bottom:0}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
  .dim{color:var(--dim)}
  .topic{font-weight:500}
  .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;border:1px solid transparent;white-space:nowrap}
  .lv-empty{background:rgba(56,180,139,.14);color:var(--ok);border-color:rgba(56,180,139,.35)}
  .lv-thin{background:rgba(91,157,255,.13);color:var(--accent);border-color:rgba(91,157,255,.3)}
  .lv-warming{background:rgba(224,160,60,.13);color:var(--warn);border-color:rgba(224,160,60,.3)}
  .lv-crowded{background:rgba(224,92,92,.12);color:var(--bad);border-color:rgba(224,92,92,.3)}
  .delta{font-size:11px;font-variant-numeric:tabular-nums}
  .delta.up{color:var(--warn)}
  .delta.down{color:var(--ok)}
  .bar{display:block;height:6px;border-radius:4px;background:var(--line);overflow:hidden;min-width:80px}
  .bar i{display:block;height:100%;background:var(--accent)}
  .bar-cell{width:130px}
  .spark{width:100%;height:auto;margin:6px 0 10px}
  .spark-line{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
  .spark-area{fill:rgba(91,157,255,.12);stroke:none}
  .spark-label{fill:var(--dim);font-size:10px}
  form.search{display:flex;gap:8px;margin:18px 0 0}
  input[type=search]{flex:1;background:var(--panel);border:1px solid var(--line);color:var(--fg);border-radius:10px;padding:10px 12px;font-size:13px;outline:none}
  input[type=search]:focus{border-color:var(--accent)}
  button{background:var(--accent);color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:13px;cursor:pointer}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
  .chip{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}
  .note{color:var(--dim);font-size:12px;margin:10px 0 16px}
  a{color:var(--accent);text-decoration:none}
  footer{margin-top:28px;color:var(--dim);font-size:12px}
</style>
</head>
<body><div class="wrap">
<header>
  <h1>插件雷达</h1>
  <div class="sub">DSH 插件作者的市场情报 · ${esc(sourceLine({ ...overview, total: stats.total }))}</div>
</header>

<form class="search" method="get" action="/radar">
  <input type="search" name="q" placeholder="查一个主题或插件：物流、dicom、crm、看板…" value="${esc(query ?? '')}" autofocus>
  <button type="submit">查竞争</button>
</form>

<div class="cards">
  <div class="stat"><b>${stats.total}</b><span>市场插件总量</span></div>
  <div class="stat"><b>${counts.empty}</b><span>完全空位主题</span></div>
  <div class="stat"><b>${counts.thin}</b><span>稀少（1–3 个）</span></div>
  <div class="stat"><b>${stats.withNpm}</b><span>已发布到 npm</span></div>
</div>

${searchBlock}

<section class="card">
  <h2>市场走势</h2>
  ${trendLine}
  ${sparkline(series)}
</section>

<section class="card">
  <h2>关键词空位榜 · 25 个最空的方向</h2>
  <p class="note">计数是「名称 + 描述」的词面匹配，偏高；因此「0」可信，「很多」不必当真。带 ± 的数字是对比历史的变化。</p>
  <table><thead><tr><th>主题</th><th class="num">覆盖</th><th>级别</th><th>分布</th><th>已有插件</th></tr></thead>
  <tbody>${gapRows(emptyTop, max, topicTrend)}</tbody></table>
</section>

<section class="card">
  <h2>我的插件</h2>
  ${mineSection(mine)}
</section>

<section class="card">
  <h2>分类分布</h2>
  <table><thead><tr><th>分类</th><th class="num">数量</th><th>分类</th><th class="num">数量</th></tr></thead><tbody>
  ${(() => {
    const cats = stats.categories;
    const half = Math.ceil(cats.length / 2);
    const left = cats.slice(0, half);
    const right = cats.slice(half);
    return left.map((c, i) => `<tr><td>${esc(c.name)}</td><td class="num">${c.count}</td><td>${esc(right[i]?.name ?? '')}</td><td class="num">${right[i]?.count ?? ''}</td></tr>`).join('');
  })()}
  </tbody></table>
</section>

<footer>数据来自 awesome-dsh-plugin.com 的公开目录，只读；本页不写入任何东西。JSON: <a href="/radar/api.json">/radar/api.json</a></footer>
</div></body></html>`;
}

export function renderError(message) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Publisher Radar</title>
<style>body{background:#0f1115;color:#e8eaf0;font:14px/1.6 -apple-system,"Segoe UI","PingFang SC",sans-serif;padding:48px;max-width:760px}
code{background:#1b1f29;padding:2px 6px;border-radius:6px}</style></head>
<body><h1>Publisher Radar 暂时取不到数据</h1><p>${esc(message)}</p>
<p>插件目录来自 <code>awesome-dsh-plugin.com</code>（GitHub Pages）。网络不通时，先在同机跑一次快照，再刷新：</p>
<pre><code>node scripts/snapshot.mjs</code></pre></body></html>`;
}
