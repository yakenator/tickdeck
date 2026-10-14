// Assembles dist-site/: the landing page at the root, every web app below it
// (cdn/, vanilla/, react/, vue/) and the Storybook build (storybook/). All links
// are relative, so the site works at any path, such as /tickdeck/ on GitHub Pages.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WEB_APPS, readVersion, resultsFile, root, siteDir } from './lib.mjs';

const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** The newest rows of RESULTS.md as an HTML table, newest first. */
function resultsTable(limit = 8) {
  if (!existsSync(resultsFile)) return '<p class="muted">No recorded runs yet.</p>';
  const rows = readFileSync(resultsFile, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.startsWith('|---'))
    .map((line) =>
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim().replaceAll('\\|', '|')),
    );
  const [header, ...body] = rows;
  if (!header || body.length === 0) return '<p class="muted">No recorded runs yet.</p>';
  const cell = (text, column) => {
    const status = ['pass', 'fail', 'flaky', 'skip'].includes(text) ? ` class="status-${text}"` : '';
    // Notes can be long; the landing page shows the start, RESULTS.md keeps all of it.
    const shown = column === header.length - 1 && text.length > 180 ? `${text.slice(0, 180)}…` : text;
    return `<td${status}${shown === text ? '' : ` title="${escape(text).replaceAll('"', '&quot;')}"`}>${escape(shown)}</td>`;
  };
  return [
    '<div class="table-scroll"><table class="results">',
    `<thead><tr>${header.map((text) => `<th scope="col">${escape(text)}</th>`).join('')}</tr></thead>`,
    `<tbody>${body
      .slice(-limit)
      .reverse()
      .map((row) => `<tr>${row.map((text, column) => cell(text, column)).join('')}</tr>`)
      .join('')}</tbody>`,
    '</table></div>',
  ].join('\n');
}

rmSync(siteDir, { recursive: true, force: true });
mkdirSync(siteDir, { recursive: true });

const landing = readFileSync(path.join(root, 'index.html'), 'utf8').replace('<!-- results -->', resultsTable());
writeFileSync(path.join(siteDir, 'index.html'), landing);
// GitHub Pages: serve the files as they are.
writeFileSync(path.join(siteDir, '.nojekyll'), '');

for (const app of WEB_APPS) {
  const target = path.join(siteDir, app);
  if (app === 'cdn') {
    // No build step: the page is published exactly as written.
    mkdirSync(target);
    cpSync(path.join(root, 'apps/cdn/index.html'), path.join(target, 'index.html'));
    continue;
  }
  const dist = path.join(root, 'apps', app, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error(`apps/${app}/dist is missing. Run \`npm run build\` first.`);
    process.exit(1);
  }
  cpSync(dist, target, { recursive: true });
}

// Storybook's static build, at storybook/ next to the apps.
const storybook = path.join(root, 'storybook', 'dist');
if (!existsSync(path.join(storybook, 'index.html'))) {
  console.error('storybook/dist is missing. Run `npm run build` first.');
  process.exit(1);
}
cpSync(storybook, path.join(siteDir, 'storybook'), { recursive: true });

console.log(`dist-site/ is ready with tickdeck ${readVersion()}: index.html, ${[...WEB_APPS, 'storybook'].map((name) => `${name}/`).join(', ')}`);
