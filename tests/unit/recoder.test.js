import { describe, it, expect } from 'vitest';
import Recoder from '../../js/lib/recoder.js';
import { buildWorkbook, roundTrip } from '../helpers/fixtures.js';

/**
 * Characterization tests: lock in the CURRENT behaviour of every public
 * helper in js/lib/recoder.js. These should all be green against the
 * code as-is. If any of them go red later, behaviour changed.
 */

describe('parseSheetData', () => {
    it('returns headers and trimmed string rows for a plain string sheet', () => {
        const { worksheet } = buildWorkbook([
            ['Name', 'Color'],
            ['  Alice ', 'red '],
            ['Bob', '  blue'],
        ]);
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        expect(headers).toEqual(['Name', 'Color']);
        expect(rows).toEqual([
            ['Alice', 'red'],
            ['Bob', 'blue'],
        ]);
    });

    it('formats numeric cells as strings (raw: false)', () => {
        const { worksheet } = roundTrip(buildWorkbook([
            ['n'],
            [1],
            [2.5],
            [-3],
        ]).workbook);
        const { rows } = Recoder.parseSheetData(worksheet);
        expect(rows.every(r => typeof r[0] === 'string')).toBe(true);
        expect(rows.map(r => r[0])).toEqual(['1', '2.5', '-3']);
    });

    it('formats boolean cells as strings', () => {
        const { worksheet } = roundTrip(buildWorkbook([
            ['flag'],
            [true],
            [false],
        ]).workbook);
        const { rows } = Recoder.parseSheetData(worksheet);
        expect(rows.every(r => typeof r[0] === 'string')).toBe(true);
        expect(rows.map(r => r[0].toUpperCase())).toEqual(['TRUE', 'FALSE']);
    });

    it('pads short rows with empty strings inside the sheet range', () => {
        const { worksheet } = roundTrip(buildWorkbook([
            ['a', 'b', 'c'],
            ['x', 'y', 'z'],
            ['solo'],
        ]).workbook);
        const { rows } = Recoder.parseSheetData(worksheet);
        expect(rows[0]).toEqual(['x', 'y', 'z']);
        expect(rows[1]).toHaveLength(3);
        expect(rows[1][0]).toBe('solo');
        expect(rows[1][1]).toBe('');
        expect(rows[1][2]).toBe('');
    });

    it('drops fully blank rows (works around defval defeating blankrows:false)', () => {
        // SheetJS keeps blank rows when `defval: ''` is set, even with
        // `blankrows: false`. parseSheetData filters them out so they
        // don't pollute the preview or downstream output.
        const { worksheet } = roundTrip(buildWorkbook([
            ['a'],
            ['x'],
            [''],
            ['y'],
        ]).workbook);
        const { rows } = Recoder.parseSheetData(worksheet);
        expect(rows.map(r => r[0])).toEqual(['x', 'y']);
    });
});

describe('cookRows', () => {
    it('attaches a lower-cased lookup key to every cell', () => {
        const cooked = Recoder.cookRows([
            ['Apple', 'BANANA'],
            ['Cherry', ''],
        ]);
        expect(cooked).toEqual([
            [{ value: 'Apple', lower: 'apple' }, { value: 'BANANA', lower: 'banana' }],
            [{ value: 'Cherry', lower: 'cherry' }, { value: '', lower: '' }],
        ]);
    });
});

describe('buildColumnData', () => {
    it('captures unique non-empty values per column, preserving first-seen casing', () => {
        const cooked = Recoder.cookRows([
            ['Yes', 'red'],
            ['NO', 'BLUE'],
            ['yes', 'red'],
            ['', 'blue'],
        ]);
        const cols = Recoder.buildColumnData(['Q1', 'Color'], cooked);

        expect(cols).toHaveLength(2);
        expect(cols[0].label).toBe('Q1');
        expect(Array.from(cols[0].values.entries())).toEqual([
            ['yes', 'Yes'],
            ['no', 'NO'],
        ]);
        expect(Array.from(cols[1].values.entries())).toEqual([
            ['red', 'red'],
            ['blue', 'BLUE'],
        ]);
    });

    it('skips empty cells when building the unique-values map', () => {
        const cooked = Recoder.cookRows([['x'], [''], ['x']]);
        const cols = Recoder.buildColumnData(['c'], cooked);
        expect(Array.from(cols[0].values.entries())).toEqual([['x', 'x']]);
    });
});

describe('collectValuesForSelection', () => {
    it('merges values from multiple selected columns', () => {
        const cooked = Recoder.cookRows([
            ['low', 'high'],
            ['high', 'medium'],
            ['medium', 'low'],
        ]);
        const cols = Recoder.buildColumnData(['Q1', 'Q2'], cooked);
        const merged = Recoder.collectValuesForSelection(cols, [0, 1]);
        expect(new Set(merged.keys())).toEqual(new Set(['low', 'high', 'medium']));
    });

    it('letting the last selected column win when casing differs', () => {
        const cooked = Recoder.cookRows([
            ['Apple'],
            ['APPLE'],
        ]);
        const colA = { label: 'A', idx: 0, values: new Map([['apple', 'Apple']]) };
        const colB = { label: 'B', idx: 1, values: new Map([['apple', 'apple']]) };
        const merged = Recoder.collectValuesForSelection([colA, colB], [0, 1]);
        expect(merged.get('apple')).toBe('apple');
    });
});

