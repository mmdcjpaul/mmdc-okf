/**
 * Turns findings into proposals. A proposal is a changeset like any other, from nobody, so
 * the review rules always send it to a person. The Gardener never commits (AU-11).
 */
import type { ChangesetIntent } from "@lore/changesets";
import type { GardenerNote } from "@lore/db";
import { linkRelated } from "@lore/ingest";
import {
  fromBundlePath,
  slugify,
  templateBody,
  toBundlePath,
  type ChangeClass,
  type Vault as LoadedVault,
} from "@lore/okf";
import type { Neighbour } from "./find.ts";
import type { GardenerReport } from "./report.ts";

export interface Proposal {
  /** Stable for the same finding, so it is not proposed twice. */
  key: string;
  /** What the reviewer reads first. */
  why: string;
  changeClass: ChangeClass;
  intents: ChangesetIntent[];
  baseShas: Record<string, string | null>;
  namespaces: string[];
}

const titleFromSlug = (slug: string) =>
  slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const percent = (n: number) => `${Math.round(n * 100)}%`;

export function proposals(input: {
  report: GardenerReport;
  notes: GardenerNote[];
  loaded: LoadedVault;
  near: Map<string, Neighbour[]>;
}): { proposals: Proposal[]; skipped: GardenerReport["skipped"] } {
  const { report, notes, loaded, near } = input;
  const byId = new Map(notes.map((n) => [n.id, n]));
  const out: Proposal[] = [];
  const skipped: GardenerReport["skipped"] = [];

  // Duplicates: keep the best note and deprecate the others in its favour.
  for (const c of report.duplicates) {
    const keep = byId.get(c.keep.id)!;
    const others = c.others.map((o) => byId.get(o.id)!);
    const ids = [keep, ...others].map((n) => n.id).sort();
    out.push({
      key: `duplicate:${ids.join(":")}`,
      why:
        `${others.map((o) => `"${o.title}"`).join(" and ")} and "${keep.title}" look like the ` +
        `same note: ${percent(c.score)} similar, with ${percent(c.wordsInCommon)} of the words ` +
        `in their titles and descriptions in common. This keeps "${keep.title}" and deprecates ` +
        `the rest in its favour. Move anything worth keeping into it first, or reject this if ` +
        `they are different.`,
      changeClass: "fix",
      intents: others.map((o) => ({
        type: "deprecate" as const,
        path: o.path,
        supersededBy: toBundlePath(loaded.root, keep.path),
      })),
      baseShas: Object.fromEntries(others.map((o) => [o.path, o.blobSha])),
      namespaces: [keep.namespace],
    });
  }

  // Orphans: a link from the nearest note in the same namespace.
  const inDuplicate = new Set(report.duplicates.flatMap((c) => c.others.map((o) => o.id)));
  const edited = new Set<string>();
  for (const o of report.orphans) {
    const orphan = byId.get(o.id)!;
    if (inDuplicate.has(orphan.id)) continue;
    const from = (near.get(orphan.id) ?? [])
      .map((n) => byId.get(n.id))
      .find((n) => n && n.status !== "draft" && !inDuplicate.has(n.id) && !edited.has(n.id));
    const parsed = from ? loaded.notes.get(from.path) : undefined;
    if (!from || !parsed) {
      skipped.push({
        what: `A link to "${orphan.title}"`,
        why: "No similar note in its namespace to link from",
      });
      continue;
    }
    const body = linkRelated(
      parsed.body,
      [{ id: orphan.id, title: orphan.title, path: orphan.path, cosine: 0 }],
      loaded.root,
    );
    if (body === parsed.body) continue;
    edited.add(from.id);
    out.push({
      key: `orphan:${orphan.id}`,
      why:
        `Nothing links to "${orphan.title}", so people only find it by searching. ` +
        `"${from.title}" is the closest note, and this adds a link from it.`,
      changeClass: "fix",
      intents: [{ type: "edit", path: from.path, body }],
      baseShas: { [from.path]: from.blobSha },
      namespaces: [from.namespace],
    });
  }

  // Wanted notes: a draft to fill in, where the links already point.
  for (const w of report.wanted) {
    const what = `A draft for ${w.path}`;
    if (!w.namespace) {
      skipped.push({ what, why: "The link does not point into a namespace" });
      continue;
    }
    const segments = w.path.split("/").slice(2);
    const file = segments.pop() ?? "";
    const slug = file.replace(/\.md$/i, "");
    const title = titleFromSlug(slug);
    if (slugify(title) !== slug || !file.endsWith(".md")) {
      skipped.push({ what, why: "The file name cannot be made from a title" });
      continue;
    }
    const first = byId.get(w.wantedBy[0]!.id)!;
    const source = loaded.notes.get(first.path);
    const usable = w.wantedBy
      .map((n) => n.type)
      .filter((t) => !["Request Type", "Action", "Runbook", "Decision"].includes(t));
    const type = usable[0] ?? "How-To";
    const themes = Array.isArray(source?.data.themes)
      ? (source.data.themes as unknown[]).filter((t): t is string => typeof t === "string")
      : [];
    const names = w.wantedBy.map((n) => `"${n.title}"`).join(", ");
    out.push({
      key: `wanted:${w.path}`,
      why:
        `${names} ${w.wantedBy.length === 1 ? "links" : "link"} to ${w.path}, which does not ` +
        `exist. This adds it as a draft to fill in. Edit it before approving, or reject this ` +
        `and remove the link.`,
      changeClass: "addition",
      intents: [
        {
          type: "create",
          namespace: w.namespace,
          ...(segments.length ? { folder: segments.join("/") } : {}),
          data: {
            type,
            title,
            description: `${title}: to be written. Wanted by ${names}.`.slice(0, 200),
            status: "draft",
            themes: themes.slice(0, 3),
          },
          body: templateBody(type, []),
        },
      ],
      baseShas: { [fromBundlePath(loaded.root, w.path)]: null },
      namespaces: [w.namespace],
    });
  }

  // Terms that are probably the same: merge the one fewer notes use into the other.
  for (const t of report.drift.nearDuplicateTerms) {
    out.push({
      key: `merge-term:${t.keep.kind}:${[t.keep.slug, t.other.slug].sort().join(":")}`,
      why:
        `The ${t.keep.kind}s "${t.other.slug}" (${t.other.notes} notes) and "${t.keep.slug}" ` +
        `(${t.keep.notes} notes) look like the same term. This merges "${t.other.slug}" into ` +
        `"${t.keep.slug}" and keeps the old name as another name for it.`,
      changeClass: "fix",
      intents: [
        { type: "merge_terms", kind: t.keep.kind, from: [t.other.slug], into: t.keep.slug },
      ],
      baseShas: {},
      namespaces: [],
    });
  }
  return { proposals: out, skipped };
}
