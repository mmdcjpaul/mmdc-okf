import "server-only";
import { listNamespaces } from "@lore/db";
import { LIMITS } from "@lore/ingest";
import type { IngestFormProps } from "@/components/IngestForm";
import { aiAvailable } from "./ai";
import { publishes, vocabulary } from "./changesets";
import type { RequestContext } from "./context";
import { db } from "./db";

/** What the upload and capture forms need, for this person. */
export async function ingestFormProps(
  ctx: RequestContext,
): Promise<Omit<IngestFormProps, "kind" | "target" | "initialNamespace">> {
  const [all, vocab, ai] = await Promise.all([
    listNamespaces(db(), ctx.vault.id),
    vocabulary(ctx.vault),
    aiAvailable(),
  ]);
  return {
    // Anyone can upload or capture into a namespace they can read (PRD 7.1).
    namespaces: all
      .filter((n) => ctx.scope.namespaces.includes(n.slug))
      .map((n) => ({
        slug: n.slug,
        title: n.title,
        writes: publishes(ctx.principal, n.slug),
        ai: n.aiProcessing,
      }))
      .sort((a, b) => Number(b.writes) - Number(a.writes) || a.title.localeCompare(b.title)),
    themes: vocab.themes,
    tags: vocab.tags,
    aiAvailable: ai,
    limits: {
      maxMb: LIMITS.maxBytes / 1024 / 1024,
      maxPages: LIMITS.maxPages,
      maxImages: LIMITS.maxCaptureImages,
    },
  };
}
