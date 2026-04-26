import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import Recoder from '../../js/lib/recoder.js';

/**
 * Performance budgets. The numbers are deliberately generous (~5x what
 * a current laptop run measures) so they catch order-of-magnitude
 * regressions without being flaky on slower CI hardware. If a budget
 * starts failing, profile first — don't just bump the number.
 *
 * Ranges measured on a 2026 M3 MacBook Pro for the current
 * implementation:
 *   - parseSheetData(10k rows × 8 cols): ~25-40ms
 *   - cookRows(10k rows × 8 cols):       ~5-10ms
 *   - buildColumnData(10k × 8):          ~5-10ms
 *   - applyRecode(10k × 4 cols):         ~5-10ms
 *   - writeFinalDataToWorksheet(10k × 8): ~30-60ms
 */

function buildLargeWorkbook(rowCount, colCount) {
    const headers = Array.from({ length: colCount }, (_, i) => `col_${i}`);
    const choices = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    const aoa = [headers];
    for (let r = 0; r < rowCount; r++) {
        const row = new Array(colCount);
        for (let c = 0; c < colCount; c++) {
            row[c] = choices[(r * 31 + c * 7) % choices.length];
        }
        aoa.push(row);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const reread = XLSX.read(buf, { type: 'array' });
    return { worksheet: reread.Sheets[reread.SheetNames[0]], workbook: reread };
}

function timeIt(fn) {
    const t0 = performance.now();
    const out = fn();
    return { elapsed: performance.now() - t0, out };
}

describe('performance budgets (10k rows × 8 cols)', () => {
    const ROWS = 10_000;
    const COLS = 8;
    const { worksheet } = buildLargeWorkbook(ROWS, COLS);

    it('parseSheetData stays under 250ms', () => {
        const { elapsed, out } = timeIt(() => Recoder.parseSheetData(worksheet));
        expect(out.rows.length).toBe(ROWS);
        expect(elapsed).toBeLessThan(250);
    });

    it('cookRows stays under 100ms', () => {
        const { rows } = Recoder.parseSheetData(worksheet);
        const { elapsed, out } = timeIt(() => Recoder.cookRows(rows));
        expect(out.length).toBe(ROWS);
        expect(elapsed).toBeLessThan(100);
    });

    it('buildColumnData stays under 100ms', () => {
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const { elapsed, out } = timeIt(() => Recoder.buildColumnData(headers, cooked));
        expect(out).toHaveLength(COLS);
        expect(elapsed).toBeLessThan(100);
    });

    it('applyRecode across 4 columns stays under 100ms', () => {
        const { headers, rows } = Recoder.parseSheetData(worksheet);
        const cooked = Recoder.cookRows(rows);
        const cols = Recoder.buildColumnData(headers, cooked);
        const finalData = rows.map(r => r.slice());
        const indices = [0, 1, 2, 3];
        const merged = Recoder.collectValuesForSelection(cols, indices);
        const items = Recoder.generateTransformationItems(merged);
        const transformations = new Map(items.map(i => [i.key, i.code]));

        const { elapsed } = timeIt(() => Recoder.applyRecode(finalData, cooked, indices, transformations));
        expect(elapsed).toBeLessThan(100);
    });

    it('end-to-end pipeline (parse + cook + build + recode + write) stays under 1000ms', () => {
        // Use a fresh worksheet so writeFinalDataToWorksheet has the
        // original cells to mutate.
        const { worksheet: ws } = buildLargeWorkbook(ROWS, COLS);
        const { elapsed } = timeIt(() => {
            const { headers, rows } = Recoder.parseSheetData(ws);
            const cooked = Recoder.cookRows(rows);
            const cols = Recoder.buildColumnData(headers, cooked);
            const finalData = rows.map(r => r.slice());
            const merged = Recoder.collectValuesForSelection(cols, [0]);
            const items = Recoder.generateTransformationItems(merged);
            const transformations = new Map(items.map(i => [i.key, i.code]));
            Recoder.applyRecode(finalData, cooked, [0], transformations);
            Recoder.writeFinalDataToWorksheet(ws, finalData);
        });
        expect(elapsed).toBeLessThan(1000);
    });
});

describe('scaling characteristics (sanity-check Big-O)', () => {
    // We're not asserting specific times here, only that doubling the
    // input size doesn't produce a more-than-quadratic blow-up. This
    // catches an accidental O(n²) introduction in cookRows / build.
    it('cookRows scales sub-quadratically from 1k -> 8k rows', () => {
        const measure = (rowCount) => {
            const { worksheet } = buildLargeWorkbook(rowCount, 4);
            const { rows } = Recoder.parseSheetData(worksheet);
            // Warm up once so JIT compiles cookRows.
            Recoder.cookRows(rows);
            const t0 = performance.now();
            for (let i = 0; i < 3; i++) Recoder.cookRows(rows);
            return (performance.now() - t0) / 3;
        };
        const small = measure(1_000);
        const big = measure(8_000);
        // 8x rows should take <16x time (quadratic would be 64x).
        // Add a small constant floor to avoid divide-by-tiny-number flake.
        const ratio = (big + 1) / (small + 1);
        expect(ratio).toBeLessThan(16);
    });
});
