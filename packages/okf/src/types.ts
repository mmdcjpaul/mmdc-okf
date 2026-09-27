/** A single change to a file, produced by every pure operation in this package. */
export type FileOp =
  { op: "put"; path: string; content: string | Uint8Array } | { op: "delete"; path: string };

/**
 * An OKF actor: `human:<id>` for people, `<job>/<model>` for AI, `process:<name>` for automated jobs.
 */
export type Actor = string;

/** How much a note changed. Drives the version bump and its side effects. */
export type ChangeClass = "fix" | "addition" | "process";

/** Vocabulary kinds that `renameTerm` and `mergeTerms` operate on. */
export type TermKind = "theme" | "system" | "tag";

/** Errors fail `kb lint`; warnings do not. */
export type Severity = "error" | "warning";

/** One problem found by the linter or the parser. */
export interface Issue {
  rule: string;
  severity: Severity;
  /** Repository-relative path, for example `kb/admissions/enroll.md`. */
  path: string;
  line?: number;
  column?: number;
  message: string;
  /** True when the rule's fix can resolve this issue. */
  fixable?: boolean;
  /** Rule-specific details used by fixes and by machine consumers. */
  data?: Record<string, unknown>;
}

/** A record that someone checked a note: who, and when (ISO 8601). */
export interface Verification {
  by: Actor;
  at: string;
}
