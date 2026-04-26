// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import axe from 'axe-core';
import { buildWorkbook } from '../helpers/fixtures.js';

/**
 * Accessibility tests. We run axe-core against the live DOM and ALSO
 * make a few targeted manual assertions for things axe doesn't cover
 * well in jsdom (where layout-dependent rules misfire). Each violation
 * we accept-as-known is documented with a TODO so it can be fixed
 * deliberately rather than slipping in.
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

// Static structure ----------------------------------------------------

describe('a11y: HTML structure', () => {
    beforeEach(async () => {
        await bootApp();
    });

    it('every <button> has accessible non-empty text', () => {
        document.querySelectorAll('button').forEach(btn => {
            const name = btn.textContent.trim() || btn.getAttribute('aria-label') || '';
            expect(name, `button ${btn.outerHTML} has no accessible name`).not.toBe('');
        });
    });

    it('every <input> either has an associated <label>, an aria-label, or a value attribute', () => {
        document.querySelectorAll('input').forEach(input => {
            const id = input.id;
            const label = id ? document.querySelector(`label[for="${id}"]`) : null;
            const wrappingLabel = input.closest('label');
            const ariaLabel = input.getAttribute('aria-label');
            // type=submit gets its accessible name from `value`.
            const value = input.type === 'submit' ? input.value : null;
            const hasName = !!(label || wrappingLabel || ariaLabel || value);
            expect(hasName, `input ${input.outerHTML} has no accessible name`).toBe(true);
        });
    });

    it('the file input is reachable via a <label for=> in the empty state', () => {
        // The hint label inside .excel.blank is what most users click on
        // since the actual <input> is visually positioned in the header.
        // That label uses for="srcFile" and points to the input.
        const input = document.querySelector('#srcFile');
        expect(input).not.toBeNull();
        const blankLabel = document.querySelector('.excel.blank label[for="srcFile"]');
        expect(blankLabel, 'no label[for=srcFile] in the empty-state grid').not.toBeNull();
    });

    it('the page declares its language on <html>', () => {
        // We render only the <body>, but check the source HTML directly.
        expect(indexHtml).toMatch(/<html[^>]*\blang="[a-z-]+"/i);
    });

    it('the page has a <title>', () => {
        expect(indexHtml).toMatch(/<title>[^<]+<\/title>/);
    });
});

// Dynamic structure (after a workbook is loaded) -----------------------

describe('a11y: rendered grid', () => {
    beforeEach(async () => {
        await bootApp();
        await loadWorkbook([
            ['Color', 'Size'],
            ['red', 'S'],
            ['blue', 'M'],
        ]);
    });

    it('every header cell exposes its label as accessible text', () => {
        document.querySelectorAll('.excel abbr.header').forEach(h => {
            expect(h.textContent.trim()).not.toBe('');
            expect(h.title).toBe(h.textContent);
        });
    });

    it('every data cell exposes its value via title attribute (tooltip discoverability)', () => {
        document.querySelectorAll('.excel abbr:not(.header)').forEach(cell => {
            expect(cell.title).toBe(cell.textContent);
        });
    });

    it('the transformations form\'s number inputs each have a sibling <label>', async () => {
        const header = document.querySelector('.excel abbr.header[data-idx="0"]');
        header.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
        const inputs = document.querySelectorAll('#transformations input[type="number"]');
        expect(inputs.length).toBeGreaterThan(0);
        inputs.forEach(input => {
            const wrapper = input.parentElement;
            const label = wrapper.querySelector('label');
            expect(label, `code input "${input.name}" has no <label>`).not.toBeNull();
            expect(label.textContent.trim()).not.toBe('');
        });
    });
});

// axe-core sweep -------------------------------------------------------

describe('a11y: axe-core sweep', () => {
    // Disable rules that are unreliable in jsdom (need layout, color
    // computation, or live region detection). These should be re-enabled
    // when we move the a11y check into Playwright.
    const ruleConfig = {
        'color-contrast': { enabled: false },
        'landmark-one-main': { enabled: false }, // body fragment, no <html>
        'page-has-heading-one': { enabled: false }, // body fragment
        'region': { enabled: false }, // body fragment
        'document-title': { enabled: false }, // we only render the <body>
        'html-has-lang': { enabled: false },
        'html-lang-valid': { enabled: false },
    };

    it('initial empty state has zero serious or critical violations', async () => {
        await bootApp();
        const results = await axe.run(document.body, { rules: ruleConfig });
        const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
        if (serious.length) {
            // Surface the violation summaries to make CI logs useful.
            console.error('axe violations:', serious.map(v => ({ id: v.id, help: v.help, nodes: v.nodes.length })));
        }
        expect(serious).toEqual([]);
    });

    it('loaded grid has zero serious or critical violations', async () => {
        await bootApp();
        await loadWorkbook([
            ['Color'],
            ['red'],
            ['blue'],
        ]);
        const results = await axe.run(document.body, { rules: ruleConfig });
        const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
        if (serious.length) {
            console.error('axe violations:', serious.map(v => ({ id: v.id, help: v.help, nodes: v.nodes.length })));
        }
        expect(serious).toEqual([]);
    });
});
