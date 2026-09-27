import "server-only";
import { env } from "./env";

export interface FileChange {
  status: "A" | "M" | "D" | "R";
  path: string;
  fromPath: string | null;
  before: string | null;
  after: string | null;
}

async function call(path: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(new URL(path, env().WORKER_URL), {
      ...init,
      headers: { authorization: `Bearer ${env().INTERNAL_API_TOKEN}`, ...init.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
}

/**
 * A note's text before and after one commit, from the worker's mirror. The caller has already
 * checked that the reader may see the note and that the commit is in its history. Null when
 * the worker is unreachable or has nothing for that commit.
 */
export async function fetchFileChange(
  vaultId: string,
  sha: string,
  path: string,
): Promise<FileChange | null> {
  const res = await call(
    `/vaults/${encodeURIComponent(vaultId)}/changes/${encodeURIComponent(sha)}?path=${encodeURIComponent(path)}`,
  );
  return res?.ok ? ((await res.json()) as FileChange) : null;
}

export interface FileAtRef {
  path: string;
  ref: string;
  blobSha: string | null;
  /** Null when the file does not exist at that commit. */
  text: string | null;
}

/** A file's text at a commit, or at the branch head when `ref` is omitted. */
export async function fetchFile(
  vaultId: string,
  path: string,
  ref?: string,
): Promise<FileAtRef | null> {
  const q = new URLSearchParams({ path, ...(ref ? { ref } : {}) });
  const res = await call(`/vaults/${encodeURIComponent(vaultId)}/file?${q}`);
  return res?.ok ? ((await res.json()) as FileAtRef) : null;
}

/** A blob's text by its SHA: what an editor started from, for a three-way merge. */
export async function fetchBlob(vaultId: string, sha: string): Promise<string | null> {
  const res = await call(`/vaults/${encodeURIComponent(vaultId)}/blobs/${encodeURIComponent(sha)}`);
  return res?.ok ? ((await res.json()) as { text: string }).text : null;
}

/**
 * Asks the worker to process a changeset now. Best effort: the worker also sweeps for
 * changesets nobody told it about, so a failed call delays a write but never loses it.
 */
export async function requestProcessing(changesetId: string): Promise<boolean> {
  const res = await call(`/changesets/${encodeURIComponent(changesetId)}/process`, {
    method: "POST",
  });
  return res?.ok ?? false;
}
