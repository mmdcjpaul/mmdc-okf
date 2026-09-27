# Plan 4: Integration and Production

Wires the vault toolkit, the Library, and the Desk into one deployable product, connects the real external systems (GitHub, Multica, identity providers, email, LLM providers), deploys it for two companies, and adds the phase 3 agent connectors. Plans 1 to 3 prove each part works alone. This plan proves they work together.

| Item | Value |
|---|---|
| PRD sections | 5, 9 (service accounts), 11.2, 11.3 (Gateway), 13, 14, 15, 16 |
| TECH_STACK sections | 3, 6, 8 (service accounts), 14, 15, 16, 17, 18 |
| Requirements | AC-5, AC-6 (interface), TK-4 and TK-5 (production), AP-2 to AP-4, all NFRs, phase exit criteria for 1, 2, and 3 |
| Packages | `apps/web` and `apps/worker` wiring, `packages/mcp`, `deploy/` (prod and e2e) |
| Depends on | Plans 1 and 2 for Stage A; Plan 3 as well for Stages B and C |

The work runs in three stages, each ending in a release:

| Stage | Needs | Delivers | PRD exit criteria |
|---|---|---|---|
| A. Library in production | Plans 1 and 2 | Company A's Library on Lightsail with the real vault and GitHub App | Company A uses the Library daily with 200 or more notes |
| B. Desk and tickets in production | Plan 3 | Desk inside the Library, Multica, feedback loops, Company B onboarded | Self-service rate of 30 percent or more; Company B after 4 stable weeks |
| C. Agents and actions | Stage B | MCP server, Action Gateway, Slack entry point, second vault interface | First auto actions in production with receipts and audit |

---

## 1. Wiring contracts

### 1.1 Domain events

Cross-app behaviour flows through pg-boss topics, never through direct calls between Library and Desk code. Each event has a zod schema in `packages/db/src/events.ts`.

| Event | Emitted by | Consumed by |
|---|---|---|
| `vault.indexed { vaultId, head, changedNoteIds, processChangedNoteIds, deletedNoteIds }` | Library indexer | Desk exemplar refresh and threshold recalibration; notifications; Gardener freshness |
| `note.process_changed { noteId, at, version }` | Library indexer | Notifications, linking-note flags, Desk disclosures (read from `notes`) |
| `changeset.committed { changesetId, sha, noteIds }` | Commit job | Editor refresh, submitter notification |
| `desk.answer_rated { messageId, helpful, citedNoteIds }` | Desk | Library `recordFeedback` |
| `desk.gap_logged { gapId }` | Desk | Gardener knowledge-gap clustering |
| `ticket.status_changed { ticketId, from, to }` | Ticket sync | Notifications, session state (resolved or cancelled) |
| `ticket.resolved { ticketId, coveredByRunbook }` | Ticket sync | Resolution-to-Capture suggestion |

### 1.2 Production adapters

| Port | Production adapter | Built in |
|---|---|---|
| `DeskKnowledge` | `SearchDeskKnowledge` over `@lore/search` chunks and cards, `notes`, `note_links`, `feedback` | B1 |
| `DeskPrincipal` | Better Auth session plus `readableNamespaces` and writable namespaces | B1 |
| `DeskModels`, `Embedder`, `BudgetGuard` | `@lore/ai` tasks `desk.*`, the shared embedding cache, shared budgets | B1 |
| `DeskStore` | Drizzle store on the shared database | B1 |
| `Notifier` | Library notifications and email | B1 |
| `FeedbackSink`, `GapSink` | Event publishers from 1.1 | B3 |
| `TicketProvider` | `MulticaTicketProvider` with production mapping | B4 |
| `GitProvider` | `GitHubProvider` with the company's app installation | A1 |
| `Mailer` | Amazon SES | A3 |
| `ObjectStore` | Lightsail bucket | A3 |

---

## 2. Test environments

