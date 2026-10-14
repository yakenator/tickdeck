/// <reference types="node" />
// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type * as Cdn from '@tickdeck/all/cdn';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as All from './index';

const packageDir = fileURLToPath(new URL('..', import.meta.url));

/** Resolves specifiers the way Node does for code in this package (a self-reference by package name). */
function resolve(...specifiers: string[]): string[] {
  const script = `for (const s of ${JSON.stringify(specifiers)}) console.log(import.meta.resolve(s));`;
  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], { cwd: packageDir, encoding: 'utf8' });
  return output.trim().split('\n').map((url) => fileURLToPath(url).slice(packageDir.length));
}

describe('@tickdeck/all exports', () => {
  it('maps the CDN bundle to @tickdeck/all/cdn and keeps its file path importable', () => {
    expect(resolve('@tickdeck/all', '@tickdeck/all/cdn', '@tickdeck/all/dist/tickdeck.js', '@tickdeck/all/package.json')).toEqual([
      'dist/index.js',
      'dist/tickdeck.js',
      'dist/tickdeck.js',
      'package.json',
    ]);
  });

  it('types the CDN bundle like the main entry', () => {
    expectTypeOf<typeof Cdn.createChartView>().toEqualTypeOf<typeof All.createChartView>();
    expectTypeOf<typeof Cdn.TdkOrderTicketElement>().toEqualTypeOf<typeof All.TdkOrderTicketElement>();
  });
});
