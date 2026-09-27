# Plan 3: Desk

The chat helpdesk: the routing cascade, retrieval, grounded answers with citations checked in code, troubleshooting, intake from Request Type notes, the post-filing ticket view, My tickets, the Multica adapter, degraded modes, and the evaluation harness. This covers the Desk half of PRD phase 2 plus the Desk items of phase 3.

| Item | Value |
|---|---|
| PRD sections | 10 (all), 11.1, 11.2 (ticket links only), 12.2 (Desk cost controls) |
| TECH_STACK sections | 10, 11, 13, 17 (Desk tests) |
| Requirements | DK-1 to DK-12, TK-1 to TK-4 |
| Packages | `packages/desk`, `packages/desk-ui`, `packages/tickets`, `apps/desk-sandbox`, `eval/`, `packages/db/src/schema/desk.ts` and `tickets.ts` |
| Depends on | Plan 1 (`@lore/okf` for chunking and `requestTypeSchema`, fixtures) |
| Optional | Plan 2 `@lore/search` and `@lore/ai` for realistic local runs |
| Depended on by | Plan 4 |

---

## 1. Scope

In scope: every Desk behaviour from the first message to a resolved ticket, running in a standalone sandbox against the fixture vault, plus a Multica adapter tested against a local Multica.

Out of scope, handled in Plan 4:

- Mounting the Desk in `apps/web` with real sign-in, real grants, and the Library's Meilisearch indexes.
- Feeding Desk ratings into note feedback, knowledge gaps into the Gardener, and ticket resolutions into Capture.
- The production Multica deployment, agent runtimes, and the Slack entry point.
- Hybrid search tuning on each company's real questions.

---

## 2. Design: a core with ports

`packages/desk` contains all logic and no framework code. Everything it needs from the outside comes through ports, so every behaviour can be tested with fakes and the sandbox and the real web app mount the same code.

```ts
export interface DeskDeps {
  knowledge: DeskKnowledge;   // retrieval over notes the principal may read
  principal: (req: Request) => Promise<DeskPrincipal>;
  embedder: Embedder;
  models: DeskModels;         // classify, rewrite, answerSingle, answerMulti, fillSlots, checklist
  tickets: TicketProvider;
  store: DeskStore;           // sessions, messages, exemplars, tickets mirror, gaps
  notifier: Notifier;
  feedback: FeedbackSink;     // answer ratings -> cited notes
  gaps: GapSink;              // knowledge gaps
  budget: BudgetGuard;        // monthly, per person, per session
  clock: Clock;
  config: DeskConfig;         // limits, thresholds, scoring constants, greeting
}

export interface DeskKnowledge {
  searchChunks(q: { text: string; vector?: number[]; principal: DeskPrincipal; limit: number }): Promise<ChunkHit[]>;
  searchCards(q: { text: string; vector?: number[]; principal: DeskPrincipal; limit: number }): Promise<CardHit[]>;
  getNotes(ids: string[], principal: DeskPrincipal): Promise<NoteMeta[]>;   // trust, stale, reports, last process change
  linkedNotes(id: string, principal: DeskPrincipal): Promise<string[]>;
  requestTypes(principal: DeskPrincipal): Promise<RequestTypeDef[]>;
  version(): Promise<string>;                                                // changes when knowledge changes
}

export interface DeskPrincipal {
  userId: string; email: string; name: string;
  readable: string[]; writable: string[]; isAdmin: boolean;
}
```

`packages/desk-ui` holds React components and a handler factory:

```ts
export function createDeskHandlers(deps: DeskDeps): {
  chat: RouteHandler;                 // POST /api/desk/chat (streaming)
  session: RouteHandler;              // GET /api/desk/sessions/:id
  rate: RouteHandler;                 // POST /api/desk/messages/:id/rating
  confirmIntake: RouteHandler;        // POST /api/desk/sessions/:id/confirm
  ticketUpdate: RouteHandler;         // POST /api/tickets/:id/updates
  ticketCancel: RouteHandler;         // POST /api/tickets/:id/cancel
  ticketStatusRequest: RouteHandler;  // POST /api/tickets/:id/status-request
  myTickets: RouteHandler;            // GET /api/tickets/mine
  plainRequest: RouteHandler;         // POST /api/desk/requests (search-only mode forms)
};
```

