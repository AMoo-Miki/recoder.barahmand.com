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
    globalThis.XLSX = XLSX;
    window.XLSX = XLSX;
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
