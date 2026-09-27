/**
 * `@lore/changesets`: the one pipeline every writer goes through. The editor, suggestions,
 * uploads, captures, the Gardener, and agents all produce a changeset; this package turns it
 * into what gets committed and decides whether a person has to review it first.
 *
 * Everything here is pure: it reads a `FileSource` and returns data. The worker owns the
 * side effects (Postgres, Git).
 *
 * @packageDocumentation
 */
export type {
  ChangesetDraft,
  ChangesetFacts,
  ChangesetIntent,
  ChangesetSource,
  DuplicateFlag,
  Level,
  NoteChange,
  Prepared,
  PrepareInput,
  PrepareStatus,
  ReviewCode,
  ReviewContext,
  ReviewDecision,
  ReviewReason,
  StoredOp,
  TermChange,
} from "./types.ts";
export { analyzeChangeset } from "./analyze.ts";
export { commitMessage, SOURCE_TRAILER, type CommitMessageInput } from "./message.ts";
export { fromStoredOps, isSafePath, newRecordId, toStoredOps } from "./ops.ts";
export {
  describeChangeset,
  noteIdOf,
  prepareChangeset,
  restoreMembers,
  stripMembersBlock,
  type PrepareContext,
} from "./prepare.ts";
export { canApprove, decideReview } from "./review.ts";
