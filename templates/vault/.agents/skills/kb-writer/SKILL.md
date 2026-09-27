---
name: kb-writer
description: Use when creating, updating, splitting, moving, or deprecating notes in this OKF knowledge vault, including documenting a service or process from source code. Covers search-first, atomic notes, frontmatter per type, links and hubs, sources, the linter, and the commit message format.
---

# Writing notes in this vault

A note is one idea: one task, one process, one concept, one decision. It has YAML
frontmatter and a markdown body, lives in a namespace folder under `kb/`, and links to at
least one hub. The same linter runs on your machine, in CI, and in the Lore app, so a note
that passes `kb lint` here passes everywhere.

## 1. Search first, and prefer updating

1. Read `kb/index.md` and `kb/_meta/graph-report.md` if you have not this session.
2. Run `kb query "<the question the note answers>"` and `kb related <closest note>`.
3. If a note already covers the idea, update it. Create a new note only for a new idea.
4. If two notes say the same thing, update one and link to it from the other; do not add a third.

## 2. Pick the vocabulary; never invent it

Run `kb taxonomy list`. Choose:

| Field | Rule |
|---|---|
| namespace | The top-level folder of the team that owns the knowledge |
| `type` | One of the profile's types (table below) |
| `themes` | 1 to 3 existing theme slugs |
| `systems` | Existing system slugs for the tools the note is about |
| `tags` | 0 to 8 existing tags |

If nothing fits, stop and say which term you would propose and why. Do not add terms to
`.kb/tags.yaml` or create hubs unless the person you work for asks you to.

| Type | Use it for |
|---|---|
| How-To | Steps for one task with one goal |
| Process | A multi-step business process across roles or systems: who does what, when |
| Explanation | What something is and why it works that way |
| Reference | Lookup facts: fields, codes, contacts, limits, SLAs |
| Policy | Rules people must follow |
| Decision | A recorded decision and its reasons |
| Runbook | Operational or incident procedures for a service team |
| Request Type | Something people can request or report; drives Desk intake forms |
| Action | An operation an agent or person can perform, with a manual procedure |
| Source Document | Extracted text of a source file, kept for provenance in `references/` |

## 3. Create the file

Use the CLI so the id, version, and template are right:

```bash
KB_ACTOR=claude-code/<model> kb new "How-To" "Reset a staff password" --ns it-support --theme access-management --system okta
```

Titles are specific enough to answer a search ("Enroll a returning student in Salesforce",
not "Salesforce notes"). The description is one sentence. Aim for 150 to 1,200 words; the
linter warns above 1,200 and fails above 2,500, which means split the note.

## 4. Frontmatter templates

Keys appear in this order. `kb new` writes them for you; these are for reference.

```yaml
---
type: How-To
title: Enroll a returning student in Salesforce
description: Reactivate a former student's record and open a new enrollment without creating a duplicate contact.
id: kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D        # never change it; it survives renames
version: 1.0.0                          # 0.1.0 for drafts
themes: [enrollment]
systems: [salesforce, sis]
tags: [returning-students]
owner: admissions-ops                   # optional, defaults to the namespace owner
aliases: [re-enroll a student]          # other names people search for
resource: https://example.com/thing     # optional canonical URI of the thing described
status: stable                          # draft, stable, or deprecated
generated: { by: claude-code/claude-sonnet-5, at: 2026-09-24T00:00:00Z }
sources:
  - { id: sync-service, resource: "https://github.com/acme/sync/blob/3f2c1a9/src/sync.ts", title: sync.ts at 3f2c1a9 }
---
```

Runbook: same keys; body sections Trigger, Severity and escalation, Diagnosis, Resolution,
Verification, Rollback, Related.

Request Type adds:

```yaml
kind: request                  # or incident
route_to: finance-systems      # team or board in the ticket settings
follow_up_after: P2D           # ISO 8601 duration
self_service: /finance/netsuite-access-levels.md
runbook: /finance/runbooks/grant-netsuite-access.md
fields:
  - { name: user_email, type: email, required: true, label: "Who needs access?" }
  - { name: role, type: select, required: true, options: [AP Clerk, Viewer] }
examples:
  - I need access to NetSuite
```

Field types: email, text, select (with `options`), date, number, boolean.

Action adds (and must have `# Manual procedure` and `# Rollback` sections):

```yaml
execution: manual              # auto, approval (needs approvers), or manual
risk: low                      # low, medium, high
approvers: []
runtime: http
parameters:
  - { name: enrollment_id, type: string, required: true }
executor:
  resource: gateway://salesforce/resend-enrollment-confirmation
  receipt: [request_id, status]
```

Deprecating a note: set `status: deprecated` and `superseded_by: /path/to/replacement.md`.

## 5. Links

- Use standard markdown links with bundle-absolute paths: `[Refund policy](/finance/refund-policy.md)`.
- Link at least one hub: `[Enrollment](/_themes/enrollment.md)` or `[Salesforce](/_systems/salesforce.md)`.
- Link instead of copying. If a step is documented elsewhere, link to it.
- A link to a note that does not exist yet is allowed; it shows up as a wanted note.
- Move or rename notes with `kb mv`, which rewrites every inbound link.

## 6. Sources and provenance

- When documenting code, add a `sources` entry per file you relied on, pointing at the
  repository path at a specific commit SHA, as in the template above.
- Cite claims with footnotes keyed to `sources` ids: `...every 15 minutes.[^sync-service]`
  and `[^sync-service]: sync.ts at 3f2c1a9` at the end of the body.
- Set `generated.by` to your agent and model (`KB_ACTOR` does this).
- Never add or edit `verified`. People verify notes with `kb verify` or in the Library.
- If you cannot confirm a step from a source, write `TODO: verify` rather than guessing.
  A wrong note is worse than an incomplete one.

## 7. Changing an existing note

Pick the change class and bump the version:

| Class | When | Command |
|---|---|---|
| fix | Typos, links, clarifications that do not change meaning | `kb bump <path> --class fix` |
| addition | New section, extra context, a new optional step | `kb bump <path> --class addition` |
| process | Steps, owners, rules, or systems changed; old instructions are now wrong | `kb bump <path> --class process --summary "<what changed>"` |

A process change writes the namespace `log.md` entry and resets verification.

## 8. Before you commit

1. `kb lint --fix` and fix every remaining error.
2. Do not edit `index.md`, `log.md` (except through `kb bump`), hub member lists, or `kb/_meta/`.
3. Commit with this message format, one note or one coherent change per commit:

```text
kb(<namespace>): <add|update|move|deprecate> "<note title>"

Change-Class: <fix|addition|process>
Source: coding-agent
Co-authored-by: <person you work for> <their email>
```
