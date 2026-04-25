// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { buildWorkbook } from '../helpers/fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

/**
 * Integration tests for js/index.js running under jsdom. These complement
 * the unit suite by exercising the actual DOM wiring: header rendering,
 * column selection clicks, transformation form generation, apply/reset
 * handlers, and crucially, whether user-controlled cell content is
 * escaped before being injected into the page.
 *
 * Each test imports js/index.js fresh (vi.resetModules) into a freshly
 * constructed body so the module-scoped state arrays start empty.
 */

const indexHtml = readFileSync(resolve(repoRoot, 'index.html'), 'utf8');

// Pull just the <body> innerHTML out of index.html so we render the same
// markup the live page does, but skip the external <script> tags (we
// want to be in control of when index.js is loaded).
function bodyMarkupFromIndexHtml() {
    const start = indexHtml.indexOf('<body>');
    const end = indexHtml.indexOf('</body>');
    const body = indexHtml.slice(start + '<body>'.length, end);
    return body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

async function bootApp() {
    document.body.innerHTML = bodyMarkupFromIndexHtml();
    globalThis.XLSX = XLSX;
    window.XLSX = XLSX;
    // The UMD lib detects CJS first; for jsdom we want the browser branch
    // so we install RecoderLib by importing it once for the side effect.
    // Simpler: require it (Vitest resolves CJS) and stash it on window.
    const RecoderLib = (await import('../../js/lib/recoder.js')).default;
    globalThis.RecoderLib = RecoderLib;
    window.RecoderLib = RecoderLib;
    // requestAnimationFrame is implemented by jsdom but its default is
    // a 16ms timeout — flush synchronously so updateSelections takes
    // effect immediately.
    window.requestAnimationFrame = (cb) => { cb(); return 0; };
    window.cancelAnimationFrame = () => {};
    vi.resetModules();
    await import('../../js/index.js');
}

// Drive a "file selected" through the same code path the UI uses, but
// skip the 1s setTimeout in fileChanged() by invoking loadFile via the
// drop handler shortcut: we already have `selectedFile`, dispatch a
// drop event with a synthetic DataTransfer so the app schedules the
// load on the next tick. Easier: just stub setTimeout for this section.
async function loadWorkbook(aoa) {
    const { workbook } = buildWorkbook(aoa);
    const buf = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const file = new File([buf], 'test.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const input = document.querySelector('#srcFile');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    // The app wraps loadFile in setTimeout(..., 1000). Fake timers let
    // us advance immediately, then await the resulting promise chain.
    vi.useFakeTimers();
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1100);
    vi.useRealTimers();
    // Give microtasks a chance to settle (loadFile is async, render is
    // synchronous after it).
    await new Promise(r => setTimeout(r, 0));
}

beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
});

describe('rendering', () => {
    it('renders header cells and data cells from a loaded workbook', async () => {
        await bootApp();
        await loadWorkbook([
            ['Name', 'Color'],
            ['Alice', 'red'],
            ['Bob', 'blue'],
        ]);

        const excel = document.querySelector('.excel');
        const headers = excel.querySelectorAll('abbr.header');
        expect(Array.from(headers).map(el => el.textContent)).toEqual(['Name', 'Color']);

        const cells = excel.querySelectorAll('abbr:not(.header)');
        expect(Array.from(cells).map(el => el.textContent)).toEqual([
            'Alice', 'red', 'Bob', 'blue',
        ]);
    });

    it('selecting a column reveals the transformation form with sorted codes', async () => {
        await bootApp();
        await loadWorkbook([
            ['Color'],
            ['red'],
            ['blue'],
            ['red'],
            ['green'],
        ]);

        const excel = document.querySelector('.excel');
        const colHeader = excel.querySelector('abbr.header[data-idx="0"]');
        // The app uses pointerdown / pointerup on cells; fire both on
        // the header so it gets toggled to selected without the
        // subsequent deselect.
        colHeader.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        // pointerup must NOT match the wasColumnSelected branch, so we
        // just don't fire it (the app handles the selection on
        // pointerdown already).

        const inputs = document.querySelectorAll('#transformations input[type="number"]');
        // Sorted: blue, green, red.
        expect(Array.from(inputs).map(i => i.getAttribute('name'))).toEqual([
            'blue', 'green', 'red',
        ]);
        expect(Array.from(inputs).map(i => i.value)).toEqual(['1', '2', '3']);
    });
});

