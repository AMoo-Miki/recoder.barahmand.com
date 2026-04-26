// Cross-browser parity: load tests/e2e/run.js into the live page and
// run it against Chromium, Firefox, and WebKit. Any divergence between
// what jsdom thinks vs. what real engines do shows up here.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runJs = readFileSync(resolve(__dirname, '..', 'run.js'), 'utf8');

test.describe('cross-browser run.js parity', () => {
    test('every assertion in tests/e2e/run.js passes on this browser', async ({ page }) => {
        await page.goto('/');
        // Wait for SheetJS (loaded from CDN) to attach.
        await page.waitForFunction(() => typeof window.XLSX !== 'undefined', null, { timeout: 15_000 });

        // Inject the runner and execute it.
        await page.evaluate(runJs);
        const result = await page.evaluate(() => window.__runTests());

        if (result.failedCount > 0) {
            console.error('Failed assertions:', JSON.stringify(result.failed, null, 2));
        }
        expect(result.failedCount, `failures: ${JSON.stringify(result.failed)}`).toBe(0);
        expect(result.passed).toBeGreaterThan(0);
    });
});
