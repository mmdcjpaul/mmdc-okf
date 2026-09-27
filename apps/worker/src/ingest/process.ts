/**
 * The ingestion job (plans/02-library.md, L8): from an uploaded file or a capture to a
 * changeset. It commits nothing itself. What it produces goes through the changeset
 * pipeline like every other write.
 */
import {
  DeferredError,
  DeferringGateway,
  type AiSettings,
  type Embedder,
  type ModelGateway,
} from "@lore/ai";
import { computeAccess } from "@lore/auth";
import { newRecordId, prepareChangeset, toStoredOps } from "@lore/changesets";
import {
  claimIngestItem,
  clearBatchRequests,
  createChangeset,
  getIngestItem,
  getUser,
  getVault,
  grantsFor,
  listNamespaces,
  notesByIds,
  notify,
  teamIdsOf,
  updateIngestItem,
  type Db,
} from "@lore/db";
import { GitTreeSource, type Mirror } from "@lore/git";
import {
  runIngest,
  type ExtractedImage,
  type FileType,
  type ObjectStore,
  type SimilarNote,
} from "@lore/ingest";
import { loadVault } from "@lore/okf";
import { searchNotes, type Meilisearch } from "@lore/search";
import type { Logger } from "pino";
import { deferredStore } from "../batch/schedule.ts";

export interface IngestDeps {
  db: Db;
  meili: Meilisearch;
  objects: ObjectStore;
  gateway: ModelGateway;
  embedder: Embedder | null;
  log: Logger;
  mirrorFor: (repository: string) => Mirror;
  syncMirror?: (repository: string) => Promise<void>;
  /** What batching needs. Without it every model call is made at once. */
  batch?: {
    settings: () => Promise<AiSettings> | AiSettings;
    /** Providers whose batch API can be used right now. */
    providers: () => Promise<ReadonlySet<string>> | ReadonlySet<string>;
  };
  now?: () => Date;
}

export interface IngestOptions {
  /**
   * `batch` lets model calls wait for the provider's batch API, at about half the price.
   * `now` is Process now: nothing waits. Answers a batch has already given are used either way.
   */
  mode?: "now" | "batch";
}

export type IngestOutcome =
  | { state: "done"; changesetId: string }
  /** A model call is with the batch API. The item runs again when it has answered. */
  | { state: "batched"; key: string }
  | { state: "waiting" | "failed"; reason: string }
  | { state: "skipped"; reason: string };

interface CaptureHints {
  text?: string;
  images?: { key: string; name: string; mediaType: string }[];
}

