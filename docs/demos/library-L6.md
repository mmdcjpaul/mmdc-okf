# Demo: Plan 2 L6, changesets, the editor, and review rules

With the Library running on the Acme fixture (`library-L0.md`) and the worker started.

## A writer's edit

1. Sign in as Alice. Open "Enroll a returning student in Salesforce" and choose Edit.
2. Add a sentence. Fix is preselected; choose Addition.
3. Type `[[refund` and pick "Refund policy". A standard markdown link is inserted.
4. Paste a screenshot into the text. It appears in the preview.
5. Save. The note page opens with the new text and version.

```bash
git --git-dir .data/vaults/acme.git log -1 --format=%B
# kb(admissions): update "Enroll a returning student in Salesforce"
#
# Change-Class: addition
# Changeset: cs_...
# Source: library-editor
# Co-authored-by: Alice Reyes <alice@acme.test>
```

## A suggestion

1. Sign in as Carol, open the same note, and choose Suggest an edit. A reason is required.
2. Sign in as Alice. Review shows the suggestion, with the diff and why it needs review.
3. Approve. The commit credits Carol and Alice, and the note's `verified` gains Alice.

## Two people, one note

Open the same note for editing in two browsers, as Bob and as Dana (a finance note). Save in
one, then in the other. The second is not saved over the first: it offers to combine the two
versions, merges what does not overlap, and marks what does.

## A process change

As Alice, edit "Enroll a new student", choose Process change, and say what changed. After
saving: the version's major number goes up, `kb/admissions/log.md` has an entry, the note
shows "Process changed recently", Admissions Ops is notified, and notes that link to it show
a notice to their writers. Push the same kind of change from outside and the effects are
the same:

```bash
pnpm lore simulate-push --vault acme --from <a working copy with a major version bump>
```

## What is reviewed

| Try | Result |
|---|---|
| Alice deletes a note | Sent for review; needs a maintainer |
| Dana (admin) edits a Request Type | Sent for review; needs a maintainer |
| Alice renames a note | Published; links rewritten in the same commit; the address still works |
| Alice adds a secret to a note | Not saved; the problem is listed |

```bash
pnpm --filter @lore/changesets test     # one test per review rule in PRD 7.3
pnpm test:int                           # concurrent commits, conflicts, effects
pnpm --filter web e2e                   # 68 tests
```
