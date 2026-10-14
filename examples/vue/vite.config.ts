import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  // The chart engine alone is a few hundred kB.
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
});
