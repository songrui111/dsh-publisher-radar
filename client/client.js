// dsh-publisher-radar, browser half.
//
// A plain hand-written bundle, same shape as the ones DSH ships: no build step, no
// import/export keywords, no JSX. The page loads it as a script, the module loader
// hands it a `require`, and the only module it asks for is React.
//
// The panel IS the product: search, the gap ranking, a topic's plugin list, and each
// plugin's detail (stars, downloads, install line) all live here. Nothing needs a
// second window — under an Electron shell that decision belongs to the host.
//
// Layout facts this file depends on (verified against shipped client bundles):
//   - `sidebar.panellist` entries carry `id`, `order`, `label` and render their own
//     icon; there is no icon field.
//   - `main` is keyed by that same id.
//   - both seats are registered from the innermost callback so they appear together.
window.__ModuleLoader__.load({
  id: 'dsh-publisher-radar',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    /** Panel identity: the rail entry and the main seat must agree. */
    const PANEL_ID = 'publisher-radar'
    const API = '/radar/api.json'

    const C = {
      dim: 'rgba(127,127,127,.85)',
      line: 'rgba(127,127,127,.22)',
      soft: 'rgba(127,127,127,.10)',
      ok: '#2f9e75',
      warn: '#c98a2b',
      accent: '#4f8ff0',
      bad: '#cf5656',
    }

    const S = {
      root: { display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 14px 24px', fontSize: 13, lineHeight: 1.5, overflowY: 'auto', height: '100%', minHeight: 0 },
      head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
      title: { fontSize: 15, fontWeight: 600 },
      sub: { fontSize: 11, color: C.dim },
      cards: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
      card: { border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 10px' },
      big: { fontSize: 19, fontWeight: 650, lineHeight: 1.2 },
      label: { fontSize: 11, color: C.dim },
      section: { border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 10px 6px' },
      sectionHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 },
      sectionTitle: { fontSize: 12, fontWeight: 600 },
      row: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.line}`, cursor: 'pointer' },
      rowLast: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', padding: '5px 0', cursor: 'pointer' },
      name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      num: { fontVariantNumeric: 'tabular-nums', color: C.dim },
      pill: { fontSize: 10, padding: '1px 7px', borderRadius: 999, border: '1px solid' },
      searchRow: { display: 'flex', gap: 6 },
      input: { flex: 1, minWidth: 0, padding: '6px 9px', borderRadius: 8, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit', fontSize: 12, outline: 'none' },
      smallBtn: { padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      actions: { display: 'flex', gap: 8, marginTop: 2 },
      btn: { flex: 1, padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      btnPrimary: { width: '100%', padding: '8px 10px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 },
      select: { flex: 1, minWidth: 0, padding: '5px 6px', borderRadius: 8, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit', fontSize: 11.5 },
      note: { fontSize: 11, color: C.dim, wordBreak: 'break-word' },
      err: { fontSize: 12, color: C.bad },
      code: { display: 'block', fontSize: 11, padding: '6px 8px', borderRadius: 8, background: C.soft, wordBreak: 'break-all', fontFamily: 'ui-monospace,Menlo,Consolas,monospace' },
      stats: { display: 'flex', gap: 14, alignItems: 'baseline', margin: '4px 0 2px' },
      statNum: { fontSize: 16, fontWeight: 650 },
      kv: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 11.5 },
      k: { color: C.dim },
      v: { wordBreak: 'break-word' },
      back: { alignSelf: 'flex-start', padding: '2px 8px', borderRadius: 8, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 },
      chip: { fontSize: 10, padding: '1px 6px', borderRadius: 999, border: `1px solid ${C.line}`, color: C.dim },
    }

    const LEVEL = {
      empty: { text: '空位', color: C.ok },
      thin: { text: '稀少', color: C.accent },
      warming: { text: '有竞争', color: C.warn },
      crowded: { text: '红海', color: C.bad },
    }

    const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—')

    /** How stale the snapshot is, in words — the timestamp alone reads as "now". */
    function ageText(fetchedAt) {
      const ms = Date.now() - Date.parse(fetchedAt)
      if (!Number.isFinite(ms) || ms < 0) return ''
      const minutes = Math.floor(ms / 60_000)
      if (minutes < 1) return '刚刚'
      if (minutes < 60) return `${minutes} 分钟前`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours} 小时前`
      return `${Math.floor(hours / 24)} 天前`
    }

    function sourceText(data) {
      const origin = data.from === 'network' ? '刚拉取' : data.from === 'cache' ? '本地缓存' : data.from === 'stale-cache' ? '过期缓存' : '本地文件'
      const when = data.fetchedAt ? String(data.fetchedAt).replace('T', ' ').slice(0, 16) : '未知'
      const age = data.fetchedAt ? ageText(data.fetchedAt) : ''
      const mirror = typeof data.sourceUrl === 'string' && data.sourceUrl !== '' ? ` · ${data.sourceUrl}` : ''
      return `${origin} · ${when}${age ? `（${age}）` : ''}${mirror}`
    }

    function Stat(value, label) {
      return h('div', { style: S.card, key: label }, h('div', { style: S.big }, String(value)), h('div', { style: S.label }, label))
    }

    /** A clickable row: plugin name, stars, monthly downloads. */
    function PluginRow(entry, index, last, onOpen) {
      return h('div', {
        style: last ? S.rowLast : S.row,
        key: `${entry.name}-${index}`,
        onClick: () => onOpen(entry),
        title: entry.description || entry.name,
      },
        h('span', { style: S.name }, entry.name),
        h('span', { style: { ...S.num, minWidth: 44, textAlign: 'right' } }, entry.stars == null ? '—' : `★${fmt(entry.stars)}`),
        h('span', { style: { ...S.num, minWidth: 52, textAlign: 'right' } }, entry.downloads == null ? '—' : fmt(entry.downloads)),
      )
    }

    /** A clickable topic row: label, coverage, level. */
    function TopicRow(row, index, last, onOpen) {
      const level = LEVEL[row.level] || { text: row.level, color: C.dim }
      return h('div', {
        style: last ? S.rowLast : S.row,
        key: row.id || index,
        onClick: () => onOpen(row),
        title: row.samples && row.samples.length ? row.samples.join('、') : row.label,
      },
        h('span', { style: S.name }, row.label),
        h('span', { style: S.num }, String(row.count)),
        h('span', { style: { ...S.pill, color: level.color, borderColor: level.color } }, level.text),
      )
    }

    function Detail({ entry, onBack, onCopy }) {
      const categories = (entry.categories || []).join(' · ')
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('button', { style: S.back, type: 'button', onClick: onBack }, '‹ 返回'),
        h('div', { style: { fontSize: 15, fontWeight: 650, wordBreak: 'break-word' } }, entry.name),
        h('div', { style: S.sub }, [entry.owner ? `@${entry.owner}` : null, categories || null].filter(Boolean).join(' · ')),
        h('div', { style: S.stats },
          h('span', null,
            h('span', { style: S.statNum }, entry.stars == null ? '—' : fmt(entry.stars)),
            h('span', { style: S.label }, ' ★ 星')),
          h('span', null,
            h('span', { style: S.statNum }, entry.downloads == null ? '—' : fmt(entry.downloads)),
            h('span', { style: S.label }, ' 月下载')),
        ),
        entry.description ? h('div', { style: { fontSize: 12, opacity: 0.9 } }, entry.description) : null,
        h('div', null,
          h('div', { style: S.label }, '安装（复制到终端执行，然后重启 DSH）'),
          h('code', { style: S.code }, entry.installCommand || entry.install || '—'),
          h('button', {
            style: { ...S.smallBtn, marginTop: 4 },
            type: 'button',
            onClick: () => onCopy(entry.installCommand || entry.install || ''),
          }, '复制安装命令'),
        ),
        h('div', { style: S.kv },
          h('span', { style: S.k }, '分类'), h('span', { style: S.v }, categories || '—'),
          h('span', { style: S.k }, '收录'), h('span', { style: S.v }, entry.added || '—'),
          h('span', { style: S.k }, 'npm'), h('span', { style: S.v }, entry.npm ? `${entry.npm}${entry.version ? ` · v${entry.version}` : ''}` : '未发布'),
        ),
        (entry.capabilities && entry.capabilities.length > 0)
          ? h('div', null,
            h('div', { style: S.label }, '能力声明'),
            h('div', { style: S.chips }, entry.capabilities.map((cap) => h('span', { style: S.chip, key: cap }, cap))))
          : null,
        entry.page ? h('div', null, h('div', { style: S.label }, '市场页'), h('div', { style: S.note }, entry.page)) : null,
      )
    }

    function RadarPanel() {
      const [home, setHome] = React.useState(null)
      const [list, setList] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [browse, setBrowse] = React.useState(null)
      const [settingsOpen, setSettingsOpen] = React.useState(false)
      const [draftPlugins, setDraftPlugins] = React.useState([])
      const [draftNew, setDraftNew] = React.useState('')
      const [draftToken, setDraftToken] = React.useState('')
      const [saveState, setSaveState] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [query, setQuery] = React.useState('')
      const [note, setNote] = React.useState(null)
      // The direction list is the panel's main reading, so its order is a control:
      // coverage ascending answers "what is still empty", descending answers "what is
      // crowded". Both are one click away.
      const [sortDir, setSortDir] = React.useState('asc')
      const [showAll, setShowAll] = React.useState(false)

      // `quiet` marks a follow-up pass: it must not flip the busy badge or replace a
      // good payload with an error banner.
      const load = React.useCallback((queryString, build, quiet) => {
        let cancelled = false
        if (quiet !== true) {
          setBusy(true)
          setError(null)
        }
        const url = queryString ? `${API}?${queryString}` : API
        fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((body) => { if (!cancelled) build(body) })
          .catch((err) => { if (!cancelled && quiet !== true) setError(err && err.message ? err.message : String(err)) })
          .finally(() => { if (!cancelled && quiet !== true) setBusy(false) })
        return () => { cancelled = true }
      }, [])

      // Two passes on purpose. The first paints everything the catalog already holds
      // (instant); the second fetches the only network-bound section — npm downloads
      // and GitHub stars — and drops it in when it arrives.
      const loadHome = React.useCallback((force) => {
        const base = force ? 'force=1' : ''
        load(base, (body) => {
          setHome(body)
          setList(null)
          setDetail(null)
          setBrowse(null)
        })
        load(base === '' ? 'mine=1' : 'mine=1&stars=force', (body) => {
          setHome((current) => ({ ...(current === null ? body : current), mine: body.mine, detected: body.detected, config: body.config }))
        }, true)
      }, [load])

      React.useEffect(() => loadHome(), [loadHome])

      // Search the WHOLE catalog, paged — not a top-12 preview.
      const submit = (event) => {
        event.preventDefault()
        const q = query.trim()
        if (q === '') { setList(null); setDetail(null); setBrowse(null); return }
        runBrowse({ query: q, page: 1 })
      }

      const openTopic = (row) => {
        load(`topic=${encodeURIComponent(row.id)}`, (body) => {
          const topic = body.topic
          setList({
            kind: 'plugins',
            title: topic.label,
            badge: `${topic.count} 个`,
            entries: topic.entries,
            sortKey: 'downloads',
            sortDir: 'desc',
            footer: topic.total > topic.entries.length
              ? `列出前 ${topic.entries.length} 个（共 ${topic.total} 个）`
              : null,
          })
          setDetail(null)
        })
      }

      /** Level 1 → 2: a market category, and the topics it actually contains. */
      const openCategory = (name) => {
        load(`cat=${encodeURIComponent(name)}`, (body) => {
          const category = body.category
          setList({
            kind: 'topics',
            category: name,
            title: `${name} 下的方向`,
            badge: `${category.count} 个插件`,
            topics: category.topics,
            footer: category.topics.length === 0 ? '这个大类下没有命中的方向。' : null,
          })
          setDetail(null)
        })
      }

      /** Level 2 → 3: plugins in (category, topic). */
      const openCategoryTopic = (category, topicId) => {
        load(`cat=${encodeURIComponent(category)}&topic=${encodeURIComponent(topicId)}`, (body) => {
          const block = body.category
          setList({
            kind: 'plugins',
            category,
            title: `${category} · ${block.topic.label}`,
            badge: `${block.topic.count} 个`,
            entries: block.entries,
            sortKey: 'downloads',
            sortDir: 'desc',
            footer: block.total > block.entries.length
              ? `列出前 ${block.entries.length} 个（共 ${block.total} 个）`
              : null,
          })
          setDetail(null)
        })
      }

      /** The whole catalog, paged. Every plugin is reachable from here. */
      const runBrowse = (next) => {
        const base = browse !== null ? browse : {}
        const state = {
          page: 1,
          sort: base.sort || 'downloads',
          dir: base.dir || 'desc',
          category: base.category || '',
          query: base.query || '',
          ...next,
        }
        const params = new URLSearchParams({ browse: '1', page: String(state.page), sort: state.sort, dir: state.dir, pageSize: '30' })
        if (state.category !== '') params.set('cat', state.category)
        if (state.query !== '') params.set('q', state.query)
        if (state.force === true) params.set('force', '1')
        load(params.toString(), (body) => {
          setBrowse({ ...body.browse, profile: body.profile || null, categories: body.categories || [] })
          setList(null)
          setDetail(null)
        })
      }

      const copy = (text) => {
        if (!text) return
        try { navigator.clipboard.writeText(text); setNote('已复制') } catch { setNote(text) }
      }

      const openSettings = () => {
        const configured = (home && home.config && home.config.myPlugins) || []
        setDraftPlugins(configured.slice())
        setDraftNew('')
        setDraftToken('')
        setSaveState(null)
        setSettingsOpen(true)
      }

      /** Append whatever was typed — the list is edited, never replaced wholesale. */
      const addDraft = () => {
        const names = draftNew.split(/[,，\s]+/).map((name) => name.trim()).filter(Boolean)
        if (names.length === 0) return
        setDraftPlugins((current) => {
          const merged = current.slice()
          for (const name of names) if (!merged.includes(name)) merged.push(name)
          return merged
        })
        setDraftNew('')
      }

      /** Save package names (and a token, if one was typed) into the plugin's own config. */
      const saveConfig = (token) => {
        const body = { myPlugins: draftPlugins }
        if (typeof token === 'string') body.githubToken = token
        else if (draftToken !== '') body.githubToken = draftToken
        fetch('/radar/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then((response) => response.json())
          .then((result) => {
            if (!result.ok) throw new Error(result.error || '保存失败')
            setSaveState('已保存')
            setDraftToken('')
            setSettingsOpen(false)
            loadHome()
          })
          .catch((err) => setSaveState(`保存失败：${err && err.message ? err.message : err}`))
      }

      const children = []
      children.push(h('div', { style: S.head, key: 'head' },
        h('div', null,
          h('div', { style: S.title }, '插件雷达'),
          h('div', { style: S.sub }, home ? sourceText(home) : '读取市场中…'),
        ),
        h('span', { style: { ...S.pill, color: busy ? C.warn : C.dim, borderColor: C.line } },
          busy ? '刷新中' : error !== null ? '离线' : '就绪'),
      ))

      children.push(h('form', { style: S.searchRow, key: 'search', onSubmit: submit },
        h('input', {
          style: S.input,
          value: query,
          placeholder: '查主题或插件：物流 / dicom / trello',
          onChange: (event) => {
            const value = event.target.value
            setQuery(value)
            if (value === '') { setList(null); setDetail(null) }
          },
        }),
        h('button', { style: S.smallBtn, type: 'submit', disabled: busy }, '查'),
      ))

      if (error !== null) children.push(h('div', { style: S.err, key: 'err' }, `读取失败：${error}`))

      if (detail !== null) {
        children.push(Detail({ entry: detail, onBack: () => setDetail(null), onCopy: copy }))
      } else if (browse !== null) {
        const cats = browse.categories || []
        children.push(h('div', { style: S.section, key: 'browse' },
          h('div', { style: S.sectionHead },
            h('span', { style: S.sectionTitle }, browse.query ? `搜「${browse.query}」` : '全部插件'),
            h('span', { style: { ...S.pill, color: C.dim, borderColor: C.line } }, `共 ${fmt(browse.total)} 个`),
          ),
          h('div', { style: { ...S.searchRow, marginBottom: 6 } },
            h('select', {
              style: S.select,
              value: browse.category || '',
              onChange: (event) => runBrowse({ category: event.target.value, page: 1 }),
            },
              h('option', { value: '' }, '全部大类'),
              cats.map((cat) => h('option', { value: cat.name, key: cat.name }, `${cat.name}（${cat.count}）`)),
            ),
            h('select', {
              style: S.select,
              value: browse.sort,
              onChange: (event) => runBrowse({ sort: event.target.value, page: 1 }),
            },
              h('option', { value: 'downloads' }, '按月下载'),
              h('option', { value: 'stars' }, '按 ★ 星数'),
              h('option', { value: 'added' }, '按收录时间'),
              h('option', { value: 'name' }, '按名称'),
            ),
          ),
          h('div', { style: { ...S.searchRow, marginBottom: 6 } },
            h('button', {
              style: S.smallBtn,
              type: 'button',
              onClick: () => runBrowse({ dir: browse.dir === 'desc' ? 'asc' : 'desc', page: 1 }),
            }, browse.dir === 'desc' ? '↓ 从高到低' : '↑ 从低到高'),
            h('button', { style: S.smallBtn, type: 'button', onClick: () => runBrowse({ page: browse.page, force: true }) }, '刷新数据'),
          ),
          h('div', { style: { ...S.label, marginBottom: 4 } }, '名称 · ★ star · 月下载（点开可复制安装命令）'),
          browse.entries.length === 0
            ? h('div', { style: S.note }, '没有命中。')
            : browse.entries.map((entry, index) => PluginRow(entry, index, index === browse.entries.length - 1, setDetail)),
          h('div', { style: { ...S.searchRow, marginTop: 8 } },
            h('button', {
              style: S.smallBtn,
              type: 'button',
              disabled: browse.page <= 1 || busy,
              onClick: () => runBrowse({ page: browse.page - 1 }),
            }, '‹ 上一页'),
            h('span', { style: { ...S.note, flex: 1, textAlign: 'center', alignSelf: 'center' } }, `第 ${browse.page} / ${browse.pages} 页`),
            h('button', {
              style: S.smallBtn,
              type: 'button',
              disabled: browse.page >= browse.pages || busy,
              onClick: () => runBrowse({ page: browse.page + 1 }),
            }, '下一页 ›'),
          ),
        ))
      } else if (list !== null) {
        const isTopics = list.kind === 'topics'
        const byDownloads = (a, b) => (b.downloads == null ? -1 : b.downloads) - (a.downloads == null ? -1 : a.downloads)
        const byStars = (a, b) => (b.stars == null ? -1 : b.stars) - (a.stars == null ? -1 : a.stars)
        const rows = (isTopics ? (list.topics || []) : list.entries).slice().sort((a, b) => {
          if (isTopics) {
            const byCount = sortDir === 'asc' ? a.count - b.count : b.count - a.count
            return byCount !== 0 ? byCount : String(a.label).localeCompare(String(b.label), 'zh')
          }
          const base = (list.sortKey === 'stars' ? byStars(a, b) : byDownloads(a, b))
          // Descending is the useful default for both metrics; ascending flips it.
          const cmp = base !== 0 ? base : String(a.name).localeCompare(String(b.name))
          return list.sortDir === 'desc' ? cmp : -cmp
        })
        children.push(h('div', { style: S.section, key: 'list' },
          h('div', { style: S.sectionHead },
            h('span', { style: S.sectionTitle }, list.title),
            h('span', { style: { ...S.pill, color: C.dim, borderColor: C.line } }, list.badge),
          ),
          h('div', { style: { ...S.searchRow, marginBottom: 6 } },
            isTopics ? null : h('button', {
              style: S.smallBtn,
              type: 'button',
              onClick: () => setList({ ...list, sortKey: list.sortKey === 'stars' ? 'downloads' : 'stars' }),
            }, list.sortKey === 'stars' ? '按 ★ 星数' : '按月下载'),
            h('button', {
              style: S.smallBtn,
              type: 'button',
              onClick: () => (isTopics
                ? setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                : setList({ ...list, sortDir: list.sortDir === 'desc' ? 'asc' : 'desc' })),
            }, (isTopics ? sortDir : list.sortDir) === 'desc' ? '↓ 从高到低' : '↑ 从低到高'),
          ),
          h('div', { style: { ...S.label, marginBottom: 4 } }, isTopics ? '方向 · 该类下的插件数' : '名称 · ★ star · 月下载'),
          rows.length === 0
            ? h('div', { style: S.note }, '没有命中。')
            : (isTopics
              ? rows.map((row, index) => TopicRow(row, index, index === rows.length - 1, (picked) => openCategoryTopic(list.category, picked.id)))
              : rows.map((entry, index) => PluginRow(entry, index, index === rows.length - 1, setDetail))),
          list.footer ? h('div', { style: { ...S.note, marginTop: 6 } }, list.footer) : null,
          h('button', { style: { ...S.smallBtn, marginTop: 8 }, type: 'button', onClick: () => { setList(null); setDetail(null) } }, '返回总览'),
        ))
      } else if (home !== null) {
        const counts = home.counts || { empty: 0, thin: 0 }
        children.push(h('div', { style: S.cards, key: 'cards' },
          Stat(home.total == null ? '—' : home.total, '插件总量'),
          Stat(counts.empty || 0, '完全空位'),
          Stat(counts.thin || 0, '稀少（1–3）'),
          Stat(counts.crowded || 0, '红海方向'),
        ))

        // The full catalog is one tap away: 6,896 records, paged, filterable.
        children.push(h('button', {
          key: 'browse-all',
          style: S.btnPrimary,
          type: 'button',
          onClick: () => runBrowse({ page: 1, query: '', category: '' }),
        }, `浏览全部 ${fmt(home.total)} 个插件 →`))

        // Level 1: the marketplace's own categories. These are the coarse buckets the
        // catalog ships (ui / tools / session …), so they are the entry point for
        // "browse by what it is" rather than "browse by idea".
        const categories = home.categories || []
        children.push(h('div', { style: S.section, key: 'cats' },
          h('div', { style: S.sectionHead },
            h('span', { style: S.sectionTitle }, '市场大类 · 点开看小类'),
            h('span', { style: { ...S.pill, color: C.dim, borderColor: C.line } }, `${categories.length} 个`),
          ),
          categories.map((cat, index) => h('div', {
            style: index === categories.length - 1 ? S.rowLast : S.row,
            key: cat.name,
            onClick: () => openCategory(cat.name),
            title: `看 ${cat.name} 下的方向`,
          },
            h('span', { style: S.name }, cat.name),
            h('span', { style: S.num }, String(cat.count)),
            h('span', { style: S.num }, '›'),
          )),
        ))

        // Coverage is the number of plugins already in that direction. Ascending
        // reads "what is still empty"; descending reads "what is crowded".
        const allTopics = home.gaps || []
        const visible = (showAll ? allTopics : allTopics.filter((row) => row.level === 'empty' || row.level === 'thin'))
          .slice()
          .sort((a, b) => {
            const byCount = sortDir === 'asc' ? a.count - b.count : b.count - a.count
            return byCount !== 0 ? byCount : String(a.label).localeCompare(String(b.label), 'zh')
          })
        children.push(h('div', { style: S.section, key: 'gaps' },
          h('div', { style: S.sectionHead },
            h('span', { style: S.sectionTitle }, '方向 · 按覆盖数排序'),
            h('span', { style: { ...S.pill, color: C.ok, borderColor: C.ok } }, `${counts.empty || 0} 空位`),
          ),
          h('div', { style: { ...S.searchRow, marginBottom: 6 } },
            h('button', {
              style: S.smallBtn,
              type: 'button',
              onClick: () => setSortDir(sortDir === 'asc' ? 'desc' : 'asc'),
              title: '在“从少到多”和“从多到少”之间切换',
            }, sortDir === 'asc' ? '↑ 覆盖数从少到多' : '↓ 覆盖数从多到少'),
            h('button', {
              style: S.smallBtn,
              type: 'button',
              onClick: () => setShowAll(!showAll),
              title: '空位/稀少之外还有有竞争与红海',
            }, showAll ? `只看空位 (${visible.filter((row) => row.level === 'empty' || row.level === 'thin').length})` : `看全部 ${allTopics.length} 个`),
          ),
          visible.length === 0
            ? h('div', { style: S.note }, '没有符合条件的方向。')
            : visible.map((row, index) => TopicRow(row, index, index === visible.length - 1, openTopic)),
          h('div', { style: { ...S.note, marginTop: 6 } }, '点任意一行看该方向下的插件。计数按「名称+描述」词面匹配，偏高；报 0 才可信。'),
        ))

        const mine = home.mine || []
        const configured = (home.config && home.config.myPlugins) || []
        // Why a star is missing is part of the answer: "—" alone reads as a bug.
        const starCell = (row) => {
          if (row.stars != null) return `★${fmt(row.stars)}`
          if (row.missing) return '未发布'
          if (!row.repo) return '无仓库'
          if (row.starsFrom === null || row.starsFrom === undefined) return '未取到'
          return '—'
        }
        const downloadCell = (row) => {
          if (row.local) return '本地'
          if (row.missing) return '未发布'
          return fmt(row.downloads)
        }
        if (mine.length > 0) {
          children.push(h('div', { style: S.section, key: 'mine' },
            h('div', { style: S.sectionHead },
              h('span', { style: S.sectionTitle }, `我的插件 · ${mine.length} 个`),
              h('span', { style: { ...S.pill, color: C.dim, borderColor: C.line } }, '月下载 / ★'),
            ),
            mine.map((row, index) => h('div', { style: index === mine.length - 1 ? S.rowLast : S.row, key: row.package },
              h('span', { style: S.name, title: row.repo ? `github.com/${row.repo}` : 'npm 包里没有仓库地址' },
                row.inCatalog ? row.name || row.package : row.package),
              h('span', { style: S.num }, downloadCell(row)),
              h('span', { style: { ...S.num, minWidth: 52, textAlign: 'right' } }, starCell(row)),
            )),
            h('div', { style: { ...S.note, marginTop: 6 } },
              (home.config && home.config.hasToken)
                ? '★ 来自 GitHub 实时数据（缓存 6 小时，「刷新数据」会强制重取）。'
                : '★ 优先来自 GitHub（免 token 也能查）；没配 token 时每小时限 60 次，失败就回退目录快照。'),
          ))
        } else if (configured.length > 0) {
          children.push(h('div', { style: S.section, key: 'mine' },
            h('div', { style: S.sectionHead },
              h('span', { style: S.sectionTitle }, `我的插件 · ${configured.length} 个`),
              h('span', { style: { ...S.pill, color: C.dim, borderColor: C.line } }, '等待数据'),
            ),
            configured.map((name, index) => h('div', { style: index === configured.length - 1 ? S.rowLast : S.row, key: name },
              h('span', { style: S.name }, name),
              h('span', { style: S.num }, '—'),
              h('span', { style: S.num }, '—'),
            )),
            h('div', { style: { ...S.note, marginTop: 6 } }, '还没查到数据（npm 上找不到，或网络不通）。'),
          ))
        }
      }

      children.push(h('div', { style: S.actions, key: 'actions' },
        h('button', { style: S.btn, type: 'button', onClick: () => loadHome(true), disabled: busy }, busy ? '刷新中…' : '刷新数据'),
        h('button', { style: S.btn, type: 'button', onClick: () => loadHome(false) }, '回到总览'),
        h('button', { style: S.btn, type: 'button', onClick: settingsOpen ? () => setSettingsOpen(false) : openSettings }, settingsOpen ? '收起设置' : '设置'),
      ))

      if (settingsOpen) {
        const hasToken = home && home.config && home.config.hasToken
        const draftList = draftPlugins
        children.push(h('div', { style: S.section, key: 'settings' },
          h('div', { style: S.sectionHead },
            h('span', { style: S.sectionTitle }, `我的插件 · 已添加 ${draftList.length} 个`),
          ),
          draftList.length === 0
            ? h('div', { style: S.note }, '还没有添加。在下面输入 npm 包名，点「添加」。')
            : draftList.map((name, index) => h('div', {
              style: index === draftList.length - 1 ? S.rowLast : S.row,
              key: name,
            },
              h('span', { style: S.name }, name),
              h('span', null),
              h('button', {
                style: S.smallBtn,
                type: 'button',
                onClick: () => setDraftPlugins(draftList.filter((item) => item !== name)),
              }, '移除'),
            )),
          h('div', { style: { ...S.searchRow, margin: '8px 0 8px' } },
            h('input', {
              style: S.input,
              value: draftNew,
              placeholder: 'npm 包名，如 dsh-my-plugin',
              onChange: (event) => setDraftNew(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); addDraft() } },
            }),
            h('button', { style: S.smallBtn, type: 'button', onClick: addDraft, disabled: draftNew.trim() === '' }, '添加'),
          ),
          h('div', { style: S.label }, hasToken ? 'GitHub token 已设置（留空＝不修改）' : 'GitHub token（可选，仅用于实时 star）'),
          h('input', {
            style: { ...S.input, width: '100%', margin: '4px 0 4px' },
            type: 'password',
            value: draftToken,
            placeholder: hasToken ? '已设置，留空则不修改' : 'ghp_…（可留空）',
            onChange: (event) => setDraftToken(event.target.value),
          }),
          h('div', { style: { ...S.searchRow, margin: '6px 0 4px' } },
            h('button', { style: S.smallBtn, type: 'button', onClick: () => saveConfig() }, '保存'),
            hasToken ? h('button', { style: S.smallBtn, type: 'button', onClick: () => saveConfig('') }, '清除 token') : null,
          ),
          h('div', { style: S.note }, '不需要 token 也能看自己的插件。token 只用来实时取 star。'),
          h('div', { style: S.note }, 'token 会以明文保存在本机 ~/.dsh/publisher-radar/config.json。'),
          saveState !== null ? h('div', { style: S.note }, saveState) : null,
        ))
      }

      if (note !== null) children.push(h('div', { style: S.note, key: 'note' }, note))
      children.push(h('div', { style: S.note, key: 'foot' }, '目录只读；设置存在本机 ~/.dsh/publisher-radar/config.json。'))

      return h('div', { style: S.root }, children)
    }

    function RadarIcon() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 9, cy: 9, r: 6.6, stroke: 'currentColor', strokeWidth: 1.3, opacity: 0.9 }),
        h('circle', { cx: 9, cy: 9, r: 3.2, stroke: 'currentColor', strokeWidth: 1.3, opacity: 0.7 }),
        h('path', { d: 'M9 2.4v2M9 13.6v2M2.4 9h2M13.6 9h2', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', opacity: 0.8 }),
        h('circle', { cx: 9, cy: 9, r: 1.1, fill: 'currentColor' }),
      )
    }

    function apply(ctx) {
      try {
        if (!ctx || ctx.slots === undefined || ctx.slots === null) {
          console.error('publisher-radar: this DSH has no slots service; the panel stays unmounted')
          return
        }
        ctx.slots.inject('main', () =>
          ctx.slots.inject('sidebar.panellist', () => {
            const stopMain = ctx.slots.register({ name: 'main', key: PANEL_ID }, RadarPanel)
            const stopIcon = ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 76, label: () => '插件雷达' },
              RadarIcon,
            )
            return () => {
              if (typeof stopIcon === 'function') stopIcon()
              if (typeof stopMain === 'function') stopMain()
            }
          }),
        )
      } catch (error) {
        console.error('publisher-radar: registering the panel failed', error)
      }
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
