# Plan 2 progress: the Library, read path first

Status as of 2026-09-25. Covers `plans/02-library.md`. The goal of this first pass was to see the
MMDC vault loaded into the Library, so it builds the read path end to end: a person signs in,
browses, searches, and reads notes and hubs, and pushes made outside Lore reach the Library
through the indexer. Editing, review, AI, and Admin come later.

## Summary

- The MMDC vault (`/Users/polaris/projects/mmdc/mmdc-vault`) is loaded into the Library: 239
  notes and 25 hubs, 829 links, 35 images, and 1,578 vectors. `lore seed` copies the vault into a
  bare repository under `.data/vaults/mmdc.git`; the vault folder itself is never changed.
- Built: scaffolding (L0), dev sign-in with grants and the permission helpers (part of L1), the
  local Git provider (L2 without GitHub), the indexer (L3), search (L4), and browse, note, and hub
  pages (L5).
- Not started: the editor and changesets (L6), review and feedback (L7), AI core and ingestion
  (L8), Admin (L9), and phase 2 features (L10).
- 229 tests pass across the workspace (61 new). Typecheck, ESLint, and `next build` are clean.
- Nothing is committed yet.

## How to run it

```bash
pnpm services:up                                                        # Postgres :5433, Meilisearch :7701, Mailpit :8025
pnpm lore seed --vault ../mmdc/mmdc-vault --principals fixtures/principals.yaml
pnpm dev:web                                                            # http://localhost:3000
pnpm dev:worker                                                         # optional: indexes pushes, polls every 5 minutes
```

Seeding again is safe. When the vault folder has not changed it commits nothing and skips the
index (`Indexed mmdc: already at 58000010`). Other commands:

| Command | What it does |
|---|---|
| `pnpm lore simulate-push --vault mmdc --from ../mmdc/mmdc-vault` | Commits the vault folder's current state, as if pushed from Obsidian |
| `pnpm lore simulate-push --vault mmdc --file edit.patch --now` | Applies a patch from outside Lore and indexes it inline |
| `pnpm lore reindex --all` | Clears the vault's rows and search indexes and rebuilds them; vectors come from the cache |
| `pnpm lore seed ... --fresh` | Deletes the Library's copy of the vault and loads it again |

## Milestones

| Milestone | Status | What exists |
|---|---|---|
| L0 Scaffolding | Done, except container images | `apps/web` (Next.js 16, Tailwind v4), `apps/worker` (pg-boss, `/health`, graceful shutdown), `@lore/db` (Drizzle schema, one migration, repositories), zod config, pino logs, `deploy/dev/library.compose.yml`, and the `lore` CLI |
| L1 Auth, teams, grants | Partial | Dev sign-in with an HMAC-signed cookie, refused when `NODE_ENV=production`; `computeAccess`, `readableNamespaces`, `requireNamespace`; allowed-domain check; sign-in audit entries. Better Auth, Google, and Entra are not wired yet |
| L2 Git provider | Partial | `GitProvider` interface; `LocalGitProvider` with compare-and-swap commits and push events; mirror reads (`ls-tree`, batched `cat-file`, `log --raw`); `GitTreeSource`, so `@lore/okf` loads a vault straight from Git. `GitHubProvider` and the commit job are not built |
| L3 Indexer | Done | All nine steps from the plan: load the tree, derive rows, history with change classes, chunk and embed through the cache, assets, Meilisearch, one Postgres transaction ending with the head, and a `vault.indexed` event |
| L4 Search | Done, except the k6 load test | Index settings, `buildReadFilter`, `searchNotes`, `searchChunks`, `similarNotes`, hybrid search at a 0.3 semantic ratio with keyword fallback, a search-only key for the web app, the Cmd-K palette, and a results page with facets |
| L5 Browse, note pages, hubs | Mostly done | Home, Namespaces with folders, Themes, Systems, Types (table and card views), Tags, note pages (banners, outline, backlinks, related notes, sources, history, Sigma.js local graph), hub pages, stale-slug redirects, 404 for unreadable notes, a checked asset route, and branding from `settings`. The diff view and the Playwright and axe suites are not built |

Design references came from Mobbin (Linear, Confluence, and Intercom note pages; Mintlify and
Vapi command palettes): a quiet grey sidebar, a centred reading column, and a sticky details panel
on the right. The layout works at 375 px and in dark mode.

## Tests

| Area | What is covered |
|---|---|
| Permissions | The capability matrix from `fixtures/principals.yaml`, run for every fixture principal; allowed domains; session tampering and expiry; dev login refused in production |
| Git | Commits to an empty repository, a moved head, deletes, binary files, diffs, renames, trailers, and a commit served as a `FileSource` |
| Indexer | `vault-acme` counts, trust tiers, draft and deprecated status, wanted notes, hub members, and history. A rerun at the same head does nothing. A commit that only touches generated files writes and embeds nothing. A rename keeps the id. A major version bump pushed from outside is a Process change. Writing a wanted note resolves the links to it |
| Incremental equals full | 20 scripted commits (edits, renames, deletes, a folder move, assets, tags, broken frontmatter), indexed one at a time, then compared table by table with a rebuild from scratch. The rebuild takes every vector from the cache |
| Leak canary | `zebra-payroll-canary` is found by `erin` and `dana` only, across `searchNotes`, `searchChunks` (with and without a vector), `getNote`, and `listNotes`. Similar notes and backlinks never cross into `people-ops` for `carol` |
| No AI | With a failing embedder, indexing completes and keyword search works (LB-6) |
| Rendering | Raw HTML and `javascript:` links are dropped; note links become `/n/<id>/<slug>`; links into unreadable namespaces become plain text; wanted notes, folder indexes, and images map correctly; heading ids match the outline |

