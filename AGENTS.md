# AGENTS.md — Testing instructions

These rules apply to **any** code change in this repo. Read them before
writing or modifying tests.

## TL;DR

```sh
npm install              # one time
npm test                 # unit + integration; must pass before you commit
npm run test:unit        # just the pure logic
npm run test:integration # just the jsdom DOM tests
npm run test:coverage    # with v8 coverage (text + html)
npm run serve            # static server on :8765 (live source)
npm run build            # produce dist/ with minified assets
npm run serve:dist       # serve the built dist/ on :8765 (smoke test)
```

CI (`.github/workflows/pages.yml`) runs `npm ci && npm test && npm run
build`, then deploys `dist/` to GitHub Pages on every push to `main`.

E2E lives in `tests/e2e/` and runs in a real browser via Playwright MCP —
see [`tests/e2e/README.md`](tests/e2e/README.md). E2E is **not** part of
`npm test`.

## Directory layout

```
tests/
  helpers/        shared XLSX fixture builders
  unit/           Vitest, node      — js/lib/recoder.js (pure logic)
  integration/    Vitest, jsdom     — js/index.js (DOM wiring)
  e2e/            browser-injected  — live page through Playwright
```

| File pattern                 | Layer        | Env    | Imports                          |
| ---------------------------- | ------------ | ------ | -------------------------------- |
| `tests/unit/*.test.js`       | unit         | node   | `../../js/lib/recoder.js`        |
| `tests/integration/*.test.js`| integration  | jsdom  | `../../js/index.js` + `../../index.html` |
| `tests/e2e/run.js`           | e2e          | browser| globals (`XLSX`, real DOM)       |

`tests/helpers/fixtures.js` exports `buildWorkbook(aoa)` and
`roundTrip(workbook)`. Use these in unit + integration tests instead of
hand-rolling XLSX setup.

## Where to put a new test

Pick the **lowest layer** that proves what you need:

- **Pure function on `RecoderLib`?** → `tests/unit/`.
- **DOM wiring, event handler, render output, escaping, focus, classes?**
  → `tests/integration/` (jsdom).
- **Full user journey across multiple files / drag-and-drop / actual
  download / cross-cutting visual behavior?** → `tests/e2e/run.js`.

Don't write a jsdom test for something that can be a unit test. Don't
write an e2e test for something jsdom can cover.

### Naming

- `tests/unit/<area>.test.js` — characterization & happy-path.
- `tests/unit/<area>.edge.test.js` — empty/degenerate/boundary inputs.
- `tests/unit/<area>.bugs.test.js` — `it.fails()` tests documenting known
  bugs (see rule 6 below).
- `tests/integration/<feature>.dom.test.js` — DOM-level integration.
- Group related assertions inside one `describe(...)`. Prefer one
  behaviour per `it(...)`.

## Test conventions

1. **ESM only.** Every test file uses `import { describe, it, expect } from 'vitest'`.
   Do not introduce CommonJS `require()` in tests.
2. **Use the fixture helpers.** `buildWorkbook(aoa)` + `roundTrip(workbook)`
   from `tests/helpers/fixtures.js`. Round-trip whenever you want to
   exercise the same XLSX read path the app uses.
3. **Test the contract, not the implementation.** Assertions should mirror
   what a user / caller observes (cells, codes, DOM text, classes), not
   the shape of an internal Map.
4. **Preserve native types in fixtures.** When asserting type behaviour,
   feed real numbers (`95`) and booleans (`true`) into `buildWorkbook`,
   not pre-stringified values.
5. **No silent skips.** Don't `.skip` or comment out tests to "make CI
   green". If a test is wrong, fix the test or fix the code; don't
   delete the signal.
6. **`BUG:` tests use `it.fails()`.** Tests in `*.bugs.test.js` and
   integration tests under `describe('BUG: …')` are written with
   `it.fails(...)`. Vitest reports them as **expected fail** so CI stays
   green while the bug is open. When the bug is actually fixed and the
   assertion starts passing, `it.fails()` itself fails — the engineer
   who fixed it must remove `.fails` and (if appropriate) move the test
   out of the bugs suite.
   - **Never** weaken a `BUG:` assertion to make it pass.
   - **Never** add `it.fails()` to a test that already passes today —
     those go in the regular suite.
   - **Never** convert a green test to `it.fails()` to "document" hoped-for
     behaviour. `.fails()` is for *real, reproduced* bugs only.
7. **Add coverage for every code change you make.** If you change a
   function in `js/lib/recoder.js`, the corresponding `recoder*.test.js`
   needs an assertion that would have failed against the old behaviour.

## Workflow before committing

1. Run `npm test`. Confirm: 4 files, 55 tests — **45 passed | 10 expected
   fail**, exit code 0. Any change in that count needs an explanation:
   - Hard failures → you broke something. Fix it or document it.
   - Fewer "expected fail" → either you fixed a bug (great — flip its
     `.fails` off, move it out of `*.bugs.test.js` if appropriate, and
     update this count) or you weakened a `BUG:` assertion (don't).
   - More "expected fail" → you found a new bug; great, but it should be
     a deliberate addition, not an accident.
2. If you touched `js/lib/recoder.js` or `js/index.js`, run
   `npm run test:coverage` and ensure your new lines are exercised.
3. If you touched anything in the live UI flow (`index.html`, `js/index.js`,
   `css/index.css`), also drive the e2e suite per
   [`tests/e2e/README.md`](tests/e2e/README.md) before considering the
   change shippable.

## When tests fail

- Read the failing assertion and the file path. Don't blanket-rerun.
- Reproduce in isolation: `npx vitest run tests/unit/recoder.test.js -t 'name'`.
- For jsdom failures, check `requestAnimationFrame` and the
  `vi.useFakeTimers()` flow in `tests/integration/index.dom.test.js` —
  most flake comes from forgetting to advance the 1s `setTimeout` that
  wraps `loadFile`.

## Don't

- Don't add a second top-level test directory. Everything goes under
  `tests/`.
- Don't put fixtures inline in a test file when an equivalent helper
  exists in `tests/helpers/`.
- Don't `import` from `../js/...` — moved tests use `../../js/...`.
- Don't run e2e against the production site. Always serve locally
  (`npm run serve`) and point the browser at `http://127.0.0.1:8765`.
- Don't commit screenshots, `test-results.json`, or anything under
  `.playwright-mcp/`. They're already gitignored — keep them that way.