| Environment | Composition | Runs |
|---|---|---|
| `deploy/e2e/compose.yml` (pull request tier) | web, worker, Postgres, Meilisearch, MinIO, Mailpit, `LocalGitProvider`, `InMemoryTicketProvider` with its team console route enabled, scripted models, local embedding model | Every pull request: `pnpm e2e:full` |
| `deploy/e2e/compose.yml --profile multica` | Adds the pinned local Multica | Nightly |
| Staging on Lightsail | The production compose file, a staging vault repository created from the template and filled with `fixtures/vault-acme`, a test GitHub App installation, local Multica, real models with a $5 daily cap | Nightly live suite, and every release candidate before Company A |
| Production A and B | Section 5 | Canary: A one day before B |

---

## 3. Stage A: Library in production

### A1. GitHub App and the vault loop (M)

Build:

- Register the Lore GitHub App with contents read and write, metadata read, and push and pull request webhooks. Document installation in `deploy/docs/github-app.md`.
- Route `POST /api/webhooks/github` to `GitHubProvider.verifyWebhook` and enqueue the index job.
- Add the app to branch protection bypass on the vault's main branch, and give the vault CI workflow a GitHub App token for its regeneration commit if branch protection blocks it.
- Confirm the full loop with real GitHub: a Lore edit commits, CI lints and regenerates indexes with `[skip ci]`, both pushes are indexed, and the generated-only commit embeds nothing new.
- Pull request mode per vault: Lore commits to a branch, opens a pull request, and enables auto-merge.

Tests and acceptance (nightly on staging):

- Edit in the Library, and the note is searchable in under 2 minutes (PRD 14 freshness).
- Push from a local clone (the Obsidian path), and the note is searchable in under 2 minutes; a major version bump in that push triggers the Process change effects.
- The CI regeneration commit does not trigger another CI run or a loop.
- A webhook with a bad signature is rejected and logged.

### A2. Identity per company (S)

Build:

- Configure Google Workspace or Microsoft Entra for Company A (and later B), the allowed email domains, and the magic link fallback.
- Create teams and namespace grants from the company's org chart, and namespaces from the vault's `namespaces.yaml`.

Tests and acceptance:

- A staff account signs in; an outside account is refused; a restricted namespace is invisible to someone without a grant.

### A3. Production infrastructure (M)

Build `deploy/`:

- `docker-compose.yml` and `Caddyfile` from TECH_STACK 15, `.env` template, and `scripts/migrate.mjs`.
- Lightsail: 8 GB instance, managed Postgres (2 GB plan, public mode off), bucket, firewall (80, 443, SSH from admin addresses), daily snapshots kept 7 days.
- Amazon SES domain verification and the `Mailer` adapter.
- Backups: managed database point-in-time restore, weekly `pg_dump` to the bucket, nightly `git bundle` of each vault to the bucket.
- Observability: health endpoints for web and worker, an external uptime check, Lightsail alarms for CPU, status checks, and database storage, pino JSON logs with rotation, optional Sentry.
- Product CI/CD: merges to main build and push images to GitHub Container Registry with a version tag; a deploy job per company runs the TECH_STACK 15 commands over SSH.

Tests and acceptance:

- A deploy to staging from a tagged image completes with no manual steps.
- Restore drill on staging: new instance, `docker compose up`, migrations, database restore, `lore reindex --all`, smoke test, all in under 4 hours (PRD 14 RTO). Repeat before each company goes live.
- `nmap` from outside shows only 80 and 443; Meilisearch and Postgres are unreachable from the internet.

### A4. Company A go-live for the Library (S)

Build:

- Onboarding runbook in `deploy/docs/onboarding.md` covering PRD 13's five steps: create the vault from the template, install the app, deploy, configure sign-in, teams, and namespaces, then import documents through Upload in manual mode one namespace at a time.
- Set `FEATURE_DESK=false` until Stage B.

Tests and acceptance:

- The Plan 2 standalone suite, pointed at staging with the GitHub provider, passes.
- Phase 1 exit: Company A uses the Library daily with 200 or more notes. Track daily active users and note count in Admin.

---

## 4. Stage B: Desk and tickets in production

### B1. Mount the Desk in the web app (M)

Build:

