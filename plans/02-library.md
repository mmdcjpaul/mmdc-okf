# Plan 2: Library

The Obsidian-style knowledge base web app, its background worker, and the platform packages it needs: auth and grants, Git, the indexer, search, AI core, ingestion, review, feedback, and admin. This covers PRD phase 1 in full and the Library half of phase 2.

| Item | Value |
|---|---|
| PRD sections | 5, 6.6, 7 (all), 8, 9, 12 (AI core), 13 (branding and flags) |
| TECH_STACK sections | 2, 3, 6, 7, 8, 9, 12, 15 (dev compose only), 17 |
| Requirements | AU-1 to AU-16, LB-1 to LB-11, AC-1 to AC-4, AC-6 (data model) |
| Packages | `apps/web`, `apps/worker`, `packages/db`, `auth`, `git`, `search`, `ai`, `ingest`, `ui` |
| Depends on | Plan 1 (`@lore/okf`, fixtures) |
| Depended on by | Plan 3 optionally (`@lore/search`, `@lore/ai`); Plan 4 |

---

## 1. Scope

In scope: everything a person does in the Library without the Desk, from sign-in to publishing a note, plus the worker jobs that keep indexes current.

Out of scope, handled elsewhere:

- The Desk, the ticket mirror, and My tickets (Plan 3).
- Installing the real GitHub App on a company vault, the CI regeneration loop against production, Multica, production deployment, service accounts, and the MCP server (Plan 4).
- The second-vault interface (Plan 4, phase 3). The data model supports several vaults from L0.

---

## 2. Running the Library on its own

The Library must run end to end on a laptop with no GitHub, no AI keys, and no Desk.

```text
deploy/dev/library.compose.yml
  postgres:18      (port 5433)
  meilisearch:<pinned>  (port 7701)
  objects          (S3-compatible object store, port 9002; see docs/decisions/0006)
  mailpit          (catches email)
```

| Setting | Standalone value | Effect |
|---|---|---|
| `GIT_PROVIDER` | `local` | `LocalGitProvider` over a bare repository in `.data/vault.git`. Commits enqueue the same index job a GitHub push webhook would |
| `AI_MODE` | `fake`, `off`, or `live` | `fake` uses scripted responses from `packages/ai/test/scripts/`; `off` exercises the no-AI paths; `live` uses keys from Admin |
| `EMBEDDINGS` | `hash`, `local`, or `provider` | `hash` is deterministic feature hashing (1,024 dims) for tests; `local` uses transformers.js |
| `AUTH_DEV_LOGIN` | `true` | Adds a "sign in as" page listing fixture principals. Refused at startup when `NODE_ENV=production` |
| `FEATURE_DESK` | `false` | Hides Desk and My tickets from the sidebar |

Commands:

```bash
docker compose -f deploy/dev/library.compose.yml up -d
pnpm lore seed --vault fixtures/vault-acme --principals fixtures/principals.yaml
pnpm dev:library
pnpm lore simulate-push --file fixtures/patches/obsidian-edit.patch
```

`lore seed` creates the bare repository from the fixture, creates users, teams, and grants, registers the vault, and runs a full index. `lore simulate-push` commits to the bare repository from outside Lore, the way a person in Obsidian or a coding agent would, so the external-writer path is testable locally.

---

## 3. Architecture inside this plan

```mermaid
flowchart LR
  subgraph web[apps/web]
    UI[Library pages] --> API[Route handlers]
  end
  API --> AUTH[@lore/auth]
  API --> SRCH[@lore/search]
  API --> DB[(Postgres)]
  API -->|create changeset| DB
  subgraph worker[apps/worker]
    CJ[commit job] --> GIT[@lore/git]
    IX[index job] --> OKF[@lore/okf]
    IX --> MS[(Meilisearch)]
    ING[ingest jobs] --> AI[@lore/ai]
  end
  DB -->|pg-boss| worker
  GIT -->|push event| IX
```

Rules that hold throughout:

