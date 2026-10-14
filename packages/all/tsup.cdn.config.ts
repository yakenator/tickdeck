import { defineConfig } from 'tsup';
import { base } from '../../tsup.base';

export default defineConfig({
  ...base,
  entry: { tickdeck: 'src/index.ts' },
  dts: false,
  clean: false,
  minify: true,
  platform: 'browser',
  noExternal: [/.*/],
});