- `apps/web/app/api/desk/**` and `apps/web/app/api/tickets/**` re-export the handlers from `createDeskHandlers(deps)` with the production adapters in 1.2.
- Pages `/desk`, `/desk/<sessionId>`, and `/tickets` using `@lore/desk-ui` inside the Library layout. Sidebar entries Desk and My tickets behind `FEATURE_DESK`.
- `SearchDeskKnowledge`: chunk and card search through `@lore/search` with the Desk semantic ratio and filters (`status = stable`, the `desk` type field, the Runbook filter for writable namespaces), note metadata from `notes`, open reports from `feedback`, last Process change from `notes`.
- Merge the Desk schema migrations into the shared migration sequence.
- Branding: the Desk greeting from Library settings.
- Library links from the Desk (citations and navigate results) use `/n/<id>/<slug>`.

Tests and acceptance (`pnpm e2e:full`):

- The Plan 3 standalone suite scenarios 1 to 13, rerun inside `apps/web` with real sign-in, real grants, and the Library's indexes.
- The leak and Runbook canaries through the Desk with real grants.
- A grant removed in Admin takes effect on the next Desk message.

### B2. Knowledge freshness across apps (S)

Build:

- A worker subscriber to `vault.indexed` that reloads Request Type exemplars from changed Request Type notes, re-embeds them, and schedules threshold recalibration.
- Desk disclosures read `note.process_changed` data from `notes`, so a Process change shows in Desk answers for 30 days.

Tests and acceptance:

- Add an example phrase to a Request Type note through the Library editor; within 2 minutes that phrase routes to the Request Type at stage 1.
- Make a Process change to a note; the next Desk answer citing it says when it changed.
- Deprecate a note; the Desk stops citing it and navigate results show the successor.

### B3. Feedback and knowledge-gap loops (S)

Build:

- `desk.answer_rated` to `recordFeedback` for each cited note, so Desk ratings count toward note health (PRD 7.7).
- `desk.gap_logged` to the Gardener's `GapSource`, clustering gaps and showing them in Hygiene and the owner digest.
- An unhelpful Desk rating creates a candidate question for the golden set (TECH_STACK 10.4).

Tests and acceptance:

- A thumbs-down on a Desk answer lowers the cited note's helpful rate in the Library.
- Five similar not-found questions appear as one gap cluster in Hygiene.
- An open "outdated" report in the Library makes the Desk warn and rank that note lower.

### B4. Service accounts, API tokens, and Multica in production (M)

Build:

- Service accounts (AC-5): Better Auth users flagged as service identities, scoped API tokens, their own grants, and actor attribution by the OKF convention. Admin screens to create, scope, and revoke tokens.
- The public API used by agents and the CLI: `GET /api/v1/search`, `GET /api/v1/notes/:id`, `GET /api/v1/related/:id`. Implement `kb related --remote` against it.
- Multica: deploy the pinned version on its own 4 GB instance (or hosted), create the workspace and projects or labels that `route_to` values map to, configure the status mapping and public-comment convention from the Plan 3 decision record, and give Lore a service token.
- Register the ticket sync job in `apps/worker` (60-second polling, or the webhook route if Multica supports it).

Tests and acceptance:

- The ticket contract suite passes against the production Multica version on staging.
- A ticket filed from the Desk appears on the right Multica board with the structured body; a public comment from the team reaches the requester's ticket view and email within 2 minutes; an internal comment does not.
- A revoked token is refused immediately.
- `kb related --remote` returns semantically similar notes using a token scoped to read.

### B5. Tickets that link knowledge, and knowledge that learns from tickets (M)

Build:

- Ticket bodies link the Request Type, its Runbook, and cited notes as Library URLs, and also list vault paths so agents can open them with the CLI (TK-4).
- Multica agent runtime setup: a read-only vault clone refreshed on each run, the `kb` CLI installed, and a `resolve-with-lore` skill telling agents to read the linked runbook first, use `kb query` and `kb related` instead of guessing, follow the manual procedure when an action is not allowed, never invent steps, and propose a note update when a runbook was wrong or missing.
- Resolution to Capture (TK-5): on `ticket.resolved` with no runbook covering it, Lore posts an internal comment on the Multica issue with a link to `/capture/from-ticket/<id>`, prefilled with the resolution's public and internal comments. One click creates a Capture item that goes through the normal ingestion pipeline and review.

Tests and acceptance:

- An agent in Multica, given a ticket about NetSuite access, opens the linked runbook through `kb` and posts its steps as a comment.
- Resolving a ticket with no runbook produces the Capture suggestion; clicking it creates a changeset in review with `source: capture` and the ticket as a source.

