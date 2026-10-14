import { readFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';
import { base } from '../../tsup.base';
import { version } from './package.json';

export default defineConfig({
  ...base,
  banner: {
    js: '/** @license @tickdeck/chart-engine, derived from KLineChart (Copyright (c) 2019 lihu). Apache-2.0. See NOTICE. */',
  },
  esbuildPlugins: [
    {
      name: 'engine-version',
      setup(build) {
        build.onLoad({ filter: /\.ts$/ }, async ({ path }) => ({
          contents: (await readFile(path, 'utf8')).replaceAll('__VERSION__', version),
          loader: 'ts',
        }));
      },
    },
  ],
});
