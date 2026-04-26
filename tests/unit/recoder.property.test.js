import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as XLSX from 'xlsx';
import Recoder from '../../js/lib/recoder.js';
import { buildWorkbook, roundTrip } from '../helpers/fixtures.js';

/**
 * Property-based tests. fast-check generates hundreds of random inputs
 * per property and shrinks any failing case to its minimal form, which
 * is much harder for a refactor to silently break than hand-written
 * examples. Each property below states an invariant that should hold
 * for ANY valid input — if you find a property that's wrong as stated,
 * fix the property, don't loosen it.
 */

// Generators -----------------------------------------------------------

// "Plain" string cells that survive xlsx round-tripping cleanly: no
// control chars, no leading/trailing whitespace (so .trim() is a no-op),
// no weird Unicode whitespace categories. Empty string allowed.
const plainCell = fc.string({ minLength: 0, maxLength: 16 })
    .filter(s => !/[\u0000-\u001f\u007f]/.test(s))
    .map(s => s.trim());

const plainHeader = fc.string({ minLength: 1, maxLength: 12 })
    .filter(s => !/[\u0000-\u001f\u007f]/.test(s))
    .map(s => s.trim())
    .filter(s => s.length > 0);

// A 2-D array of strings shaped like a worksheet AOA: a non-empty
// header row, then 0+ data rows of the same width.
const aoa = fc.tuple(
    fc.array(plainHeader, { minLength: 1, maxLength: 5 }),
    fc.array(fc.array(plainCell, { minLength: 1, maxLength: 5 }), { minLength: 0, maxLength: 20 }),
).map(([headers, rows]) => {
    const width = headers.length;
    const padded = rows.map(r => {
        const out = r.slice(0, width);
        while (out.length < width) out.push('');
        return out;
    });
    return [headers, ...padded];
});

// Helpers --------------------------------------------------------------

function isLowerCase(s) {
    return s === s.toLowerCase();
}

// Properties: parseSheetData -------------------------------------------

describe('property: parseSheetData', () => {
    it('returns headers matching the first row of the worksheet', () => {
        fc.assert(fc.property(aoa, (data) => {
            const { worksheet } = roundTrip(buildWorkbook(data).workbook);
            const { headers } = Recoder.parseSheetData(worksheet);
            expect(headers).toEqual(data[0]);
        }), { numRuns: 100 });
    });

    it('every parsed row is the same length as the header row OR shorter (padded by SheetJS)', () => {
        fc.assert(fc.property(aoa, (data) => {
            const { worksheet } = roundTrip(buildWorkbook(data).workbook);
            const { headers, rows } = Recoder.parseSheetData(worksheet);
            rows.forEach(r => {
                // SheetJS pads/truncates to the sheet range, which is
                // header-width when the header is the widest row.
                expect(r.length).toBeLessThanOrEqual(headers.length);
            });
        }), { numRuns: 100 });
    });

    it('every parsed cell is a trimmed string', () => {
        fc.assert(fc.property(aoa, (data) => {
            const { worksheet } = roundTrip(buildWorkbook(data).workbook);
            const { rows } = Recoder.parseSheetData(worksheet);
            rows.forEach(r => r.forEach(cell => {
                expect(typeof cell).toBe('string');
                expect(cell).toBe(cell.trim());
            }));
        }), { numRuns: 100 });
    });

    it('drops fully-blank rows (no row survives where every cell is empty)', () => {
        fc.assert(fc.property(aoa, (data) => {
            const { worksheet } = roundTrip(buildWorkbook(data).workbook);
            const { rows } = Recoder.parseSheetData(worksheet);
            rows.forEach(r => {
                expect(r.some(cell => cell !== '')).toBe(true);
            });
        }), { numRuns: 100 });
    });
});

// Properties: cookRows -------------------------------------------------

describe('property: cookRows', () => {
    it('preserves shape exactly', () => {
        fc.assert(fc.property(
            fc.array(fc.array(plainCell, { minLength: 0, maxLength: 8 }), { minLength: 0, maxLength: 30 }),
            (rows) => {
                const cooked = Recoder.cookRows(rows);
                expect(cooked).toHaveLength(rows.length);
                cooked.forEach((row, i) => {
                    expect(row).toHaveLength(rows[i].length);
                });
            },
        ), { numRuns: 200 });
    });

    it('every cooked cell has lower === value.toLowerCase()', () => {
        fc.assert(fc.property(
            fc.array(fc.array(plainCell, { minLength: 0, maxLength: 6 }), { minLength: 0, maxLength: 20 }),
            (rows) => {
                const cooked = Recoder.cookRows(rows);
                cooked.forEach((row, i) => row.forEach((cell, j) => {
                    expect(cell.value).toBe(rows[i][j]);
                    expect(cell.lower).toBe((rows[i][j] || '').toLowerCase());
                    expect(isLowerCase(cell.lower)).toBe(true);
                }));
            },
        ), { numRuns: 200 });
    });
});

