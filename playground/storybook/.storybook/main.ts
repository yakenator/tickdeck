import type { StorybookConfig } from '@storybook/web-components-vite';

const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.ts'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
  framework: { name: '@storybook/web-components-vite', options: {} },
  core: { disableTelemetry: true },
  // Relative asset URLs: the static build works at any path, such as /tickdeck/storybook/ on GitHub Pages.
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    base: './',
    // The chart engine alone is a few hundred kB.
    build: { ...viteConfig.build, chunkSizeWarningLimit: 2000 },
  }),
};

export default config;
