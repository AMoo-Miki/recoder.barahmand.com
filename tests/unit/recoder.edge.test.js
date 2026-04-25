import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import Recoder from '../../js/lib/recoder.js';
import { buildWorkbook, roundTrip } from '../helpers/fixtures.js';

/**
 * Edge-case unit tests for js/lib/recoder.js. These complement the main
 * characterization suite by hitting empty/degenerate inputs, multi-sheet
 * workbooks, non-ASCII text, and boundary conditions on the worksheet
 * range. They also pin down a few behaviours that are easy to break
 * accidentally during refactors.
 */

describe('parseSheetData edge cases', () => {
    it('header-only sheet yields headers and an empty rows array', () => {
        const { worksheet } = roundTrip(buildWorkbook([
            ['Name', 'Color'],
        ]).workbook);
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        expect(headers).toEqual(['Name', 'Color']);
        expect(rows).toEqual([]);
    });

    it('reads only the first sheet (matches what the app does)', () => {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['First'], ['a']]), 'One');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Second'], ['b']]), 'Two');
        const { worksheet } = (() => {
            const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
            const reread = XLSX.read(buf, { type: 'array' });
            return { worksheet: reread.Sheets[reread.SheetNames[0]] };
        })();
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        expect(headers).toEqual(['First']);
        expect(rows).toEqual([['a']]);
    });

    it('trims tabs, newlines, and surrounding whitespace', () => {
        const { worksheet } = roundTrip(buildWorkbook([
            ['h'],
            ['\tword\n'],
            ['  spaced  '],
        ]).workbook);
        const { rows } = Recoder.parseSheetData(worksheet);
        expect(rows).toEqual([['word'], ['spaced']]);
    });

    it('preserves non-ASCII content (Turkish, German, emoji)', () => {
        const { worksheet } = roundTrip(buildWorkbook([
            ['name'],
            ['İstanbul'],
            ['Straße'],
            ['🍎'],
        ]).workbook);
        const { rows } = Recoder.parseSheetData(worksheet);
        expect(rows).toEqual([['İstanbul'], ['Straße'], ['🍎']]);
    });
});

describe('cookRows edge cases', () => {
    it('handles an empty input', () => {
        expect(Recoder.cookRows([])).toEqual([]);
    });

    it('treats a row of empty strings as cells with empty lookup keys', () => {
        const cooked = Recoder.cookRows([['', '']]);
        expect(cooked).toEqual([
            [{ value: '', lower: '' }, { value: '', lower: '' }],
        ]);
    });

    it('lowercases non-ASCII consistently', () => {
        const cooked = Recoder.cookRows([['Straße', 'İSTANBUL']]);
        expect(cooked[0][0].lower).toBe('straße');
        // Note: this is the documented JS Unicode lowercasing behaviour;
        // İ -> i + combining-dot-above. Keys derived from any cell with
        // the same source character will match because they go through
        // the same .toLowerCase().
        expect(cooked[0][1].lower).toBe('İstanbul'.toLowerCase());
    });
});

describe('buildColumnData edge cases', () => {
    it('returns an empty array when there are no headers', () => {
        const cols = Recoder.buildColumnData([], Recoder.cookRows([]));
        expect(cols).toEqual([]);
    });

    it('returns columns with empty value Maps when every cell is blank', () => {
        const cols = Recoder.buildColumnData(['c'], Recoder.cookRows([[''], ['']]));
        expect(cols).toHaveLength(1);
        expect(cols[0].values.size).toBe(0);
    });

    it('preserves column index even for columns with no unique values', () => {
        const cols = Recoder.buildColumnData(
            ['a', 'b', 'c'],
            Recoder.cookRows([['x', '', 'z']]),
        );
        expect(cols.map(c => c.idx)).toEqual([0, 1, 2]);
        expect(cols[1].values.size).toBe(0);
    });
});

describe('collectValuesForSelection edge cases', () => {
    it('returns an empty Map when no columns are selected', () => {
        const cooked = Recoder.cookRows([['x']]);
        const cols = Recoder.buildColumnData(['c'], cooked);
        const merged = Recoder.collectValuesForSelection(cols, []);
        expect(merged.size).toBe(0);
    });

    it('does not duplicate keys when the same column is selected twice', () => {
        const cooked = Recoder.cookRows([['x'], ['y']]);
        const cols = Recoder.buildColumnData(['c'], cooked);
        const merged = Recoder.collectValuesForSelection(cols, [0, 0]);
        expect(merged.size).toBe(2);
    });
});

describe('generateTransformationItems edge cases', () => {
    it('returns an empty array for an empty Map', () => {
        expect(Recoder.generateTransformationItems(new Map())).toEqual([]);
    });

    it('assigns codes as strings (matches the input field value attribute)', () => {
        const items = Recoder.generateTransformationItems(new Map([
            ['a', 'a'], ['b', 'b'], ['c', 'c'],
        ]));
        expect(items.every(i => typeof i.code === 'string')).toBe(true);
        expect(items.map(i => i.code)).toEqual(['1', '2', '3']);
    });

    it('keeps a stable order for identical labels (sort is not actually random)', () => {
        // Two distinct lower-case keys mapping to the same display label
        // (impossible in real data, but documents sort stability).
        const items = Recoder.generateTransformationItems(new Map([
            ['k1', 'same'], ['k2', 'same'],
        ]));
        expect(items.map(i => i.key)).toEqual(['k1', 'k2']);
    });
});

