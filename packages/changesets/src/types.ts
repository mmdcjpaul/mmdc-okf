import type { Actor, ChangeClass, FileOp, Issue } from "@lore/okf";

export type Level = "read" | "write" | "maintain";

export type ChangesetSource = "editor" | "suggest" | "upload" | "capture" | "gardener" | "agent";

/**
 * An operation that needs the whole vault to carry out, such as a move that rewrites inbound
 * links. The pipeline expands it into file operations with `@lore/okf`.
 */
export type ChangesetIntent =
  | {
      /** Changes a note's body and chosen frontmatter keys, leaving every other byte alone. */
      type: "edit";
      path: string;
      /** The new body, or undefined to keep it. */
      body?: string;
      set?: Record<string, unknown>;
      unset?: string[];
    }
  | {
      type: "create";
      namespace: string;
      /** Subfolder inside the namespace. */
      folder?: string;
      data: Record<string, unknown>;
      body: string;
    }
  | { type: "move"; from: string; to: string }
  | { type: "delete"; path: string }
  | { type: "deprecate"; path: string; supersededBy: string }
  | { type: "verify"; path: string }
  | { type: "rename_term"; kind: "theme" | "system" | "tag"; from: string; to: string }
  | { type: "merge_terms"; kind: "theme" | "system" | "tag"; from: string[]; into: string }
  | { type: "add_term"; kind: "theme" | "system" | "tag"; slug: string; description: string }
  | {
      /** Registers a namespace or changes its settings. Admins only. */
      type: "set_namespace";
      slug: string;
      patch: {
        title?: string;
        description?: string;
        owner?: string | null;
        visibility?: "company" | "restricted";
        publishing?: "auto" | "manual";
        ai_processing?: boolean;
      };
    }
  /** Sets the team slugs the vault knows, for checking owners offline. Admins only. */
  | { type: "set_teams"; teams: string[] };

/** A file operation as stored in Postgres: binary content is base64. */
export type StoredOp =
  | { op: "put"; path: string; content: string; encoding?: "utf8" | "base64" }
  | { op: "delete"; path: string };

/** What happened to one note between the vault before and after a changeset. */
export interface NoteChange {
  id: string;
  kind: "created" | "updated" | "moved" | "deleted";
  /** Path before the change; null for a new note. */
  from: string | null;
  /** Path after the change; null for a deleted note. */
  to: string | null;
  title: string;
  type: string;
  typeBefore: string | null;
  namespace: string | null;
  namespaceBefore: string | null;
  hub: "theme" | "system" | null;
  statusBefore: string | null;
  status: string | null;
  versionBefore: string | null;
  /** True when a person had verified the note before this change. */
  humanVerified: boolean;
  /** True when the text changed, as opposed to a pure move. */
  textChanged: boolean;
  /** True when the submitter edited this note; false for side effects such as rewritten links. */
  primary: boolean;
}

export interface TermChange {
  kind: "namespace" | "theme" | "system" | "tag";
  slug: string;
  change: "added" | "removed";
}

export interface DuplicateFlag {
  path: string;
  /** Id of the existing note it resembles or contradicts. */
  otherId: string;
  kind: "duplicate" | "contradiction";
  /** Cosine similarity, when the flag came from embeddings. */
  score?: number;
}

/** Everything the review rules need to know about a changeset. */
export interface ChangesetFacts {
  notes: NoteChange[];
  terms: TermChange[];
  /** Namespaces the changeset writes to, sorted. Hubs and vocabulary files have none. */
  namespaces: string[];
  /** True when hub notes or `.kb/` vocabulary files change. */
  touchesTaxonomy: boolean;
  /** Paths of assets added or removed. */
  assets: string[];
}

export interface ChangesetDraft {
  source: ChangesetSource;
  aiDrafted: boolean;
  changeClass: ChangeClass;
  facts: ChangesetFacts;
  /** Lint errors left after the automatic repair. */
  unrepaired: Issue[];
  duplicates: DuplicateFlag[];
}

export interface ReviewContext {
  /** The submitter's level on each namespace they can read. */
  access: ReadonlyMap<string, Level>;
  isAdmin: boolean;
  /** Publishing mode per namespace. Namespaces not listed are manual. */
  publishing: Readonly<Record<string, "auto" | "manual">>;
}

export type ReviewCode =
  | "no-write-access"
  | "ai-manual-namespace"
  | "ai-process-change"
  | "ai-changes-verified"
  | "new-term"
  | "likely-duplicate"
  | "contradiction"
  | "destructive"
  | "action-or-request-type"
  | "validation";

export interface ReviewReason {
  /** Rule number in PRD 7.3, 1 to 8. */
  rule: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  code: ReviewCode;
  message: string;
  /** Who may approve a changeset this reason applies to. */
  level: "write" | "maintain";
}

export interface ReviewDecision {
  review: boolean;
  reasons: ReviewReason[];
  approverLevel: "write" | "maintain";
}

export interface PrepareInput {
  id: string;
  source: ChangesetSource;
  aiDrafted: boolean;
  changeClass: ChangeClass;
  /** OKF actor of the writer. */
  actor: Actor;
  /** The submitter ticked "I checked this is accurate". */
  verify: boolean;
  /** One line for the namespace log when the change class is process. */
  summary?: string | null;
  ops: FileOp[];
  intents: ChangesetIntent[];
  /** Blob SHA of each file the submitter started from; null for a file that did not exist. */
  baseShas: Record<string, string | null>;
  duplicates?: DuplicateFlag[];
  /**
   * Set when a reviewer approved the changeset. Their approval counts as a human
   * verification of the notes it changes.
   */
  approvedBy?: Actor | null;
}

export type PrepareStatus = "ready" | "conflicted" | "invalid" | "forbidden";

export interface Prepared {
  status: PrepareStatus;
  /** Why the changeset was refused, when status is forbidden. */
  refusal: string | null;
  /** Files that changed in Git after the draft was made. */
  conflicts: string[];
  /** Lint issues in the files the changeset touches. Errors make it invalid. */
  issues: Issue[];
  warnings: string[];
  /** What to commit: the submitter's changes plus version bumps, verification, and log entries. */
  finalOps: FileOp[];
  facts: ChangesetFacts;
  decision: ReviewDecision;
  /** Subject of the commit, without the `kb(<namespace>):` prefix. */
  title: string;
}
