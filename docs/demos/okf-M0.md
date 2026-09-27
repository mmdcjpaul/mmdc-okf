# Demo: Plan 1 M0, monorepo skeleton

1. `pnpm install` on a clean clone (Node 24, pnpm 11).
2. `pnpm turbo run typecheck test` builds the CLI, type-checks every package, and runs the
   `@lore/okf` and `@lore/cli` suites. Run it twice: the second run is served from the turbo cache.
3. `pnpm lint` runs ESLint over the workspace.
4. Open `packages/cli/package.json`: it depends on `@lore/okf` through `workspace:*`, which is the
   cross-package import the milestone asks for.
5. `.github/workflows/ci.yml` runs the same steps on every pull request.
