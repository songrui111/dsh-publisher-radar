# Publishing

Four channels, one commit. They are not interchangeable — a green CI run does not
prove npm was published, and npm does not prove the market can install you.

| Channel | What it is | How |
|---|---|---|
| GitHub repo | where the source lives | `https://github.com/songrui111/dsh-publisher-radar` |
| GitHub Release asset | what the plugin market installs from | tag `v*` → `.github/workflows/release.yml` produces `dsh-publisher-radar.tgz` |
| npm | the package `dsh-publisher-radar` | same workflow, last step (needs `NPM_TOKEN`) |
| Catalog entry | the listing line + install command the market shows | PR to `awesome-dsh-plugin/awesome-dsh-plugin` |
| Working profile | the copy DSH actually loads | `node scripts/sync.mjs`, then restart |

## First release, from zero

```sh
# 1. local repo
cd publisher-radar
git init
git add -A
git commit -m "插件雷达 0.4.0: full market browser + author intelligence"

# 2. create the empty repo on GitHub first, then:
git remote add origin https://github.com/songrui111/dsh-publisher-radar.git
git branch -M main
git push -u origin main
```

Then create the first release. The tag is what runs the pipeline:

```sh
git tag -a v0.4.0 -m "插件雷达 0.4.0"
git push origin v0.4.0
```

Before tagging, add the secret the workflow needs:

> Repo → Settings → Secrets and variables → Actions → New repository secret
> `NPM_TOKEN` = an npm **Automation** token (npmjs.com → Access Tokens → Generate →
> Automation). Classic publish tokens are enough; granular tokens must include
> publish rights on `dsh-publisher-radar`.

Without that secret the npm step is **skipped** (the run is still green) and only the
GitHub Release asset appears. Check the jobs list for `conclusion: skipped`, not the
run colour.

## Every release after that

```sh
npm version <x.y.z> --no-git-tag-version
git add -A && git commit -m "..."
git tag -a v<x.y.z> -m "..."
git push origin main && git push origin v<x.y.z>
```

The asset goes first (the market's critical path), then npm, so a failing publish
fails the run without withholding the release.

## Catalog entry (the market listing)

The market reads `https://awesome-dsh-plugin.com/plugins.json`, generated from the
`awesome-dsh-plugin/awesome-dsh-plugin` repo. Open a PR there adding this plugin's
record; use these values:

```
name        : dsh-publisher-radar
owner       : songrui111
url         : https://github.com/songrui111/dsh-publisher-radar
page        : https://github.com/songrui111/dsh-publisher-radar#readme
category    : tools          ← pick the bucket it belongs in from the catalog's own list
npm         : dsh-publisher-radar
description : 全量浏览 DSH 插件市场：6000+ 个插件可搜可翻可筛，一键复制安装命令；
              另有空位榜、市场走势、竞品查询、自己插件的下载与 Star。
              A browser for the whole DSH plugin market, plus author intelligence.
install     : dsh plugin --profile <profile> add dsh-publisher-radar
```

Rules the listing has to satisfy (all already true here, and asserted by
`test/smoke.mjs` + `radar_checkup`):

- `cordis.patch.yml` exists and its `name:` is **relative** (`./index.js`) — an
  absolute path breaks npm installs while working from a `file:` checkout.
- `package.json` declares `dsh.bundle.patch` and, for a UI plugin, `dsh.client`.
- No install-time lifecycle scripts (`preinstall` / `postinstall`).
- `files` whitelist keeps the tarball small; nothing is read from outside the package.

After the PR merges, the catalog is regenerated upstream; the plugin picks the new
snapshot up on its next cache expiry (6 h) or immediately via **刷新数据**.

## Verify each channel by artifact, not by button colour

```sh
npm view dsh-publisher-radar version          # the published version
curl -sL -o a.tgz https://github.com/songrui111/dsh-publisher-radar/releases/latest/download/dsh-publisher-radar.tgz
tar -xzOf a.tgz package/package.json | grep '"version"'
curl -s https://awesome-dsh-plugin.com/plugins.json | grep -c '"dsh-publisher-radar"'
```

Registry caches lag a publish by minutes and cache inconsistently (packument,
abbreviated packument, dist-tags and the tarball URL each separately), so a 404 right
after publishing is not proof of failure — re-query before concluding.

## Known failure modes

- **A green run with `NPM_TOKEN` absent** skips npm quietly. Check for
  `conclusion: skipped`.
- **The asset name is load-bearing.** The catalog's URL points at
  `dsh-publisher-radar.tgz`; renaming the copy breaks every install from the market.
- **A relative `name:` in `cordis.patch.yml`** is what makes an npm install and a
  `file:` install both resolve.
- **The version is read from `package.json`, not the tag.** `npm version --no-git-tag-version`
  bumps the file; tag the same string or the release asset and npm disagree.
