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

/**
 * Asks the worker to recompute health for notes whose feedback changed. Best effort: the
 * worker recomputes after every index run as well.
 */
export async function requestHealth(vaultId: string, noteIds: string[]): Promise<boolean> {
  if (noteIds.length === 0) return true;
  const q = new URLSearchParams(noteIds.map((id) => ["note", id]));
  const res = await call(`/vaults/${encodeURIComponent(vaultId)}/health?${q}`, { method: "POST" });
  return res?.ok ?? false;
}

/** Asks the worker to process an upload or capture now. */
export async function requestIngest(itemId: string): Promise<boolean> {
  const res = await call(`/ingest/${encodeURIComponent(itemId)}/process`, { method: "POST" });
  return res?.ok ?? false;
}

export interface KeyTest {
  ok: boolean;
  model: string | null;
  message: string;
  latencyMs: number;
}

/** Makes one small call with a provider's stored key. */
export async function testProviderKey(provider: string): Promise<KeyTest> {
  const res = await call(`/ai/test?provider=${encodeURIComponent(provider)}`, { method: "POST" });
  if (!res?.ok)
    return { ok: false, model: null, message: "The worker could not be reached", latencyMs: 0 };
  return (await res.json()) as KeyTest;
}

export interface Snapshot {
  name: string;
  sha: string;
  taggedAt: string | null;
}

export async function listSnapshots(
  vaultId: string,
): Promise<{ head: string | null; tags: Snapshot[] } | null> {
  const res = await call(`/vaults/${encodeURIComponent(vaultId)}/tags`);
  return res?.ok ? ((await res.json()) as { head: string | null; tags: Snapshot[] }) : null;
}

/** Tags the branch head. Returns an error message, or null when it worked. */
export async function createSnapshot(
  vaultId: string,
  name: string,
  message: string,
): Promise<string | null> {
  const q = new URLSearchParams({ name, message });
  const res = await call(`/vaults/${encodeURIComponent(vaultId)}/tags?${q}`, { method: "POST" });
  if (res?.ok) return null;
  return (
    ((await res?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ??
    "The worker could not be reached"
  );
}

/** Asks the worker for a Gardener run. False when the worker cannot be reached. */
export async function requestGardener(
  vaultId: string,
  namespace: string | null,
  by: string,
): Promise<boolean> {
  const q = new URLSearchParams({ by, ...(namespace ? { namespace } : {}) });
  const res = await call(`/vaults/${encodeURIComponent(vaultId)}/gardener?${q}`, {
    method: "POST",
  });
  return res?.ok ?? false;
}