The sandbox and, later, `apps/web` each build `DeskDeps` and re-export these handlers. There is no Desk logic in either app.

---

## 3. Running the Desk on its own

`apps/desk-sandbox` is a small Next.js app that is never deployed. It exists to develop and test the Desk without the Library.

| Sandbox piece | Adapter |
|---|---|
| Knowledge | `InMemoryKnowledge`: loads `fixtures/vault-acme` with `@lore/okf`, chunks with `chunkNote`, indexes chunks and cards in MiniSearch, and scores vectors by brute-force cosine. Applies the same permission, status, and `desk` type filters as TECH_STACK 9. Optionally `SearchDeskKnowledge` over a local Meilisearch if Plan 2 is available |
| Principal | A user switcher over `fixtures/principals.yaml` |
| Embedder | `HashEmbedder` by default; `local` (transformers.js) or a provider key for realistic runs |
| Models | `ScriptedModels` (deterministic, keyed by task and input) by default; `live` with a provider key and a spending cap |
| Tickets | `InMemoryTicketProvider` plus a Team console page where a tester acts as the service team: post public or internal comments, change status, add the `waiting-on-requester` label, resolve. Or `MulticaTicketProvider` against local Multica |
| Store | In-memory by default; Drizzle on the dev Postgres with `DESK_STORE=pg` |
| Clock | `FakeClock` with a control panel to jump forward (idle timeout, cooldowns, session age) |
| Degraded modes | Toggles for AI off, provider failing, embeddings failing, budget exhausted |

```bash
pnpm dev:desk-sandbox                       # in-memory everything, scripted models
DESK_MODELS=live DESK_EMBEDDER=local pnpm dev:desk-sandbox
docker compose -f deploy/dev/multica.compose.yml up -d && DESK_TICKETS=multica pnpm dev:desk-sandbox
```

---

## 4. Data model (owned by this plan)

`packages/db/src/schema/desk.ts` and `tickets.ts`, following TECH_STACK 7:

| Table | Notes |
|---|---|
| `desk_sessions` | Person, state, intake sub-state (JSONB), counters, timestamps, mode (`normal`, `search_only`) |
| `desk_messages` | Session, role, content, intent, routing stage and scores, citations, disclosures, model, tokens, latency, rating |
| `intent_exemplars` | Text, intent, request type id, source (`seed`, `vault`, `approved`, `candidate`), embedding |
| `intent_thresholds` | Intent, threshold, precision at threshold, computed at |
| `tickets` | Provider, external id, session, requester, request type, status, last public update, next allowed status request, idempotency key |
| `ticket_events` | Ticket, kind (created, comment, status, nudge, cancel), public flag, body, external id |
| `desk_gaps` | Query text, vector, principal namespaces, session, time, cluster id |

---

## 5. Milestones

Sizes: S is 1 to 3 days, M is 3 to 6 days, L is 1 to 2 weeks.

### D0. Multica spike, scaffolding, and ports (M)

Build:

- Multica API spike (TECH_STACK 20): with a service token against a local Multica from its upstream Docker Compose, can we create, comment on, cancel, and read issues? Are there webhooks? How are public and internal comments told apart? How do we map `route_to` to a workspace, project, or label? Record in `docs/decisions/0004-multica.md`, including the public-comment convention (a `public` label or a prefix) and the pinned Multica version.
- Package skeletons, the port interfaces above, `DeskConfig` with PRD 10.2 defaults, and the sandbox shell with the user switcher, clock panel, and toggles.
- `InMemoryKnowledge` and `HashEmbedder`.

Tests and acceptance:

- `InMemoryKnowledge` never returns `people-ops` chunks to `carol` (leak canary), never returns drafts or deprecated notes, and returns Runbooks only to writers of their namespace.
- The spike decision record answers each question with evidence.

### D1. Session state machine (M)

Build the session reducer from PRD 10.2 as a pure function:

```ts
export function reduce(state: SessionState, event: DeskEvent, ctx: { now: Date; config: DeskConfig }):
  { state: SessionState; effects: Effect[] };
```

