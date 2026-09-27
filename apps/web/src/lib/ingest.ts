import "server-only";
import { createHash } from "node:crypto";
import { newRecordId } from "@lore/changesets";
import {
  createIngestItem,
  getNote,
  ingestItemByHash,
  listNamespaces,
  listTerms,
  type IngestItemRow,
} from "@lore/db";
import {
  CaptureRefused,
  createCaptureItem,
  inspect,
  MEDIA_TYPES,
  UploadRefused,
} from "@lore/ingest";
import { publishes, RequestError } from "./changesets";
import type { RequestContext } from "./context";
import { db, objects } from "./db";
import { requestIngest } from "./worker";

export interface Hints {
  theme?: string;
  tags?: string[];
  /** Id of the note a capture updates. */
  target?: string;
}

export interface Saved {
  id: string;
  /** An earlier upload of the same file, if there is one. */
  duplicateOf: string | null;
  /** Whether processing started. When false, the item waits in the queue. */
  processing: boolean;
}

async function checkHints(ctx: RequestContext, namespace: string, hints: Hints): Promise<Hints> {
  if (!ctx.scope.namespaces.includes(namespace)) throw new RequestError(404, "No such namespace");
  const terms = await listTerms(db(), ctx.vault.id);
  const has = (kind: string, slug: string) =>
    terms.some((t) => t.kind === kind && t.slug === slug && t.state === "active");
  const out: Hints = {};
  if (hints.theme) {
    if (!has("theme", hints.theme))
      throw new RequestError(400, `There is no theme "${hints.theme}"`);
    out.theme = hints.theme;
  }
  if (hints.tags?.length) {
    const unknown = hints.tags.filter((t) => !has("tag", t));
    if (unknown.length) throw new RequestError(400, `There is no tag "${unknown[0]}"`);
    out.tags = [...new Set(hints.tags)].slice(0, 8);
  }
  if (hints.target) {
    // A note the person cannot read cannot be named as a target, or even confirmed to exist.
    const note = await getNote(db(), ctx.scope, hints.target);
    if (!note || note.namespace !== namespace)
      throw new RequestError(400, "The note to update is not in that namespace");
    out.target = note.id;
  }
  return out;
}

/**
 * Whether processing may start right away. Writers choose Process now, which uses the normal
 * API (AU-6). Where AI is not used there is nothing to pay for, so there is nothing to wait
 * for either.
 */
async function mayProcessNow(ctx: RequestContext, namespace: string): Promise<boolean> {
  if (publishes(ctx.principal, namespace)) return true;
  const ns = (await listNamespaces(db(), ctx.vault.id)).find((n) => n.slug === namespace);
  return ns ? !ns.aiProcessing : false;
}

export async function saveUpload(
  ctx: RequestContext,
  input: { name: string; bytes: Uint8Array; namespace: string; hints: Hints; processNow: boolean },
): Promise<Saved> {
  const name = input.name.replace(/[/\\\0]/g, "_").slice(-160);
  const hints = await checkHints(ctx, input.namespace, input.hints);
  let inspected: Awaited<ReturnType<typeof inspect>>;
  try {
    inspected = await inspect(name, input.bytes);
  } catch (err) {
    if (err instanceof UploadRefused) throw new RequestError(err.status, err.message);
    throw err;
  }
  const hash = createHash("sha256").update(input.bytes).digest("hex");
  const earlier = await ingestItemByHash(db(), ctx.vault.id, hash);
  const id = newRecordId("in");
  const key = `uploads/${id}/original.${inspected.type}`;
  await objects().put(key, input.bytes, { contentType: MEDIA_TYPES[inspected.type] });
  await createIngestItem(db(), {
    id,
    vaultId: ctx.vault.id,
    submitterId: ctx.principal.user.id,
    kind: "upload",
    namespace: input.namespace,
    hints: { ...hints },
    fileKey: key,
    fileName: name,
    fileType: inspected.type,
    fileSize: input.bytes.length,
    fileHash: hash,
    duplicateOf: earlier?.id ?? null,
  });
  const now = input.processNow && (await mayProcessNow(ctx, input.namespace));
  return {
    id,
    duplicateOf: earlier?.id ?? null,
    processing: now ? await requestIngest(id) : false,
  };
}

export async function saveCapture(
  ctx: RequestContext,
  input: {
    text: string;
    images: { name: string; bytes: Uint8Array }[];
    namespace: string;
    hints: Hints;
    processNow: boolean;
  },
): Promise<Saved> {
  const hints = await checkHints(ctx, input.namespace, input.hints);
  let id: string;
  try {
    ({ id } = await createCaptureItem(
      { db: db(), objects: objects() },
      {
        vaultId: ctx.vault.id,
        submitterId: ctx.principal.user.id,
        namespace: input.namespace,
        text: input.text,
        images: input.images,
        hints,
      },
    ));
  } catch (err) {
    if (err instanceof CaptureRefused) throw new RequestError(err.status, err.message);
    throw err;
  }
  const now = input.processNow && (await mayProcessNow(ctx, input.namespace));
  return { id, duplicateOf: null, processing: now ? await requestIngest(id) : false };
}

/** Who may see an item: the person who sent it, and the writers of its namespace. */
export function canSeeItem(ctx: RequestContext, item: IngestItemRow): boolean {
  if (item.vaultId !== ctx.vault.id) return false;
  if (item.submitterId === ctx.principal.user.id || ctx.principal.isAdmin) return true;
  return publishes(ctx.principal, item.namespace);
}

/** Who may start processing: writers of the namespace (Process now, AU-6). */
export function canProcessItem(ctx: RequestContext, item: IngestItemRow): boolean {
  return (
    item.vaultId === ctx.vault.id &&
    ["queued", "batched", "waiting"].includes(item.state) &&
    publishes(ctx.principal, item.namespace)
  );
}
