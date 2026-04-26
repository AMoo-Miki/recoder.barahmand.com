// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { buildWorkbook } from '../helpers/fixtures.js';

/**
 * Deeper UI interaction tests. The base index.dom.test.js suite
 * exercises rendering, single-column selection, reset, and XSS safety.
 * This file goes after richer flows:
 *
 *   - drag-multi-select across two columns
 *   - drop-to-upload (DataTransfer-based file injection)
 *   - editing a code, applying, and asserting the grid updates
 *   - selecting a second column preserves codes for the first
 *   - clicking an already-selected column twice (toggle off) restores
 *     the no-selections empty state
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const indexHtml = readFileSync(resolve(repoRoot, 'index.html'), 'utf8');

function bodyMarkupFromIndexHtml() {
    const start = indexHtml.indexOf('<body>');
    const end = indexHtml.indexOf('</body>');
    const body = indexHtml.slice(start + '<body>'.length, end);
    return body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

// index.js attaches a `pointerup` listener to `document` at module
// scope. jsdom keeps the same `document` instance across tests, so
// every fresh import leaks another listener that still holds a
// reference to the previous test's `excelDiv`. Track and remove them
// per boot.
let trackedDocListeners = [];
const realDocAddListener = document.addEventListener.bind(document);

async function bootApp() {
    trackedDocListeners.forEach(({ type, fn }) => document.removeEventListener(type, fn));
    trackedDocListeners = [];
    document.addEventListener = (type, fn, opts) => {
        trackedDocListeners.push({ type, fn });
        return realDocAddListener(type, fn, opts);
    };

    document.body.innerHTML = bodyMarkupFromIndexHtml();
    // The XLSX import is a frozen ESM namespace, but several tests need
    // to stub methods (e.g. writeFile, read) — wrap in a shallow copy
    // that's mutable.
    const xlsxWrap = Object.assign({}, XLSX);
    globalThis.XLSX = xlsxWrap;
    window.XLSX = xlsxWrap;
    const RecoderLib = (await import('../../js/lib/recoder.js')).default;
    globalThis.RecoderLib = RecoderLib;
    window.RecoderLib = RecoderLib;
    window.requestAnimationFrame = (cb) => { cb(); return 0; };
    window.cancelAnimationFrame = () => {};
    vi.resetModules();
    await import('../../js/index.js');
}

async function loadWorkbook(aoa) {
    const { workbook } = buildWorkbook(aoa);
    const buf = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([buf], 'test.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const input = document.querySelector('#srcFile');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    vi.useFakeTimers();
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1100);
    vi.useRealTimers();
    await new Promise(r => setTimeout(r, 0));
}

beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
});

// pointerup-on-document safety ----------------------------------------

describe('pointerup safety', () => {
    it('releasing the pointer on the document itself does not crash', async () => {
        // Regression: the document pointerup handler used to call
        // e.target.closest('abbr') unconditionally, which throws when
        // the target is the Document node. We now guard the call.
        await bootApp();
        await loadWorkbook([['Color'], ['red'], ['blue']]);
        const header = document.querySelector('.excel abbr.header[data-idx="0"]');
        header.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        // No try/catch — if the handler throws, vitest fails this test.
        document.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
        // The column should still be selected (the document pointerup
        // bails because the document isn't an abbr).
        expect(document.querySelector('.excel abbr.header[data-idx="0"].selected'))
            .not.toBeNull();
    });
});

// drag-multi-select ----------------------------------------------------

describe('drag-multi-select', () => {
    it('drag from column 0 to column N works (regression: !isPointerPressed treated 0 as falsy)', async () => {
        // Discovered while writing this suite: the pointerDragged
        // handler used `if (!isPointerPressed)` to bail out, but
        // isPointerPressed holds the colIdx (0-based) of the pressed
        // column, so dragging from the first column silently broke. Now
        // the check is `=== false`. Pinning it down so it stays fixed.
        await bootApp();
        await loadWorkbook([
            ['First', 'Second', 'Third'],
            ['a', 'x', 'p'],
            ['b', 'y', 'q'],
        ]);
        const headerA = document.querySelector('.excel abbr.header[data-idx="0"]');
        const headerC = document.querySelector('.excel abbr.header[data-idx="2"]');
        headerA.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        headerC.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
        document.body.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
        const tags = Array.from(document.querySelectorAll('#selectedCols a')).map(a => a.textContent);
        expect(tags).toContain('First');
        expect(tags).toContain('Third');
    });

    it('dragging the pointer from header A to header B selects both columns', async () => {
        await bootApp();
        await loadWorkbook([
            ['Color', 'Size'],
            ['red', 'S'],
            ['blue', 'M'],
        ]);

        const headerA = document.querySelector('.excel abbr.header[data-idx="0"]');
        const headerB = document.querySelector('.excel abbr.header[data-idx="1"]');

        // Press on header A — that selects col 0 and arms drag mode.
        headerA.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        // Drag over header B — pointerover triggers selectColumn for col 1.
        headerB.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
        // Release outside the grid (on body, not on a header) so we
        // don't toggle off A.
        document.body.dispatchEvent(new window.Event('pointerup', { bubbles: true }));

        const tags = Array.from(document.querySelectorAll('#selectedCols a')).map(a => a.textContent);
        expect(tags).toEqual(['Color', 'Size']);

        const inputs = document.querySelectorAll('#transformations input[type="number"]');
        // Union of {red,blue,S,M} sorted case-insensitively: blue, M, red, S.
        expect(Array.from(inputs).map(i => i.getAttribute('name'))).toEqual([
            'blue', 'm', 'red', 's',
        ]);
    });
});

// drop-to-upload -------------------------------------------------------

describe('drop-to-upload', () => {
    it('dropping a file on the .excel area loads the workbook (no input.change required)', async () => {
        await bootApp();

        const { workbook } = buildWorkbook([['Color'], ['red'], ['blue']]);
        const buf = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
        const file = new File([buf], 'dropped.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        // jsdom doesn't ship a `DataTransfer` constructor; provide a
        // tiny stub that quacks enough like the real thing for the drop
        // handler in index.js (which reads `.files` and assigns it back
        // to the file input — that assignment requires a real FileList,
        // which jsdom doesn't expose either, so we override the input's
        // `files` setter to accept a plain array).
        const dt = { files: [file] };
        const input = document.querySelector('#srcFile');
        Object.defineProperty(input, 'files', { configurable: true, writable: true, value: [] });

        const drop = new window.Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(drop, 'dataTransfer', { value: dt });

        vi.useFakeTimers();
        document.querySelector('.excel').dispatchEvent(drop);
        await vi.advanceTimersByTimeAsync(1100);
        vi.useRealTimers();
        await new Promise(r => setTimeout(r, 0));

        const headers = document.querySelectorAll('.excel abbr.header');
        expect(Array.from(headers).map(el => el.textContent)).toEqual(['Color']);
        const cells = document.querySelectorAll('.excel abbr:not(.header)');
        expect(Array.from(cells).map(el => el.textContent)).toEqual(['red', 'blue']);
        expect(document.body.classList.contains('file-selected')).toBe(true);
    });
});

// edit-then-apply ------------------------------------------------------

describe('edit-then-apply', () => {
    it('changing a code input and clicking Apply updates the rendered cells', async () => {
        await bootApp();
        await loadWorkbook([
            ['Color'],
            ['red'],
            ['blue'],
            ['red'],
        ]);

        document.querySelector('.excel abbr.header[data-idx="0"]')
            .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));

        const inputs = document.querySelectorAll('#transformations input[type="number"]');
        // Sorted: blue=1, red=2.
        const redInput = Array.from(inputs).find(i => i.getAttribute('name') === 'red');
        expect(redInput).toBeDefined();
        redInput.value = '99';

        document.querySelector('#apply-transformation')
            .dispatchEvent(new window.Event('click', { bubbles: true }));

        const dataCells = document.querySelectorAll('.excel abbr:not(.header)');
        expect(Array.from(dataCells).map(el => el.textContent)).toEqual(['99', '1', '99']);
    });
});

// selecting a second column preserves the first column's user edits ----

describe('code-stability across multi-select', () => {
    it('selecting a second column does NOT renumber the first column\'s codes', async () => {
        await bootApp();
        await loadWorkbook([
            ['A', 'B'],
            ['yes', 'on'],
            ['no',  'off'],
        ]);

        // Select column A.
        const headerA = document.querySelector('.excel abbr.header[data-idx="0"]');
        headerA.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        // User edits the code: no -> 50, yes -> 51.
        const inputs1 = document.querySelectorAll('#transformations input[type="number"]');
        const noInput = Array.from(inputs1).find(i => i.getAttribute('name') === 'no');
        const yesInput = Array.from(inputs1).find(i => i.getAttribute('name') === 'yes');
        noInput.value = '50';
        yesInput.value = '51';

        // Now also select column B (drag from A to B).
        const headerB = document.querySelector('.excel abbr.header[data-idx="1"]');
        headerB.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
        document.body.dispatchEvent(new window.Event('pointerup', { bubbles: true }));

        const inputs2 = document.querySelectorAll('#transformations input[type="number"]');
        const map = Object.fromEntries(
            Array.from(inputs2).map(i => [i.getAttribute('name'), i.value]),
        );
        // yes/no should keep their user-assigned codes.
        expect(map.no).toBe('50');
        expect(map.yes).toBe('51');
        // on/off are new keys; they should get fresh sequential codes.
        expect(map.on).toMatch(/^\d+$/);
        expect(map.off).toMatch(/^\d+$/);
        // No two codes should collide.
        const codes = Object.values(map);
        expect(new Set(codes).size).toBe(codes.length);
    });
});

// toggle off a selected column -----------------------------------------

describe('toggle-off-last-column', () => {
    it('clicking the only-selected column twice clears the form', async () => {
        await bootApp();
        await loadWorkbook([['Color'], ['red'], ['blue']]);

        const header = document.querySelector('.excel abbr.header[data-idx="0"]');
        // First press+release: select.
        header.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        header.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
        expect(document.querySelectorAll('#transformations input[type="number"]').length)
            .toBeGreaterThan(0);

        // Second press+release on the same header: toggle off.
        header.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        header.dispatchEvent(new window.Event('pointerup', { bubbles: true }));

        expect(document.querySelectorAll('#transformations input[type="number"]').length).toBe(0);
        expect(document.querySelectorAll('#selectedCols a').length).toBe(0);
        expect(document.querySelector('.excel').classList.contains('no-selections')).toBe(true);
    });
});

// numeric output -------------------------------------------------------

describe('recoded values are written as numbers, not strings', () => {
    it('saved workbook cells have cell.t === "n" with numeric .v', async () => {
        // Bug: the apply-transformation handler reads input.value (a
        // string) and stores '1', '2', ... in the transformation Map.
        // applyRecode then writes those strings into finalData, and
        // writeFinalDataToWorksheet types them as 's'. Researchers
        // opening the output in SPSS / R / Excel see codes as text,
        // which silently breaks downstream stats. Fix: coerce to
        // Number before applying.
        await bootApp();
        await loadWorkbook([['Color'], ['red'], ['blue'], ['red']]);

        const header = document.querySelector('.excel abbr.header[data-idx="0"]');
        header.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        header.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
        // Apply with the default codes (blue=1, red=2).
        document.querySelector('#apply-transformation')
            .dispatchEvent(new window.Event('click', { bubbles: true }));

        // Capture the workbook by spying on XLSX.writeFile (the real
        // implementation tries to write to disk / trigger a browser
        // download, neither of which works in jsdom).
        let captured = null;
        const origWriteFile = window.XLSX.writeFile;
        window.XLSX.writeFile = (wb) => { captured = wb; };
        try {
            document.querySelector('#download')
                .dispatchEvent(new window.Event('click', { bubbles: true }));
        } finally {
            window.XLSX.writeFile = origWriteFile;
        }

        expect(captured).not.toBeNull();
        const ws = captured.Sheets[Object.keys(captured.Sheets)[0]];
        ['A2', 'A3', 'A4'].forEach(addr => {
            expect(ws[addr].t).toBe('n');
            expect(typeof ws[addr].v).toBe('number');
        });
    });
});

// loading-state recovery -----------------------------------------------

describe('corrupt file does not get the UI stuck on the loading spinner', () => {
    it('removes the file-loading class even when XLSX.read throws', async () => {
        // Bug: loadFile awaits XLSX.read with no try/catch. A corrupt
        // upload makes the await reject; the requestAnimationFrame that
        // strips `file-loading` never runs, and the spinner stays
        // forever. Fix: try/finally that always strips the class.
        await bootApp();
        const origRead = window.XLSX.read;
        window.XLSX.read = () => { throw new Error('Bad file format'); };
        // Pre-fix code produces an unhandled rejection out of the
        // setTimeout callback; suppress it so vitest doesn't kill the
        // run while we observe the latent bug.
        const swallow = () => {};
        process.on('unhandledRejection', swallow);
        try {
            const file = new File([new Uint8Array([1, 2, 3])], 'bad.xlsx');
            const input = document.querySelector('#srcFile');
            Object.defineProperty(input, 'files', { value: [file], configurable: true });
            vi.useFakeTimers();
            input.dispatchEvent(new window.Event('change', { bubbles: true }));
            await vi.advanceTimersByTimeAsync(1100);
            vi.useRealTimers();
            // Let any pending microtasks settle.
            await new Promise(r => setTimeout(r, 10));
            expect(document.body.classList.contains('file-loading')).toBe(false);
        } finally {
            window.XLSX.read = origRead;
            process.removeListener('unhandledRejection', swallow);
        }
    });
});

// defensive button clicks ---------------------------------------------

describe('apply / download buttons survive being clicked with no state', () => {
    // jsdom swallows listener exceptions — `dispatchEvent` doesn't
    // rethrow — but it surfaces them as `error` events on window. To
    // actually assert no listener crashed we have to capture those
    // events ourselves.
    function withErrorCapture(fn) {
        const errors = [];
        const onError = (e) => { errors.push(e.error || new Error(e.message)); };
        window.addEventListener('error', onError);
        try { fn(); } finally { window.removeEventListener('error', onError); }
        return errors;
    }

    it('clicking #apply-transformation with no selected column does not throw', async () => {
        // The button is hidden via CSS until a column is selected, but
        // a programmatic click (or a future keyboard wiring) must not
        // crash the app. Pre-fix: querySelector('input[name="cols"]')
        // returned null and `.value` threw.
        await bootApp();
        await loadWorkbook([['Color'], ['red']]);
        const errs = withErrorCapture(() => {
            document.querySelector('#apply-transformation')
                .dispatchEvent(new window.Event('click', { bubbles: true }));
        });
        expect(errs).toEqual([]);
    });

    it('clicking #download with no file loaded does not throw', async () => {
        // Pre-fix: `worksheet`, `workbook`, and `filename` are
        // undefined before any file is loaded; writeFinalDataToWorksheet
        // would dereference them and crash.
        await bootApp();
        const errs = withErrorCapture(() => {
            document.querySelector('#download')
                .dispatchEvent(new window.Event('click', { bubbles: true }));
        });
        expect(errs).toEqual([]);
    });
});

// re-entrancy guard ----------------------------------------------------

describe('file upload re-entrancy guard', () => {
    it('a second file change while the first is loading is ignored', async () => {
        // The 1s setTimeout in fileChanged keeps `file-loading` set
        // while a file is in flight. Dispatching a second change in
        // that window must not start a parallel load — index.js bails
        // early when file-loading is already on the body.
        await bootApp();

        const { workbook: wb1 } = buildWorkbook([['First'], ['a']]);
        const { workbook: wb2 } = buildWorkbook([['Second'], ['b']]);
        const buf1 = XLSX.write(wb1, { type: 'array', bookType: 'xlsx' });
        const buf2 = XLSX.write(wb2, { type: 'array', bookType: 'xlsx' });
        const file1 = new File([buf1], 'first.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const file2 = new File([buf2], 'second.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const input = document.querySelector('#srcFile');
        Object.defineProperty(input, 'files', { configurable: true, writable: true, value: [file1] });

        vi.useFakeTimers();
        // First change: arms the load.
        input.dispatchEvent(new window.Event('change', { bubbles: true }));
        // Swap in file2 and dispatch a second change WHILE file-loading
        // is still set (no timer advance yet).
        Object.defineProperty(input, 'files', { configurable: true, writable: true, value: [file2] });
        expect(document.body.classList.contains('file-loading')).toBe(true);
        input.dispatchEvent(new window.Event('change', { bubbles: true }));
        // Now let the first load complete.
        await vi.advanceTimersByTimeAsync(1100);
        vi.useRealTimers();
        await new Promise(r => setTimeout(r, 0));

        // Grid should show file1's header, not file2's.
        const headers = Array.from(document.querySelectorAll('.excel abbr.header'))
            .map(el => el.textContent);
        expect(headers).toEqual(['First']);
    });
});

// re-loading a different file resets state -----------------------------

describe('re-upload replaces previous workbook state', () => {
    it('loading a new file overwrites grid content from the previous file', async () => {
        await bootApp();
        await loadWorkbook([['Color'], ['red'], ['blue']]);
        expect(document.querySelectorAll('.excel abbr.header').length).toBe(1);

        await loadWorkbook([['Name', 'Age'], ['Alice', '30'], ['Bob', '40']]);

        const headers = document.querySelectorAll('.excel abbr.header');
        expect(Array.from(headers).map(el => el.textContent)).toEqual(['Name', 'Age']);
        const cells = document.querySelectorAll('.excel abbr:not(.header)');
        expect(Array.from(cells).map(el => el.textContent)).toEqual(['Alice', '30', 'Bob', '40']);
    });
});
