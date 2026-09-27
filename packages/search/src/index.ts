/**
 * `@lore/search`: Meilisearch index settings, the permission filter every query uses, and the
 * Library's query builders (TECH_STACK section 9).
 *
 * The worker holds the admin key and writes documents; the web app holds a search-only key.
 * Meilisearch is never reachable from the browser.
 *
 * @packageDocumentation
 */
import type { ReadScope } from "@lore/db";
import {
  Meilisearch,
  type Filter,
  type SearchParams,
  type SearchResponse,
  type Settings,
} from "meilisearch";

export { Meilisearch };

export const DIMENSIONS = 1024;
/** The Library searches mostly by keyword and title. The Desk uses 0.6. */
export const LIBRARY_SEMANTIC_RATIO = 0.3;

export function indexNames(vaultSlug: string): { notes: string; chunks: string } {
  return { notes: `${vaultSlug}-notes`, chunks: `${vaultSlug}-chunks` };
}

export interface NoteDoc {
  id: string;
  path: string;
  slug: string;
  title: string;
  aliases: string[];
  description: string;
  /** Body text for keyword search, capped so large notes do not dominate. */
  body: string;
  type: string;
  /** Null for hubs, which every member can read. */
  namespace: string | null;
  is_hub: boolean;
  themes: string[];
  systems: string[];
  tags: string[];
  trust_tier: string;
  status: string;
  stale: boolean;
  desk: string;
  health: number;
  /** Unix seconds of the last change, for sorting. */
  updated_at: number;
  _vectors: { default: number[] | null };
}

export interface ChunkDoc {
  id: string;
  note_id: string;
  note_title: string;
  slug: string;
  position: number;
  heading_path: string[];
  header: string;
  text: string;
  namespace: string | null;
  is_hub: boolean;
  type: string;
  status: string;
  trust_tier: string;
  stale: boolean;
  desk: string;
  themes: string[];
  systems: string[];
  tags: string[];
  _vectors: { default: number[] | null };
}

export const FACETS = [
  "namespace",
  "type",
  "themes",
  "systems",
  "tags",
  "trust_tier",
  "status",
] as const;
export type Facet = (typeof FACETS)[number];

const FILTERABLE = [...FACETS, "is_hub", "stale", "desk", "note_id", "id"];

export function noteSettings(synonyms: Record<string, string[]>): Settings {
  return {
    searchableAttributes: ["title", "aliases", "description", "body"],
    displayedAttributes: ["*"],
    // Title and description matches outrank body proximity: people search the Library by name.
    rankingRules: [
      "words",
      "typo",
      "attributeRank",
      "proximity",
      "wordPosition",
      "sort",
      "exactness",
    ],
    filterableAttributes: FILTERABLE,
    sortableAttributes: ["updated_at", "health", "title"],
    synonyms,
    typoTolerance: { enabled: true },
    embedders: { default: { source: "userProvided", dimensions: DIMENSIONS } },
  };
}

export function chunkSettings(synonyms: Record<string, string[]>): Settings {
  return {
    searchableAttributes: ["header", "text"],
    filterableAttributes: FILTERABLE,
    synonyms,
    typoTolerance: { enabled: true },
    embedders: { default: { source: "userProvided", dimensions: DIMENSIONS } },
  };
}

/** Creates both indexes for a vault if needed and applies settings. Worker only. */
export async function ensureIndexes(
  admin: Meilisearch,
  vaultSlug: string,
  synonyms: Record<string, string[]> = {},
): Promise<void> {
  const names = indexNames(vaultSlug);
  for (const [uid, settings] of [
    [names.notes, noteSettings(synonyms)],
    [names.chunks, chunkSettings(synonyms)],
  ] as const) {
    try {
      await admin.getIndex(uid);
    } catch {
      await admin.createIndex(uid, { primaryKey: "id" }).waitTask();
    }
    await admin.index(uid).updateSettings(settings).waitTask({ timeout: 120_000 });
  }
}

