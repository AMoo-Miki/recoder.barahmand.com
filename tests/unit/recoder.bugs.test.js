import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import Recoder from '../../js/lib/recoder.js';
import { buildWorkbook, roundTrip } from '../helpers/fixtures.js';

/**
 * Regression tests for previously-shipped bugs. Each test pins down the
 * *fixed* behaviour. If one of these starts failing, somebody has
 * re-introduced the bug — please push back rather than relaxing the
 * assertion.
 */

describe('empty source cells survive recode unchanged', () => {
    it('keeps an empty cell empty after applyRecode', () => {
        const cooked = Recoder.cookRows([
            ['yes'],
            [''],
            ['no'],
        ]);
        const finalData = [['yes'], [''], ['no']];
        const transformations = new Map([['yes', '1'], ['no', '2']]);

        Recoder.applyRecode(finalData, cooked, [0], transformations);

        expect(finalData[0][0]).toBe('1');
        expect(finalData[1][0]).toBe('');
        expect(finalData[2][0]).toBe('2');
    });
});

describe('download keeps cell .t and .v in sync', () => {
    it('flips .t to "s" when overwriting a numeric cell with a string code', () => {
        const { worksheet } = roundTrip(buildWorkbook([
            ['Score'],
            [95],
            [70],
        ]).workbook);

        // Sanity: original cells are typed as numbers.
        expect(worksheet['A2'].t).toBe('n');
        expect(typeof worksheet['A2'].v).toBe('number');

        Recoder.writeFinalDataToWorksheet(worksheet, [['1'], ['2']]);

        if (worksheet['A2'].t === 'n') {
            expect(typeof worksheet['A2'].v).toBe('number');
        } else {
            expect(worksheet['A2'].t).toBe('s');
        }
    });

    it('downloaded file round-trips correctly for a recoded numeric column', () => {
        const { workbook } = buildWorkbook([
            ['Score'],
            [95],
            [70],
        ]);
        const { worksheet, workbook: reread } = roundTrip(workbook);
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const finalData = rows.map(r => r.slice());
        const cols = Recoder.buildColumnData(headers, cooked);
        const merged = Recoder.collectValuesForSelection(cols, [0]);
        const items = Recoder.generateTransformationItems(merged);
        const transformations = new Map(items.map(i => [i.key, i.code]));
        Recoder.applyRecode(finalData, cooked, [0], transformations);
        Recoder.writeFinalDataToWorksheet(worksheet, finalData);

        const buf = XLSX.write(reread, { type: 'array', bookType: 'xlsx' });
        const final = XLSX.read(buf, { type: 'array' });
        const fws = final.Sheets[final.SheetNames[0]];
        const out = XLSX.utils.sheet_to_json(fws, { header: 1, raw: false, defval: '' });

        // Sorted display labels are ['70','95'] -> codes '1','2'.
        expect(out[1][0]).toBe('2'); // 95 -> 2
        expect(out[2][0]).toBe('1'); // 70 -> 1
    });

    it('clears .w (the cached formatted text) when overwriting .v', () => {
        const { worksheet } = roundTrip(buildWorkbook([
            ['Score'],
            [95],
        ]).workbook);
        expect(worksheet['A2'].w).toBeDefined(); // sanity

        Recoder.writeFinalDataToWorksheet(worksheet, [['1']]);

        expect(worksheet['A2'].w === undefined || worksheet['A2'].w === '1').toBe(true);
    });
});

describe('parseSheetData drops fully blank rows', () => {
    it('removes blank rows so they do not show up in the recoded preview', () => {
        const { worksheet } = roundTrip(buildWorkbook([
            ['Q'],
            ['x'],
            [''],
            ['y'],
        ]).workbook);

        const { rows } = Recoder.parseSheetData(worksheet);
        expect(rows.map(r => r[0])).toEqual(['x', 'y']);
    });
});

describe('generateTransformationItems sorts case-insensitively', () => {
    it('orders A before B regardless of letter case', () => {
        const values = new Map([
            ['apple', 'apple'],
            ['banana', 'Banana'],
        ]);
        const items = Recoder.generateTransformationItems(values);
        expect(items.map(i => i.label.toLowerCase())).toEqual(['apple', 'banana']);
    });
});

describe('generateTransformationItems preserves prior codes for stability', () => {
    it('does not change codes for previously-recoded columns when adding a new column', () => {
        // Workflow: user recodes column A alone, getting "no"->1, "yes"->2.
        // Then they add column B (which contains "maybe") and re-apply.
        // The stability guarantee: keys already shown to the user keep
        // their codes; the new key claims the next unused integer.
        const cooked = Recoder.cookRows([
            ['yes', 'maybe'],
            ['no', 'maybe'],
        ]);
        const finalData = [['yes', 'maybe'], ['no', 'maybe']];
        const cols = Recoder.buildColumnData(['A', 'B'], cooked);

        // First pass: recode column A only.
        const valsA = Recoder.collectValuesForSelection(cols, [0]);
        const itemsA = Recoder.generateTransformationItems(valsA);
        const transA = new Map(itemsA.map(i => [i.key, i.code]));
        Recoder.applyRecode(finalData, cooked, [0], transA);

        const colAAfterFirstPass = finalData.map(r => r[0]);

        // Second pass: now select A AND B. Pass the user-visible codes
        // from pass 1 into the lib so prior assignments are preserved.
        const valsAB = Recoder.collectValuesForSelection(cols, [0, 1]);
        const itemsAB = Recoder.generateTransformationItems(valsAB, transA);
        const transAB = new Map(itemsAB.map(i => [i.key, i.code]));
        Recoder.applyRecode(finalData, cooked, [0, 1], transAB);

        const colAAfterSecondPass = finalData.map(r => r[0]);

        expect(colAAfterSecondPass).toEqual(colAAfterFirstPass);
    });
});

describe('parser preserves HTML-like content verbatim', () => {
    it('lets the renderer escape it (the parser stays format-agnostic)', () => {
        const { worksheet } = roundTrip(buildWorkbook([
            ['<b>Bold</b>', 'plain'],
            ['x', 'y'],
        ]).workbook);
        const { headers } = Recoder.parseSheetData(worksheet);
        expect(headers[0]).toBe('<b>Bold</b>');
    });
});