describe('applyRecode edge cases', () => {
    it('does nothing when selectedIndices is empty', () => {
        const cooked = Recoder.cookRows([['yes'], ['no']]);
        const finalData = [['yes'], ['no']];
        Recoder.applyRecode(finalData, cooked, [], new Map([['yes', '1']]));
        expect(finalData).toEqual([['yes'], ['no']]);
    });

    it('does nothing when there are no rows', () => {
        const out = Recoder.applyRecode([], Recoder.cookRows([]), [0], new Map());
        expect(out).toEqual([]);
    });

    it('accepts string column indices (the app passes strings from cols.split(","))', () => {
        const cooked = Recoder.cookRows([['yes', 'red']]);
        const finalData = [['yes', 'red']];
        Recoder.applyRecode(finalData, cooked, ['0', '1'], new Map([
            ['yes', '1'], ['red', '2'],
        ]));
        expect(finalData).toEqual([['1', '2']]);
    });

    it('overwrites previously-recoded values when called twice with different maps', () => {
        const cooked = Recoder.cookRows([['yes'], ['no']]);
        const finalData = [['yes'], ['no']];
        Recoder.applyRecode(finalData, cooked, [0], new Map([['yes', '9'], ['no', '8']]));
        expect(finalData).toEqual([['9'], ['8']]);
        Recoder.applyRecode(finalData, cooked, [0], new Map([['yes', '1'], ['no', '2']]));
        expect(finalData).toEqual([['1'], ['2']]);
    });
});

describe('writeFinalDataToWorksheet edge cases', () => {
    it('skips cells outside the finalData array (extra worksheet rows)', () => {
        const { worksheet } = buildWorkbook([
            ['Q'],
            ['yes'],
            ['no'],
            ['maybe'],
        ]);
        // finalData is shorter than the worksheet body — the third data
        // row should be left untouched.
        Recoder.writeFinalDataToWorksheet(worksheet, [['1'], ['2']]);
        expect(worksheet['A2'].v).toBe('1');
        expect(worksheet['A3'].v).toBe('2');
        expect(worksheet['A4'].v).toBe('maybe');
    });

    it('skips cells whose worksheet entry does not exist (originally blank)', () => {
        const ws = XLSX.utils.aoa_to_sheet([['Q'], ['yes']]);
        // Manually delete the cell and shrink the range to simulate a
        // truly blank worksheet cell.
        delete ws['A2'];
        ws['!ref'] = 'A1:A2';
        Recoder.writeFinalDataToWorksheet(ws, [['1']]);
        expect(ws['A2']).toBeUndefined();
    });

    it('returns the worksheet for chaining', () => {
        const { worksheet } = buildWorkbook([['Q'], ['yes']]);
        expect(Recoder.writeFinalDataToWorksheet(worksheet, [['1']])).toBe(worksheet);
    });
});

describe('end-to-end round-trip on a string-only sheet', () => {
    // Sticking to strings here so the result is independent of the
    // cell-type bug (.t='n' + .v=string mismatch); a similar test that
    // exercises numeric/boolean inputs lives in recoder.bugs.test.js.
    it('all-string columns survive parse -> recode -> write -> re-read', () => {
        const { workbook } = buildWorkbook([
            ['Name', 'Color'],
            ['Alice', 'red'],
            ['Bob', 'blue'],
            ['Cara', 'red'],
        ]);
        const { worksheet, workbook: reread } = roundTrip(workbook);
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const finalData = rows.map(r => r.slice());

        const cols = Recoder.buildColumnData(headers, cooked);
        const merged = Recoder.collectValuesForSelection(cols, [1]);
        const items = Recoder.generateTransformationItems(merged);
        const transformations = new Map(items.map(i => [i.key, i.code]));

        Recoder.applyRecode(finalData, cooked, [1], transformations);
        Recoder.writeFinalDataToWorksheet(worksheet, finalData);

        const buf2 = XLSX.write(reread, { type: 'array', bookType: 'xlsx' });
        const final = XLSX.read(buf2, { type: 'array' });
        const fws = final.Sheets[final.SheetNames[0]];
        const out = XLSX.utils.sheet_to_json(fws, { header: 1, raw: false, defval: '' });

        expect(out[0]).toEqual(['Name', 'Color']);
        // Color codes are 'blue' -> 1, 'red' -> 2 (alphabetic).
        expect(out[1]).toEqual(['Alice', '2']);
        expect(out[2]).toEqual(['Bob', '1']);
        expect(out[3]).toEqual(['Cara', '2']);
    });
});
