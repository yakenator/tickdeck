import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  // Relative asset URLs: the build works at any path, such as /tickdeck/vue/ on GitHub Pages.
  base: './',
  // The chart engine alone is a few hundred kB.
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
});
