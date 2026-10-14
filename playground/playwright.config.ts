import { defineConfig, devices } from '@playwright/test';

// The built site (npm run site) is served below /tickdeck/, the way GitHub Pages hosts it.
const PORT = Number(process.env.PLAYGROUND_PORT ?? 4310);
const SITE = `http://127.0.0.1:${PORT}/tickdeck/`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ['list'],
    ['json', { outputFile: 'e2e-report/results.json' }],
    ['html', { outputFolder: 'e2e-report/html', open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node scripts/serve.mjs --port ${PORT}`,
    url: SITE,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    // The CDN page loads tickdeck from jsDelivr, so it needs network access.
    { name: 'cdn', testMatch: 'trading.spec.ts', use: { baseURL: `${SITE}cdn/` } },
    { name: 'vanilla', testMatch: /(trading|recipes)\.spec\.ts/, use: { baseURL: `${SITE}vanilla/` } },
    { name: 'react', testMatch: /(trading|recipes)\.spec\.ts/, use: { baseURL: `${SITE}react/` } },
    { name: 'vue', testMatch: /(trading|recipes)\.spec\.ts/, use: { baseURL: `${SITE}vue/` } },
    { name: 'landing', testMatch: 'landing.spec.ts', use: { baseURL: SITE } },
  ],
});
