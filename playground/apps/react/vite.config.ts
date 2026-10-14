import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs: the build works at any path, such as /tickdeck/react/ on GitHub Pages.
  base: './',
  // The chart engine alone is a few hundred kB.
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
});