- The web container never touches Git or the file system. It reads Postgres and Meilisearch and writes changesets.
- Every read path builds its filter from `readableNamespaces`. There is no read helper that skips it.
- Every write, whatever its source, becomes a changeset, is linted by `@lore/okf` against an `OverlaySource`, passes the review rules, and is committed by the worker.
- Side effects of a change class (badges, log entries, notifications, flagged linking notes) are triggered by the indexer, not by the editor. That way Git pushes and Lore edits behave identically (AU-14).

---

## 4. Milestones

Sizes: S is 1 to 3 days, M is 3 to 6 days, L is 1 to 2 weeks.

### L0. Platform scaffolding (M)

Build:

- `apps/web`: Next.js App Router, Tailwind v4, shadcn/ui in `packages/ui`, the layout with the left sidebar from PRD 8.
- `apps/worker`: pg-boss bootstrap, job registry, graceful shutdown, health endpoint.
- `packages/db`: Drizzle schema for every table in TECH_STACK 7 except `desk_*`, `intent_exemplars`, `tickets`, `ticket_events`, and `action_runs`. Drizzle Kit migrations. Repository functions per table so no app code writes SQL directly.
- Config loading with zod (fail fast on missing env), pino logging, request ids.
- Dev compose file, `lore seed`, `lore reindex`, and `lore simulate-push` commands.

Tests and acceptance:

- `docker compose up`, `lore seed`, and `pnpm dev:library` bring up a page that lists the fixture's namespaces.
- Migrations apply to an empty database and are reversible by deploying the previous image (additive-only check in CI).

### L1. Auth, teams, grants, and audit (M)

Build:

- Better Auth with the Drizzle adapter, organization (teams enabled), admin, and SSO plugins. Google and Microsoft Entra social providers, email magic link fallback, the allowed-domain hook, dev login.
- One organization per deployment, created by `lore seed` or on first admin sign-in.
- `namespace_grants` and `namespaces.visibility`. `readableNamespaces(userId)` (company namespaces plus granted restricted ones, admins get all, cached per request) and `requireNamespace(userId, ns, level)`.
- `audit_log` writes for sign-ins, grant changes, commits, approvals, and exports.
- Sign-in spike mechanics: the flows work against a test Google Workspace and a test Entra tenant. Per-company configuration is Plan 4.

Tests and acceptance:

- A table-driven permission test that encodes the capability matrix in PRD section 9 row by row, run for every fixture principal.
- A user outside the allowed domains cannot create an account.
- Grant changes take effect on the next request.

### L2. Git provider and commit job (M)

Build `packages/git`:

```ts
export interface GitProvider {
  head(vault: VaultRef): Promise<string>;
  readFile(vault: VaultRef, path: string, ref?: string): Promise<{ content: Uint8Array; blobSha: string } | null>;
  diff(vault: VaultRef, from: string, to: string): Promise<{ path: string; status: "A" | "M" | "D" | "R"; from?: string }[]>;
  commit(vault: VaultRef, input: { ops: FileOp[]; message: string; expectedHead: string }): Promise<{ sha: string } | { headMoved: string }>;
  openPullRequest?(vault: VaultRef, input: { branch: string; title: string; body: string }): Promise<{ url: string }>;
  verifyWebhook?(req: Request): Promise<PushEvent | null>;
}
```

- `LocalGitProvider`: git CLI against a bare repository, compare-and-swap with `git update-ref`, emits a push event onto the queue after each commit.
- `GitHubProvider`: Octokit, GraphQL `createCommitOnBranch` with `expectedHeadOid`, REST Git Data API fallback for large payloads, webhook signature verification, pull-request mode.
- Mirror clones in the worker (`/data/vaults/<vault-id>`), fetched on push events and every 5 minutes.
- Commit job: load the changeset, check base blob SHAs, build the commit message in the TECH_STACK 6 format with `Change-Class`, `Changeset`, `Source`, `Co-authored-by`, and optional `Resolves-Report` trailers, commit, and on a moved head refetch, compare blob SHAs of touched files, retry up to 3 times, otherwise mark the changeset conflicted.
- GitHub commits spike: measure the payload limit with images and confirm branch protection bypass. Record in `docs/decisions/0003-commit-api.md` and set the REST fallback threshold.