// Properties: buildColumnData ------------------------------------------

describe('property: buildColumnData', () => {
    it('produces one entry per header, with matching idx', () => {
        fc.assert(fc.property(aoa, (data) => {
            const cooked = Recoder.cookRows(data.slice(1));
            const cols = Recoder.buildColumnData(data[0], cooked);
            expect(cols).toHaveLength(data[0].length);
            cols.forEach((c, i) => {
                expect(c.idx).toBe(i);
                expect(c.label).toBe(data[0][i]);
            });
        }), { numRuns: 100 });
    });

    it('every value-map key is the lower-cased form of its value', () => {
        fc.assert(fc.property(aoa, (data) => {
            const cooked = Recoder.cookRows(data.slice(1));
            const cols = Recoder.buildColumnData(data[0], cooked);
            cols.forEach(c => {
                c.values.forEach((displayed, key) => {
                    expect(key).toBe(displayed.toLowerCase());
                    expect(key).not.toBe('');
                });
            });
        }), { numRuns: 100 });
    });
});

// Properties: generateTransformationItems -------------------------------

describe('property: generateTransformationItems', () => {
    it('returns one item per unique key, sorted case-insensitively', () => {
        fc.assert(fc.property(
            fc.uniqueArray(plainHeader, { minLength: 0, maxLength: 20 }),
            (labels) => {
                const map = new Map(labels.map(l => [l.toLowerCase(), l]));
                const items = Recoder.generateTransformationItems(map);
                expect(items).toHaveLength(map.size);
                for (let i = 1; i < items.length; i++) {
                    expect(items[i - 1].label.toLowerCase().localeCompare(items[i].label.toLowerCase()))
                        .toBeLessThanOrEqual(0);
                }
            },
        ), { numRuns: 200 });
    });

    it('default codes are 1..N as strings when no priorCodes given', () => {
        fc.assert(fc.property(
            fc.uniqueArray(plainHeader, { minLength: 1, maxLength: 15 }),
            (labels) => {
                const map = new Map(labels.map(l => [l.toLowerCase(), l]));
                const items = Recoder.generateTransformationItems(map);
                items.forEach((it, i) => expect(it.code).toBe(String(i + 1)));
            },
        ), { numRuns: 100 });
    });

    it('priorCodes are preserved verbatim for keys that survive', () => {
        fc.assert(fc.property(
            fc.uniqueArray(plainHeader, { minLength: 1, maxLength: 12 }),
            fc.uniqueArray(plainHeader, { minLength: 0, maxLength: 5 }),
            (originalLabels, addedLabels) => {
                fc.pre(originalLabels.every(l => !addedLabels.includes(l)));
                const originalMap = new Map(originalLabels.map(l => [l.toLowerCase(), l]));
                const first = Recoder.generateTransformationItems(originalMap);
                const priorCodes = new Map(first.map(i => [i.key, i.code]));

                const allLabels = [...originalLabels, ...addedLabels];
                const fullMap = new Map(allLabels.map(l => [l.toLowerCase(), l]));
                const second = Recoder.generateTransformationItems(fullMap, priorCodes);

                first.forEach(({ key, code }) => {
                    const matched = second.find(s => s.key === key);
                    expect(matched, `key ${key} missing in second pass`).toBeDefined();
                    expect(matched.code).toBe(code);
                });

                // No two items share a code.
                const codes = second.map(i => i.code);
                expect(new Set(codes).size).toBe(codes.length);
            },
        ), { numRuns: 100 });
    });
});

// Properties: applyRecode -----------------------------------------------

