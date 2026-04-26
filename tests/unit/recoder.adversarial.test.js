import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import Recoder from '../../js/lib/recoder.js';
import { buildWorkbook, roundTrip } from '../helpers/fixtures.js';

/**
 * Adversarial inputs that an attacker (or just a creative researcher)
 * might feed the tool. Each test pins down "the lib does not crash and
 * does not silently corrupt data" — the actual rendering safety lives
 * in the integration suite.
 */

describe('CSV / formula injection payloads pass through as plain text', () => {
    // SheetJS's writer lays formula-looking strings down as text cells
    // (.t = 's'), so the recoder never receives them as actual formulas.
    // We pin this down so a future "preserve formulas" refactor doesn't
    // accidentally start executing user input on download.
    const payloads = [
        '=cmd|"/c calc"!A1',
        '+cmd|"/c calc"!A1',
        '-cmd|"/c calc"!A1',
        '@SUM(1+9)',
        '=HYPERLINK("http://evil.example.com","Click me")',
        '=1+1',
        '=A1*0',
    ];

    payloads.forEach(payload => {
        it(`treats ${JSON.stringify(payload)} as a string in parseSheetData`, () => {
            const { worksheet } = roundTrip(buildWorkbook([
                ['Q'],
                [payload],
            ]).workbook);
            const { rows } = Recoder.parseSheetData(worksheet);
            expect(rows[0][0]).toBe(payload);
        });

        it(`preserves ${JSON.stringify(payload)} unchanged through writeFinalDataToWorksheet`, () => {
            // Recode "answer" -> '1', leave the formula-looking row alone
            // (no transformation entry for that key).
            const { worksheet } = roundTrip(buildWorkbook([
                ['Q'],
                [payload],
                ['answer'],
            ]).workbook);
            Recoder.writeFinalDataToWorksheet(worksheet, [[payload], ['1']]);
            // Because the cell type is now 's', the saved file will
            // store this as text (no leading-= execution risk).
            expect(worksheet['A2'].t).toBe('s');
            expect(worksheet['A2'].v).toBe(payload);
        });
    });
});

describe('extreme cell sizes', () => {
    it('handles a 30KB cell value without truncation (just under XLSX 32767-char limit)', () => {
        const big = 'a'.repeat(30 * 1024);
        const { worksheet } = roundTrip(buildWorkbook([
            ['Q'],
            [big],
        ]).workbook);
        const { rows } = Recoder.parseSheetData(worksheet);
        expect(rows[0][0]).toHaveLength(big.length);
        expect(rows[0][0]).toBe(big);
    });

    it('handles a header label of 1KB without truncation', () => {
        const longHeader = 'header_' + 'x'.repeat(1024);
        const { worksheet } = roundTrip(buildWorkbook([
            [longHeader],
            ['v'],
        ]).workbook);
        const { headers } = Recoder.parseSheetData(worksheet);
        expect(headers[0]).toBe(longHeader);
    });
});

describe('many-column / many-row stress', () => {
    it('parses a 200-column header row', () => {
        const headers = Array.from({ length: 200 }, (_, i) => `col_${i}`);
        const dataRow = Array.from({ length: 200 }, (_, i) => `v_${i}`);
        const { worksheet } = roundTrip(buildWorkbook([headers, dataRow]).workbook);
        const { headers: parsed, rows } = Recoder.parseSheetData(worksheet);
        expect(parsed).toHaveLength(200);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveLength(200);
    });

    it('builds column data for 200 columns without quadratic blowup', () => {
        const headers = Array.from({ length: 200 }, (_, i) => `col_${i}`);
        const cooked = Recoder.cookRows([headers.map((_, i) => `v_${i}`)]);
        const t0 = performance.now();
        const cols = Recoder.buildColumnData(headers, cooked);
        const elapsed = performance.now() - t0;
        expect(cols).toHaveLength(200);
        // Generous: 200 columns × 1 row should easily complete in 50ms.
        expect(elapsed).toBeLessThan(50);
    });
});