### B6. Tuning on real questions (M)

Build:

- Collect about 30 real questions per company from past support requests into each vault's `.kb/eval/questions.yaml`.
- Run the hybrid search tuning spike: sweep `semanticRatio` for the Library and the Desk, the kNN thresholds, and the not-found threshold; enable the reranker only if it improves recall at 5.
- Repeat the embedding model comparison per company and pick one.
- Schedule the weekly eval run against each live vault and show results in Admin.

Tests and acceptance:

- Recall at 5 of 0.85 or more on each company's golden set before the Desk is enabled for everyone.
- Tuned values are stored in settings, not code, and recorded in `docs/decisions/0005-search-tuning-<company>.md`.

### B7. Admin consolidation (S)

Build one Admin area covering both apps: Desk limits and quotas, ticketing (provider, board mapping, status mapping), intent exemplar approval, Desk monitoring (heaviest users, repeated off-topic sessions, spend by task, throttle a person), eval results, and one AI off switch that puts the Desk in search-only mode and the ingestion pipeline in no-model mode together.

Tests and acceptance:

- The AI off switch: Library editing and search still work, uploads become drafts, and the Desk shows search-only mode with plain request forms.
- Budget at 100 percent triggers the same behaviour, and 80 percent sends the alert.

### B8. Desk launch and Company B onboarding (M)

Build:

- Enable the Desk for Company A: first a pilot team, then everyone.
- After 4 stable weeks, onboard Company B with the onboarding runbook: its own vault, app installation, Lightsail stack, identity provider, Multica workspace, and keys.
- A configuration-only check in product CI: a lint rule that fails if any company name, domain, or company-specific identifier appears in `apps/` or `packages/`.
- Canary release train: Company A gets each release a day before Company B.

Tests and acceptance (phase 2 exit):

- Self-service rate of 30 percent or more for Company A (sessions resolved without a ticket, from PRD 15).
- Company B runs the same image version as Company A with only configuration and vault differences.

---

## 5. Stage C: Agents and actions (phase 3)

### C1. MCP server (M)

Build `packages/mcp` served from `apps/web` at `/mcp`:

- Tools: search with filters, get a note by id or path, related notes, list the taxonomy, get a Request Type, propose a changeset (always lands in review).
- Resources: the root index and the graph report.
- Authentication: service account tokens and OAuth for people through Lore. Every tool uses `readableNamespaces`.

Tests and acceptance:

- MCP conformance tests with the official inspector.
- The leak canary through every MCP tool.
- A proposed changeset from MCP appears in the review queue attributed to the calling identity.

### C2. Action Gateway (L)

Build a separate MCP server offered to Multica agents (AP-2 to AP-4):

- One tool per stable, human-reviewed Action note, with the input schema from `actionParameterSchema`.
- Executor registry keyed by `executor.resource` (for example `gateway://salesforce/resend-enrollment-confirmation`), with credentials from the Gateway's secret store only.
- Policy enforced in code: `auto` runs, `approval` creates an approval request in a Library approvals inbox for named approvers, `manual` returns the manual procedure and executes nothing. Rate limits per action.
- `action_runs` rows, audit entries, and receipts posted to the ticket.
- Loosening an Action (manual to approval, approval to auto) or raising its risk is a review item that only an admin can approve (AP-3), enforced in `decideReview`.

Tests and acceptance:

- For each execution mode, a scripted agent call produces the expected outcome, receipt, audit entry, and ticket comment.
- An Action that is draft, deprecated, or unverified exposes no tool.
- Invalid parameters are rejected before the executor runs.
- An approval request that is never approved never executes.
- Phase 3 exit: the first `auto` actions run in production with receipts and audit.

### C3. Slack entry point (M)

Build a Slack app that forwards direct messages to `createDeskHandlers` with the user mapped by email, renders answers with citations as links, and hands intake and ticket views off to the web Desk with a deep link.

Tests and acceptance:

- A question in Slack gets the same cited answer as the web Desk for the same user; a user without a Lore account is told how to sign in.

### C4. Second vault interface (M)

