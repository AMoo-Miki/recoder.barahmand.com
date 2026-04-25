# Development

How to work on Forms Recoder. End-user docs live in [`README.md`](README.md);
test conventions for AI / human contributors live in [`AGENTS.md`](AGENTS.md).

## Repo layout

```
index.html                  app entry
css/index.css               app styles
js/index.js                 app glue (DOM + events)
js/lib/recoder.js           pure recoding logic (UMD; testable in node)
img/                        static assets
tests/                      unit, integration, e2e — see tests/README.md
scripts/build.mjs           dist/ builder (esbuild)
.github/workflows/pages.yml CI: test + build + deploy
AGENTS.md                   conventions for AI / human contributors
```

The split between `js/index.js` and `js/lib/recoder.js` is deliberate:
`recoder.js` is a UMD module containing the pure spreadsheet-recoding
logic with no DOM dependencies — it's importable from node so the unit
suite can hit it directly. `index.js` owns everything DOM (file input,
grid render, pointer events, download) and delegates the pure work to
`RecoderLib`.

## Setup

```sh
npm install
```

Node 20+ is recommended (matches CI). The only runtime dependency in
the live app is the `xlsx` library, loaded via CDN from `index.html` —
the npm `xlsx` dep exists only so node-side tests can build/parse
worksheets.

## Develop

```sh
npm run serve      # http://127.0.0.1:8765 — serves source files directly
```

No build step is needed for local development. `index.html` references
the unminified `js/index.js`, `js/lib/recoder.js`, and `css/index.css`
directly, so edits are picked up on refresh.

## Test

```sh
npm test                # unit + integration; must stay 45 pass | 10 expected fail
npm run test:unit       # just the pure logic
npm run test:integration # just the jsdom DOM tests
npm run test:watch      # vitest in watch mode
npm run test:coverage   # with v8 coverage (text + html in coverage/)
```

E2E tests live under [`tests/e2e/`](tests/e2e/) and are driven through
Playwright MCP — see [`tests/e2e/README.md`](tests/e2e/README.md) for
the injection workflow. E2E is not part of `npm test` because it
requires a live browser session.

The full test strategy and per-layer rationale is in
[`tests/README.md`](tests/README.md). Read [`AGENTS.md`](AGENTS.md)
before changing tests or adding features — the short version: pick the
lowest test layer that proves the contract, no silent skips, and
`BUG:` tests use Vitest's `it.fails()` so the suite stays green while
real bugs are open.

## Build

```sh
npm run build      # writes dist/
npm run serve:dist # smoke-test dist/ on :8765
```

The build script ([`scripts/build.mjs`](scripts/build.mjs)) emits a
deploy-ready `dist/`:

- `dist/index.html` rewritten to reference minified assets
- `dist/css/index.min.css` (esbuild)
- `dist/js/index.min.js` and `dist/js/lib/recoder.min.js` (esbuild)
- `dist/img/`, `dist/CNAME` copied verbatim

`dist/` is gitignored — CI rebuilds it on every push, no need to commit
build output.

## Deploy

Pushes to `main` trigger
[`.github/workflows/pages.yml`](.github/workflows/pages.yml), which:

1. installs deps with `npm ci`,
2. runs `npm test` (CI fails if anything regresses),
3. runs `npm run build`,
4. uploads `dist/` and deploys it to GitHub Pages at
   <https://recoder.barahmand.com>.

### One-time GitHub setup

In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**
(not "Deploy from a branch"). Without this the workflow has nowhere to
publish to.

### Custom domain

The custom domain (`recoder.barahmand.com`) is tracked in the
[`CNAME`](CNAME) file and copied into `dist/` on every build. To change
it, edit `CNAME` and update the DNS record at the domain registrar.

## Contributing

PRs welcome. Please:

- Run `npm test` before pushing; CI will block the deploy otherwise.
- Read [`AGENTS.md`](AGENTS.md) for the test conventions.
- Keep changes minimal — this is a 4-year-old tool that works; refactors
  for their own sake make review harder.
