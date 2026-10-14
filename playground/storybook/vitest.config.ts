import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Every story is a test: it renders in Chromium, runs its play function, then the accessibility checks.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [storybookTest({ configDir: path.join(import.meta.dirname, '.storybook') })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
            // A desktop window like the e2e tests (the default is 414 px wide), so the trading screen lays out side by side.
            viewport: { width: 1400, height: 1000 },
          },
        },
      },
    ],
  },
});