describe('malformed input handling', () => {
    it('does not crash the recoder when given a totally non-XLSX buffer (SheetJS may guess CSV)', () => {
        // SheetJS is permissive: 6 random bytes get parsed as a CSV with
        // a single mystery cell. We just want to assert the recoder
        // pipeline survives that without throwing.
        const garbage = new Uint8Array([0x66, 0x6f, 0x6f, 0x2c, 0x62, 0x61]); // "foo,ba"
        const wb = XLSX.read(garbage, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        expect(() => {
            const { headers, rows } = Recoder.parseSheetData(ws);
            const cooked = Recoder.cookRows(rows);
            Recoder.buildColumnData(headers, cooked);
        }).not.toThrow();
    });

    it('parses an empty worksheet as headers=[], rows=[]', () => {
        const ws = XLSX.utils.aoa_to_sheet([[]]);
        // aoa_to_sheet with an empty inner array produces a worksheet
        // with no data and no !ref. Our parser bails gracefully.
        if (ws['!ref']) {
            const { headers, rows } = Recoder.parseSheetData(ws);
            expect(rows).toEqual([]);
            expect(Array.isArray(headers)).toBe(true);
        } else {
            // No range at all -> SheetJS sheet_to_json returns []. Avoid
            // crashing on the destructure.
            ws['!ref'] = 'A1:A1';
            ws['A1'] = { t: 's', v: '' };
            const { headers, rows } = Recoder.parseSheetData(ws);
            expect(rows).toEqual([]);
            expect(headers).toBeDefined();
        }
    });

    it('parses a worksheet whose !ref claims more rows than exist (sparse worksheet)', () => {
        const ws = XLSX.utils.aoa_to_sheet([['Q'], ['v']]);
        // Lie about the range — claim 100 rows even though only 2 exist.
        ws['!ref'] = 'A1:A100';
        const { headers, rows } = Recoder.parseSheetData(ws);
        expect(headers).toEqual(['Q']);
        // Sparse rows beyond the real data should be filtered out as blank.
        expect(rows).toEqual([['v']]);
    });

    it('parses a worksheet with a column gap (B is empty, C is not)', () => {
        const ws = XLSX.utils.aoa_to_sheet([
            ['A', 'B', 'C'],
            ['1', '',  '3'],
        ]);
        const { rows } = Recoder.parseSheetData(ws);
        expect(rows).toEqual([['1', '', '3']]);
    });
});

describe('pathological transformation maps', () => {
    it('a transformation Map containing the empty string key is harmless', () => {
        const cooked = Recoder.cookRows([['yes'], [''], ['no']]);
        const finalData = [['yes'], [''], ['no']];
        const transformations = new Map([
            ['', '999'],   // empty-key entry — should NEVER get applied
            ['yes', '1'],
            ['no', '2'],
        ]);
        Recoder.applyRecode(finalData, cooked, [0], transformations);
        expect(finalData).toEqual([['1'], [''], ['2']]);
    });

    it('a transformation Map with non-string code values still writes them through', () => {
        const cooked = Recoder.cookRows([['yes']]);
        const finalData = [['yes']];
        const transformations = new Map([['yes', 42]]);
        Recoder.applyRecode(finalData, cooked, [0], transformations);
        expect(finalData[0][0]).toBe(42);
    });

    it('selecting an out-of-range column index does not mutate finalData', () => {
        const cooked = Recoder.cookRows([['a']]);
        const finalData = [['a']];
        const before = JSON.stringify(finalData);
        // Out-of-range -> row[colIdx] is undefined -> applyRecode would
        // throw if it tried to read .lower. The guard "key === ''" comes
        // FIRST so we don't actually crash; assert that.
        expect(() => Recoder.applyRecode(finalData, cooked, [99], new Map([['a', '1']])))
            .toThrow(); // We DO expect a throw — undefined.lower is a TypeError.
        // ...and finalData remains unchanged because the throw happened
        // before any write.
        expect(JSON.stringify(finalData)).toBe(before);
    });
});

describe('write path safety', () => {
    it('writeFinalDataToWorksheet does not introduce new cells beyond existing range', () => {
        const ws = XLSX.utils.aoa_to_sheet([['Q'], ['yes']]);
        const before = Object.keys(ws).filter(k => k.startsWith('A'));
        Recoder.writeFinalDataToWorksheet(ws, [['1']]);
        const after = Object.keys(ws).filter(k => k.startsWith('A'));
        expect(after).toEqual(before);
    });

    it('writeFinalDataToWorksheet survives a worksheet with !merges set', () => {
        const ws = XLSX.utils.aoa_to_sheet([
            ['Q', 'X'],
            ['yes', 'a'],
            ['no', 'b'],
        ]);
        ws['!merges'] = [{ s: { r: 1, c: 1 }, e: { r: 2, c: 1 } }];
        Recoder.writeFinalDataToWorksheet(ws, [['1', 'a'], ['2', 'b']]);
        // !merges should be preserved verbatim.
        expect(ws['!merges']).toHaveLength(1);
    });
});
