// Builds, type-checks and tests every workspace against the installed tickdeck version.
// `npm run verify` runs it directly; scripts/update.mjs imports `verify` and records the result.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { WEB_APPS, WORKSPACES, readVersion, root, run, workspaceScripts } from './lib.mjs';

/** Playwright projects: the trading flow per web app, then the hosted site (landing page and Storybook). */
export const E2E_PROJECTS = [...WEB_APPS, 'site'];
const E2E_JSON = path.join(root, 'e2e-report', 'results.json');
const STORYBOOK_JSON = path.join(root, 'e2e-report', 'storybook.json');

const ERROR_LINE = /error TS\d+|Error:|Error \[|failed to resolve|Cannot find|AssertionError|FAIL /;

/** The first error line of a failed command, without machine-specific paths, for the notes column. */
export function reason(output) {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('npm error') && !line.startsWith('at '));
  const line = lines.find((candidate) => ERROR_LINE.test(candidate)) ?? lines.at(-1) ?? '';
  return line
    .replaceAll(`${root}/`, '')
    .replace(/apps\/[a-z]+\/node_modules\//g, 'node_modules/')
    .slice(0, 200);
}

/** "build react, vue: <reason>": failures with the same reason on one line. */
function group(step, failures) {
  const byReason = new Map();
  for (const { name, reason: why } of failures) byReason.set(why, [...(byReason.get(why) ?? []), name]);
  return [...byReason].map(([why, names]) => `${step} ${names.join(', ')}: ${why}`);
}

/** Runs `script` in every workspace that defines it. Resolves with the workspaces that failed and why. */
async function eachWorkspace(script) {
  const failed = [];
  for (const { name, dir } of WORKSPACES) {
    if (!workspaceScripts(dir)[script]) continue;
    const result = await run('npm', ['run', script, '--workspace', dir]);
    if (!result.ok) failed.push({ name, reason: reason(result.output) });
  }
  return failed;
}

/** Status per Playwright project from the JSON report: pass, fail, flaky or skip. */
function e2eStatus() {
  const status = Object.fromEntries(E2E_PROJECTS.map((project) => [project, 'skip']));
  const failures = [];
  if (!existsSync(E2E_JSON)) return { status, failures };
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const project = test.projectName;
        const outcome = { expected: 'pass', flaky: 'flaky', unexpected: 'fail', skipped: 'skip' }[test.status] ?? 'fail';
        const previous = status[project];
        if (outcome === 'fail' || previous === 'fail') status[project] = 'fail';
        else if (outcome === 'flaky' || previous === 'flaky') status[project] = 'flaky';
        else if (outcome === 'pass') status[project] = 'pass';
        if (outcome === 'fail') failures.push(`${project}: ${spec.title}`);
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of JSON.parse(readFileSync(E2E_JSON, 'utf8')).suites ?? []) visit(suite);
  return { status, failures };
}

/** Every story as a Vitest browser test: render, interactions, accessibility checks. */
async function storybookTests(notes) {
  rmSync(STORYBOOK_JSON, { force: true });
  const result = await run(
    'npx',
    ['vitest', 'run', '--project', 'storybook', '--reporter=default', '--reporter=json', `--outputFile=${STORYBOOK_JSON}`],
    { cwd: path.join(root, 'storybook') },
  );
  if (existsSync(STORYBOOK_JSON)) {
    const report = JSON.parse(readFileSync(STORYBOOK_JSON, 'utf8'));
    notes.push(`storybook ${report.numPassedTests}/${report.numTotalTests} stories`);
    for (const file of report.testResults ?? []) {
      for (const test of file.assertionResults ?? []) {
        if (test.status === 'failed') notes.push(`storybook ${path.basename(file.name, '.stories.ts')} > ${test.title}`);
      }
    }
  } else if (!result.ok) {
    notes.push(`storybook: ${reason(result.output)}`);
  }
  return result.ok ? 'pass' : 'fail';
}

/**
 * Runs every check, continuing past failures so each one is reported.
 * Resolves with `{ ok, checks, e2e, notes }`; checks are 'pass', 'fail' or 'skip'.
 */
export async function verify() {
  const notes = [];
  const checks = {};

  const versionCheck = await run('node', ['scripts/sync-version.mjs', '--check']);
  if (!versionCheck.ok) notes.push('files out of sync with tickdeck.version');

  const buildFailures = await eachWorkspace('build');
  checks.build = buildFailures.length === 0 ? 'pass' : 'fail';
  notes.push(...group('build', buildFailures));

  const typeFailures = await eachWorkspace('typecheck');
  checks.typecheck = typeFailures.length === 0 ? 'pass' : 'fail';
  notes.push(...group('typecheck', typeFailures));

  const node = await run('npm', ['run', 'test:node']);
  checks.node = node.ok ? 'pass' : 'fail';
  if (!node.ok) notes.push(`node: ${reason(node.output)}`);

  checks.storybook = await storybookTests(notes);

  let e2e = Object.fromEntries(E2E_PROJECTS.map((project) => [project, 'skip']));
  const site = buildFailures.length === 0 ? await run('node', ['scripts/site.mjs']) : undefined;
  if (site?.ok) {
    // A report from an earlier run must not stand in for this one.
    rmSync(E2E_JSON, { force: true });
    const playwright = await run('npx', ['playwright', 'test']);
    const { status, failures } = e2eStatus();
    e2e = status;
    notes.push(...failures.map((failure) => `e2e ${failure}`));
    if (!playwright.ok && failures.length === 0) notes.push(`e2e: ${reason(playwright.output)}`);
  } else {
    notes.push(site ? `e2e skipped: ${reason(site.output)}` : 'e2e skipped: the apps did not build');
  }

  const ok =
    versionCheck.ok &&
    Object.values(checks).every((value) => value === 'pass') &&
    Object.values(e2e).every((value) => value === 'pass' || value === 'flaky');
  return { ok, checks, e2e, notes };
}

if (import.meta.main) {
  const version = readVersion();
  const result = await verify();
  console.log(`\ntickdeck ${version}`);
  for (const [name, value] of Object.entries(result.checks)) console.log(`  ${name.padEnd(12)} ${value}`);
  for (const [name, value] of Object.entries(result.e2e)) console.log(`  e2e ${name.padEnd(8)} ${value}`);
  for (const note of result.notes) console.log(`  - ${note}`);
  console.log(result.ok ? '\nAll checks passed.' : '\nSome checks failed.');
  process.exit(result.ok ? 0 : 1);
}