export async function dropIndexes(admin: Meilisearch, vaultSlug: string): Promise<void> {
  const names = indexNames(vaultSlug);
  for (const uid of [names.notes, names.chunks]) {
    try {
      await admin.deleteIndex(uid).waitTask();
    } catch {
      // Already gone.
    }
  }
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The permission filter for one person: readable namespaces, plus hubs. Every query in this
 * package includes it; there is no search function without a scope.
 */
export function buildReadFilter(scope: ReadScope): string {
  if (scope.namespaces.length === 0) return "is_hub = true";
  return `(namespace IN [${scope.namespaces.map(quote).join(", ")}] OR is_hub = true)`;
}

export type FacetFilters = Partial<Record<Facet, string[]>>;

function facetFilters(filters: FacetFilters): string[] {
  const out: string[] = [];
  for (const [facet, values] of Object.entries(filters)) {
    if (!values?.length) continue;
    out.push(values.map((v) => `${facet} = ${quote(v)}`).join(" OR "));
  }
  return out;
}

export interface NoteSearchInput {
  vaultSlug: string;
  scope: ReadScope;
  q: string;
  /** Query vector. Omit when embeddings are unavailable: the search becomes keyword only. */
  vector?: number[] | null;
  filters?: FacetFilters;
  /** Show deprecated notes. Hidden by default. */
  includeDeprecated?: boolean;
  facets?: boolean;
  limit?: number;
  offset?: number;
  semanticRatio?: number;
}

export type NoteHit = NoteDoc & {
  _formatted?: Partial<Record<keyof NoteDoc, string>>;
  _rankingScore?: number;
};

export async function searchNotes(
  client: Meilisearch,
  input: NoteSearchInput,
): Promise<SearchResponse<NoteHit>> {
  const filter: Filter = [
    buildReadFilter(input.scope),
    ...(input.includeDeprecated ? [] : ['status != "deprecated"']),
    ...facetFilters(input.filters ?? {}),
  ];
  const params: SearchParams = {
    filter,
    limit: input.limit ?? 20,
    offset: input.offset ?? 0,
    attributesToRetrieve: [
      "id",
      "slug",
      "path",
      "title",
      "description",
      "type",
      "namespace",
      "is_hub",
      "themes",
      "systems",
      "tags",
      "trust_tier",
      "status",
      "stale",
      "updated_at",
    ],
    attributesToHighlight: ["title", "description"],
    attributesToCrop: ["body"],
    cropLength: 28,
    highlightPreTag: "<mark>",
    highlightPostTag: "</mark>",
    showRankingScore: true,
    ...(input.facets ? { facets: [...FACETS] } : {}),
  };
  if (input.vector && input.q.trim()) {
    params.vector = input.vector;
    params.hybrid = {
      embedder: "default",
      semanticRatio: input.semanticRatio ?? LIBRARY_SEMANTIC_RATIO,
    };
  }
  return client.index<NoteHit>(indexNames(input.vaultSlug).notes).search<NoteHit>(input.q, params);
}

export interface ChunkSearchInput {
  vaultSlug: string;
  scope: ReadScope;
  q: string;
  vector?: number[] | null;
  limit?: number;
  semanticRatio?: number;
}

export type ChunkHit = ChunkDoc & { _rankingScore?: number };

export async function searchChunks(
  client: Meilisearch,
  input: ChunkSearchInput,
): Promise<SearchResponse<ChunkHit>> {
  const params: SearchParams = {
    filter: [buildReadFilter(input.scope), 'status != "deprecated"'],
    limit: input.limit ?? 20,
    attributesToRetrieve: [
      "id",
      "note_id",
      "note_title",
      "slug",
      "heading_path",
      "header",
      "text",
      "namespace",
      "type",
    ],
    showRankingScore: true,
  };
  if (input.vector && input.q.trim()) {
    params.vector = input.vector;
    params.hybrid = { embedder: "default", semanticRatio: input.semanticRatio ?? 0.6 };
  }
  return client
    .index<ChunkHit>(indexNames(input.vaultSlug).chunks)
    .search<ChunkHit>(input.q, params);
}

/** Readable notes whose card vector is closest to this note's. Empty when vectors are off. */
export async function similarNotes(
  client: Meilisearch,
  input: { vaultSlug: string; scope: ReadScope; noteId: string; limit?: number },
): Promise<NoteHit[]> {
  try {
    const res = await client
      .index<NoteHit>(indexNames(input.vaultSlug).notes)
      .searchSimilarDocuments<NoteHit>({
        id: input.noteId,
        embedder: "default",
        filter: [buildReadFilter(input.scope), 'status != "deprecated"', "is_hub = false"],
        limit: input.limit ?? 6,
        attributesToRetrieve: [
          "id",
          "slug",
          "title",
          "description",
          "type",
          "namespace",
          "trust_tier",
        ],
      });
    return res.hits;
  } catch {
    return [];
  }
}
