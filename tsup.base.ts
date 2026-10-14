import { defineConfig, type Options } from 'tsup';

export const base: Options = {
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  esbuildOptions(options) {
    options.sourcesContent = false;
  },
  clean: true,
};

export default defineConfig(base);
