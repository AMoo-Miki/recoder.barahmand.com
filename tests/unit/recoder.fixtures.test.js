import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import Recoder from '../../js/lib/recoder.js';

/**
 * Tests that load real-shape XLSX fixtures committed under
 * tests/fixtures/. These exercise the lib against shapes the in-test
 * `buildWorkbook` helper doesn't naturally produce: multi-sheet
 * workbooks, merged headers, formula cells, mixed types, large sheets,
 * international text. Regenerate the fixtures with:
 *
 *   node tests/fixtures/generate.mjs
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '..', 'fixtures');

function loadFixture(name) {
    const buf = readFileSync(resolve(fixturesDir, name));
    const workbook = XLSX.read(buf, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    return { workbook, worksheet };
}

describe('fixture: likert-survey.xlsx', () => {
    const { worksheet } = loadFixture('likert-survey.xlsx');

    it('parses 200 respondents and 6 columns', () => {
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        expect(headers).toHaveLength(6);
        expect(rows).toHaveLength(200);
        expect(headers[0]).toBe('RespondentID');
        expect(headers[1]).toMatch(/^Q1:/);
    });

    it('every Q-column has at most the 5 Likert-scale unique values', () => {
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const cols = Recoder.buildColumnData(headers, cooked);
        for (let i = 1; i < 6; i++) {
            expect(cols[i].values.size).toBeGreaterThan(0);
            expect(cols[i].values.size).toBeLessThanOrEqual(5);
        }
    });

    it('recoding a Q-column produces codes for every non-empty cell', () => {
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const cols = Recoder.buildColumnData(headers, cooked);
        const finalData = rows.map(r => r.slice());
        const merged = Recoder.collectValuesForSelection(cols, [1]);
        const items = Recoder.generateTransformationItems(merged);
        const transformations = new Map(items.map(i => [i.key, i.code]));
        Recoder.applyRecode(finalData, cooked, [1], transformations);
        // Every cell in the recoded column should now be a 1..N digit string.
        finalData.forEach(r => {
            expect(r[1]).toMatch(/^\d+$/);
        });
    });
});

describe('fixture: multi-sheet.xlsx', () => {
    it('reads only the first sheet (PrimaryData), ignoring Notes / IGNORED', () => {
        const { worksheet } = loadFixture('multi-sheet.xlsx');
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        expect(headers).toEqual(['Color', 'Size']);
        expect(rows).toEqual([
            ['red', 'S'],
            ['blue', 'M'],
            ['green', 'L'],
        ]);
    });
});

describe('fixture: merged-header.xlsx', () => {
    it('parses merged-cell headers without crashing (the merge cell becomes empty in the AOA)', () => {
        const { worksheet } = loadFixture('merged-header.xlsx');
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        expect(headers).toHaveLength(3);
        expect(headers[0]).toBe('Category');
        expect(rows).toHaveLength(3);
    });
});

describe('fixture: formulas.xlsx', () => {
    it('uses cached formula results, not the raw "=A2+B2" formula text', () => {
        const { worksheet } = loadFixture('formulas.xlsx');
        const { rows } = Recoder.parseSheetData(worksheet);
        // Sum column should be 3 and 7 (the cached .v values), not the
        // formula strings.
        expect(rows.map(r => r[2])).toEqual(['3', '7']);
        expect(rows.flat().every(c => !c.startsWith('='))).toBe(true);
    });
});

describe('fixture: large-1000-rows.xlsx', () => {
    const { worksheet } = loadFixture('large-1000-rows.xlsx');

    it('parses 1000 rows × 8 columns', () => {
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        expect(headers).toHaveLength(8);
        expect(rows).toHaveLength(1000);
    });

    it('Likert columns each have at most 5 unique values', () => {
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const cols = Recoder.buildColumnData(headers, cooked);
        ['Q1', 'Q2', 'Q3', 'Q4'].forEach(label => {
            const col = cols.find(c => c.label === label);
            expect(col).toBeDefined();
            expect(col.values.size).toBeLessThanOrEqual(5);
        });
    });

    it('recodes the union of all 4 Q columns into a stable codebook', () => {
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const cols = Recoder.buildColumnData(headers, cooked);
        const qIndices = ['Q1', 'Q2', 'Q3', 'Q4'].map(l => cols.find(c => c.label === l).idx);
        const merged = Recoder.collectValuesForSelection(cols, qIndices);
        const items = Recoder.generateTransformationItems(merged);
        // 5 Likert choices; should match exactly.
        expect(items).toHaveLength(5);
        // The cookbook applied across all 4 columns must produce identical
        // codes for the same answer, regardless of which column it appeared in.
        const transformations = new Map(items.map(i => [i.key, i.code]));
        const finalData = rows.map(r => r.slice());
        Recoder.applyRecode(finalData, cooked, qIndices, transformations);
        const lookup = new Map(items.map(i => [i.label.toLowerCase(), i.code]));
        for (let r = 0; r < 50; r++) {
            qIndices.forEach(c => {
                const original = (rows[r][c] || '').toLowerCase();
                if (original) expect(finalData[r][c]).toBe(lookup.get(original));
            });
        }
    });
});

describe('fixture: mixed-types.xlsx', () => {
    it('formats numbers and booleans as strings, drops the blank row, trims whitespace', () => {
        const { worksheet } = loadFixture('mixed-types.xlsx');
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        expect(headers).toEqual(['Age']);
        // Original data rows: [25, 'twenty-six', 27.5, 'unknown', true, '', '25 ']
        // After drop-blank + trim:
        expect(rows.flat()).toEqual(['25', 'twenty-six', '27.5', 'unknown', 'TRUE', '25']);
    });

    it('builds 5 unique values (the two "25" cells collapse via the lower-case key)', () => {
        const { worksheet } = loadFixture('mixed-types.xlsx');
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const cols = Recoder.buildColumnData(headers, cooked);
        expect(cols[0].values.size).toBe(5);
    });
});

describe('fixture: international.xlsx', () => {
    const { worksheet } = loadFixture('international.xlsx');

    it('preserves all Unicode characters byte-for-byte through the parser', () => {
        const { rows } = Recoder.parseSheetData(worksheet);
        const flat = rows.map(r => r[0]);
        expect(flat).toContain('İstanbul');
        expect(flat).toContain('Köln');
        expect(flat).toContain('北京');
        expect(flat).toContain('القاهرة');
        expect(flat).toContain('São Paulo');
        expect(flat).toContain('🍎🍊🍋');
        expect(flat).toContain('Café');
    });

    it('collapses NFC ("Café") and NFD ("Cafe\\u0301") to a single key via NFC normalisation', () => {
        // cookRows normalises every cell to NFC before lowercasing, so
        // visually identical strings entered on different keyboards (or
        // exported by different tools) get assigned the same code.
        const { rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const cols = Recoder.buildColumnData(['City'], cooked);
        const keys = Array.from(cols[0].values.keys());
        expect(keys.includes('café')).toBe(true);
        expect(keys.includes('cafe\u0301')).toBe(false);

        // The two source rows ('Café' NFC and 'Cafe\u0301' NFD) should
        // produce a SINGLE entry in the values Map.
        const cafeEntries = keys.filter(k => k.startsWith('caf'));
        expect(cafeEntries).toEqual(['café']);
    });

    it('recoding the City column gives NFC and NFD spellings the same code', () => {
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const cols = Recoder.buildColumnData(headers, cooked);
        const merged = Recoder.collectValuesForSelection(cols, [0]);
        const items = Recoder.generateTransformationItems(merged);
        const transformations = new Map(items.map(i => [i.key, i.code]));
        const finalData = rows.map(r => r.slice());
        Recoder.applyRecode(finalData, cooked, [0], transformations);

        // Find the row indices for the precomposed and decomposed forms.
        const flat = rows.map(r => r[0]);
        const nfcIdx = flat.indexOf('Café');
        const nfdIdx = flat.indexOf('Cafe\u0301');
        expect(nfcIdx).toBeGreaterThan(-1);
        expect(nfdIdx).toBeGreaterThan(-1);
        expect(finalData[nfcIdx][0]).toBe(finalData[nfdIdx][0]);
    });
});
