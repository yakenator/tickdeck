// Shared helpers for the playground scripts: paths, the pinned version and running commands.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');
export const versionFile = path.join(root, 'tickdeck.version');
export const resultsFile = path.join(root, 'RESULTS.md');
export const siteDir = path.join(root, 'dist-site');

/** Apps served as web pages, in the order the landing page and the e2e tests list them. */
export const WEB_APPS = ['cdn', 'vanilla', 'react', 'vue'];
export const APPS = readdirSync(path.join(root, 'apps'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(path.join(root, 'apps', entry.name, 'package.json')))
  .map((entry) => entry.name)
  .sort();

export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
/** `@tickdeck/<name>@<version>` in CDN URLs and install commands. */
const PINNED = /(@tickdeck\/[a-z-]+@)\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/g;
/** `<span data-tickdeck-version>0.1.0</span>` on the landing page. */
const MARKER = /(data-tickdeck-version>)[^<]*(<)/g;

export function readVersion() {
  const version = readFileSync(versionFile, 'utf8').trim();
  if (!SEMVER.test(version)) throw new Error(`tickdeck.version holds "${version}", which is not a version`);
  return version;
}

export function writeVersion(version) {
  writeFileSync(versionFile, `${version}\n`);
}

/** Text files that mention the version: the CDN page, the landing page and the READMEs. */
function textFiles() {
  return ['index.html', 'README.md', 'apps/cdn/index.html', ...APPS.map((app) => `apps/${app}/README.md`)].filter((file) =>
    existsSync(path.join(root, file)),
  );
}

/**
 * Applies `version` to every app's `@tickdeck/*` dependencies, the CDN URLs and
 * the snippets. Returns the files that differ; writes them unless `check` is set.
 */
export function syncVersion(version, { check = false } = {}) {
  const changed = [];
  const update = (file, next) => {
    const full = path.join(root, file);
    if (readFileSync(full, 'utf8') === next) return;
    changed.push(file);
    if (!check) writeFileSync(full, next);
  };

  for (const app of APPS) {
    const file = `apps/${app}/package.json`;
    const pkg = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    for (const field of ['dependencies', 'devDependencies']) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (name.startsWith('@tickdeck/')) pkg[field][name] = version;
      }
    }
    update(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  for (const file of textFiles()) {
    const text = readFileSync(path.join(root, file), 'utf8');
    update(file, text.replace(PINNED, `$1${version}`).replace(MARKER, `$1${version}$2`));
  }
  return changed;
}

/**
 * Runs a command in the playground, streaming its output, and resolves with
 * its exit status, its standard output and the last lines it printed.
 */
export function run(command, args, { cwd = root, env = {}, quiet = false } = {}) {
  if (!quiet) console.log(`\n$ ${[command, ...args].join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    let stdout = '';
    const keep = (chunk, stream) => {
      if (!quiet) stream.write(chunk);
      tail = (tail + chunk).slice(-8000);
    };
    child.stdout.on('data', (chunk) => {
      keep(chunk, process.stdout);
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => keep(chunk, process.stderr));
    child.on('error', (error) => resolve({ ok: false, status: -1, stdout, output: String(error) }));
    child.on('close', (status) => resolve({ ok: status === 0, status, stdout, output: tail }));
  });
}

/** The scripts an app's package.json defines. */
export function appScripts(app) {
  return JSON.parse(readFileSync(path.join(root, 'apps', app, 'package.json'), 'utf8')).scripts ?? {};
}
