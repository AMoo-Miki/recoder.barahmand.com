// Browser-side e2e test runner for Forms Recoder. Drop this script into
// the live page (e.g. via Playwright `evaluate`) and call
// `await window.__runTests()`. Returns { total, passed, failedCount, failed }.
//
// All assertions read the real DOM and drive the app via the same events
// real users dispatch (change / pointerdown / pointerup / click / drop).
// Spreadsheet fixtures are generated in-browser using the bundled XLSX
// library (already loaded by index.html), so no external files needed.
//
// Mirrors the pattern used in ../image-resizer/test/run.js. See
// tests/e2e/README.md for how to inject and run this against a live
// dev server.

window.__runTests = async function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const pass = (name) => results.push({ name, ok: true });
  const fail = (name, info) => results.push({ name, ok: false, ...info });

  function eq(name, got, want) {
    if (Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want)) pass(name);
    else fail(name, { msg: 'mismatch', got, want });
  }
  function truthy(name, got) { got ? pass(name) : fail(name, { msg: 'expected truthy', got }); }
  function falsy(name, got)  { !got ? pass(name) : fail(name, { msg: 'expected falsy', got }); }
  function deepEq(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) pass(name);
    else fail(name, { msg: 'deep mismatch', got, want });
  }

  // ----------------------- helpers -----------------------------------
  // Build an xlsx ArrayBuffer from a 2D array of strings/numbers/booleans.
  function makeXlsxBuffer(aoa, sheetName = 'Sheet1') {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  // Drive the same code path the user takes when picking a file. The
  // app wraps loadFile in a setTimeout(..., 1000), so we wait for the
  // 'file-loading' class to come and go before returning.
  async function loadXlsx(aoa, name = 'test.xlsx') {
    const buf = makeXlsxBuffer(aoa);
    const file = new File([buf], name, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = $('#srcFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // Wait for 'file-loading' to appear (set synchronously) and then
    // disappear (after the 1s timeout + render).
    await waitFor(() => document.body.classList.contains('file-loading'), 200);
    await waitFor(() => !document.body.classList.contains('file-loading'), 4000);
    // Render is sync after loadFile resolves; one extra paint for raF.
    await sleep(40);
  }

  async function waitFor(predicate, timeoutMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { if (predicate()) return true; } catch {}
      await sleep(20);
    }
    return false;
  }

  function readState() {
    const excel = $('.excel');
    return {
      excelClasses: Array.from(excel.classList),
      headers: $$('.excel abbr.header').map(el => ({
        text: el.textContent,
        idx: el.dataset.idx,
        selected: el.classList.contains('selected'),
      })),
      cells: $$('.excel abbr:not(.header)').map(el => el.textContent),
      transformations: $$('#transformations input[type="number"]').map(el => ({
        name: el.getAttribute('name'),
        value: el.value,
        label: el.nextElementSibling ? el.nextElementSibling.textContent : null,
      })),
      selectedColsList: $$('#selectedCols a').map(el => el.textContent),
      hiddenCols: ($('#transformations input[name="cols"]') || {}).value || '',
      bodyClasses: Array.from(document.body.classList),
    };
  }

  // Click a column header (pointerdown only — pointerup with the same
  // colIdx + wasColumnSelected=true would deselect it).
  function selectColumnByIdx(idx) {
    const header = $(`.excel abbr.header[data-idx="${idx}"]`);
    header.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  }

  function clickApply() {
    $('#apply-transformation').dispatchEvent(new Event('click', { bubbles: true }));
  }

  function clickReset() {
    $('#reset').dispatchEvent(new Event('click', { bubbles: true }));
  }

  // Set a transformation input to a custom code (simulates the user
  // editing the auto-generated 1..N).
  function setCode(name, value) {
    const input = $(`#transformations input[type="number"][name="${name}"]`);
    if (!input) throw new Error(`no transformation input for "${name}"`);
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ============================================================
  // A. Initial state. Force a Reset first so the suite is idempotent
  //    when re-run inside the same page session.
  // ============================================================
  if ($('#reset')) clickReset();
  await sleep(20);
  {
    const s = readState();
    truthy('A1 .excel starts in blank mode', s.excelClasses.includes('blank'));
    eq    ('A1 no headers rendered yet', s.headers.length, 0);
  }

  // ============================================================
  // B. Load a string-only sheet
  // ============================================================
  await loadXlsx([
    ['Name', 'Color'],
    ['Alice', 'red'],
    ['Bob', 'blue'],
    ['Cara', 'red'],
  ]);
  {
    const s = readState();
    truthy('B1 file-selected applied', s.bodyClasses.includes('file-selected'));
    deepEq('B1 headers rendered',
      s.headers.map(h => h.text), ['Name', 'Color']);
    deepEq('B1 cells rendered in row order',
      s.cells, ['Alice', 'red', 'Bob', 'blue', 'Cara', 'red']);
    truthy('B1 .excel grid class set',
      s.excelClasses.some(c => c.startsWith('cols-')));
  }

  // ============================================================
  // C. Load a sheet mixing strings, numbers, and booleans
  // ============================================================
  clickReset();
  await loadXlsx([
    ['Name', 'Score', 'Pass'],
    ['Alice', 95, true],
    ['Bob', 70, false],
    ['Cara', 95, true],
  ]);
  {
    const s = readState();
    deepEq('C1 numeric cells formatted as strings',
      s.cells, ['Alice', '95', 'TRUE', 'Bob', '70', 'FALSE', 'Cara', '95', 'TRUE']);
  }

  // ============================================================
  // D. Select a column → transformation form appears with sorted codes
  // ============================================================
  clickReset();
  await loadXlsx([
    ['Color'],
    ['red'],
    ['blue'],
    ['red'],
    ['green'],
  ]);
  selectColumnByIdx(0);
  await sleep(40);
  {
    const s = readState();
    truthy('D1 header marked selected',
      s.headers[0].selected === true);
    deepEq('D1 transformation inputs sorted alphabetically',
      s.transformations.map(t => t.name),
      ['blue', 'green', 'red']);
    deepEq('D1 default codes are 1..N',
      s.transformations.map(t => t.value),
      ['1', '2', '3']);
    deepEq('D1 selected columns sidebar lists the column',
      s.selectedColsList, ['Color']);
    eq    ('D1 hidden cols input tracks selection', s.hiddenCols, '0');
  }

  // ============================================================
  // E. Apply default transformation → cells in column show codes
  // ============================================================
  clickApply();
  await sleep(40);
  {
    const s = readState();
    deepEq('E1 cells replaced with codes after apply',
      s.cells, ['3', '1', '3', '2']);
  }

  // ============================================================
  // F. Edit a code, re-apply → cells reflect the user-edited code
  // ============================================================
  setCode('blue', 99);
  clickApply();
  await sleep(40);
  {
    const s = readState();
    deepEq('F1 user-edited code propagates to cells',
      s.cells, ['3', '99', '3', '2']);
  }

  // ============================================================
  // G. Multi-column selection unifies the codes across columns
  // ============================================================
  clickReset();
  await loadXlsx([
    ['Q1', 'Q2'],
    ['low', 'high'],
    ['high', 'medium'],
    ['medium', 'low'],
  ]);
  selectColumnByIdx(0);
  selectColumnByIdx(1);
  await sleep(40);
  {
    const s = readState();
    eq    ('G1 both headers selected', s.headers.filter(h => h.selected).length, 2);
    // Sorted unique values across the union: high, low, medium.
    deepEq('G1 unified transformation list is sorted union',
      s.transformations.map(t => t.name),
      ['high', 'low', 'medium']);
  }

  // ============================================================
  // H. Reset returns to blank state
  // ============================================================
  clickReset();
  {
    const s = readState();
    truthy('H1 .excel back to blank', s.excelClasses.includes('blank'));
    eq    ('H1 no headers', s.headers.length, 0);
    falsy ('H1 file-selected cleared', s.bodyClasses.includes('file-selected'));
    // Reset clears the grid but the transformations form is never
    // touched, so any previous codes survive across files. Bug.
    eq    ('H2 BUG: transformations form cleared on Reset',
      s.transformations.length, 0);
    eq    ('H2 BUG: selected-columns sidebar cleared on Reset',
      s.selectedColsList.length, 0);
  }

  // ============================================================
  // I. Empty cells survive recoding (renderer-level check).
  //    NOTE: at the data layer the cell becomes literal `undefined`
  //    (see recoder.bugs.test.js); the renderer's `?? ''` masks it,
  //    so users do not see the bug. We pin both layers down so a
  //    future renderer refactor doesn't expose it.
  // ============================================================
  clickReset();
  await loadXlsx([
    ['Color'],
    ['red'],
    [''],
    ['blue'],
  ]);
  selectColumnByIdx(0);
  await sleep(40);
  clickApply();
  await sleep(40);
  {
    const s = readState();
    // Sorted: blue=1, red=2. Middle row was empty.
    eq('I1 empty cell renders as empty string after recode',
      s.cells[1], '');
    eq('I1 non-empty cells get codes',
      [s.cells[0], s.cells[2]], ['2', '1']);
  }

  // ============================================================
  // J. HTML in header is rendered as TEXT, not markup (XSS check)
  // ============================================================
  clickReset();
  await loadXlsx([
    ['<img src=x onerror="window.__pwned_e2e=true">'],
    ['a'],
  ]);
  await sleep(50);
  {
    const injected = $('.excel abbr.header img');
    truthy('J1 BUG: header HTML not interpreted as markup', injected === null);
    falsy ('J1 BUG: header onerror did not fire', !!window.__pwned_e2e);
  }

  // ============================================================
  // K. HTML in cell is rendered as TEXT, not markup
  // ============================================================
  clickReset();
  await loadXlsx([
    ['c'],
    ['<b>bold</b>'],
  ]);
  await sleep(50);
  {
    const cell = $('.excel abbr:not(.header)');
    truthy('K1 BUG: cell HTML not interpreted as markup',
      cell && cell.querySelector('b') === null);
    eq    ('K1 BUG: cell text content matches literal',
      cell && cell.textContent, '<b>bold</b>');
  }

  // ============================================================
  // L. Blank rows in the source survive parsing (matches blankrows bug)
  // ============================================================
  clickReset();
  await loadXlsx([
    ['Q'],
    ['x'],
    [''],
    ['y'],
  ]);
  {
    const s = readState();
    // Today: cells = ['x', '', 'y']. After fix: cells = ['x', 'y'].
    truthy('L1 BUG: blank rows are dropped from preview',
      s.cells.length === 2 && s.cells[0] === 'x' && s.cells[1] === 'y');
  }

  // ============================================================
  // M. Re-apply with new selection should not silently re-number prior cols
  // ============================================================
  clickReset();
  await loadXlsx([
    ['A', 'B'],
    ['yes', 'maybe'],
    ['no', 'maybe'],
  ]);
  selectColumnByIdx(0);
  await sleep(40);
  clickApply();
  await sleep(40);
  const colAFirst = readState().cells.filter((_, i) => i % 2 === 0);
  selectColumnByIdx(1);
  await sleep(40);
  clickApply();
  await sleep(40);
  const colASecond = readState().cells.filter((_, i) => i % 2 === 0);
  truthy('M1 BUG: column A codes stable across selection-add + re-apply',
    JSON.stringify(colAFirst) === JSON.stringify(colASecond));

  // ============================================================
  // N. Pointer interaction: click + click-again deselects
  // ============================================================
  clickReset();
  await loadXlsx([
    ['Color'],
    ['red'],
  ]);
  {
    const header = $('.excel abbr.header[data-idx="0"]');
    // First press + release on the same cell selects (pointerdown selects;
    // pointerup with wasColumnSelected=false leaves it selected).
    header.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    // Workaround: the pointerup listener checks e.target.closest('abbr')
    // which is null for a document-bubbled event, so we dispatch on the
    // header itself.
    header.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await sleep(20);
    eq('N1 column selected after click', readState().headers[0].selected, true);

    // Second press: wasColumnSelected becomes true; release deselects.
    header.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    header.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await sleep(20);
    eq('N2 column deselected after second click', readState().headers[0].selected, false);
  }

  // ============================================================
  // O. Clear-all unselects every column
  // ============================================================
  clickReset();
  await loadXlsx([
    ['A', 'B', 'C'],
    ['x', 'y', 'z'],
  ]);
  selectColumnByIdx(0);
  selectColumnByIdx(1);
  selectColumnByIdx(2);
  await sleep(40);
  $('#clear-cols').dispatchEvent(new Event('click', { bubbles: true }));
  await sleep(40);
  {
    const s = readState();
    eq('O1 no headers selected after clear', s.headers.filter(h => h.selected).length, 0);
    // updateSelections() only refreshes the form when there are still
    // selected columns, so unselecting everything leaves the previous
    // form (and its hidden cols field) in place. Bug.
    eq('O2 BUG: transformations form cleared by Unselect-all',
      s.transformations.length, 0);
  }

  // ----------------- summary ---------------------------------
  const failed = results.filter(r => !r.ok);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failedCount: failed.length,
    failed,
  };
};
