// node scripts/update.mjs [<version> | <dist-tag>] [--note <text>]...   (default: latest)
//
// Pins every app to one published tickdeck version, installs it from the npm
// registry, runs every check and appends the outcome to RESULTS.md.
// Each --note adds its text to the row's notes, before the notes of the checks.
// Exits non-zero when anything failed.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SEMVER, readVersion, resultsFile, run, syncVersion, writeVersion } from './lib.mjs';
import { E2E_PROJECTS, verify } from './verify.mjs';

const PACKAGE = '@tickdeck/all';

/** The version or dist-tag (the first argument that is not an option) and the --note texts. */
function parseArguments(args) {
  const extra = [];
  let target;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--note') {
      const text = args[index + 1];
      if (!text) throw new Error('--note needs a text');
      extra.push(text);
      index += 1;
    } else if (target === undefined) {
      target = args[index];
    } else {
      throw new Error(`Unexpected argument "${args[index]}"`);
    }
  }
  return { requested: target ?? 'latest', extra };
}

const { requested, extra } = (() => {
  try {
    return parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return process.exit(1);
  }
})();

async function npmView(spec, field) {
  const result = await run('npm', ['view', spec, field, '--json'], { quiet: true });
  if (!result.ok) return undefined;
  const value = JSON.parse(result.stdout.trim() || 'null');
  return Array.isArray(value) ? value.at(-1) : value;
}

/** A version is used as given (it must exist); anything else is a dist-tag such as latest or alpha. */
async function resolveVersion(input) {
  if (SEMVER.test(input)) {
    if (!(await npmView(`${PACKAGE}@${input}`, 'version'))) throw new Error(`${PACKAGE}@${input} is not on the registry`);
    return input;
  }
  const version = input === 'latest' ? await npmView(PACKAGE, 'version') : await npmView(PACKAGE, `dist-tags.${input}`);
  if (!version) throw new Error(`${PACKAGE} has no dist-tag "${input}"`);
  return version;
}

const HEADER = [
  '| Date (UTC) | Version | Install | Build | Typecheck | Node | Storybook | E2E cdn | E2E vanilla | E2E react | E2E vue | Site | Notes |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
];

function appendResult({ version, install, checks, e2e, notes }) {
  if (!existsSync(resultsFile)) writeFileSync(resultsFile, `# Playground results\n\n${HEADER.join('\n')}\n`);
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const cells = [date, version, install, checks.build, checks.typecheck, checks.node, checks.storybook, ...E2E_PROJECTS.map((project) => e2e[project])];
  const note = notes.join('; ').replaceAll('|', '\\|').replaceAll('\n', ' ');
  const row = `| ${cells.map((cell) => cell ?? 'skip').join(' | ')} | ${note} |`;
  const text = readFileSync(resultsFile, 'utf8');
  appendFileSync(resultsFile, `${text.endsWith('\n') ? '' : '\n'}${row}\n`);
  return row;
}

const previous = readVersion();
const version = await resolveVersion(requested).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
console.log(`tickdeck ${previous} -> ${version}${requested === version ? '' : ` (${requested})`}`);

writeVersion(version);
const changed = syncVersion(version);
console.log(changed.length ? `Updated:\n  ${changed.join('\n  ')}` : 'Every file already used this version.');

const notes = [];
if (previous !== version) notes.push(`from ${previous}`);
notes.push(...extra);
const deprecated = await npmView(`${PACKAGE}@${version}`, 'deprecated');
if (deprecated) notes.push(`deprecated on npm: ${deprecated}`);
const install = await run('npm', ['install', '--no-audit', '--no-fund']);
let result;
if (install.ok) {
  result = await verify();
} else {
  result = { ok: false, checks: {}, e2e: {}, notes: ['npm install failed'] };
}
const row = appendResult({ version, install: install.ok ? 'pass' : 'fail', ...result, notes: [...notes, ...result.notes] });

console.log(`\nRESULTS.md:\n${row}`);
console.log(result.ok ? `\ntickdeck ${version} passed every check.` : `\ntickdeck ${version} failed; see RESULTS.md.`);
process.exit(result.ok ? 0 : 1);