describe('BUG: HTML in header text is rendered as markup', () => {
    it.fails('does not interpret <img onerror> in a header label', async () => {
        await bootApp();
        await loadWorkbook([
            ['<img src=x onerror="window.__pwned=true">', 'plain'],
            ['a', 'b'],
        ]);

        // If the header was HTML-injected, an <img> tag would now exist
        // in the DOM with the malicious onerror attribute.
        const injectedImg = document.querySelector('.excel abbr.header img');
        expect(injectedImg).toBeNull();
        expect(window.__pwned).toBeUndefined();

        // The header text content should still match the original label.
        const header = document.querySelector('.excel abbr.header[data-idx="0"]');
        expect(header.textContent).toBe('<img src=x onerror="window.__pwned=true">');
    });
});

describe('BUG: HTML in cell values is rendered as markup', () => {
    it.fails('does not interpret <script> tags inside data cells', async () => {
        await bootApp();
        await loadWorkbook([
            ['c'],
            ['<b>bold</b>'],
        ]);

        const dataCells = document.querySelectorAll('.excel abbr:not(.header)');
        expect(dataCells.length).toBe(1);
        // Today the <b> tag is parsed and the cell's textContent is
        // 'bold' (HTML stripped to text). The fix is to render via
        // textContent / escape, so textContent should equal the
        // original literal string.
        expect(dataCells[0].textContent).toBe('<b>bold</b>');
        expect(dataCells[0].querySelector('b')).toBeNull();
    });
});

describe('reset clears the loaded state', () => {
    it('returns the grid to its initial empty state', async () => {
        await bootApp();
        await loadWorkbook([
            ['Color'],
            ['red'],
        ]);
        expect(document.querySelector('.excel abbr.header')).not.toBeNull();

        document.querySelector('#reset').dispatchEvent(new window.Event('click', { bubbles: true }));

        expect(document.querySelector('.excel abbr.header')).toBeNull();
        expect(document.querySelector('.excel.blank')).not.toBeNull();
        expect(document.body.classList.contains('file-selected')).toBe(false);
    });
});

describe('BUG: Reset leaves stale UI behind', () => {
    it.fails('clears the transformations form on Reset', async () => {
        await bootApp();
        await loadWorkbook([['Color'], ['red'], ['blue']]);
        document.querySelector('.excel abbr.header[data-idx="0"]')
            .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        expect(document.querySelectorAll('#transformations input[type="number"]').length)
            .toBeGreaterThan(0);

        document.querySelector('#reset').dispatchEvent(new window.Event('click', { bubbles: true }));

        // Expected: the transformations form is cleared. Today: it
        // stays populated with the previous file's codes.
        expect(document.querySelectorAll('#transformations input[type="number"]').length).toBe(0);
        expect(document.querySelectorAll('#selectedCols a').length).toBe(0);
    });
});

describe('BUG: Unselect-all leaves stale transformations form', () => {
    it.fails('clears the form when the last selected column is removed', async () => {
        await bootApp();
        await loadWorkbook([['Color'], ['red'], ['blue']]);
        document.querySelector('.excel abbr.header[data-idx="0"]')
            .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        expect(document.querySelectorAll('#transformations input[type="number"]').length)
            .toBeGreaterThan(0);

        document.querySelector('#clear-cols')
            .dispatchEvent(new window.Event('click', { bubbles: true }));

        // updateSelections() bails when no columns are selected, so the
        // form retains the previous codes. Bug.
        expect(document.querySelectorAll('#transformations input[type="number"]').length).toBe(0);
    });
});
