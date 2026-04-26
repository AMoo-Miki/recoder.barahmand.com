// Download round-trip: drive the app to recode a column, click
// Download, capture the saved bytes, re-parse them with SheetJS, and
// assert that the saved file matches what was on screen. This is the
// only way to verify the writeFinalDataToWorksheet path doesn't drift
// from the rendered preview.

import { test, expect } from '@playwright/test';

test.describe('download round-trip', () => {
    test('recoded preview matches the bytes saved to disk', async ({ page, browserName }, testInfo) => {
        await page.goto('/');
        await page.waitForFunction(() => typeof window.XLSX !== 'undefined', null, { timeout: 15_000 });

        // Build a small fixture in-page to avoid filesystem dependencies.
        await page.evaluate(() => {
            window.__buildFixtureBuffer = function () {
                const aoa = [
                    ['Name', 'Color', 'Score'],
                    ['Alice', 'red',   95],
                    ['Bob',   'blue',  70],
                    ['Cara',  'red',   80],
                    ['Dan',   'green', 60],
                ];
                const ws = window.XLSX.utils.aoa_to_sheet(aoa);
                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
                return window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
            };
        });

        // Drive the file input.
        const buffer = await page.evaluate(() => Array.from(new Uint8Array(window.__buildFixtureBuffer())));
        const buf = Buffer.from(buffer);
        await page.setInputFiles('#srcFile', {
            name: 'roundtrip.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            buffer: buf,
        });
        // The app sets a 1s timeout before loading.
        await page.waitForFunction(() => document.body.classList.contains('file-selected'), null, { timeout: 5_000 });
        await page.waitForFunction(() => !document.body.classList.contains('file-loading'), null, { timeout: 5_000 });
        await page.waitForSelector('.excel abbr.header', { timeout: 5_000 });

        // Select the Color column (idx=1).
        await page.evaluate(() => {
            const h = document.querySelector('.excel abbr.header[data-idx="1"]');
            h.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        });
        await page.waitForSelector('#transformations input[type="number"]');

        // Customize the codes so we can detect drift: blue=10, green=20, red=30.
        await page.evaluate(() => {
            const set = (name, value) => {
                const el = document.querySelector(`#transformations input[name="${name}"]`);
                el.value = String(value);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            };
            set('blue', 10);
            set('green', 20);
            set('red', 30);
        });

        // Apply.
        await page.click('#apply-transformation');
        await page.waitForFunction(() => {
            const cells = Array.from(document.querySelectorAll('.excel abbr:not(.header)')).map(c => c.textContent);
            return cells[1] === '30';
        }, null, { timeout: 5_000 });

        // Capture the rendered preview.
        const previewCells = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.excel abbr:not(.header)')).map(c => c.textContent);
        });
        expect(previewCells).toEqual([
            'Alice', '30', '95',
            'Bob',   '10', '70',
            'Cara',  '30', '80',
            'Dan',   '20', '60',
        ]);

        // Trigger download and capture the bytes.
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 10_000 }),
            page.click('#download'),
        ]);
        const path = await download.path();
        expect(path, `${browserName}: download path missing`).toBeTruthy();

        // Re-parse the saved file using the page's own XLSX (so we use
        // exactly the version the app used to write it).
        const downloadedBytes = await page.evaluate(async ({ path }) => {
            // Round-trip the bytes through the page so we can use the
            // same XLSX instance — but Playwright provides only the
            // local filesystem path. Read in Node instead.
            return path;
        }, { path });

        const fs = await import('node:fs');
        const xlsx = await import('xlsx');
        const bytes = fs.readFileSync(path);
        const wb = xlsx.read(bytes, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

        // Header row preserved verbatim.
        expect(aoa[0]).toEqual(['Name', 'Color', 'Score']);
        // Color column written as the user-edited codes; type should now
        // be numeric (writeFinalDataToWorksheet syncs cell.t to runtime
        // type), so SheetJS gives us number-as-string.
        expect(aoa.slice(1)).toEqual([
            ['Alice', '30', '95'],
            ['Bob',   '10', '70'],
            ['Cara',  '30', '80'],
            ['Dan',   '20', '60'],
        ]);

        // Filename should follow "<source>-recoded.xlsx" convention.
        expect(download.suggestedFilename()).toBe('roundtrip-recoded.xlsx');
    });
});