The worker tests need `pnpm services:up`. They skip locally when the services are down and fail
in CI, where the `test` job now starts Postgres and Meilisearch (`LORE_REQUIRE_SERVICES=1`).

Checked by hand in the browser: sign-in, Home, search with facets, Cmd-K, a theme hub with its
graph, a runbook, a knowledge-transfer document with seven images, the Runbook collection in card
view, and a note page at phone width. An edit pushed from outside Lore appeared on the note page
about six seconds later, with "External editor" in its history. The demo edit was then removed
with `lore seed --fresh`.

## Issues encountered

| Issue | Cause | Resolution |
|---|---|---|
| Meilisearch would not start on port 7700 | The `mmdc-v3` stack already uses 7700, and 5432 for Postgres | The Library uses 5433 for Postgres and 7701 for Meilisearch |
| Deleting a file in a Lore commit failed with "this operation must be run in a work tree" | `git update-index --force-remove` needs a work tree, and the local vault is a bare repository | Commits now write every change with `git update-index --index-info`, where mode 0 removes an entry |
| Every page returned 500 with "Can't resolve '../migrations'" | Turbopack treats `new URL("../migrations", import.meta.url)` in `@lore/db` as an asset to bundle | Migrations moved to a separate entry point, `@lore/db/migrate`, which only the worker and CLI import |
| The first search result for "salesforce stuck" was a long ledger, not the runbook | Meilisearch ranks body proximity before attribute by default, and long notes mention everything | Title and description matches now rank first (`attributeRank` before `proximity`) |
| MMDC images were stored as body links | The MMDC import writes images as reference definitions (`[image1]: /platform/_assets/...`) | Any link into `_assets/` counts as an image link |
| Incremental indexing and a rebuild disagreed on history (71 rows against 69) | History for deleted notes stayed after incremental runs. Also, a note whose frontmatter stopped parsing got a new id, and its old commits were mapped differently by the two paths | Deleting a note deletes its history, and each history entry takes its id from that revision's own file. Only notes that exist at the head keep history |
| `next build` failed while prerendering `/login` | `.env.local` sets `AUTH_DEV_LOGIN=true`, and the production guard refused it. This is the guard working as intended | `/login` now renders per request (`connection()`). Production builds must set `AUTH_DEV_LOGIN=false` |
| ESLint reported 17,745 problems | It was linting Next's `.next` build output | `.next`, `next-env.d.ts`, and `.data` are ignored |
| Hub files list every member, including restricted notes | The generated member block in a hub file is written for the whole vault | The indexer strips the block. Hub pages build member lists from Postgres, filtered by what the reader can see |
| Small UI problems found in the browser | Double focus ring on search inputs; hub "Owners" showed namespaces instead of teams; graph labels hidden on small graphs | Fixed |
| The 21st.dev `magic` MCP server did not connect | Its API key is missing or was reset | Not needed; Mobbin was used for design references |

## Changes from the plan

- Postgres runs on port 5433 and Meilisearch on 7701 (see Issues). The compose file pins
  `postgres:18.6` because that image was already local; the plan asks for 16 or later.
- Assets go to a folder store (`.data/objects`) behind an `ObjectStore` interface, not MinIO.
  The asset route checks the namespace and then streams the file. In production it should
  redirect to a signed bucket URL instead.
- Dev sign-in uses Lore's own `users`, `teams`, and `team_members` tables with a signed cookie.
  Better Auth should take over these tables in L1 without changing the permission helpers.
- The indexer derives every note on every run and writes only rows whose hash changed. This keeps
  incremental and full runs identical. It will need a narrower pass for 20,000-note vaults.
- Integration tests run against the dev compose services instead of Testcontainers.
- `EMBEDDINGS=hash` (deterministic feature hashing) is the default locally. Its vectors are weak,
  so hybrid ranking will improve once a real embedder arrives in L8.

## Open questions

- The dev principals are the Acme fixture people (`alice`, `bob`, `carol`, `dana`, `erin`). MMDC
  needs its own principals file with real people and teams.
- Every MMDC note shows "Updated by Lore seed" because the vault has no Git history yet. Once
  `mmdc-vault` has commits, `lore seed --fresh` pushes its real history.
- The plan's commit-API decision record is numbered `0002`, which is already taken by
  `docs/decisions/0002-kb-query-index.md`.

## Remaining work

| Item | Needs |
|---|---|
| Better Auth with Google, Entra, and magic link; organization and teams plugins | Test Google Workspace and Entra tenants |
| `GitHubProvider`, the commit job, and the commit API spike | A scratch GitHub repository and a test app installation |
| Diff view in note history (needs the worker's mirror API) | Nothing external |
| Playwright suite, axe-core sweep, k6 search load test | Nothing external |
| Container images for `apps/web` and `apps/worker` | Nothing external |
| L6 to L10: editor, changesets, review, feedback, AI core, ingestion, Admin, phase 2 | Plan order; L8 needs AI keys for the `@live` job |
| MMDC principals file | A list of real users and teams |
| Commit the work | Your go-ahead |

## Where things are

| Path | Contents |
|---|---|
| `apps/web` | Library pages (`src/app/(library)`), sign-in, `/api/search`, `/assets/...`, and the markdown renderer (`src/lib/markdown.ts`) |
| `apps/worker` | Index job (`src/indexer`), pg-boss runtime, the `lore` CLI, and integration tests with their harness |
| `packages/db` | Schema, migration, and repositories; `@lore/db/migrate` is separate so the web bundle never sees it |
| `packages/git`, `search`, `auth`, `ai` | Git provider and mirrors, Meilisearch, permissions and sessions, embedders |
| `deploy/dev/library.compose.yml` | Postgres, Meilisearch, and Mailpit |
| `.claude/launch.json` | `library-web` and `library-worker` for the desktop preview |
