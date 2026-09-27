# Lore

Internal knowledge base, documentation hub, and AI helpdesk built on the Open Knowledge Format.
`PRD.md` says what to build, `TECH_STACK.md` says how, and `plans/` splits the work into four plans.

## What is here (Plan 1: OKF vault toolkit)

| Path | What it is |
|---|---|
| `packages/okf` | `@lore/okf`: parse and serialize notes without disturbing formatting, load the vault profile, lint (24 rules), fix, links and graph, generated index files, pure note operations, the chunker, Request Type and Action schemas |
| `packages/cli` | `@lore/cli`, the `kb` command, bundled into one file at `packages/cli/dist/kb.js` |
| `templates/vault` | The vault template repository: README, AGENTS.md, kb-writer skill, `.kb/` profile, seed hubs, and the `kb` GitHub workflow |
| `fixtures` | Shared test vaults and principals used by every plan (see `fixtures/README.md`) |
| `scripts` | `create-vault.mjs`, `publish-cli.mjs`, the synthetic vault generator, fixture builders, and `import/mmdc-runbook.ts` |
| `docs/decisions`, `docs/demos` | Decision records and a demo script per milestone |
| `apps/web`, `apps/worker` | The Library web app and its background worker (Plan 2, read path; see `docs/plan-02-summary.md`) |
| `packages/db`, `git`, `search`, `auth`, `ai` | Postgres schema and repositories, Git provider and mirrors, Meilisearch queries, namespace permissions, embeddings |
| `deploy/dev` | Docker Compose file for the Library's local services |
| Other `packages/*` | Empty placeholders owned by Plans 3 and 4 |

## Develop

Node 24 and pnpm 11.

```bash
pnpm install
pnpm turbo run typecheck test      # builds the CLI, then runs every suite
pnpm lint
pnpm --filter @lore/okf bench      # 20,000-note scale check (nightly in CI)
```

Run the CLI from source or from the bundle:

```bash
node packages/cli/src/main.ts --help
pnpm --filter @lore/cli build && node packages/cli/dist/kb.js --help
```

## Run the Library

Needs Docker. Postgres listens on 5433 and Meilisearch on 7701 so they do not clash with other
local stacks.

```bash
pnpm services:up
pnpm lore seed --vault ../mmdc/mmdc-vault --principals fixtures/principals.yaml
pnpm dev:web          # http://localhost:3000, sign in as any fixture person
pnpm dev:worker       # optional: indexes pushes and polls every 5 minutes
```

`lore seed` copies the vault folder into a bare repository under `.data/vaults/`, indexes it,
and writes `apps/web/.env.local`. It does not change the vault folder. Other commands:

```bash
pnpm lore simulate-push --vault mmdc --from ../mmdc/mmdc-vault   # re-sync after editing the vault
pnpm lore simulate-push --vault mmdc --file some.patch --now     # an outside edit, indexed inline
pnpm lore reindex --all                                          # rebuild rows and search indexes
```

The worker's integration tests use the same services and skip when they are not running.

## Create a vault

```bash
pnpm create-vault acme-vault --dir ../acme-vault --title "Acme knowledge base" --cli @acme/kb@1
```

## Publish the CLI

Run the `publish-cli` workflow with the package name (for example `@mmdc-tech/kb`), or
`node scripts/publish-cli.mjs @org/kb` with a `write:packages` token. Add `--dry-run` to check
the package first. The CLI's major version follows the profile schema version.