describe('property: applyRecode', () => {
    it('preserves array length and width', () => {
        fc.assert(fc.property(aoa, (data) => {
            const cooked = Recoder.cookRows(data.slice(1));
            const finalData = data.slice(1).map(r => r.slice());
            const before = finalData.map(r => r.length);
            const cols = Recoder.buildColumnData(data[0], cooked);
            const merged = Recoder.collectValuesForSelection(cols, [0]);
            const items = Recoder.generateTransformationItems(merged);
            const transformations = new Map(items.map(i => [i.key, i.code]));
            Recoder.applyRecode(finalData, cooked, [0], transformations);
            expect(finalData).toHaveLength(before.length);
            finalData.forEach((r, i) => expect(r.length).toBe(before[i]));
        }), { numRuns: 100 });
    });

    it('leaves unselected columns untouched', () => {
        fc.assert(fc.property(aoa, (data) => {
            fc.pre(data[0].length >= 2);
            const cooked = Recoder.cookRows(data.slice(1));
            const finalData = data.slice(1).map(r => r.slice());
            const original = finalData.map(r => r.slice());
            const cols = Recoder.buildColumnData(data[0], cooked);
            const merged = Recoder.collectValuesForSelection(cols, [0]);
            const items = Recoder.generateTransformationItems(merged);
            const transformations = new Map(items.map(i => [i.key, i.code]));
            Recoder.applyRecode(finalData, cooked, [0], transformations);
            for (let i = 0; i < finalData.length; i++) {
                for (let j = 1; j < finalData[i].length; j++) {
                    expect(finalData[i][j]).toBe(original[i][j]);
                }
            }
        }), { numRuns: 100 });
    });

    it('is idempotent when applied twice with the same transformations', () => {
        fc.assert(fc.property(aoa, (data) => {
            const cooked = Recoder.cookRows(data.slice(1));
            const cols = Recoder.buildColumnData(data[0], cooked);
            const merged = Recoder.collectValuesForSelection(cols, [0]);
            const items = Recoder.generateTransformationItems(merged);
            const transformations = new Map(items.map(i => [i.key, i.code]));

            const finalA = data.slice(1).map(r => r.slice());
            Recoder.applyRecode(finalA, cooked, [0], transformations);
            const afterFirst = JSON.stringify(finalA);

            // Re-cook from finalA to simulate "applying again on whatever
            // is now in the cell" — this should NOT touch cells whose new
            // value isn't in the transformation map.
            Recoder.applyRecode(finalA, cooked, [0], transformations);
            expect(JSON.stringify(finalA)).toBe(afterFirst);
        }), { numRuns: 100 });
    });

    it('empty cells stay empty', () => {
        fc.assert(fc.property(aoa, (data) => {
            const cooked = Recoder.cookRows(data.slice(1));
            const finalData = data.slice(1).map(r => r.slice());
            const cols = Recoder.buildColumnData(data[0], cooked);
            const merged = Recoder.collectValuesForSelection(cols, [0]);
            const items = Recoder.generateTransformationItems(merged);
            const transformations = new Map(items.map(i => [i.key, i.code]));

            const emptyBefore = [];
            finalData.forEach((r, i) => { if (r[0] === '') emptyBefore.push(i); });
            Recoder.applyRecode(finalData, cooked, [0], transformations);
            emptyBefore.forEach(i => expect(finalData[i][0]).toBe(''));
        }), { numRuns: 100 });
    });
});

// End-to-end pipeline property -----------------------------------------

describe('property: full pipeline round-trip', () => {
    it('every distinct value in selected col gets exactly one stable code', () => {
        fc.assert(fc.property(aoa, (data) => {
            const { worksheet } = roundTrip(buildWorkbook(data).workbook);
            const { headers, rows } = Recoder.parseSheetData(worksheet);
            const cooked = Recoder.cookRows(rows);
            const cols = Recoder.buildColumnData(headers, cooked);
            const finalData = rows.map(r => r.slice());
            const merged = Recoder.collectValuesForSelection(cols, [0]);
            const items = Recoder.generateTransformationItems(merged);
            const transformations = new Map(items.map(i => [i.key, i.code]));
            Recoder.applyRecode(finalData, cooked, [0], transformations);

            // Build value -> set of codes seen for that value.
            const valueToCodes = new Map();
            for (let i = 0; i < rows.length; i++) {
                const lower = (rows[i][0] || '').toLowerCase();
                if (lower === '') continue;
                const set = valueToCodes.get(lower) || new Set();
                set.add(finalData[i][0]);
                valueToCodes.set(lower, set);
            }
            valueToCodes.forEach(codes => expect(codes.size).toBe(1));
        }), { numRuns: 100 });
    });
});