- States: `active`, `intake` (sub-stages `offer_self_service`, `check_open_ticket`, `filling`, `confirming`), `filed`, `closed`, `cancelled`, `resolved`.
- Events: user message, intent detected, self-service accepted, intake declined, slots updated, confirm, cancel intake, idle timeout, message cap, age cap, ended by user, ticket status changed, add update, cancel ticket, status request.
- Effects are commands for a runner: ask a field, file a ticket, post a comment, cancel a ticket, send a nudge, notify, close.
- Limits enforced here: idle 30 minutes, 20 user messages per session, 12 hours maximum age, 2,000 characters per message. The daily 40-message limit is checked by the budget guard.

Tests and acceptance:

- A transition table test covering every state and event pair, including the rejected ones.
- Model-based property test with fast-check: random event sequences never accept a user message in `filed`, `cancelled`, `resolved`, or `closed`; counters never exceed caps; `filed` always has a ticket id.
- Persistence round trip through both `DeskStore` implementations.

### D2. Routing cascade (L)

Build TECH_STACK 11:

- Stage 0 rules: commands and buttons, ticket references, greetings and thanks, empty or oversized messages, quota checks.
- Stage 1 nearest neighbours: embed the message once, similarity-weighted vote of the top 7 exemplars, decide when the score clears the intent's threshold and the margin over the runner-up is at least 0.1. The same vector suggests request types from Request Type `examples` and probes whether relevant knowledge exists.
- Stage 2 small model: structured output with intent, candidate request types, and confidence.
- The seed exemplar set in `packages/desk/seed/exemplars.yaml`: about 300 generic examples across the 8 intents.
- Exemplar loading from Request Type notes through `DeskKnowledge.requestTypes`, refreshed when `knowledge.version()` changes.
- Threshold calibration job: for each intent, the lowest threshold with precision of 0.95 or more on the labelled set; if none reaches it, the intent never decides at stage 1.
- Every decision logged with stage and scores. Model-classified messages and user corrections ("I want to file a request instead") become candidate exemplars.
- Off-topic messages at stage 1 get the fixed reply with no model call.

Tests and acceptance:

- Rule unit tests for every rule.
- Calibration unit tests on synthetic score distributions.
- On the fixture golden set with the local embedding model: intent precision at stage 1 of 0.95 or more for every intent that decides, and at most 20 percent of messages reaching stage 2. With `HashEmbedder` the suite asserts only that the cascade runs, since hashed vectors are not semantic.
- A scripted off-topic message never reaches `DeskModels`.

### D3. Retrieval (M)

Build TECH_STACK 10.2 steps 1 to 7 on top of `DeskKnowledge`:

- Follow-up rewrite with the small model when there is history; first messages skip it.
- Hybrid search on chunks (40) and cards (10) with the shared vector, semantic ratio 0.6.
- Group by note and score: `best + 0.5 * second + 0.3 * card`, multiplied by trust and health factors (human-reviewed 1.10, unverified 0.95, stale 0.85, open incorrect or outdated report 0.70). All constants live in `DeskConfig`.
- Link expansion for the top 3 notes at 0.6 times the linked note's own score.
- A `Reranker` interface with a no-op default.
- Context assembly up to about 6,000 tokens, grouped by note with title, id, trust tier, and last update; notes under 800 tokens go in whole.

Tests and acceptance:

- Scoring and expansion unit tests with hand-built hits.
- Recall at 5 of 0.85 or more on the fixture golden set with the local embedding model.
- Token budget never exceeded; notes never cut mid-chunk.

### D4. Answer paths (L)

Build PRD 10.4:

| Path | Implementation |
|---|---|
| Navigate | Intent `navigate`, or one card clearly above the rest with a title or alias match; returns links with descriptions and trust badges; no model call |
| Single note | `answerSingle` with the `Answer` zod schema from TECH_STACK 10.2 |
| Synthesis | `answerMulti` with the same schema |
| Troubleshoot | Checklist from the relevant how-tos, then "Did this fix it?"; No starts intake with the context carried over |
| Not found | Honest message, closest notes, offer to ask the owning team; writes a `desk_gaps` row |

Plus, all in code:

- Streaming: the answer text streams to the UI; when the structured result completes, citations are validated and the stored message replaces the streamed draft.
- Citation validation: every citation must point to a retrieved note; invalid ones are removed; an answer with none left becomes a list of links; low confidence adds the request offer.
- Disclosures for unverified, stale, reported, and recently Process-changed notes ("This process changed on 12 Sep").
- Topic lock: a narrow system prompt, and notes and messages passed as delimited data.
- Answer ratings stored on the message and sent to `FeedbackSink` for every cited note.
- The Desk greeting from config.

