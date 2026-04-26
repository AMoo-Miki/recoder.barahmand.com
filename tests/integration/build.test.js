import { describe, it, beforeAll, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import vm from 'node:vm';

/**
 * Build pipeline integration tests. We actually run scripts/build.mjs
 * once for the whole suite and then assert dist/ has the right shape,
 * size budgets, and that the minified code is functionally equivalent
 * to the source.
 *
 * Size budgets are sticky — if you bump them you should know why.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const dist = join(root, 'dist');

// Size budgets in KB. Generous so a small future feature isn't blocked
// by the budget itself, but tight enough to catch a "left source maps
// in" or "imported all of lodash" mistake.
const BUDGETS_KB = {
    'index.html': 5,
    'css/index.min.css': 20,
    'js/index.min.js': 10,
    'js/lib/recoder.min.js': 5,
};

beforeAll(() => {
    execSync('node scripts/build.mjs', { cwd: root, stdio: 'pipe' });
}, 60_000);

describe('build pipeline: dist/ shape', () => {
    it('emits all expected files', () => {
        for (const rel of Object.keys(BUDGETS_KB)) {
            expect(existsSync(join(dist, rel)), `missing ${rel}`).toBe(true);
        }
    });

    it('copies static img/ folder verbatim', () => {
        const distImg = join(dist, 'img');
        expect(existsSync(distImg)).toBe(true);
        const sourceFiles = readdirSync(join(root, 'img'));
        const distFiles = readdirSync(distImg);
        sourceFiles.forEach(f => expect(distFiles).toContain(f));
    });

    it('does NOT include any source maps in dist/', () => {
        function walk(dir) {
            const out = [];
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                if (entry.isDirectory()) out.push(...walk(full));
                else out.push(full);
            }
            return out;
        }
        const all = walk(dist);
        const maps = all.filter(p => p.endsWith('.map'));
        expect(maps).toEqual([]);
    });

    it('does NOT include any test fixtures, tests, or node_modules in dist/', () => {
        expect(existsSync(join(dist, 'tests'))).toBe(false);
        expect(existsSync(join(dist, 'node_modules'))).toBe(false);
        expect(existsSync(join(dist, 'package.json'))).toBe(false);
    });
});

describe('build pipeline: size budgets', () => {
    Object.entries(BUDGETS_KB).forEach(([rel, kbBudget]) => {
        it(`${rel} stays under ${kbBudget} KB`, () => {
            const sizeKB = statSync(join(dist, rel)).size / 1024;
            expect(sizeKB).toBeLessThan(kbBudget);
        });
    });
});

describe('build pipeline: HTML rewriting', () => {
    const html = () => readFileSync(join(dist, 'index.html'), 'utf8');

    it('references the minified css and js bundles, not the originals', () => {
        const text = html();
        expect(text).toContain('css/index.min.css');
        expect(text).toContain('js/index.min.js');
        expect(text).toContain('js/lib/recoder.min.js');
        expect(text).not.toContain('css/index.css"');
        expect(text).not.toContain('js/index.js"');
    });
});

describe('build pipeline: minified output is functionally equivalent to source', () => {
    function loadMinifiedLib() {
        const minSrc = readFileSync(join(dist, 'js/lib/recoder.min.js'), 'utf8');
        // The browser-side recoder gets XLSX via the global script tag,
        // so mirror that: expose XLSX on the sandbox window before
        // evaluating the UMD wrapper.
        const sandbox = { window: { XLSX }, console };
        sandbox.window.window = sandbox.window;
        vm.createContext(sandbox);
        vm.runInContext(`(function(){ ${minSrc} }).call(window);`, sandbox);
        return sandbox.window.RecoderLib;
    }

    it('the minified recoder.min.js exposes the same RecoderLib API as the source', async () => {
        const src = await import('../../js/lib/recoder.js');
        const sourceApi = Object.keys(src.default).sort();
        const minLib = loadMinifiedLib();
        const minApi = Object.keys(minLib || {}).sort();
        expect(minApi).toEqual(sourceApi);
    });

    it('the minified recoder.min.js produces identical recoded output', () => {
        const minLib = loadMinifiedLib();

        const ws = XLSX.utils.aoa_to_sheet([
            ['Q'],
            ['yes'], ['no'], ['yes'], ['maybe'],
        ]);
        const { headers, rows } = minLib.parseSheetData(ws);
        const cooked = minLib.cookRows(rows);
        const cols = minLib.buildColumnData(headers, cooked);
        const merged = minLib.collectValuesForSelection(cols, [0]);
        const items = minLib.generateTransformationItems(merged);
        const transformations = new Map(items.map(i => [i.key, i.code]));
        const finalData = rows.map(r => r.slice());
        minLib.applyRecode(finalData, cooked, [0], transformations);

        // Sorted alphabetically: maybe=1, no=2, yes=3.
        expect(finalData).toEqual([['3'], ['2'], ['3'], ['1']]);
    });
});
