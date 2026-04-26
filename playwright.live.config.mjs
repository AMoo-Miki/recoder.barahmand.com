// Smoke-test config for the live GitHub Pages deployment at
// https://recoder.barahmand.com. Mirrors playwright.config.mjs but
// drops the local http-server and points baseURL at the real site,
// so the in-page run.js runner exercises the deployed bundle (and
// the SheetJS CDN) end-to-end across all three browser engines.
//
// Run with:  npm run test:e2e:live
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e/playwright',
    testMatch: '**/cross-browser.spec.mjs',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: 'https://recoder.barahmand.com',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    ],
});