Tests and acceptance:

- With `ScriptedModels` returning a fabricated citation, the stored answer has no invalid citation; returning only fabricated citations produces a links-only answer.
- Disclosures appear for the fixture's stale, unverified, reported, and recently changed notes, and never come from the model.
- The leak canary: `carol` asking about `zebra-payroll-canary` gets the not-found path, and the scripted model never receives restricted text (asserted by inspecting recorded prompts).
- Runbook canary: `okapi-runbook-canary` appears in context for an `it-support` writer and never for `carol`.
- Navigate and off-topic paths record zero model calls.
- Streaming Playwright test in the sandbox: the first token appears and citations render as links.

### D5. Intake (L)

Build PRD 10.5 steps 1, 2, and 4 to 7 (step 3 is D9):

- Detection by intent or the "I need help from a team" button; request type chosen from stage 1 suggestions or the model's candidates, with a picker when unsure.
- Self-service offer when the Request Type's `self_service` link or a how-to covers it.
- Open ticket check: an open ticket of the same request type offers Add update instead.
- Slot filling: `requestTypeSchema` from `@lore/okf`; the small model fills `.partial()` of it from the conversation; code validates each value and asks for missing required fields using their labels, rendering select fields as buttons. Usually two to four questions.
- Confirmation card with editable fields, request type, receiving team, and suggested priority. Filing happens only on Confirm.
- Filing: a structured markdown body (summary, fields, conversation summary, transcript link, suggested priority, related notes and runbooks as links, requester), an idempotency key so a double click files once, then `createTicket` and a mirror row.

Tests and acceptance:

- Sandbox Playwright: "can you give my new hire NetSuite AP access" leads to the NetSuite Request Type, asks only for missing fields, shows the card, and files one ticket that the team console shows with the expected body.
- Double-clicking Confirm files exactly one ticket.
- Declining at the self-service step returns the session to `active`.
- Filling with `ScriptedModels` that return an invalid email makes the Desk ask for it again.

### D6. Tickets, post-filing view, and My tickets (L)

Build `packages/tickets`:

- `TicketProvider` from TECH_STACK 13, `InMemoryTicketProvider`, and `MulticaTicketProvider` per the D0 decision, with configurable `route_to` and status mappings (PRD 11.1 table).
- A reusable contract suite, `describeTicketProvider(make)`, that runs against both implementations.
- Sync: `listUpdatedSince` every 60 seconds with a stored cursor, or `parseWebhook` if Multica supports it. Only public comments reach the mirror. Status and public comment changes call `Notifier`.

Build the post-filing experience:

- After filing, the message box is not rendered for `filed`, `cancelled`, or `resolved` sessions. The session becomes a ticket view with status, public updates, and three actions.
- Add update: text plus attachments, posted as a public comment.
- Cancel request: reason and confirmation.
- Request status update: enabled after the cooldown (24 hours for requests, 4 hours for incidents, or `follow_up_after`); posts a nudge, notifies the assignee, restarts the cooldown. The route rejects early calls with 429 and `nextAllowedAt`.
- Waiting on you: shown when the team sets the label, highlighting Add update.
- My tickets page with status, last update, and the same actions.

Tests and acceptance:

- The contract suite passes against the in-memory provider in pull request CI and against local Multica in the nightly job.
- An internal team comment never appears to the requester; a public one does.
- With the fake clock: the status request button is disabled until the cooldown passes, and the route returns 429 when called early.
- The message box is absent from the DOM in every post-filing state.

### D7. Quotas, budgets, and degraded modes (M)

Build PRD 10.6 and 10.7:

- `BudgetGuard` checking the person's daily messages, the session cap, and the monthly organization budget (alert at 80 percent, search-only at 100 percent). In the sandbox it is in-memory; Plan 4 backs it with `@lore/ai` budgets.
- Search-only mode when models fail after fallback, the budget is spent, or an admin switches AI off: ranked links with descriptions, Request Types as plain forms built from `fields` with no model, My tickets unchanged, and a banner explaining the mode.
- Embeddings failing: routing uses rules plus keyword heuristics, and retrieval runs keyword only.
- Monitoring queries for Admin: heaviest users, sessions with repeated off-topic attempts, spend by task, and a per-person throttle flag.

