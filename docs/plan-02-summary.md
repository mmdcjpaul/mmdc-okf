# Plan 2: the Library

Status as of 2026-09-27. Covers `plans/02-library.md`. Every milestone, L0 to L10, is built
and tested. What is left needs accounts and people that only the owner can arrange, and is
listed under "What is left".

## Milestones

| Milestone | Status | Where to look |
|---|---|---|
| L0 Scaffolding | Done | `apps/web`, `apps/worker`, `@lore/db` (8 migrations, checked to be additive), `deploy/docker`, `deploy/dev` |
| L1 Sign-in, teams, grants, audit | Done, with one departure | Better Auth for sign-in: Google, Microsoft Entra, email link, dev login, allowed domains. Teams and roles stay in Lore's tables (`docs/decisions/0007-sign-in.md`). The provider round trips are untested: see below |
| L2 Git provider and commit job | Done | `LocalGitProvider`, `GitHubProvider`, mirrors, the push webhook, one contract suite for both (`docs/decisions/0003-commit-api.md`, Proposed until measured on GitHub) |
| L3 Indexer | Done | Incremental equals full, with a moving clock |
| L4 Search | Done | Hybrid search, facets, Cmd-K, leak canary over HTTP, p95 under 300 ms on 20,000 notes |
| L5 Browse, notes, hubs | Done | History diffs, pinned hubs, signed URLs for assets |
| L6 Editor and changesets | Done | `docs/demos/library-L6.md` |
| L7 Review and feedback | Done | `docs/demos/library-L7.md` |
| L8 AI core and ingestion | Done | `docs/demos/library-L8.md`. PDF extraction decision is Proposed (`0004`) |
| L9 Admin | Done | `docs/demos/library-L9.md` |
| L10 Phase 2 features | Done | `docs/demos/library-L10.md`: follows, email, digest, Hygiene, taxonomy queue, Gardener, graph, batches, doc2query |
| Section 5 suite | Done | 123 end-to-end tests, all twelve scenarios |

## Tests

| Tier | Command | Count |
|---|---|---|
| Unit | `pnpm test` | 591 across 11 packages |
| Integration (Postgres, Meilisearch, object store, Mailpit) | `pnpm test:int` | 127 |
| End to end (real web app and worker, fake models, local Git) | `pnpm --filter web e2e` | 123 |
| Scale (20,000 notes) | `pnpm scale:library` | 9 checks |
| Live (real providers and GitHub) | nightly `live` job | skipped until credentials exist |

Scale, last run: full index 147 s, a one-note push searchable in 15 s (limit 30 s), search
p95 122 ms and 149 ms (limit 300 ms), the graph draws 20,000 notes with a longest
main-thread task of 435 ms (limit 1000 ms).

## Definition of done (Plan 2, section 6)

| Item | State |
|---|---|
| Every milestone's tests pass in CI, and the standalone suite passes on a clean clone | Yes, on the pull request branch. Two editing tests failed once on a slow runner and passed on the next run with the same code |
| Every read path is covered by the leak canary test | Yes: search, Cmd-K, note, lists, backlinks, similar notes, graph, Hygiene, the Gardener's report, follows. The route inventory test fails when a route skips the guard |
| Works with `AI_MODE=off` and embeddings failing | Yes |
| Decision records for the commit API and PDF extraction | Both exist, both Proposed: the measurements need GitHub and real PDFs |
| Container images | Both build in CI |
| Interfaces documented for Plans 3 and 4 | `docs/interfaces-for-plans-3-and-4.md` |

## Departures from the plan, each with its reason

| Plan says | Built | Record |
|---|---|---|
| Better Auth organization, admin, and SSO plugins | Better Auth for sign-in only; teams, roles, and grants in Lore's tables | `0007` |
| MinIO | Versity S3 gateway | `0006` |
| Testcontainers | Compose services, and tiers that fail when they are down | `0005` |
| msw for provider tests | A local HTTP server | `0003` |
| Batch client tests against recorded responses | Replies written from the providers' documented shapes, not recorded | `docs/demos/library-L10.md` |
| Pull-request mode | At the provider (`createBranch`, `openPullRequest`). Per vault, with auto-merge, is Plan 4 | `0003` |

## What is left

None of this can be done from a keyboard alone.

| What | Needs | Then |
|---|---|---|
| Google and Entra sign-in, end to end | A test Google Workspace and a test Entra tenant, with OAuth clients for the deployment's URL | Sign in once with each; `docs/demos/library-L1-sign-in.md` |
| GitHub commits, measured | A scratch repository and a test installation of the app | Set `LIVE_GITHUB_REPO` and `LIVE_GITHUB_TOKEN`; fill in `0003` and accept it |
| Batch APIs, against the real services | Provider keys as repository secrets | The nightly `live` job stops skipping |
| PDF extraction spike | Ten real PDFs from the company, scanned ones among them | Fill in `0004` and accept it |
| Usability test of the editor (risk table) | Three contributors | Decide whether CodeMirror is enough |
