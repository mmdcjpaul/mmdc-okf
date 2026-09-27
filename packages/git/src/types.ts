import type { FileOp } from "@lore/okf";

/** Which repository and branch a vault lives in. */
export interface VaultRef {
  id: string;
  /** `local:<path to bare repository>` or `github:<owner>/<repo>`. */
  repository: string;
  branch: string;
}

export interface DiffEntry {
  path: string;
  status: "A" | "M" | "D" | "R";
  /** Old path of a rename. */
  from?: string;
  /** Blob before and after the change, when known (commit logs). */
  oldSha?: string;
  newSha?: string;
}

export interface TreeEntry {
  path: string;
  blobSha: string;
  size: number;
}

export interface CommitInfo {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  committedAt: Date;
  subject: string;
  body: string;
  /** Git trailers such as `Change-Class`, keyed by lowercase name. */
  trailers: Record<string, string>;
  files: DiffEntry[];
}

export interface PushEvent {
  vaultId: string;
  before: string | null;
  after: string;
}

export interface CommitInput {
  ops: FileOp[];
  message: string;
  /** The head the change was based on. The commit is refused if the branch has moved. */
  expectedHead: string | null;
  author?: { name: string; email: string };
}

export type CommitResult = { sha: string } | { headMoved: string };

/** Git access for Lore. See plans/02-library.md, L2. */
export interface GitProvider {
  head(vault: VaultRef): Promise<string | null>;
  readFile(
    vault: VaultRef,
    path: string,
    ref?: string,
  ): Promise<{ content: Uint8Array; blobSha: string } | null>;
  diff(vault: VaultRef, from: string, to: string): Promise<DiffEntry[]>;
  commit(vault: VaultRef, input: CommitInput): Promise<CommitResult>;
  openPullRequest?(
    vault: VaultRef,
    input: { branch: string; title: string; body: string },
  ): Promise<{ url: string }>;
  verifyWebhook?(req: Request): Promise<PushEvent | null>;
}
