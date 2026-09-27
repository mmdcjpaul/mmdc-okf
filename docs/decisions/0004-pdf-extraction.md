# 0004: PDF extraction, a multimodal model or Docling

- Status: **Proposed** (the comparison below has not been run)
- Date: 2026-09-27
- Plan: 2, milestone L8 (TECH_STACK section 20, "PDF extraction" spike)

## Context

PDFs and images are the only uploads that deterministic code cannot convert well. The plan
offers two ways to read them: a multimodal model through the `ingest.extract` task, or a
Docling sidecar. The spike is to compare them on 10 real standard operating procedures.

## What is built

- `ingest.extract` sends the PDF to the task's model and gets markdown back. This is the
  default when AI is allowed.
- Without AI, `extractPdfText` reads the PDF's text layer with pdf.js. It is lossy (no
  tables, no columns, nothing from scans) and says so in the changeset's warnings.
- There is no Docling sidecar yet. The extractor is chosen in one place
  (`runIngest` in `packages/ingest/src/pipeline/run.ts`), so adding one is a local change.

## The comparison (to do)

Needs 10 real SOPs as PDFs, including at least two scans and two with wide tables, and a
provider key.

| Measure | Model | Docling |
|---|---|---|
| Headings kept, out of all headings | | |
| Numbered steps kept in order | | |
| Tables readable as tables | | |
| Scanned pages read | | |
| Invented content (count) | | |
| Cost per document | | |
| Time per document | | |

## Decision

Until the comparison is run: the model when AI is allowed, the text layer when it is not.
If Docling does as well on structure, prefer it for PDFs with a text layer, because it
costs nothing per document and cannot invent content, and keep the model for scans.
