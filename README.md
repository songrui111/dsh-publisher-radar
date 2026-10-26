# dsh-publisher-radar · Publisher Radar

**A browser for the DSH plugin market, plus the author's radar — install it and it works.**

The sidebar entry — **Publisher Radar**（插件雷达, the label DSH shows）— searches and pages
through the **whole plugin market**: several thousand entries and growing, with the live
count on the panel. It drills from a market category to a topic to the plugins themselves,
and hands you the install command for any one of them, while still ranking which corners
are empty.

[简体中文](README.zh-CN.md) · MIT · [Publishing](PUBLISHING.md)

## Why

The DSH marketplace passed **6,000 plugins** in 2026 and keeps growing — the panel always
shows the current count, because it reads the catalog rather than a number written here.
Until now there was no way to look at that market from inside DSH — no search, no paging,
no way to see what a plugin is without leaving the app. Two harder questions followed:

1. *Is anyone already doing this?* — names collide (five authors ship a
   `dsh-plugin-doctor`), and real competitors describe themselves with different words.
2. *Will my package survive the market's install path?* — a missing
   `dsh.bundle.patch` or an install-time script makes a listing silently uninstallable.

Publisher Radar answers all three from one catalog: browse the whole market, find the empty
corners, and copy the exact command that installs any plugin.

## What you see

A sidebar entry and five model tools — all from one catalog.

| Surface | What it does |
|---|---|
| **Publisher Radar** (sidebar) | Browse the whole market: search, category filter, paging, sort by downloads / stars / date; open one for its install command |
| Panel「方向 · Topics」 | Category → topic → plugins, with coverage levels and both sort directions |
| Panel「设置 · Settings」 | Track your own npm packages; optional GitHub token (never required) |
| `radar_gaps` | Which topics have 0–3 plugins? |
| `radar_market` | How big is the market, what leads? |
| `radar_plugin` | Who already did this? |
| `radar_checkup` | Will this folder survive a market install? |
| `radar_mine` | My downloads, stars, catalog presence, category rank |

## Zero configuration, on purpose

Nothing below is required to use it, and there is no setup step:

- **Catalog** — raced across the canonical host, unpkg, jsDelivr, and the npm China
  mirror (`dsh-plugin-catalog` tarball). Whichever answers first wins; results are
  cached six hours. Measured from a mainland network: 6.7 s when the canonical host is
  blocked, 0.7 s through the mirror, 50 ms from cache.
- **Stars** — live from GitHub when the package has a repository (the catalog's URL, or
  the one npm publishes); otherwise the catalog's snapshot. A failure falls back
  silently instead of showing a broken number.
- **Your plugins** — read from the panel's Settings field (「设置」in the UI), or
  auto-detected when the workspace is your plugin folder (a `package.json` with
  `dsh.bundle`). A local `file:` package that was never published still resolves — its
  manifest is in the profile.

## Install

```sh
dsh plugin --profile web add dsh-publisher-radar
```

Restart the profile → the sidebar gains **Publisher Radar**.

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
- The 80 topics do **not** cover every plugin (about half match none). Browsing is the
  full catalog; the topic ranking is for deciding what to build. Do not mix the two.
- `checkup` judges packaging and supply-chain shape, not code quality or security.

## Privacy

- Public data only, nothing uploaded.
- **Writing: two files.** The catalog cache (`catalog.json`, 8.7 MB, six-hour TTL) and
  the settings you save in the panel (`config.json`). No history, no session data, no
  copies of anything of yours.
- A GitHub token, if you provide one, is stored in that `config.json` in plain text on
  this machine and is never returned by the API — only "a token is set".
- `radar_checkup` reads the folder you point it at and writes nowhere.
- The panel's data is served by your local DSH web server, same-origin, `no-store`.

## Development

```sh
npm test                                              # smoke + host wiring + client (offline)
node test/smoke.mjs --catalog ../market/plugins.json  # against the real catalog snapshot
npm run test:install                                  # pack, install into a temp dir, boot it
node scripts/sync.mjs                                 # copy into the desktop profile
```

`test:install` is the one that matters before a release: it takes the tarball a user
would download, `npm install`s it into an empty directory, then imports the installed
copy and asserts it registers its five tools and two routes. Packaging mistakes that
pass a source-tree test (a missing file, an absolute `name:` in the patch) fail here.

No build step, no runtime dependencies. `lib/` ships as authored; the browser half is
hand-written plain JS (no JSX, no bundler), the same shape DSH's own panels use.

## Limitations

- The catalog is a curated list, not npm itself; an unlisted plugin is invisible here.
- `added` dates come from the catalog, so a very fresh plugin may not be dated yet.

## License

MIT
