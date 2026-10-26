/**
 * Markdown renderers for the tools.
 *
 * The rule these follow: say where every number came from and how old it is. A gap
 * ranking derived from a two-day-old snapshot is still useful, but only if the reader
 * knows it is two days old — so `describeSource` is prepended to each report rather
 * than buried.
 */

const LEVEL_LABEL = {
  empty: '空位',
  thin: '稀少',
  warming: '有竞争',
  crowded: '红海',
};

export function describeSource({ from, fetchedAt, total }) {
  const origin = from === 'network' ? '刚拉取'
    : from === 'cache' ? '本地缓存'
      : from === 'stale-cache' ? '过期缓存（上游不可达）'
        : '本地文件';
  const when = fetchedAt ? new Date(fetchedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '未知时间';
  return `数据源：${origin} · ${when} · ${total} 个插件`;
}

function bar(count, max) {
  if (max <= 0) return '';
  const width = Math.max(count === 0 ? 0 : 1, Math.round((count / max) * 12));
  return '█'.repeat(width) + '░'.repeat(Math.max(0, 12 - width));
}

/** The gap table. */
export function gapsMarkdown(result, { limit = 20 } = {}) {
  const rows = result.rows.slice(0, limit);
  const max = Math.max(1, ...result.rows.map((r) => r.count));
  const out = [];
  out.push('## 关键词空位榜');
  out.push('');
  out.push(describeSource(result));
  out.push('');
  out.push(`空位 ${result.counts.empty} 个 · 稀少 ${result.counts.thin} 个 · 有竞争 ${result.counts.warming} 个 · 红海 ${result.counts.crowded} 个`);
  out.push('');
  out.push('| 主题 | 覆盖 | 级别 | 分布 | 已有插件（最多 3 个） |');
  out.push('|---|---:|---|---|---|');
  for (const row of rows) {
    out.push(`| ${row.label} | ${row.count} | ${LEVEL_LABEL[row.level] ?? row.level} | ${bar(row.count, max)} | ${row.samples.join('、') || '—'} |`);
  }
  out.push('');
  out.push('> 计数是「名称 + 描述」的词面匹配，会偏高（把 token 预算里的 budget 算成记账）。所以：**报 0 的格子可信，报很多的不必当真**。');
  return out.join('\n');
}

/** Market overview. */
export function overviewMarkdown(result, { gapLimit = 10 } = {}) {
  const { stats, counts } = result;
  const out = [];
  out.push('## 插件市场概览');
  out.push('');
  out.push(describeSource({ ...result, total: stats.total }));
  out.push('');
  out.push(`**总量** ${stats.total} 个插件，其中 ${stats.withNpm} 个已发布到 npm。`);
  out.push('');
  out.push('### 分类分布（前 12）');
  out.push('');
  out.push('| 分类 | 数量 |');
  out.push('|---|---:|');
  for (const c of stats.categories.slice(0, 12)) out.push(`| ${c.name} | ${c.count} |`);
  out.push('');
  out.push('### 每月新增');
  out.push('');
  for (const m of stats.months.slice(-8)) out.push(`- ${m.month}: ${m.count}`);
  out.push('');
  out.push('### 下载量领先（近一月）');
  out.push('');
  for (const e of stats.topDownloads.slice(0, 8)) out.push(`- ${e.name} — ${e.downloads.toLocaleString()} 次${e.npm ? ` · npm \`${e.npm}\`` : ''}`);
  out.push('');
  out.push('### 竞争对手最少的方向');
  out.push('');
  for (const row of result.gaps.filter((r) => r.level === 'empty' || r.level === 'thin').slice(0, gapLimit)) {
    out.push(`- **${row.label}** — ${row.count} 个（${LEVEL_LABEL[row.level]}）`);
  }
  out.push('');
  out.push(`空位 ${counts.empty} 个 · 稀少 ${counts.thin} 个`);
  return out.join('\n');
}

/** "Who already did this?" */
export function searchMarkdown(result) {
  const out = [];
  out.push(`## 「${result.query}」的竞争面`);
  out.push('');
  out.push(describeSource(result));
  out.push('');
  if (result.topics.length > 0) {
    out.push('### 主题覆盖');
    out.push('');
    for (const t of result.topics) out.push(`- **${t.label}** — ${t.count} 个（${LEVEL_LABEL[t.level]}）${t.samples.length ? `：${t.samples.join('、')}` : ''}`);
    out.push('');
  }
  out.push('### 直接命中的插件');
  out.push('');
  if (result.entries.length === 0) {
    out.push('没有任何插件的名称、作者或描述命中这个查询。');
  } else {
    out.push('| 插件 | 作者 | 分类 | Star | 月下载 |');
    out.push('|---|---|---|---:|---:|');
    for (const e of result.entries) {
      out.push(`| ${e.name} | ${e.owner || '—'} | ${e.category.join('/') || '—'} | ${e.stars ?? '—'} | ${e.downloads ?? '—'} |`);
    }
  }
  return out.join('\n');
}

/** The publisher's own numbers. */
export function mineMarkdown(result) {
  const out = [];
  out.push('## 我的插件');
  out.push('');
  out.push(describeSource(result));
  if (result.detected) out.push(`跟踪目标来自当前目录的 \`package.json\`：**${result.detected.name}**`);
  out.push('');
  if (result.rows.length === 0) {
    out.push('没有检测到本地插件。把工作区切到你要发布的插件目录，这一栏就会自动出现。');
    return out.join('\n');
  }
  out.push('| 包 | 版本 | 月下载 | Star | 收录 | 同类排名 |');
  out.push('|---|---|---:|---:|---|---|');
  for (const r of result.rows) {
    const name = r.inCatalog ? r.entry.name : r.package;
    const version = r.version ?? (r.missing ? '未发布' : '—');
    const downloads = r.missing ? '—' : (r.downloads ?? '—');
    const stars = r.stars == null ? '—' : `${r.stars}${r.starsFrom === 'live' || r.starsFrom === 'cache' || r.starsFrom === 'stale' ? '' : '（目录）'}`;
    const rank = r.rank ? `${r.rank.position}/${r.rank.of}（${r.rank.category}）` : '—';
    out.push(`| ${name} | ${version} | ${downloads} | ${stars} | ${r.inCatalog ? '是' : '否'} | ${rank} |`);
  }
  out.push('');
  const missing = result.rows.filter((r) => r.missing).map((r) => r.package);
  if (missing.length > 0) out.push(`> 尚未在 npm 上找到：${missing.join(', ')}`);
  const notListed = result.rows.filter((r) => !r.missing && !r.inCatalog).map((r) => r.package);
  if (notListed.length > 0) out.push(`> 已发布但未进市场目录：${notListed.join(', ')} — 向 awesome-dsh-plugin 提 PR 收录。`);
  const lived = result.rows.filter((r) => r.starsFrom === 'live' || r.starsFrom === 'cache');
  if (lived.length === 0 && result.rows.length > 0) out.push('> Star 来自目录快照；设置 `GITHUB_TOKEN` 可拿到实时数（未鉴权每小时 60 次）。');
  return out.join('\n');
}

/** How the market filled up. */
export function trendMarkdown(result) {
  const out = [];
  out.push(`## 市场走势（近 ${result.window} 个月）`);
  out.push('');
  if (result.months.length < 2) {
    out.push('目录里没有足够的收录日期，画不出走势。');
    return out.join('\n');
  }
  const first = result.months[0];
  const last = result.months[result.months.length - 1];
  const growth = last.total - first.total;
  out.push(`${first.month} → ${last.month}：在册插件 ${first.total} → ${last.total}（+${growth}）。`);
  out.push(`收录日期覆盖 ${result.coverage} / ${result.total} 条记录。`);
  out.push('');
  const deltas = result.deltas ?? [];
  if (deltas.length === 0) {
    out.push('这段时间里，各主题的在册数量没有变化。');
  } else {
    out.push('### 涨得最快的方向');
    out.push('');
    out.push('| 主题 | 增量 | 起点 → 现在 |');
    out.push('|---|---:|---|');
    for (const row of deltas.slice(0, 20)) {
      const label = result.labels?.[row.id] ?? row.id;
      out.push(`| ${label} | +${row.delta} | ${row.before} → ${row.now} |`);
    }
    out.push('');
    out.push('> 这是**累计**曲线（按收录日期统计），只会上升：它说明一个方向在变挤，不能说明有人退出。');
  }
  out.push('');
  out.push('### 逐月总量');
  out.push('');
  out.push(result.months.map((m) => `${m.month}: ${m.total}`).join(' · '));
  return out.join('\n');
}

/** Publish-readiness. */
export function checkupMarkdown(result) {
  const out = [];
  const icon = { ok: '✅', warn: '⚠️', error: '❌', info: 'ℹ️' };
  out.push('## 发布前体检');
  out.push('');
  out.push(`目录：\`${result.dir}\``);
  out.push(`结果：**${result.verdict.toUpperCase()}** · 得分 ${result.score}/100`);
  out.push('');
  out.push('| 项 | 结论 | 说明 | 修法 |');
  out.push('|---|---|---|---|');
  for (const c of result.checks) {
    out.push(`| ${icon[c.level] ?? ''} ${c.id} | ${c.level} | ${c.message.replace(/\|/g, '\\|')} | ${(c.fix ?? '').replace(/\|/g, '\\|')} |`);
  }
  out.push('');
  if (result.verdict === 'pass') out.push('没有阻塞项。可以打 tag、发 GitHub Release、提市场 PR 了。');
  else if (result.verdict === 'warn') out.push('没有阻塞项，但有会让列表页减分的地方，建议发布前清掉。');
  else out.push('有阻塞项：按上面 `error` 行修完再发布，否则市场装不上。');
  return out.join('\n');
}