describe('generateTransformationItems', () => {
    it('sorts displayed labels lexicographically and assigns sequential codes', () => {
        const values = new Map([
            ['banana', 'Banana'],
            ['apple', 'Apple'],
            ['cherry', 'Cherry'],
        ]);
        const items = Recoder.generateTransformationItems(values);
        expect(items.map(i => i.label)).toEqual(['Apple', 'Banana', 'Cherry']);
        expect(items.map(i => i.code)).toEqual(['1', '2', '3']);
        expect(items.map(i => i.key)).toEqual(['apple', 'banana', 'cherry']);
    });

    it('sorts case-insensitively by displayed label', () => {
        // 'Apple' and 'banana' should be alphabetic (A before b)
        // regardless of letter case.
        const values = new Map([
            ['banana', 'banana'],
            ['apple', 'Apple'],
        ]);
        const items = Recoder.generateTransformationItems(values);
        expect(items.map(i => i.label)).toEqual(['Apple', 'banana']);
    });

    it('preserves prior codes when a priorCodes map is supplied', () => {
        // First selection assigns codes 1..N over [no, yes].
        const first = Recoder.generateTransformationItems(new Map([
            ['no', 'no'],
            ['yes', 'yes'],
        ]));
        const priorMap = new Map(first.map(i => [i.key, i.code]));

        // Adding "maybe" should not renumber "no" or "yes".
        const second = Recoder.generateTransformationItems(new Map([
            ['no', 'no'],
            ['yes', 'yes'],
            ['maybe', 'maybe'],
        ]), priorMap);

        const codes = Object.fromEntries(second.map(i => [i.key, i.code]));
        expect(codes.no).toBe('1');
        expect(codes.yes).toBe('2');
        expect(codes.maybe).toBe('3');
    });
});

describe('applyRecode', () => {
    it('writes transformation values into finalData for selected columns only', () => {
        const cooked = Recoder.cookRows([
            ['yes', 'red'],
            ['no', 'blue'],
        ]);
        const finalData = [
            ['yes', 'red'],
            ['no', 'blue'],
        ];
        const transformations = new Map([
            ['yes', '1'],
            ['no', '2'],
        ]);
        Recoder.applyRecode(finalData, cooked, ['0'], transformations);
        expect(finalData).toEqual([
            ['1', 'red'],
            ['2', 'blue'],
        ]);
    });

    it('is keyed by the lower-cased original cell value, not the displayed label', () => {
        const cooked = Recoder.cookRows([
            ['Yes'],
            ['YES'],
            ['no'],
        ]);
        const finalData = [['Yes'], ['YES'], ['no']];
        const transformations = new Map([
            ['yes', '1'],
            ['no', '2'],
        ]);
        Recoder.applyRecode(finalData, cooked, [0], transformations);
        expect(finalData).toEqual([['1'], ['1'], ['2']]);
    });
});

describe('writeFinalDataToWorksheet', () => {
    it('overwrites cell .v with the matching finalData value, leaving header untouched', () => {
        const { worksheet } = buildWorkbook([
            ['Q', 'Color'],
            ['yes', 'red'],
            ['no', 'blue'],
        ]);
        Recoder.writeFinalDataToWorksheet(worksheet, [
            ['1', 'red'],
            ['2', 'blue'],
        ]);
        expect(worksheet['A1'].v).toBe('Q');
        expect(worksheet['A2'].v).toBe('1');
        expect(worksheet['A3'].v).toBe('2');
        expect(worksheet['B2'].v).toBe('red');
    });

    it('skips cells whose finalData entry is undefined (preserves original)', () => {
        const { worksheet } = buildWorkbook([
            ['Q'],
            ['yes'],
            ['no'],
        ]);
        Recoder.writeFinalDataToWorksheet(worksheet, [
            ['1'],
            [undefined],
        ]);
        expect(worksheet['A2'].v).toBe('1');
        expect(worksheet['A3'].v).toBe('no');
    });
});

describe('end-to-end: parse -> select -> generate codes -> recode -> write', () => {
    it('round-trips a typical strings/numbers/booleans sheet', () => {
        const { workbook } = buildWorkbook([
            ['Name', 'Score', 'Pass'],
            ['Alice', 95, true],
            ['Bob', 70, false],
            ['Cara', 95, true],
        ]);
        const { worksheet } = roundTrip(workbook);

        const { headers, rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const cols = Recoder.buildColumnData(headers, cooked);
        const finalData = rows.map(r => r.slice());

        // Recode the boolean column: TRUE -> 1, FALSE -> 0.
        const passValues = Recoder.collectValuesForSelection(cols, [2]);
        const passItems = Recoder.generateTransformationItems(passValues);
        // Default codes are 1..N over sorted labels: ['FALSE', 'TRUE'] -> '1', '2'.
        expect(passItems.map(i => i.label)).toEqual(['FALSE', 'TRUE']);
        const transformations = new Map(passItems.map(i => [i.key, i.code]));
        Recoder.applyRecode(finalData, cooked, [2], transformations);

        Recoder.writeFinalDataToWorksheet(worksheet, finalData);
        expect(worksheet['C2'].v).toBe('2'); // Alice / TRUE
        expect(worksheet['C3'].v).toBe('1'); // Bob / FALSE
        expect(worksheet['C4'].v).toBe('2'); // Cara / TRUE
    });
});
