# Demo: Plan 2 L10, phase 2 Library features

With the services up (`pnpm services:up`, which includes Mailpit) and the Acme fixture
seeded:

```bash
AI_MODE=fake SMTP_URL=smtp://127.0.0.1:1025 PUBLIC_URL=http://localhost:3000 pnpm dev:library
```

## Follow, notifications by email, and the weekly digest

1. Sign in as Carol. Open a note and choose Follow. Open the Month-end close theme and
   choose Follow there too. Both are listed under Notifications, Following.
2. Sign in as Bob and save a Process change to a Finance note under Month-end close. Carol
   gets a notification in the app, and within a minute an email in Mailpit
   (http://localhost:8025). Notifications she has already read in the app are not emailed.
3. Send the weekly digest now instead of waiting for Monday:

```bash
SMTP_URL=smtp://127.0.0.1:1025 pnpm lore digest --force
# Sent 2, nothing to say to 3, skipped 0, failed 0
```

Bob's digest lists "Approve vendor invoices" (review due) and "How deposits flow from
Salesforce to NetSuite" (never verified). Carol owns nothing, so she gets none. Each person
switches either kind of email off under Notifications, Email.

## Hygiene

Hygiene, in the sidebar, lists the notes a person can read with the worst health first, and
says what is wrong with each: reported, review due, never verified, linked process changed,
broken links. "Owned by my teams" narrows it to what is theirs to fix.

## Gardener

1. Sign in as Dana, open Hygiene, and run the Gardener for the whole vault.
2. It reports the fixture's near-duplicate pair ("Clean up duplicate contacts" and "Merge
   duplicate student records"), its orphan ("Set up a campus printer"), and its wanted note
   (`/it-support/unlock-a-locked-account.md`), and makes three proposals.
3. Each proposal is a change waiting under Review, with the reason written out. IT Support
   publishes AI drafts by itself; the Gardener's proposals wait all the same.
4. Nothing is committed until a person approves:

```bash
git -C .data/vaults/acme.git log -1 --format=%s   # unchanged by the run
```

It also runs every Sunday night. A proposal that was turned down is not made again for 90
days. Thresholds are in the `gardener` setting.

## Taxonomy

1. Sign in as Alice and upload `fixtures/uploads/orientation.pptx` to Admissions. The
   scripted model proposes the tag `orientation-day`, and the change waits.
2. Sign in as Dana and open Taxonomy. Accept the tag, use an existing tag instead (the
   proposed name becomes another name for it), or reject it. The change goes through the
   pipeline again with the decision applied.
3. Rename or merge a term on the same page. It is one change, reviewed by a maintainer, and
   one commit that rewrites every note using the term.

## Publishing mode

A namespace set to publish by itself (Admin, Namespaces) publishes a clean AI draft without
review. A draft that proposes a term, looks like a duplicate, changes a verified note, or
changes a process is reviewed anyway. Admins switch auto publishing off for every namespace
under Branding and features.

## Graph

Graph, in the sidebar, draws every note the reader can see. Colour by namespace or theme,
filter by namespace, theme, and type, and find a note by title. The layout runs in a web
worker, so the page answers while it settles. The most linked notes are also listed as
text below the drawing.

## Batched processing

Uploads that are not processed at once wait in the queue. Every two hours in working hours
(Monday to Friday, eight to six, in `TIME_ZONE`) the worker starts them, collects the model
calls they make, and sends the calls to each provider's batch API: Anthropic Message
Batches, the OpenAI Batch API, or Gemini batch mode. Every ten minutes it asks whether the
batches have ended. The item's page says "Sent to the model in a batch" meanwhile, and
Process now still works, at the normal price.

With `AI_MODE=fake` a batch ends as soon as it is sent. Run a turn of the schedule now:

```bash
curl -s -X POST -H "authorization: Bearer $INTERNAL_API_TOKEN" localhost:8081/batches/tick
# {"started":1,"submitted":[{"provider":"anthropic",...,"requests":1}],"polled":[...]}
```

Usage rows for batched calls have `batch = true` and half the cost. A setup with only an
OpenRouter key has no batch API to use, so its calls are made at once, at the normal
price. A request the batch does not answer (an error, or no answer within a day) is asked
again at once. `BATCH_SCHEDULE=off` leaves queued items until someone chooses Process now.

## Example questions (doc2query)

After each index the worker asks, in a batch, for a few questions each changed note
answers. They are stored in `note_questions`, searched as text, and embedded into the
note's card vector, so "how do I get my tuition money back" finds "Issue a student
refund". Notes in namespaces with AI processing off are never sent.

## What is checked against the real providers

`packages/ai/test/batch/` runs the three batch clients against a local server whose
replies are written from the providers' published response shapes. They were not recorded
from live calls. The nightly `live` job sends one tiny batch to each provider that has a
key in the repository's secrets (`LIVE_ANTHROPIC_API_KEY`, `LIVE_OPENAI_API_KEY`,
`LIVE_GEMINI_API_KEY`), and is the check that the clients match the real services. Until
those secrets are set it skips every provider.
