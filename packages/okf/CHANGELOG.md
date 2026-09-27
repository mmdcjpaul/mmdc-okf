# Changelog: @lore/okf

The exports of `src/index.ts` are the public API. They are recorded in `api/okf.api.txt`, and
a test fails when they change without a version bump and an entry here.

Versions follow semantic versioning: a major version removes or changes an export, a minor
version adds one, a patch changes behaviour without changing a signature.

## 1.1.0 (2026-09-27)

- Added `templateBody`, so the Library's new-note form starts from the same sections as
  `kb new`.

## 1.0.0 (2026-09-27)

The API is stable. It is the surface in section 3 of `plans/01-okf-vault-toolkit.md`, plus the
helpers that the CLI, the Library indexer, and the importer turned out to need.

Beyond the plan:

- `addTerm`, next to `renameTerm` and `mergeTerms`, for `kb taxonomy add`.
- `compactOps` and `gitBlobSha` for callers that turn ops into commits.
- `hubMembers`, `MEMBERS_START`, and `MEMBERS_END`, so readers can build or strip a hub's
  member list. The Library strips it, because it names notes a reader may not be allowed to see.
- `communities`, `graphToJson`, and `linkDegree` for graph reports.
- `formatReport`, `formatHuman`, `formatJson`, and `formatGithub` for lint output.
- Two lint rules the plan did not list: `lore/link-style` and `lore/provenance`.

Behaviour worth knowing:

- `parseNote` never throws. Problems are returned as issues on the note.
- `serializeNote` returns the original text byte for byte when nothing was modified.
- Every operation is pure and returns `FileOp[]`. Nothing in this package writes to disk
  except `DiskSource` callers that apply the ops themselves.
- Links to generated files (`index.md`, `log.md`, `_meta/`) never count as wanted notes.

## 0.1.0 (2026-09-24)

First implementation, milestones M1 to M5.
