# Lore

Internal knowledge base, documentation hub, and AI helpdesk built on the Open Knowledge Format.
`PRD.md` says what to build, `TECH_STACK.md` says how, and `plans/` splits the work into four plans.

## What is here

| Path | What it is |
|---|---|
| `packages/okf` | `@lore/okf`: parse and serialize notes without disturbing formatting, the vault profile, lint (24 rules), links and graph, generated indexes, note and vocabulary operations, the chunker. The API is stable and versioned (`CHANGELOG.md`) |
| `packages/cli` | The `kb` command, bundled into one file |
| `apps/web` | The Library: browse, search, read, edit, review, upload, capture, Admin, Hygiene, Taxonomy, Graph |
| `apps/worker` | Indexing, the changeset and ingestion jobs, batches, the Gardener, email, and the internal API |
| `packages/db` | Postgres schema, migrations, and every query |
| `packages/git` | `GitProvider`: a bare repository on disk, or GitHub |
| `packages/changesets` | The write pipeline: prepare, lint in memory, review rules, commit message |
| `packages/ai` | The model gateway, budgets, usage, provider batch APIs, embeddings |
| `packages/ingest` | Extractors, the atomizer's plan and its checks, captures, the object store |
| `packages/search`, `auth`, `ui` | Meilisearch queries, permissions and sign-in, shared components |
| `templates/vault`, `fixtures`, `scripts` | The vault template, shared test vaults, and tools |
| `docs` | Decisions, a demo per milestone, summaries of Plans 1 and 2, and what Plans 3 and 4 build on |
| `deploy` | Compose file for local services, and the container images |
| `packages/desk`, `desk-ui`, `tickets`, `mcp` | Empty placeholders owned by Plans 3 and 4 |

Where things stand: `docs/plan-01-summary.md`, `docs/plan-02-summary.md`, and
`plans/05-completion-plans-1-2.md`.

## Develop

Node 24 and pnpm 11.

```bash
pnpm install
pnpm turbo run typecheck test      # builds the CLI, then runs every unit suite
pnpm test:int                      # needs `pnpm services:up`
pnpm --filter web e2e              # the real web app and worker, in a browser
pnpm scale:library                 # 20,000 notes; needs Docker for k6
pnpm lint
pnpm --filter @lore/okf bench      # 20,000-note scale check (nightly in CI)
```

Run the CLI from source or from the bundle:

```bash
node packages/cli/src/main.ts --help
pnpm --filter @lore/cli build && node packages/cli/dist/kb.js --help
```

## Run the Library

Needs Docker. Postgres listens on 5433, Meilisearch on 7701, the object store on 9002, and
Mailpit on 8025, so they do not clash with other local stacks.

```bash
pnpm services:up
pnpm lore seed --vault ../mmdc/mmdc-vault --principals fixtures/principals.yaml
AI_MODE=fake SMTP_URL=smtp://127.0.0.1:1025 pnpm dev:library   # web on :3000 and the worker
```

Sign in as any fixture person. `AI_MODE=fake` answers from scripts and costs nothing;
`AI_MODE=live` uses the keys saved in Admin and needs `APP_ENCRYPTION_KEY`.

`lore seed` copies the vault folder into a bare repository under `.data/vaults/`, indexes it,
and writes `apps/web/.env.local`. It does not change the vault folder. Other commands:

```bash
pnpm lore simulate-push --vault mmdc --from ../mmdc/mmdc-vault   # re-sync after editing the vault
pnpm lore simulate-push --vault mmdc --file some.patch --now     # an outside edit, indexed inline
pnpm lore reindex --all                                          # rebuild rows and search indexes
pnpm lore digest --force                                         # send the weekly digest now
```

## Create a vault

```bash
pnpm create-vault acme-vault --dir ../acme-vault --title "Acme knowledge base" --cli @acme/kb@1
```

## Publish the CLI

Run the `publish-cli` workflow with the package name (for example `@mmdc-tech/kb`), or
`node scripts/publish-cli.mjs @org/kb` with a `write:packages` token. Add `--dry-run` to check
the package first. The CLI's major version follows the profile schema version.
