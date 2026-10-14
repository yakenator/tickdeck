# tickdeck playground

Consumer test apps for tickdeck. Each one installs the **published** `@tickdeck/*` packages from the public npm registry at one pinned version, exactly as an external project would, and shows one way to adopt tickdeck. After every release the playground moves to the new version and checks it end to end: install, build, type check, Node tests and a browser run of the trading flow.

The playground is not part of the pnpm workspace and never uses `workspace:`, `link:` or `file:` dependencies. It uses npm, with its own `package-lock.json` and npm workspaces under `apps/`.

Hosted build: <https://yakenator.github.io/tickdeck/> (once GitHub Pages is enabled, see below).

## Apps

| App | Adoption | What it shows |
|---|---|---|
| [`apps/cdn`](apps/cdn) | `<script type="module">` from jsDelivr, no build | Chart, ticket, trade buttons, account panel and notifications in one static HTML page |
| [`apps/vanilla`](apps/vanilla) | Web Components from npm, bundled with Vite | The full trading screen with every integration recipe from `examples/` |
| [`apps/react`](apps/react) | `@tickdeck/react` with React 19 | The same screen; the chart is created in an effect |
| [`apps/vue`](apps/vue) | `@tickdeck/vue` with Vue 3 | The same screen; the chart is created in `onMounted` |
| [`apps/node`](apps/node) | Headless `core`, `datafeed`, `broker` | A strategy script (bracket order, fill, take-profit) and an import and SSR check for the browser packages and wrappers |
| [`apps/types`](apps/types) | TypeScript | Type checks with `bundler`, `nodenext` and `node16` resolution and `skipLibCheck: false` |

[`index.html`](index.html) is the landing page: one paragraph and a snippet per method, links to the apps and the latest results.

## Version

[`tickdeck.version`](tickdeck.version) is the only place the version is chosen. Every app depends on exactly that version, and the CDN URL and the snippets carry it too. `npm run check:version` fails if any of them drifts.

## Run it

```sh
cd playground
npm ci
npx playwright install chromium   # once
npm run verify                    # build, type check, Node tests, browser tests
npm run site                      # dist-site/: landing page plus every app
npm run preview                   # serves dist-site/ at http://127.0.0.1:4310/tickdeck/
```

| Script | What it does |
|---|---|
| `npm run install:all` | `npm install` for every app (npm workspaces) |
| `npm run build` | Builds the Vite apps (`base: './'`, so they work at `/tickdeck/<app>/` on GitHub Pages and anywhere else) |
| `npm run typecheck` | `tsc` or `vue-tsc` in every app, and the three configurations of `apps/types` |
| `npm run test:node` | `apps/node`: the headless strategy, then the import and SSR checks |
| `npm run test:e2e` | Assembles `dist-site/`, serves it below `/tickdeck/` and runs Playwright (Chromium) against it |
| `npm run verify` | All of the above, continuing past failures and printing a summary; exits non-zero if anything failed |
| `npm run site` | Assembles `dist-site/` (needs `npm run build` first) |
| `npm run preview` | Serves `dist-site/` like GitHub Pages |
| `npm run check:version` | Fails if any file does not use the version in `tickdeck.version` |

### Browser tests

[`e2e/trading.spec.ts`](e2e/trading.spec.ts) runs on `cdn`, `vanilla`, `react` and `vue`:

1. The page loads the pinned version (`#version`), defines every `tdk-*` element and logs no console errors or warnings.
2. A limit buy of 10 with take-profit and stop-loss is entered in the ticket with the mouse and keyboard and submitted.
3. The order and its two held exits appear in the account panel and as chart lines.
4. The "Simulated market" control moves the mock market through the limit: the entry fills and a toast says so.
5. The position shows in the panel and on the chart, with live P&L.
6. The market reaches the take-profit: the position closes, the stop-loss is cancelled, a toast reports the P&L and the panel shows it as realized.

[`e2e/recipes.spec.ts`](e2e/recipes.spec.ts) checks the integrations each app wires itself (vanilla, React, Vue): Alt-click a chart price into the ticket, one instrument for chart, ticket and buttons, Modify on an order of another instrument, and TP/SL on a position. [`e2e/landing.spec.ts`](e2e/landing.spec.ts) checks the landing page. The HTML report with screenshots of each step is written to `e2e-report/html/`.

The CDN test loads tickdeck from jsDelivr, so it needs network access.

## After each release

```sh
node playground/scripts/update.mjs 0.1.0-alpha.2   # a version, or a dist-tag: latest, alpha
git add playground && git commit -m "chore(playground): verify tickdeck 0.1.0-alpha.2"
```

[`scripts/update.mjs`](scripts/update.mjs) resolves the version (`latest` is `npm view @tickdeck/all version`; any other non-version argument is read as a dist-tag), writes `tickdeck.version`, updates every app's dependencies, the CDN URL and the snippets, runs `npm install`, runs every check, and appends a row to [`RESULTS.md`](RESULTS.md) with the UTC date, the version, pass or fail for each check and notes. It exits non-zero when anything failed. Commit `RESULTS.md` with the version bump, whatever the outcome.

While the repository is in Changesets pre mode, new prereleases are published under the `alpha` dist-tag, and `latest` only moves when a version is published with that tag. Use `update.mjs alpha` to follow the prereleases.

## CI and GitHub Pages

[`.github/workflows/playground.yml`](../.github/workflows/playground.yml) runs on pushes to `main` that touch `playground/`, daily, and by hand (`workflow_dispatch`, with a version input that defaults to `latest`):

- On push it runs `npm run verify` against the pinned version. On the schedule and by hand it runs `scripts/update.mjs` with the requested version, which verifies that version and adds its row to the job summary.
- It then builds the site and deploys it to GitHub Pages. The deploy job is allowed to fail, so the workflow stays green until Pages is enabled.

To publish the site, enable Pages once: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site is then served at `https://<owner>.github.io/tickdeck/`.
