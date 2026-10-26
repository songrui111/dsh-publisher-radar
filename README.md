# dsh-publisher-radar · 插件雷达

**A browser for the DSH plugin market, plus the author's radar — install it and it works.**

The sidebar **插件雷达** searches and pages through all **6,896 plugins**, drills from a
market category to a topic to the plugins themselves, and hands you the install command
for any one of them — while still ranking which corners of the market are empty.

[简体中文](README.zh-CN.md) · MIT · [Publishing](PUBLISHING.md)

## Why

The DSH marketplace has **6,896 plugins** (2026-10-26 snapshot), and until now there was
no way to look at it from inside DSH — no search, no paging, no way to see what a plugin
is without leaving the app. Two harder questions followed:

1. *Is anyone already doing this?* — names collide (five authors ship a
   `dsh-plugin-doctor`), and real competitors describe themselves with different words.
2. *Will my package survive the market's install path?* — a missing
   `dsh.bundle.patch` or an install-time script makes a listing silently uninstallable.

插件雷达 answers all three from one catalog: browse the whole market, find the empty
corners, and copy the exact command that installs any plugin.

## What you see

A sidebar entry, a full page at `/radar`, and six model tools — all from one catalog.

| Surface | What it does |
|---|---|
| **插件雷达 panel** (sidebar) | Browse all 6,896 plugins: search, category filter, paging, sort by downloads / stars / date; open one for its install command |
| Panel「方向」 | Category → topic → plugins, with coverage levels and both sort directions |
| Panel「设置」 | Track your own npm packages; optional GitHub token (never required) |
| `/radar` | The wide view: trend chart, full gap table, search |
| `radar_gaps` | Which topics have 0–3 plugins? |
| `radar_market` | How big is the market, what leads? |
| `radar_trend` | Which directions are filling up? (12 months, from the catalog's own dates) |
| `radar_plugin` | Who already did this? |
| `radar_checkup` | Will this folder survive a market install? |
| `radar_mine` | My downloads, stars, catalog presence, category rank |

## Zero configuration, on purpose

Nothing below is required to use it, and there is no setup step:

- **Catalog** — raced across the canonical host, unpkg, jsDelivr, and the npm China
  mirror (`dsh-plugin-catalog` tarball). Whichever answers first wins; results are
  cached six hours. Measured from a mainland network: 6.7 s when the canonical host is
  blocked, 0.7 s through the mirror, 50 ms from cache.
- **Trend** — derived from each plugin's `added` date inside today's snapshot, so the
  twelve-month curve exists on the first open. There is no local history to accumulate.
- **Stars** — live from GitHub when the package has a repository (the catalog's URL, or
  the one npm publishes); otherwise the catalog's snapshot. A failure falls back
  silently instead of showing a broken number.
- **Your plugins** — read from the panel's「设置」field, or auto-detected when the
  workspace is your plugin folder (a `package.json` with `dsh.bundle`). A local
  `file:` package that was never published still resolves — its manifest is in the
  profile.

## Install

```sh
dsh plugin --profile web add dsh-publisher-radar
```

Restart the profile → the sidebar gains **插件雷达**.

## Optional config

Only when you want it:

```yaml
- id: publisher-radar
  config:
    myPlugins: ["your-package"]   # track a published plugin from any workspace
    githubToken: ""              # higher GitHub rate limit (or GITHUB_TOKEN)
```

## Honest caveats

- Coverage is a **lexical** match over `name + description`, so it over-counts
  (`ats` hits `formats`). Reported **0 is trustworthy**; a large number only means
  "not obviously unclaimed".
- The trend curve is **cumulative** (by `added` date): it shows a niche filling up, and
  cannot show withdrawals.
- `checkup` judges packaging and supply-chain shape, not code quality or security.

## Privacy

- Public data only, nothing uploaded.
- **Writing: two files.** The catalog cache (`catalog.json`, 8.7 MB, six-hour TTL) and
  the settings you save in the panel (`config.json`). No history, no session data, no
  copies of anything of yours.
- A GitHub token, if you provide one, is stored in that `config.json` in plain text on
  this machine and is never returned by the API — only "a token is set".
- `radar_checkup` reads the folder you point it at and writes nowhere.
- The dashboard is served by your local DSH web server, same-origin, `no-store`.

## Development

```sh
npm test                                              # smoke + host wiring + client (offline)
node test/smoke.mjs --catalog ../market/plugins.json  # against the real 6,896-entry catalog
node scripts/preview.mjs --catalog ../market/plugins.json --out radar-preview.html
node scripts/sync.mjs                                 # copy into the desktop profile
```

No build step, no runtime dependencies. `lib/` ships as authored; the browser half is
hand-written plain JS (no JSX, no bundler), the same shape DSH's own panels use.

## Limitations

- The catalog is a curated list, not npm itself; an unlisted plugin is invisible here.
- `added` dates come from the catalog, so a very fresh plugin may not be dated yet.

## License

MIT