Build Admin and Library support for a second, confidential vault per deployment (AC-6): vault registration, a separate app installation, separate indexes filtered by vault, and a vault switcher in the Library.

Tests and acceptance:

- Notes from the confidential vault never appear for people without grants, across search, the Desk, the graph, MCP, and exports.

---

## 6. Full-stack journeys

These run in `pnpm e2e:full` (pull request tier, local Git and scripted models) and again nightly on staging with real GitHub, real Multica, and real models.

| # | Journey | Apps crossed |
|---|---|---|
| 1 | A person edits in Obsidian and pushes; CI lints and regenerates; the note is searchable in the Library and cited by the Desk within 2 minutes | Vault, CI, Library, Desk |
| 2 | Upload an SOP; AI atomizes; a writer reviews and publishes; the Desk cites the new note with an unverified disclosure; the writer marks it verified; the disclosure disappears | Library, Desk |
| 3 | A Process change edit; followers are notified; linking notes are flagged; the Desk mentions the change date | Library, Desk |
| 4 | A reader reports a note as outdated; the Desk warns and ranks it lower; a fix commit resolves the report | Library, Desk |
| 5 | Desk intake to Multica ticket; the team posts internal and public comments; the requester sees only public ones; the status syncs; the ticket resolves; the Capture suggestion becomes a runbook in review | Desk, Multica, Library |
| 6 | Leak canaries for every principal across Library pages, search, related notes, the graph, exports, the Desk, the public API, and MCP | All |
| 7 | Model provider down: the Library is unaffected, uploads become drafts, the Desk is search-only with plain forms, My tickets works | All |
| 8 | Budget exhausted: the same behaviour as journey 7, plus the admin alert | All |
| 9 | Restore drill from backups and `lore reindex --all` | Deployment |
| 10 | A Multica agent works a ticket using the vault clone and `kb` CLI | Multica, Vault |

---

## 7. Non-functional verification

| NFR (PRD 14) | How it is verified | When |
|---|---|---|
| 20,000 notes, 1,000 users, 5,000 Desk messages a day | Synthetic vault on staging; k6 scenario mixing browse, search, and Desk traffic at 3x the daily peak rate | Before each company's launch |
| Library search p95 under 300 ms | k6 against staging | Nightly |
| Desk first token p95 under 3 s; navigation under 1 s | k6 with real models on staging, within the daily cap | Weekly |
| A commit is searchable within 2 minutes | Journey 1 timing | Nightly |
| 99.5 percent availability in business hours | External uptime check | Continuous |
| RPO 24 hours, RTO 4 hours | Restore drill | Before each launch and quarterly |
| Portability | Export app data as JSON; open the vault in Obsidian and GitHub without Lore; run `kb` offline | Before each launch |
| Security | Dependency scanning with Renovate, webhook signatures, secret scanning on writes, encrypted keys, TLS, firewall scan | CI and before each launch |
| Privacy | Transcript retention job deletes sessions older than 90 days; provider settings with no training on API data | Nightly job test |
| WCAG 2.2 AA | axe-core in every Playwright suite, plus a manual screen reader pass on the Desk and editor | Before each launch |
| Browsers | Playwright on Chromium, WebKit, and Firefox; a manual Edge pass | Every release |

---

## 8. Definition of done

- Stage A: Company A's Library is live and meets the phase 1 exit criteria; the restore drill passed.
- Stage B: the Desk is live for Company A with the phase 2 exit criteria met; Company B is onboarded on the same release train; all ten journeys pass nightly on staging.
- Stage C: the phase 3 exit criteria are met.
- Success metrics from PRD 15 are visible on an Admin dashboard for each company.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Integration reveals port mismatches late | Plans 2 and 3 publish their port contracts at their first milestone; B1 starts with a thin end-to-end slice before full wiring |
| Multica upgrade breaks the adapter | Pinned version, contract suite on staging before every Multica upgrade |
| CI regeneration commits loop or are blocked by branch protection | `[skip ci]`, app token for the workflow, nightly loop check in A1 |
| One Lightsail instance runs out of memory with Meilisearch, web, and worker | Memory alarms; move Meilisearch to its own instance first, then the worker |
| Company-specific requests creep into code | The configuration-only CI check in B8 and the PRD 13 rule |
