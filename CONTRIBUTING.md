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
| `pnpm typecheck` | Type-checks every package. Run `pnpm build` first, because packages resolve each other through their `dist` output |
| `pnpm test` | Runs the test suites |
| `pnpm clean` | Removes build output |
| `pnpm changeset` | Records a release note for your change |

## Changesets

Every pull request that changes a published package needs a changeset:

1. Run `pnpm changeset`.
2. Select the affected packages and a bump for each. Before 1.0, breaking changes are minor bumps.
3. Write a short summary for users and commit the generated file in `.changeset/`.

Changes that only touch docs, tests or tooling don't need a changeset. At release time, maintainers run `changeset version` to apply pending changesets (version bumps and changelogs), then publish.

## Ground rules

- Respect the dependency direction in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Never import from a higher layer.
- `core`, `datafeed`, `broker` and `widgets-core` must not touch the DOM. Their `tsconfig.json` leaves out the DOM library to enforce this.
- Styles use flat, solid colors (no gradients), and every themable value goes through a `--tdk-*` custom property.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
