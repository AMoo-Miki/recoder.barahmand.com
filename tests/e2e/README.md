# E2E tests

`run.js` is a browser-side test runner. It does not run under Vitest — it
runs **inside the live page**, driving the real DOM with the real bundled
`XLSX` library and the real `js/index.js`.

## How it works

1. Serve the app locally.
2. Open it in a Playwright-controlled browser.
3. Inject `run.js` (defines `window.__runTests`).
4. Call `await window.__runTests()` and inspect the returned summary
   `{ total, passed, failedCount, failed }`.

The runner is idempotent: it issues a `Reset` at the start so it can be
re-run inside the same page session without leftover state.

## Running it

### 1. Start the dev server

```sh
npm run serve     # http-server on :8765
```

### 2. Drive the browser via Playwright MCP

Using the `user-playwright` MCP (the default `cursor-ide-browser` MCP does
not expose `browser_evaluate`):

- `browser_navigate` to `http://127.0.0.1:8765/index.html`
- `browser_evaluate` with the contents of `tests/e2e/run.js` (this defines
  `window.__runTests`)
- `browser_evaluate` again with `() => window.__runTests()` to run the
  suite and return its result.

The summary contains a `failed` array; each entry has `{ name, msg, got,
want }` so failures are self-explanatory.

## Test sections

| ID  | What it covers                                                           |
| --- | ------------------------------------------------------------------------ |
| A   | Initial blank state                                                      |
| B   | Load string-only sheet, verify headers + cells render                    |
| C   | Mixed strings/numbers/booleans format as strings                         |
| D   | Column selection produces sorted transformation form                     |
| E   | Apply default codes overwrites cells                                     |
| F   | Edited code propagates to cells                                          |
| G   | Multi-column selection unifies the code list                             |
| H   | Reset clears grid (and exposes the stale-form bug)                       |
| I   | Empty cells render as `''` post-recode                                   |
| J   | **BUG**: header HTML is rendered as markup (XSS)                         |
| K   | **BUG**: cell HTML is rendered as markup (XSS)                           |
| L   | **BUG**: blank rows survive parsing                                      |
| M   | **BUG**: re-applying with new selection re-numbers prior columns         |
| N   | Pointer click + click-again deselects                                    |
| O   | **BUG**: Unselect-all leaves the previous transformations form behind    |

The `BUG:` lines are expected to fail until the underlying issue is fixed.