Tests and acceptance:

- `LocalGitProvider` contract tests: commit, head moved, delete, binary files.
- The same contract suite runs against `GitHubProvider` in the nightly `@live` job using a scratch repository and a test app installation.
- Unit tests with msw for the GraphQL payload shape and the retry logic.
- Two concurrent commits against the same head: one succeeds, the other retries and succeeds when files do not overlap, or is marked conflicted when they do.

### L3. Indexer (L)

Build the `index` job in the worker:

1. Fetch the mirror and read `last_indexed_head` and the new head.
2. Diff. If anything under `.kb/` changed, reload the profile, sync `namespaces` and `taxonomy_terms`.
3. Parse changed notes with `@lore/okf` and upsert `notes` (frontmatter JSONB, body, type, status, trust tier, `stale_after`, content hash, blob SHA, word count). Detect renames by `id`.
4. Rebuild `note_links` for changed notes and re-resolve inbound links that were previously broken.
5. Detect change class for commits not made by Lore by comparing versions: a major bump is a Process change. Read `Change-Class` and `Resolves-Report` trailers for Lore's own commits.
6. Chunk with `chunkNote`. Embed only chunks whose `(model, contentHash)` is missing from `embedding_cache`. Upsert `chunks` and `notes` documents in Meilisearch and delete stale chunk documents by `note_id`.
7. Upload `_assets` files to the object store under their blob SHA.
8. Wait for Meilisearch tasks, then write `last_indexed_head` in the same transaction as the note rows.
9. Emit a `vault.indexed` event with the head, changed note ids, and Process-changed note ids. Plan 4 subscribes the Desk to it.

Tests and acceptance:

- Integration test (`pnpm test:int`, against the dev compose services; see `docs/decisions/0005-test-tiers.md`): seed `vault-acme`, index, and assert row and document counts, trust tiers, stale flags, broken links as wanted notes, and hub memberships.
- Incremental equals full: apply 20 scripted commits one at a time with incremental indexing, then rebuild from scratch, and compare a normalized dump of Postgres note tables and Meilisearch documents. They must be identical.
- A commit that only touches generated files embeds zero new chunks.
- Re-running an index job for the same head is a no-op.
- Freshness: from `simulate-push` to searchable in under 30 seconds locally with `hash` embeddings.

### L4. Search (M)

Build `packages/search`:

- Index settings for `notes` and `chunks` from TECH_STACK 9, with a `userProvided` embedder at 1,024 dimensions, synonyms from tag and note aliases, typo tolerance on.
- `buildReadFilter(principal)`, `searchNotes({ q, vector?, facets, filters, principal })`, `searchChunks(...)`, `similarNotes(noteId, principal)`. Hybrid with semantic ratio 0.3 for the Library; keyword only when no vector is available.
- Separate admin (worker) and search-only (web) keys. Meilisearch is never reachable from the browser.
- UI: Cmd-K palette and a full results page with facets for namespace, type, theme, system, tag, trust tier, and status, highlighted snippets, and trust badges. Deprecated notes are hidden by default.

Tests and acceptance:

- Leak canary: searching `zebra-payroll-canary` returns nothing for `carol` and one result for `erin` and `dana`, across `searchNotes`, `searchChunks`, `similarNotes`, and the Cmd-K endpoint.
- With `EMBEDDINGS` failing, search still returns keyword results (LB-6).
- k6 test on the synthetic 20,000-note vault: p95 under 300 ms for search requests.

### L5. Browse, note pages, and hubs (L)

Build:

- Sidebar pages: Home (search box, process changes in the last 30 days, recent updates in readable namespaces, pinned hubs), Namespaces, Themes, Systems, Types, Tags, and Collections (table and card views with filters and sort by update or health).
- Note page at `/n/<id>/<slug>`, redirecting stale slugs. Header with title, type, namespace, chips, trust badge, version, last change and actor, owner. Banners for draft, deprecated, stale, reported, and recently changed. Rendered body through unified with `rehype-sanitize`, links rewritten to Library URLs (missing targets rendered as wanted notes), footnotes linked to sources.
- Side panel: backlinks and outgoing links (filtered by readable namespaces), related notes, sources, history (commits with change class and a diff view read through the worker's mirror API), and a local graph with Sigma.js.
- Hub pages: introduction, members grouped by type, small graph, owners.
- Unreadable notes return 404, not 403, so their existence is not revealed. Images are served through a route that checks the namespace and redirects to a short-lived signed URL.
- Branding: name, logo, colors, and Desk greeting from settings (LB-8).

Tests and acceptance:

- Playwright: browse each dimension, open a note, follow a link, open a hub, see banners on the fixture's draft, deprecated, stale, and reported notes.
- Renaming a note through `simulate-push` keeps its URL working.
- Backlinks from `people-ops` do not appear for `carol`.
- axe-core reports no WCAG 2.2 AA violations on Home, search results, a note page, and a hub page. The note page reads well at 375 px width.
- An injected `<script>` in a fixture note body is not executed.

### L6. Changesets, editor, and review rules (L)

Build:

- `changesets` with operations as `FileOp[]`, base blob SHAs, source, change class, state (`draft`, `in_review`, `approved`, `committing`, `committed`, `conflicted`, `rejected`, `changes_requested`), AI summary, and warnings.
- A server `submitChangeset` service used by every writer: check permission, apply `@lore/okf` `bump`, `verify` (when ticked), and `generated`, lint against an `OverlaySource`, run the review rules, then either enqueue the commit or move to review.
- Review rules as a pure function:

```ts
export function decideReview(cs: ChangesetDraft, ctx: ReviewContext): {
  review: boolean;
  reasons: ReviewReason[];        // one per rule in PRD 7.3
  approverLevel: "write" | "maintain";
};
```

- Editor: CodeMirror 6 with markdown live preview, a frontmatter form bound to the YAML document so unknown keys survive, `[[` autocomplete that inserts standard links, image paste into `_assets/`, the change class selector with Fix preselected for small diffs, the verified checkbox for writers, and a Similar notes panel driven by `searchNotes` on the title.
- Suggest edit: the same editor with a required reason; always goes to review.
- Conflict handling: the editor stores the loaded blob SHA. On save against a changed file, show a three-way merge view.
- Move and rename in the UI via `moveNote`, so inbound links are rewritten in the same commit.
- Process change effects on `vault.indexed`: Changed badge for 30 days, notify owners (in-app for now, email in L10), flag linking notes, Request Types, and Actions for their owners.

Tests and acceptance:

- `decideReview` has one test per PRD 7.3 rule plus combinations, including a writer's direct edit (no review), a reader's suggestion (review, write level), and an AI Process change to a verified note (review).
- Playwright: `alice` edits an admissions note and a commit lands in the bare repository with the right message and `Co-authored-by` trailer, and the page shows the new version immediately.
- `carol` suggests an edit, `alice` approves it, and the commit credits `carol`; the note's `verified` includes `alice`.
- Two browsers edit the same note; the second save shows the merge view.
- A Process change edit produces a major bump, a `log.md` entry, the Changed badge, and flags on linking notes. The same effects occur for a `simulate-push` that bumps a major version.

### L7. Review queue, feedback, and trust (M)

Build:

- Review queue per namespace: rendered and raw diffs, AI summary and warnings, similar notes side by side, edit before approving, approve, request changes with a comment, reject with a reason. Maintainer-only categories enforced on the server. Approval counts as a human verification.
- Mark verified on the note page.
- Helpful and Report an issue with reasons, a comment, the 10-per-person-per-day limit, banners for open incorrect or outdated reports, owner notification, closing by a commit with `Resolves-Report` or by an owner dismissal with a reason.
- Health score as a stored column, recomputed on index and feedback changes. Starting formula, tunable in settings: 100, minus 25 per open incorrect or outdated report, minus 10 per other open report, minus 20 if stale, minus 10 if unverified, minus 5 per broken outbound link, plus up to 10 from the helpful rate, clamped to 0 to 100.
- A `recordFeedback` service that Plan 4 will call for Desk answer ratings.

Tests and acceptance:

- The 11th report in a day is refused.
- A report shows its banner; a changeset that resolves it closes the report after the commit is indexed.
- Health score unit tests for each factor.
- Only maintainers can approve an Action or Request Type change.

### L8. AI core and ingestion (L)

Build `packages/ai`:

- Provider registry from keys stored in `settings`, encrypted with AES-256-GCM under `APP_ENCRYPTION_KEY`.
- Task routing from the TECH_STACK 12 configuration, primary and fallback with timeouts, zod structured output, prompt assembly with stable content first and Anthropic cache control.
- Usage middleware writing one `llm_usage` row per call, priced from a per-model table.
- Budgets: organization monthly, per task, and per person daily, checked before every call. Typed errors `AiUnavailableError` and `BudgetExceededError` so callers degrade instead of failing.
- Embeddings through the AI SDK, the `local` transformers.js option, the `hash` test embedder, and `embedding_cache`.
- `FakeModelProvider` that replays scripted outputs and records every call.

Build `packages/ingest` and the ingestion jobs:

| Stage | Implementation |
|---|---|
| Intake | Upload (PDF, DOCX, PPTX, XLSX, CSV, HTML, MD, TXT, PNG, JPG, 25 MB, 60 pages) and Capture (text plus up to 10 images, optional target note) to the object store; `ingest_items` row; duplicate file hash flagged |
| Extract | mammoth and turndown, SheetJS, JSZip for PPTX, rehype for HTML, passthrough for MD and TXT; PDFs and images through the `ingest.extract` task or the Docling sidecar; with AI off, pdf.js text extraction as a lossy fallback |
| Context | Similar notes via `searchNotes`, the full vocabulary, the profile |
| Atomize | `ingest.atomize` structured output: a plan of create, update, or skip items with type, namespace, themes, systems, tags, title, description, body, proposed change class, proposed new terms, and sources |
| Validate | Operations only in namespaces the submitter can read; lint against an `OverlaySource`; secret scan; duplicate check (cosine of 0.92 or more blocks auto-publish, 0.85 to 0.92 adds links and a warning); one repair attempt with lint errors fed back |
| Changeset | Source Document note in `references/`, images in `_assets/`, summary and warnings |
| Gate | `decideReview`; in phase 1 everything AI drafts goes to review |

Also: the per-namespace "AI processing allowed" flag (uploads become drafts with no model call), Process now, and the PDF extraction spike (model versus Docling on 10 real SOPs, recorded in `docs/decisions/0004-pdf-extraction.md`).

Tests and acceptance:

- Extractor golden tests for every file in `fixtures/uploads/`.
- Atomize with `FakeModelProvider`: the scripted plan produces the expected changeset and review reasons.
- Prompt injection: the fake model returns an operation targeting `people-ops` for a submitter without access; validation rejects it and nothing is committed.
- With the AI flag off or `AI_MODE=off`, an upload becomes a draft changeset and the fake provider records zero calls.
- Budget exhausted: ingestion items wait in the queue with a visible reason; the Library still works.
- Key encryption round trip, and a stored key never appears in any API response.

### L9. Admin (M)

Build Admin screens for users, teams and membership, namespaces (visibility, owner team, publishing mode, AI flag), grants, AI keys (with Test key and which tasks use it), task model mapping, budgets and limits, branding, feature flags, the audit log viewer, and snapshot tags of the vault (`vault-2026-09`).

Tests and acceptance:

- Non-admins get 403 on every Admin route (checked by a route inventory test, so new routes cannot skip it).
- Changing a namespace to restricted immediately hides it from `carol` in search and browse.

### L10. Phase 2 Library features (L)

Build:

- Batched processing (AU-6): group pending tasks per provider every 2 hours in working hours, submit through Anthropic Message Batches, OpenAI Batch, or Gemini batch mode, poll every 10 minutes, write results back. OpenRouter-only setups run at full price.
- Auto publishing mode per namespace (AU-7), new namespaces default to manual.
- doc2query example questions per note in batch, embedded into the note card vector.
- Taxonomy queue (AU-10): accept, map to alias, reject. Renames and merges produce one changeset via `renameTerm` and `mergeTerms`.
- Gardener (AU-11), weekly and on demand per namespace or vault: duplicate clusters, orphans, wanted notes, stale and unverified notes, heavily reported notes, taxonomy drift, and knowledge gaps from a `GapSource` interface (empty until Plan 4 connects the Desk). Output is proposals in the review queue only.
- Hygiene dashboard (LB-11) sorted by health.
- Follows, in-app notifications, email through the `Mailer` port (Mailpit locally), and the weekly owner digest (LB-9).
- Global graph view with Sigma.js, colored by namespace or theme, cluster labels, filters (LB-10).

Tests and acceptance:

- Batch client tests against recorded provider responses; the `@live` job submits one tiny batch per configured provider.
- A namespace in auto mode publishes a clean AI changeset without review and still reviews one that trips a rule.
- A taxonomy merge of two tags lands as one commit and leaves the vault lint-clean.
- The Gardener finds the fixture's near-duplicate pair, orphan, and wanted note, and creates proposals without committing anything.
- The weekly digest email in Mailpit lists the fixture's stale, reported, and unverified notes for their owner.
- The global graph renders the synthetic 20,000-note vault without freezing the page.

---

## 5. Standalone end-to-end suite

`pnpm --filter web e2e` runs these against the dev compose stack with `GIT_PROVIDER=local`, `AI_MODE=fake`, and `EMBEDDINGS=hash`:

1. Dev sign-in as each principal; an unknown domain is refused.
2. Browse every dimension; open hubs; follow links; wanted-note links render.
3. Search with facets; Cmd-K; leak canary for each principal.
4. Edit and commit; verify the commit in the bare repository.
5. Suggest edit, review, approve; suggest edit, request changes, resubmit.
6. Concurrent edit conflict and merge view.
7. Upload a DOCX and a PDF with the fake model; review; publish; the new notes are searchable and link to their Source Document.
8. Upload with AI off; a draft appears for a person to finish.
9. Report outdated; banner; resolve by commit.
10. Process change through the editor and through `simulate-push`; badge, log entry, flags.
11. `lore reindex --all` on an empty database reproduces the same pages.
12. Accessibility sweep and mobile reading check.

---

## 6. Definition of done

- Every milestone's tests pass in CI, and the standalone suite passes on a clean clone.
- Every read path is covered by the leak canary test.
- The Library works with `AI_MODE=off` and `EMBEDDINGS` failing (LB-6).
- Decision records exist for the commit API and PDF extraction spikes.
- `apps/web` and `apps/worker` build as container images that Plan 4 can deploy.
- `@lore/search`, `@lore/ai`, `recordFeedback`, `createCaptureItem`, the `GapSource` interface, and the `vault.indexed` event are documented for Plans 3 and 4.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Commit conflicts from concurrent editors | Expected-head checks, retries, blob SHA comparison, merge view (L2, L6) |
| Incremental indexing drifts from the truth | The incremental-equals-full test in L3 runs on every pull request |
| Permission leaks through a new read path | The canary test is parameterized over a route inventory; a new route without a filter fails CI |
| AI-drafted notes are plausible but wrong | Everything AI drafts is reviewed in phase 1; unverified badges |
| CodeMirror live preview is too plain for non-technical writers | Usability test with 3 contributors at the end of L6; Milkdown remains the fallback |
