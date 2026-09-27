# Demo: Plan 2 L8, AI core and ingestion

With the services up and the Acme fixture seeded, start the Library with a scripted model:

```bash
AI_MODE=fake pnpm lore seed --vault fixtures/vault-acme --principals fixtures/principals.yaml
AI_MODE=fake pnpm dev:library
```

`AI_MODE=fake` answers from `packages/ai/test/scripts/` and costs nothing. `AI_MODE=live`
uses the keys saved in Admin and needs `APP_ENCRYPTION_KEY`. `AI_MODE=off` calls no model.

## Upload

1. Sign in as Bob. Choose Upload, pick `fixtures/uploads/deposit-refund-sop.docx`, choose
   Finance, and upload. There is no prompt box.
2. The status page goes from "Reading the file" to "Drafting notes" to "Done".
3. "See what it produced" opens the changeset: what the AI did and why, what it skipped as
   already covered, the new How-To, and the Source Document with the extracted text.
4. It is in review because AI drafted it and Finance publishes manually. Sign in as Dana
   and approve. The note is published, unverified until Dana's approval verified it, with
   `sources` pointing at the Source Document.

## Without AI

Sign in as Dana and upload `leave-request.pdf` to People Ops, where AI processing is off.
The form says so and asks for a theme. The PDF's text layer is converted with no model,
and the result is a draft note for a person to finish.

```bash
curl -s -H "authorization: Bearer $INTERNAL_API_TOKEN" localhost:8081/ai/fake
# {"count":...}: unchanged by that upload
```

## What is refused

| Try | Result |
|---|---|
| Rename a `.docx` to `.pdf` and upload it | Refused: named like a .pdf file but its contents are a .docx file |
| Upload an `.exe` or `.svg` | Refused |
| Upload a PDF of 61 pages, or a file over 25 MB | Refused, with what to do instead |
| Upload `laptop-return-injection.docx` with a model that obeys it | The plan is refused whole; nothing is committed; the submitter is told |

## Budgets

Set `budgets.orgMonthlyUsd` to 0 in the `ai` setting and upload again. The item shows
"Waiting" with the reason, and is tried again every ten minutes. The rest of the Library
is unaffected.

```bash
pnpm --filter @lore/ai test        # routing, fallback, timeouts, budgets, key encryption
pnpm --filter @lore/ingest test    # extractor goldens, the plan checks, prompt injection
pnpm test:int                      # the ingestion job against Postgres and Meilisearch
pnpm --filter web e2e              # 78 tests
```

## Not done here

The PDF extraction spike (a multimodal model against Docling on 10 real SOPs) needs real
documents and provider keys. It is recorded as open in `docs/decisions/0004-pdf-extraction.md`.
