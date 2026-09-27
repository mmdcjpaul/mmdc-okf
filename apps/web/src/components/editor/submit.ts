/** Saving a changeset from the browser and waiting for it to settle. */

export interface ChangesetStatus {
  id: string;
  state: string;
  title: string;
  error: string | null;
  issues: { rule: string; severity: string; path: string; line?: number; message: string }[];
  conflicts: string[];
  warnings: string[];
  reviewReasons: { rule: number; code: string; message: string }[];
  commitSha: string | null;
  indexed: boolean;
  href: string | null;
}

export type Outcome =
  /** Committed and visible in the Library. */
  | { kind: "published"; status: ChangesetStatus }
  | { kind: "review"; status: ChangesetStatus }
  | { kind: "invalid"; status: ChangesetStatus }
  | { kind: "conflict"; status: ChangesetStatus }
  | { kind: "failed"; message: string };

const SLOW =
  "This is taking longer than usual. Your change is saved and will be processed; check My changes in a minute.";

/** Polls until the changeset reaches a state a person has to know about. */
export async function watchChangeset(
  id: string,
  onProgress: (message: string) => void = () => {},
): Promise<Outcome> {
  const started = Date.now();
  let committedAt: number | null = null;
  for (;;) {
    const elapsed = Date.now() - started;
    await new Promise((r) => setTimeout(r, elapsed < 4000 ? 350 : 1200));
    let status: ChangesetStatus;
    try {
      const res = await fetch(`/api/changesets/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      status = (await res.json()) as ChangesetStatus;
    } catch {
      if (Date.now() - started > 90_000) return { kind: "failed", message: SLOW };
      continue;
    }
    switch (status.state) {
      case "committed":
        committedAt ??= Date.now();
        // Indexing normally follows within seconds. If it does not, the change is still
        // published, so stop waiting rather than hold the person here.
        if (status.indexed || Date.now() - committedAt > 30_000)
          return { kind: "published", status };
        onProgress("Saved. Updating the Library…");
        break;
      case "in_review":
        return { kind: "review", status };
      case "draft":
        return { kind: "invalid", status };
      case "conflicted":
        return { kind: "conflict", status };
      case "rejected":
        return { kind: "failed", message: status.error ?? "The change was refused." };
      default:
        if (Date.now() - started > 90_000) return { kind: "failed", message: SLOW };
    }
  }
}

/** Saves a change and waits for the result. Never throws. */
export async function submitChangeset(
  request: Record<string, unknown>,
  onProgress: (message: string) => void = () => {},
): Promise<Outcome> {
  try {
    const res = await fetch("/api/changesets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !json.id)
      return { kind: "failed", message: json.error ?? "The change could not be saved." };
    return await watchChangeset(json.id, onProgress);
  } catch {
    return { kind: "failed", message: "The Library could not be reached. Nothing was saved." };
  }
}
