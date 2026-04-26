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

The suite is layered. Lower layers are fast and run on every commit;
higher layers are slower and reserved for `npm run test:all` / CI.

```sh
npm test                  # vitest: unit + integration (~1s, 90+ tests)
npm run test:unit         # pure logic only
npm run test:integration  # jsdom DOM tests (rendering, a11y, build)
npm run test:watch        # vitest in watch mode
npm run test:coverage     # v8 coverage (text + html in coverage/)

npm run test:property     # fast-check property-based fuzz tests
npm run test:fixtures     # tests against committed real-shape XLSX fixtures
npm run test:adversarial  # CSV-injection, malformed XLSX, extreme sizes
npm run test:perf         # performance budgets (fails on order-of-magnitude regressions)
npm run test:a11y         # axe-core sweep + manual ARIA assertions

npm run test:e2e          # Playwright cross-browser (Chromium + Firefox + WebKit)
npm run test:e2e:chromium # Playwright on Chromium only (faster smoke check)
npm run test:all          # vitest + Playwright; what CI runs
```

Each test layer covers something the others can't:

| Layer        | Where                                  | What it catches                                       |
| ------------ | -------------------------------------- | ----------------------------------------------------- |
| Unit         | `tests/unit/recoder.test.js`           | Pure-logic correctness against hand-written examples  |
| Property     | `tests/unit/recoder.property.test.js`  | Invariants under randomly generated input             |
| Fixtures     | `tests/unit/recoder.fixtures.test.js`  | Real-shape XLSX (Likert, multi-sheet, formulas, 1k×8) |
| Adversarial  | `tests/unit/recoder.adversarial.test.js` | Hostile input: injection, huge cells, malformed bytes |
| Perf         | `tests/unit/recoder.perf.test.js`      | Performance regressions on a 10k-row workbook         |
| Bug regression | `tests/unit/recoder.bugs.test.js`    | Pin known bug fixes against re-introduction           |
| Integration  | `tests/integration/index.dom.test.js`  | DOM rendering, XSS safety, reset / clear flows        |
| Interactions | `tests/integration/index.interactions.test.js` | Drag-multi-select, drop-upload, edit-then-apply |
| Build        | `tests/integration/build.test.js`      | dist/ shape, size budgets, no source maps leaked      |
| A11y         | `tests/integration/index.a11y.test.js` | ARIA, labels, axe-core violations                     |
| E2E (in-page) | `tests/e2e/run.js`                    | Pasteable into the live site for smoke tests          |
| E2E (Playwright) | `tests/e2e/playwright/`            | Cross-browser parity + actual download round-trip     |

Fixtures under [`tests/fixtures/`](tests/fixtures/) are committed
binaries. Regenerate with:

```sh
npm run fixtures:regenerate
```

Read [`AGENTS.md`](AGENTS.md) before changing tests or adding features.
Short version: pick the lowest test layer that proves the contract,
fix bugs and convert their failing tests into regressions, no silent
skips.

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
