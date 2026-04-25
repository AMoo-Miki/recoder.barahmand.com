import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import Recoder from '../../js/lib/recoder.js';
import { buildWorkbook, roundTrip } from '../helpers/fixtures.js';

/**
 * Failing tests that document suspected bugs in the current behaviour.
 * Each test states what the user-facing outcome SHOULD be.
 *
 * Each `it.fails()` is **expected to fail** today — Vitest inverts the
 * status so the suite stays green while the bug is open. When the bug
 * gets fixed, the now-passing assertion will make `it.fails()` itself
 * fail in CI, prompting whoever fixed it to flip `.fails` off.
 *
 * Don't relax the assertions to make them pass. Don't add `.fails()` to
 * a test that already passes today — those go in the regular suite.
 */

describe('BUG: empty source cells are recoded to undefined instead of being preserved', () => {
    it.fails('keeps an empty cell empty (or original) after applyRecode', () => {
        // The user codes "yes" -> 1 and "no" -> 2. A row with an empty
        // value in the recoded column should not be silently turned into
        // the string "undefined" or get lost — it should round-trip as
        // empty.
        const cooked = Recoder.cookRows([
            ['yes'],
            [''],
            ['no'],
        ]);
        const finalData = [['yes'], [''], ['no']];
        const transformations = new Map([['yes', '1'], ['no', '2']]);

        Recoder.applyRecode(finalData, cooked, [0], transformations);

        // Today: finalData becomes [['1'], [undefined], ['2']]
        // Expected: empty stays empty (or otherwise non-undefined).
        expect(finalData[1][0]).not.toBeUndefined();
        expect(finalData[1][0]).toBe('');
    });
});

describe('BUG: download keeps cell .t even though .v changes type', () => {
    it.fails('preserves numeric/boolean cell type info when recoding to a numeric code', () => {
        // A score column holds real numbers in the source xlsx. After
        // recoding (e.g. 95 -> 1, 70 -> 2), the codes are conceptually
        // numbers but the app writes them as strings while leaving
        // .t = 'n'. Downstream tools that read .t will be confused.
        const { worksheet } = roundTrip(buildWorkbook([
            ['Score'],
            [95],
            [70],
        ]).workbook);

        // Sanity: original cells are typed as numbers.
        expect(worksheet['A2'].t).toBe('n');
        expect(typeof worksheet['A2'].v).toBe('number');

        Recoder.writeFinalDataToWorksheet(worksheet, [['1'], ['2']]);

        // Today: .t is still 'n' but .v is the string '1'. That mismatch
        // is the bug. Either .t should be flipped to 's', or .v should
        // be coerced to a Number — but the two should agree.
        if (worksheet['A2'].t === 'n') {
            expect(typeof worksheet['A2'].v).toBe('number');
        } else {
            expect(worksheet['A2'].t).toBe('s');
        }
    });

    it('downloaded file round-trips correctly for a recoded numeric column', () => {
        // Real-world manifestation of the .t / .v mismatch: write the
        // recoded workbook back to xlsx bytes, re-read it the same way
        // the app reads input files, and confirm the codes survive.
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
        // After re-read, the cells should still show those codes.
        expect(out[1][0]).toBe('2'); // 95 -> 2
        expect(out[2][0]).toBe('1'); // 70 -> 1
    });

    it.fails('clears .w (the cached formatted text) when overwriting .v', () => {
        // Some readers (and SheetJS itself in some paths) prefer .w over
        // .v when displaying cells. Failing to clear it means the
        // downloaded file may visually still show the original value.
        const { worksheet } = roundTrip(buildWorkbook([
            ['Score'],
            [95],
        ]).workbook);
        expect(worksheet['A2'].w).toBeDefined(); // sanity

        Recoder.writeFinalDataToWorksheet(worksheet, [['1']]);

        // Expected: .w cleared (or updated to match the new .v).
        expect(worksheet['A2'].w === undefined || worksheet['A2'].w === '1').toBe(true);
    });
});

describe('BUG: blank rows survive parsing and pollute the output', () => {
    it.fails('drops fully blank rows so they do not show up in the recoded preview', () => {
        const { worksheet } = roundTrip(buildWorkbook([
            ['Q'],
            ['x'],
            [''],
            ['y'],
        ]).workbook);

        const { rows } = Recoder.parseSheetData(worksheet);
        // Today: rows = [['x'], [''], ['y']]
        // Expected: blank rows dropped (this is what `blankrows: false`
        // is supposed to do).
        expect(rows.map(r => r[0])).toEqual(['x', 'y']);
    });
});

describe('BUG: code generation sort is case-sensitive on display label', () => {
    it.fails('sorts unique values case-insensitively for stable codes', () => {
        // If the same column has both "apple" and "Banana", the user
        // probably expects A before B regardless of case. The current
        // sort uses default JS string compare, so all uppercase letters
        // sort before all lowercase ones — "Banana" comes before "apple".
        const values = new Map([
            ['apple', 'apple'],
            ['banana', 'Banana'],
        ]);
        const items = Recoder.generateTransformationItems(values);
        expect(items.map(i => i.label.toLowerCase())).toEqual(['apple', 'banana']);
    });
});

describe('BUG: re-applying recode on a different selection silently changes earlier codes', () => {
    it.fails('does not change codes for previously-recoded columns when adding a new column', () => {
        // Workflow: user recodes column A alone, getting "yes"->1, "no"->2.
        // Then they add column B (which contains "maybe") and re-apply.
        // The merged code list now includes "maybe", which can re-order
        // the codes — column A's previously-applied codes silently drift.
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

        // Second pass: now select A AND B, default codes get recomputed
        // over the union, then user applies again.
        const valsAB = Recoder.collectValuesForSelection(cols, [0, 1]);
        const itemsAB = Recoder.generateTransformationItems(valsAB);
        const transAB = new Map(itemsAB.map(i => [i.key, i.code]));
        Recoder.applyRecode(finalData, cooked, [0, 1], transAB);

        const colAAfterSecondPass = finalData.map(r => r[0]);

        // Expected: column A's codes are stable across the two passes.
        // Today they drift because the unified sort puts "maybe" between
        // "no" and "yes" alphabetically, shifting the indices.
        expect(colAAfterSecondPass).toEqual(colAAfterFirstPass);
    });
});

describe('BUG: header labels and cell values are HTML-injected without escaping', () => {
    it('parser preserves HTML-like content verbatim (so a renderer fix has stable input)', () => {
        // The parser path is fine — the bug lives in js/index.js render(),
        // updateSelections() and selectedCols rendering, all of which
        // build innerHTML via bare template literals around the parsed
        // text. A sheet header like `<img src=x onerror=alert(1)>` will
        // be executed when the file is loaded.
        //
        // This test just pins down that the lib does NOT pre-escape, so
        // any fix must escape at the render layer.
        const { worksheet } = roundTrip(buildWorkbook([
            ['<b>Bold</b>', 'plain'],
            ['x', 'y'],
        ]).workbook);
        const { headers } = Recoder.parseSheetData(worksheet);
        expect(headers[0]).toBe('<b>Bold</b>');
    });

    // The actual rendering bugs (header + cell HTML injection) are
    // covered by the jsdom integration suite in
    // tests/integration/index.dom.test.js — see "BUG: HTML in header
    // text is rendered as markup" and "BUG: HTML in cell values is
    // rendered as markup".
});
