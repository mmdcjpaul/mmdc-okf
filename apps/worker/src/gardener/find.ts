/**
 * What the Gardener looks for. Everything here reads; nothing writes. The findings become a
 * report, and some of them become proposals (`propose.ts`).
 */
import type { GardenerNote } from "@lore/db";
import { buildGraph, linkDegree, toBundlePath, type Vault as LoadedVault } from "@lore/okf";
import { indexNames, type Meilisearch } from "@lore/search";
import type { KnowledgeGap } from "../notify/gaps.ts";
import type {
  DuplicateCluster,
  GardenerReport,
  GardenerSettings,
  NoteRef,
  TermRef,
  WantedFinding,
} from "./report.ts";
import { clusters, contentWords, jaccard, nearDuplicateSlugs } from "./similarity.ts";

export const ref = (n: GardenerNote): NoteRef => ({
  id: n.id,
  slug: n.slug,
  title: n.title,
  type: n.type,
  namespace: n.namespace,
});

export interface Neighbour {
  id: string;
  score: number;
}

/** Each note's nearest notes in its own namespace, by card vector. Empty when vectors are off. */
export async function neighbours(
  meili: Meilisearch,
  vaultSlug: string,
  notes: GardenerNote[],
  limit = 4,
): Promise<Map<string, Neighbour[]>> {
  const out = new Map<string, Neighbour[]>();
  const index = meili.index(indexNames(vaultSlug).notes);
  for (const n of notes) {
    try {
      const res = await index.searchSimilarDocuments<{ id: string; _rankingScore?: number }>({
        id: n.id,
        embedder: "default",
        // The same namespace only: a proposal names both notes, and whoever reviews it must
        // be allowed to read both.
        filter: [
          `namespace = ${JSON.stringify(n.namespace)}`,
          'status != "deprecated"',
          "is_hub = false",
        ],
        limit,
        showRankingScore: true,
        attributesToRetrieve: ["id"],
      });
      out.set(
        n.id,
        res.hits.map((h) => ({ id: h.id, score: h._rankingScore ?? 0 })),
      );
    } catch {
      out.set(n.id, []);
    }
  }
  return out;
}

const TRUST = { human: 2, machine: 1, unverified: 0 } as const;

/** The note to keep from a cluster: verified, healthy, linked to, and older, in that order. */
function best(notes: GardenerNote[]): GardenerNote {
  return [...notes].sort(
    (a, b) =>
      TRUST[b.trustTier] - TRUST[a.trustTier] ||
      b.healthScore - a.healthScore ||
      b.inbound - a.inbound ||
      (a.id < b.id ? -1 : 1),
  )[0]!;
}

export function findDuplicates(
  notes: GardenerNote[],
  near: Map<string, Neighbour[]>,
  settings: GardenerSettings,
): DuplicateCluster[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const words = new Map(notes.map((n) => [n.id, contentWords(`${n.title} ${n.description}`)]));
  const pairs = new Map<string, { a: string; b: string; score: number; shared: number }>();
  for (const n of notes) {
    if (n.status === "draft") continue;
    for (const other of near.get(n.id) ?? []) {
      const o = byId.get(other.id);
      if (!o || o.id === n.id || o.status === "draft") continue;
      const shared = jaccard(words.get(n.id)!, words.get(o.id)!);
      const same =
        other.score >= settings.likely ||
        (o.type === n.type && other.score >= settings.floor && shared >= settings.wordsInCommon);
      if (!same) continue;
      const [a, b] = n.id < o.id ? [n.id, o.id] : [o.id, n.id];
      const key = `${a}:${b}`;
      const seen = pairs.get(key);
      if (!seen || other.score > seen.score) pairs.set(key, { a, b, score: other.score, shared });
    }
  }
  const found = [...pairs.values()];
  return clusters(found.map((p) => [p.a, p.b] as [string, string]))
    .map((ids) => {
      const members = ids.map((id) => byId.get(id)!);
      const keep = best(members);
      const closest = found.filter((p) => ids.includes(p.a)).sort((x, y) => y.score - x.score)[0]!;
      return {
        keep: ref(keep),
        others: members
          .filter((m) => m.id !== keep.id)
          .sort((x, y) => (x.title < y.title ? -1 : 1))
          .map(ref),
        score: Math.round(closest.score * 1000) / 1000,
        wordsInCommon: Math.round(closest.shared * 100) / 100,
      };
    })
    .sort((x, y) => y.score - x.score || (x.keep.title < y.keep.title ? -1 : 1));
}

/**
 * Notes with no links in either direction (PRD 6.5), the same test the graph report uses.
 * Belonging to a hub does not count: a note nobody links to is still hard to come across.
 */
export function findOrphans(notes: GardenerNote[], loaded: LoadedVault): GardenerNote[] {
  const graph = buildGraph(loaded);
  return notes.filter((n) => {
    if (n.status === "draft") return false;
    const key = toBundlePath(loaded.root, n.path);
    if (!graph.hasNode(key)) return false;
    const d = linkDegree(graph, key, ["link", "source", "superseded_by"]);
    return d.inbound === 0 && d.outbound === 0;
  });
}

