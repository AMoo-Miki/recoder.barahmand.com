// Playwright config — drives the e2e suite against a real browser
// (Chromium, Firefox, WebKit) running an actual http-server hosting the
// site. This complements tests/e2e/run.js (which is the in-page runner
// invoked via `evaluate`) by adding cross-browser parity checks and a
// real download round-trip test that needs Playwright's download API.
//
// Usage:
//   npm run test:e2e               # all browsers
//   npx playwright test --project=chromium
//
// We don't use Playwright Test for the in-page run.js suite because the
// run.js file is intentionally framework-free so it can also be pasted
// into the live production site for smoke-tests.

import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PW_PORT || 8989;

export default defineConfig({
    testDir: './tests/e2e/playwright',
    testMatch: '**/*.spec.mjs',
    timeout: 30_000,
    expect: { timeout: 5_000 },
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'retain-on-failure',
    },
    webServer: {
        command: `npx http-server . -p ${PORT} -c-1 --silent`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        timeout: 30_000,
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    ],
});
