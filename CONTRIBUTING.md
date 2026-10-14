# Contributing to tickdeck

## Setup

- **Node 24.** The version is in `.nvmrc`, so `nvm use` picks it up.
- **pnpm through Corepack.** The exact pnpm version is pinned in the root `package.json` (`packageManager`). Node 24 ships Corepack:

  ```sh
  corepack enable
  pnpm install
  ```

## Scripts

| Command | What it does |
|---|---|
| `pnpm build` | Builds every package (ESM and type declarations) in dependency order |
| `pnpm typecheck` | Type-checks every package and example. Run `pnpm build` first, because packages resolve each other through their `dist` output |
| `pnpm test` | Runs the test suites |
| `pnpm build:examples` | Type-checks and builds the example apps in `examples/` (after `pnpm build`) |
| `pnpm dev:vanilla`, `pnpm dev:react`, `pnpm dev:vue` | Builds the packages, then starts an example's dev server |
| `pnpm clean` | Removes build output |
| `pnpm changeset` | Records a release note for your change |

## Changesets

Every pull request that changes a published package needs a changeset:

1. Run `pnpm changeset`.
2. Select the affected packages and a bump for each. Before 1.0, breaking changes are minor bumps.
3. Write a short summary for users and commit the generated file in `.changeset/`.

Changes that only touch docs, tests or tooling don't need a changeset. The examples in `examples/` are private and never need one.

All `@tickdeck/*` packages form one fixed group (`.changeset/config.json`), so they always share a version: the highest bump among pending changesets applies to every package.

## Releases

The repository is in Changesets pre mode with the `alpha` tag (`.changeset/pre.json`), so `changeset version` produces `0.1.0-alpha.N` versions. To release:

1. `pnpm changeset version` applies pending changesets (versions and changelogs). Commit the result.
2. `pnpm build`, then `pnpm changeset publish`. In this workspace Changesets publishes through `pnpm publish`, which replaces `workspace:*` dependencies with the exact version. Never run plain `npm publish` in a package directory: the `workspace:*` ranges would be published as they are.
3. Run `pnpm changeset pre exit` before the first stable release.

## Ground rules

- Respect the dependency direction in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Never import from a higher layer.
- `core`, `datafeed`, `broker` and `widgets-core` must not touch the DOM. Their `tsconfig.json` leaves out the DOM library to enforce this.
- Styles use flat, solid colors (no gradients), and every themable value goes through a `--tdk-*` custom property.

## Refactoring rules

`packages/chart-engine` is derived from KLineChart (Apache-2.0), and its upstream files keep their original license headers.

- **Mark modified upstream files.** When you change an upstream file, add this line to its existing license header comment, once: `Modified by tickdeck contributors.` Apache-2.0 §4(b) requires modified files to say they were changed. Never remove or rewrite an upstream header.
- **New code gets the tickdeck header.** New files, and files rewritten from scratch without upstream code, start with the tickdeck Apache-2.0 header instead (see `packages/chart-engine/src/common/EventHandler.ts`).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