export function findWanted(
  notes: GardenerNote[],
  loaded: LoadedVault,
  namespace: string | null,
): WantedFinding[] {
  const byPath = new Map(notes.map((n) => [toBundlePath(loaded.root, n.path), n]));
  const graph = buildGraph(loaded);
  return graph
    .getAttribute("wanted")
    .map((w) => {
      const ns = w.path.split("/")[1] ?? "";
      return {
        path: w.path,
        namespace: Object.hasOwn(loaded.namespaces, ns) && w.path.split("/").length > 2 ? ns : null,
        wantedBy: w.from.flatMap((p) => (byPath.has(p) ? [ref(byPath.get(p)!)] : [])),
      };
    })
    .filter((w) => w.wantedBy.length > 0)
    .filter((w) => !namespace || w.namespace === namespace);
}

export function findDrift(
  loaded: LoadedVault,
  notes: GardenerNote[],
  settings: GardenerSettings,
): GardenerReport["drift"] {
  const count = { theme: new Map<string, number>(), system: new Map(), tag: new Map() } as Record<
    TermRef["kind"],
    Map<string, number>
  >;
  const live = new Set(notes.map((n) => n.path));
  for (const n of loaded.notes.values()) {
    if (!live.has(n.path)) continue;
    const add = (kind: TermRef["kind"], values: unknown) => {
      if (!Array.isArray(values)) return;
      for (const v of values)
        if (typeof v === "string") count[kind].set(v, (count[kind].get(v) ?? 0) + 1);
    };
    add("theme", n.data.themes);
    add("system", n.data.systems);
    add("tag", n.data.tags);
  }
  const term = (kind: TermRef["kind"], slug: string): TermRef => ({
    kind,
    slug,
    notes: count[kind].get(slug) ?? 0,
  });
  const slugs = {
    theme: [...loaded.themes.keys()].sort(),
    system: [...loaded.systems.keys()].sort(),
    tag: Object.keys(loaded.tags).sort(),
  };

  const nearDuplicateTerms: GardenerReport["drift"]["nearDuplicateTerms"] = [];
  for (const kind of ["theme", "system", "tag"] as const) {
    const list = slugs[kind];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!nearDuplicateSlugs(list[i]!, list[j]!)) continue;
        const [a, b] = [term(kind, list[i]!), term(kind, list[j]!)];
        // The one more notes use stays.
        nearDuplicateTerms.push(b.notes > a.notes ? { keep: b, other: a } : { keep: a, other: b });
      }
    }
  }
  const described = (kind: "theme" | "system", slug: string) => {
    const hub = (kind === "theme" ? loaded.themes : loaded.systems).get(slug);
    const text = (hub?.description ?? "").trim();
    return text !== "" && !/^Hub for .+\.$/.test(text);
  };
  return {
    nearDuplicateTerms,
    tagsUsedOnce: slugs.tag.map((s) => term("tag", s)).filter((t) => t.notes === 1),
    smallThemes: slugs.theme
      .map((s) => term("theme", s))
      .filter((t) => t.notes > 0 && t.notes < settings.smallTheme),
    hubsWithoutDescription: [
      ...slugs.theme.filter((s) => !described("theme", s)).map((s) => term("theme", s)),
      ...slugs.system.filter((s) => !described("system", s)).map((s) => term("system", s)),
    ],
  };
}

export function buildReport(input: {
  notes: GardenerNote[];
  loaded: LoadedVault;
  near: Map<string, Neighbour[]>;
  namespace: string | null;
  gaps: KnowledgeGap[];
  settings: GardenerSettings;
}): GardenerReport {
  const { notes, loaded, near, namespace, gaps, settings } = input;
  const byTitle = (a: NoteRef, b: NoteRef) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  return {
    notes: notes.length,
    duplicates: findDuplicates(notes, near, settings),
    orphans: findOrphans(notes, loaded).map(ref).sort(byTitle),
    wanted: findWanted(notes, loaded, namespace),
    stale: notes
      .filter((n) => n.stale)
      .map(ref)
      .sort(byTitle),
    unverified: notes
      .filter((n) => n.trustTier === "unverified" && n.status !== "draft")
      .map(ref)
      .sort(byTitle),
    reported: notes
      .filter((n) => n.openReports >= settings.reports)
      .sort((a, b) => b.openReports - a.openReports)
      .map((n) => ({ ...ref(n), reports: n.openReports })),
    // The vocabulary belongs to the whole vault, so drift is reported for whole-vault runs.
    drift: namespace
      ? { nearDuplicateTerms: [], tagsUsedOnce: [], smallThemes: [], hubsWithoutDescription: [] }
      : findDrift(loaded, notes, settings),
    gaps,
    skipped: [],
  };
}