/** Processes one item. Safe to call twice: the item is claimed first. */
export async function processIngestItem(
  deps: IngestDeps,
  id: string,
  opts: IngestOptions = {},
): Promise<IngestOutcome> {
  const { db, log } = deps;
  const found = await getIngestItem(db, id);
  if (!found) return { state: "skipped", reason: "No such item" };
  const item = await claimIngestItem(db, id, ["queued", "waiting", "batched"], "extracting");
  if (!item) return { state: "skipped", reason: `Item is ${found.state}` };

  const fail = async (state: "waiting" | "failed", reason: string): Promise<IngestOutcome> => {
    await updateIngestItem(db, id, { state, stateReason: reason });
    if (state === "failed") await clearBatchRequests(db, "ingest", id);
    if (state === "failed" && item.submitterId) {
      await notify(db, [
        {
          userId: item.submitterId,
          vaultId: item.vaultId,
          kind: "ingest_failed",
          title: `Not processed: ${item.fileName ?? "your capture"}`,
          body: reason,
          href: `/uploads/${id}`,
          dedupeKey: `ingest-failed:${id}`,
        },
      ]);
    }
    log.info({ id, state, reason }, "ingest item stopped");
    return { state, reason };
  };

  try {
    const vault = await getVault(db, item.vaultId);
    const user = item.submitterId ? await getUser(db, item.submitterId) : null;
    if (!vault || !user) return await fail("failed", "The submitter or the vault no longer exists");
    const namespaces = await listNamespaces(db, vault.id);
    const access = computeAccess({
      role: user.role,
      grants: (await grantsFor(db, vault.id, user.id, await teamIdsOf(db, user.id))).map((g) => ({
        namespace: g.namespace,
        level: g.level,
      })),
      namespaces,
    });
    const ns = namespaces.find((n) => n.slug === item.namespace);
    if (!ns || !access.has(item.namespace))
      return await fail("failed", "You can no longer read the namespace this was sent to");

    await deps.syncMirror?.(vault.repository);
    const mirror = deps.mirrorFor(vault.repository);
    const head = await mirror.resolve(`refs/heads/${vault.branch}`);
    if (!head) return await fail("failed", "The vault has no commits");
    const root = vault.bundleRoot.replace(/\/+$/, "");
    const src = await new GitTreeSource(mirror, head).load([root + "/", ".kb/"]);
    const loaded = await loadVault(src);
    const scope = { vaultId: vault.id, namespaces: [...access.keys()] };

    const hints = item.hints as CaptureHints & {
      theme?: string;
      tags?: string[];
      type?: string;
      target?: string;
    };
    const bytes = item.fileKey ? await deps.objects.get(item.fileKey) : undefined;
    if (item.kind === "upload" && !bytes)
      return await fail("failed", "The uploaded file is missing");
    const images: ExtractedImage[] = [];
    for (const img of hints.images ?? []) {
      const data = await deps.objects.get(img.key);
      if (data) images.push({ name: img.name, bytes: data, mediaType: img.mediaType });
    }

    const similar = async (text: string, limit: number): Promise<SimilarNote[]> => {
      const embed = async (): Promise<number[] | null> => {
        if (!deps.embedder) return null;
        try {
          if (deps.embedder.embedQuery) return await deps.embedder.embedQuery(text);
          return (await deps.embedder.embed([text]))[0] ?? null;
        } catch {
          // Keyword search still finds similar notes when embeddings are down.
          return null;
        }
      };
      const vector = await embed();
      let ids: string[];
      try {
        const res = await searchNotes(deps.meili, {
          vaultSlug: vault.slug,
          scope,
          q: text.slice(0, 300),
          vector,
          limit,
        });
        ids = res.hits.map((h) => h.id);
      } catch {
        return [];
      }
      const rows = (await notesByIds(db, scope, ids)).filter((r) => r.status !== "deprecated");
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids
        .map((noteId) => byId.get(noteId))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => ({
          id: r.id,
          path: r.path,
          title: r.title,
          description: r.description,
          type: r.type,
          namespace: r.namespace,
          blobSha: r.blobSha,
          hub: r.hubKind !== null,
          body: loaded.notes.get(r.path)?.body ?? "",
        }));
    };

    // Answers a batch has given are used whatever the mode. Only in batch mode does a new
    // call wait for one.
    const gateway = deps.batch
      ? new DeferringGateway({
          inner: deps.gateway,
          store: deferredStore(db, { kind: "ingest", id }),
          settings: deps.batch.settings,
          batchProviders: opts.mode === "batch" ? await deps.batch.providers() : new Set(),
          owner: `ingest:${id}`,
          wait: opts.mode === "batch",
        })
      : deps.gateway;

    await updateIngestItem(db, id, { state: "atomizing" });
    const result = await runIngest(
      {
        item: {
          id,
          kind: item.kind,
          namespace: item.namespace,
          hints,
          fileName: item.fileName,
          fileKey: item.fileKey,
          fileType: (item.fileType as FileType | null) ?? null,
        },
        ...(bytes ? { bytes } : {}),
        ...(hints.text ? { text: hints.text } : {}),
        images,
        submitter: { id: user.id, handle: user.handle, readable: new Set(access.keys()) },
        vaultId: vault.id,
      },
      {
        gateway,
        embedder: deps.embedder,
        vault: loaded,
        similar,
        now: () => deps.now?.() ?? new Date(),
        dryRun: (draft) =>
          prepareChangeset(
            {
              id: "cs_dry_run",
              source: draft.source,
              aiDrafted: draft.aiDrafted,
              changeClass: draft.changeClass,
              actor: draft.actor,
              verify: false,
              ops: draft.ops,
              intents: draft.intents,
              baseShas: draft.baseShas,
              duplicates: draft.duplicates,
            },
            {
              src,
              access,
              isAdmin: user.role !== "member",
              now: deps.now?.() ?? new Date(),
            },
          ),
      },
      { aiAllowed: ns.aiProcessing },
    );

    if (result.extracted)
      await updateIngestItem(db, id, {
        extractedText: result.extracted.markdown.slice(0, 400_000),
      });
    if (result.status === "waiting") return await fail("waiting", result.reason);
    if (result.status === "refused" || result.status === "failed")
      return await fail("failed", result.reason);

    const { draft } = result;
    const cs = await createChangeset(db, {
      id: newRecordId("cs", deps.now?.() ?? new Date()),
      vaultId: vault.id,
      submitterId: user.id,
      actor: draft.actor,
      source: draft.source,
      aiDrafted: draft.aiDrafted,
      changeClass: draft.changeClass,
      state: "submitted",
      title: `add notes from ${item.fileName ?? "a capture"}`,
      ops: toStoredOps(draft.ops),
      intents: draft.intents,
      baseShas: draft.baseShas,
      namespaces: [item.namespace],
      aiSummary: draft.aiSummary,
      warnings: draft.warnings,
      duplicates: draft.duplicates,
      ingestItemId: id,
      submittedAt: deps.now?.() ?? new Date(),
    });
    await updateIngestItem(db, id, { state: "done", changesetId: cs.id, stateReason: null });
    await clearBatchRequests(db, "ingest", id);
    log.info({ id, changeset: cs.id, calls: result.modelCalls }, "ingest item done");
    return { state: "done", changesetId: cs.id };
  } catch (err) {
    if (err instanceof DeferredError) {
      await updateIngestItem(db, id, { state: "batched", stateReason: null });
      log.info({ id, key: err.key }, "ingest item waits for a batch");
      return { state: "batched", key: err.key };
    }
    await fail("failed", `Something went wrong: ${(err as Error).message.slice(0, 300)}`);
    throw err;
  }
}
