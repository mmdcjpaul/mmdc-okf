# What Plans 3 and 4 build on

Plan 2's definition of done asks for these to be documented. Each is code that exists and
is tested. Signatures are in the files named; this says what each is for and what it
promises.

## Reading: `@lore/search`

`packages/search/src/index.ts`

| Function | Use |
|---|---|
| `searchNotes(client, { vaultSlug, scope, q, vector, filters, limit, offset })` | Notes by keyword and meaning. The Library's search, Cmd-K, and "similar notes" |
| `searchChunks(client, { vaultSlug, scope, q, vector, filters, limit })` | Passages, for answering. Each hit has `note_id`, `heading_path`, `header`, and `text` |
| `similarNotes(client, { vaultSlug, scope, noteId, limit })` | Notes whose card vector is closest to a note's |
| `buildReadFilter(scope)` | The filter every search carries. Hubs are readable by everyone |

Promises:

- Every function takes a `ReadScope` and filters on the server. There is no search
  without one. Build the scope with `readScope(principal)` from `@lore/auth`.
- `vector: null` is keyword search. Callers pass null when embeddings are off or failing,
  and search still works (LB-6).
- Documents carry `trust_tier`, `stale`, `reported`, `health`, and `desk`. The Desk ranks
  down and warns on `stale` and `reported`, and honours `desk` (`answer`, `route`, `never`).
- `questions` holds the example questions written for a note (doc2query). They are in the
  card vector and are searched as text.
- The web app and the Desk use a search-only key. Only the worker writes.

## Models: `@lore/ai`

`packages/ai/src/index.ts`, and `@lore/ai/batch` for the providers' batch APIs.

- `ModelGateway.generate({ task, instructions, context, input, images, schema, userId,
  vaultId, namespace })` is the only way to call a model. It picks the model from settings,
  checks the organization's, the task's, and the person's budget, falls back once, and
  writes one `llm_usage` row per attempt.
- Tasks are named in `TASKS`. The Desk's are already there: `desk.classify`, `desk.rewrite`,
  `desk.answer.single`, `desk.answer.multi`, `desk.intake`. A new task is a new entry in
  `TASKS` and `DEFAULT_TASKS`.
- It throws `AiUnavailableError`, `BudgetExceededError`, or `InvalidOutputError`. Callers
  catch them and degrade: search-only answers, a draft for a person to finish.
- Put stable text in `instructions` and `context`, and what changes per call in `input`.
  The provider's cache matches on a prefix.
- Wrap anything that came from outside with `asData(label, text)`.
- `AI_MODE=fake` answers from `packages/ai/test/scripts/`. A script matches on the start of
  the instructions and, optionally, on text in the input.
- `DeferringGateway` lets work wait for a batch without being written for it. Give it an
  owner (`desk-eval:<run>`), catch `DeferredError`, and run the work again when the worker
  calls back for that owner.
- Embeddings: `embedderFor(mode, options)` returns an `Embedder` or null. `hash` is for
  tests, `local` runs a model on the machine.

## Feedback: `recordFeedback`

`packages/db/src/repos/feedback.ts`

```ts
recordFeedback(db, { id, vaultId, noteId, userId, kind: "helpful" | "report", reason?, comment?, now? })
```

- `helpful` is one per person per note. `report` takes a reason from `REPORT_REASONS`.
- A person may file `REPORTS_PER_DAY` reports. Past that it throws `FeedbackLimitError`.
- After writing, ask the worker to recompute the note's health:
  `POST /vaults/:id/health?note=<id>` on the internal API (`requestHealth` in the web app).
  The Desk does the same after "this answer was wrong".
- An open report of `incorrect` or `outdated` sets `reported` on the note's search
  documents. It closes when a commit with a `Resolves-Report` trailer is indexed, or when
  an owner dismisses it with `dismissReport`.

## Captures: `createCaptureItem`

`packages/ingest/src/capture.ts`

```ts
createCaptureItem({ db, objects }, { vaultId, submitterId, namespace, text, images?, hints? })
// → { id }   throws CaptureRefused (status 400 or 413)
```

- It checks what a capture may hold: 20 to 60,000 characters or at least one image, up to
  10 PNG or JPEG images of up to 5 MB each, judged by their bytes.
- It does not check who may make one. The caller checks that the submitter can read the
  namespace, and that the namespace allows AI processing if it expects a model to be used.
- The item is `queued`. Start it with `POST /ingest/:id/process` on the worker's internal
  API, or leave it for the next batch window.
- What comes out is a changeset, which goes through the review rules like any other.
  Drafted by AI in a manual namespace, it waits for review.
- For the Desk: the submitter is the agent who resolved the ticket, not a service account,
  so the notes are drafted with what that person may read.

## Knowledge gaps: `GapSource`

`packages/db/src/gaps.ts`

```ts
interface GapSource {
  gaps(query: { vaultId, namespaces, since, limit }): Promise<KnowledgeGap[]>;
}
// KnowledgeGap: { question, count, namespace, lastAskedAt }
```

- The Desk implements it over the questions that found nothing (DK-10). Plan 4 passes the
  implementation to the worker in place of `NO_GAPS`: `gaps` in the digest's and the
  Gardener's dependencies (`apps/worker/src/main.ts`).
- The caller passes only namespaces its reader may read. The source returns nothing from
  any other, and returns gaps with no namespace only to admins.
- Gaps reach maintainers in the weekly digest and appear in the Gardener's report.

## The `vault.indexed` event

`apps/worker/src/runtime.ts` (`VAULT_INDEXED`), published with pg-boss after every index
run that changed something.

```ts
{ vaultId: string, head: string | null, changed: string[], deleted: string[], processChanged: string[] }
```

- `changed` holds the ids of the notes that were added or whose rows changed, `deleted`
  the ids of the notes that are gone, and `processChanged` the ids that had a Process
  change (a major version bump).
- It is published after Postgres and Meilisearch both hold the new state, so a subscriber
  that reads on receipt reads what was just indexed.
- Subscribe with `boss.subscribe(VAULT_INDEXED, queue)`. Plan 4 subscribes the Desk, which
  drops cached answers that cite a changed note.
- Delivery is at least once. A subscriber must not mind seeing the same head twice.

## The worker's internal API

`apps/worker/src/api.ts`. Reachable from the web container only, with
`Authorization: Bearer $INTERNAL_API_TOKEN`.

| Route | Use |
|---|---|
| `GET /health` | Liveness, and the last index |
| `GET /vaults/:id/changes/:sha?path=` | A file before and after a commit |
| `GET /vaults/:id/file?path=&ref=` | A file at a commit |
| `GET /vaults/:id/tags`, `POST /vaults/:id/tags?name=&message=` | Snapshots |
| `POST /changesets/:id/process` | Run the changeset job now |
| `POST /ingest/:id/process` | Process now |
| `POST /vaults/:id/health?note=` | Recompute health after feedback |
| `POST /vaults/:id/gardener?namespace=&by=` | Run the Gardener |
| `POST /batches/tick` | One turn of the batch schedule, whatever the clock says |
| `POST /mail` | Send an email the web app wrote |
| `POST /webhooks/github` | A delivery from GitHub, passed on by the web app |
| `POST /ai/test?provider=` | Try a provider key |
