# Tests

Three layers, each with a clear job.

```
tests/
  helpers/        shared fixtures (XLSX builders) — used by unit + integration
  unit/           pure-logic tests for js/lib/recoder.js (Vitest, node)
  integration/    DOM tests for js/index.js (Vitest, jsdom)
  e2e/            browser-side runner injected into the live app (Playwright)
```

## Unit (`tests/unit/`)

Vitest, node environment. Imports `js/lib/recoder.js` directly and exercises
its pure helpers with hand-built worksheets from `tests/helpers/fixtures.js`.

- `recoder.test.js` — characterization tests that pin down current behaviour.
- `recoder.edge.test.js` — empty/degenerate/non-ASCII inputs and boundaries.
- `recoder.bugs.test.js` — **failing** tests documenting known bugs. Don't
  relax the assertions; fix the code.

```sh
npm run test:unit
```

## Integration (`tests/integration/`)

Vitest, jsdom environment. Boots `js/index.js` against the real `index.html`
body markup and drives the UI through DOM events.

- `index.dom.test.js` — header/cell rendering, column selection, transformation
  form generation, reset, plus failing tests for the HTML-injection (XSS) bugs
  and the stale-form-after-reset/unselect bugs.

```sh
npm run test:integration
```

## End-to-end (`tests/e2e/`)

A browser-side test runner (`run.js`) injected into the live page via
Playwright's `evaluate`. Same shape as `image-resizer/test/run.js`. See
[`tests/e2e/README.md`](e2e/README.md) for the full workflow.

## Helpers (`tests/helpers/`)

- `fixtures.js` — `buildWorkbook(aoa)` and `roundTrip(workbook)` for unit and
  integration tests. The e2e runner has its own inline `makeXlsxBuffer`
  because it has to execute inside the browser.

## Run everything

```sh
npm test            # unit + integration
npm run test:coverage
```

E2E is not part of `npm test` — it requires the dev server and Playwright
MCP. Run it separately as documented in [`tests/e2e/README.md`](e2e/README.md).