Tests and acceptance:

- For each toggle in the sandbox (AI off, provider failing, embeddings failing, budget exhausted), a Playwright test asks a question, gets links, files a ticket through the plain form, and sees the banner. `ScriptedModels` records zero calls.
- The 41st message of the day is refused with a clear message and no model call.

### D8. Evaluation harness and embedding spike (M)

Build `eval/`:

- `pnpm eval --vault <path> --mode fast|full`: runs `.kb/eval/questions.yaml` through the real Desk core and reports recall at 5, MRR, intent precision and recall per class, the share of messages at each routing stage, cost and latency per message, and in `full` mode groundedness on a sample with a model judge.
- Output as JSON and markdown in `eval/reports/`, with a stored baseline per vault.
- Pull request CI runs `fast` on the fixture vault with the local embedding model and fails if recall at 5 drops by more than 0.02 or any deciding intent falls below 0.95 precision.
- Embedding model spike: compare one provider model at 1,024 dimensions against the local model on the fixture golden set, and document how Plan 4 repeats it per company.

Tests and acceptance:

- The harness produces a report on the fixture vault in CI in under 5 minutes.
- A deliberately broken scoring constant makes the CI check fail.

### D9. Phase 3 Desk features (L)

Build:

- Trained intent classifier: multinomial logistic regression on embeddings from approved exemplars, retrained weekly, replacing the nearest-neighbour vote once it beats it on the eval set. SetFit exported to ONNX only if accuracy plateaus.
- Known-issue detection (DK-11): embed open incident tickets from the mirror; when a new incident message is similar, offer "Add yourself as affected", which posts a comment on the existing ticket instead of filing a new one.
- Multi-step retrieval (DK-12): for complex questions or low-confidence first passes, the model gets `search`, `open_note`, and `related` tools with a hard limit of 3 steps and the same permission filters.

Tests and acceptance:

- The trained classifier matches or beats kNN on the eval set before it is enabled, and a flag switches between them.
- Two scripted LMS-outage messages from different users produce one ticket and one "affected" comment.
- Multi-step retrieval never makes a fourth tool call and never returns content the principal cannot read.

---

## 6. Standalone end-to-end suite

`pnpm --filter desk-sandbox e2e` runs against the sandbox with in-memory adapters and scripted models:

1. Question with a single-note answer and a valid citation link.
2. Synthesis across two linked atomic notes.
3. Navigation request answered with links and no model call.
4. Off-topic message with the fixed reply and no model call.
5. Not-found question logs a gap.
6. Troubleshoot checklist, "No", intake with context carried over.
7. Request intake to confirmation to filed ticket; team console posts public and internal comments; requester sees only the public one.
8. Waiting on you, Add update, Cancel request, Request status update with the fake clock.
9. My tickets lists all filed tickets.
10. Idle close, message cap, and age cap with the fake clock.
11. Each degraded mode.
12. Leak and Runbook canaries for every principal.
13. Accessibility sweep of the chat, confirmation card, ticket view, and My tickets.

---

## 7. Definition of done

- Every milestone's tests pass, and the standalone suite passes on a clean clone with no network access beyond the local model download.
- The ticket contract suite passes against local Multica in the nightly job.
- The eval harness runs in CI with a stored baseline.
- `createDeskHandlers`, `DeskDeps`, the ports, the Desk schema, and the ticket sync job entry point are documented for Plan 4.
- Decision records exist for the Multica and embedding spikes.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Multica's API changes (pre-1.0) | Adapter plus contract suite, pinned version, polling fallback, mirror table |
| The fixture golden set is too easy to reflect real quality | Plan 4 B6 runs the harness on each company's real questions before launch |
| Streaming structured output makes the final answer differ from the streamed text | Stream only the answer text; replace with the validated message on completion; tests cover the swap |
| Hash embeddings hide semantic regressions in CI | CI eval uses the local embedding model; hash embeddings are only for logic tests |
| Users try to use the Desk as a general assistant | Rules and fixed replies, quotas, budgets, monitoring (D2, D7) |
