import "server-only";
import { env } from "./env";

export interface FileChange {
  status: "A" | "M" | "D" | "R";
  path: string;
  fromPath: string | null;
  before: string | null;
  after: string | null;
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
  const url = new URL(
    `/vaults/${encodeURIComponent(vaultId)}/changes/${encodeURIComponent(sha)}`,
    env().WORKER_URL,
  );
  url.searchParams.set("path", path);
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${env().INTERNAL_API_TOKEN}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? ((await res.json()) as FileChange) : null;
  } catch {
    return null;
  }
}
