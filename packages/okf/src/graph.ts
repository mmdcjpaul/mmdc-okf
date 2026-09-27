import { MultiDirectedGraph, UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import { findMembersBlock } from "./hubs.ts";
import { trustTier } from "./lifecycle.ts";
import { noteLinks, resolveLink } from "./links.ts";
import { str, strList, type ParsedNote } from "./note.ts";
import { hubKindOf, hubPath, namespaceOf, toBundlePath } from "./paths.ts";
import { contentNotes, type Vault } from "./vault.ts";

export interface GraphNode {
  id: string | null;
  path: string;
  title: string;
  type: string;
  namespace: string | null;
  themes: string[];
  systems: string[];
  tags: string[];
  trust: "unverified" | "machine" | "human";
  status: string;
  /** When the note needs review; kept instead of a stale flag so graph.json does not change with the clock. */
  stale_after: string | null;
  hub: "theme" | "system" | null;
}

export type EdgeKind = "link" | "member" | "source" | "superseded_by";

export interface GraphEdge {
  kind: EdgeKind;
}

export interface WantedNote {
  /** Bundle path of the missing note. */
  path: string;
  /** Bundle paths of the notes that link to it. */
  from: string[];
}

export type Graph = MultiDirectedGraph<GraphNode, GraphEdge, { wanted: WantedNote[] }>;

/**
 * The vault's link graph. Node keys are bundle paths. Edges are body links (excluding the
 * generated hub member lists), hub membership, and `superseded_by`.
 */
export function buildGraph(vault: Vault): Graph {
  const graph: Graph = new MultiDirectedGraph();
  const notes = contentNotes(vault).sort((a, b) => (a.path < b.path ? -1 : 1));
  const keyOf = (n: ParsedNote) => toBundlePath(vault.root, n.path);
  for (const n of notes) {
    graph.addNode(keyOf(n), {
      id: str(n.data, "id") ?? null,
      path: keyOf(n),
      title: str(n.data, "title") ?? keyOf(n),
      type: str(n.data, "type") ?? "",
      namespace: namespaceOf(vault.root, n.path),
      themes: strList(n.data, "themes"),
      systems: strList(n.data, "systems"),
      tags: strList(n.data, "tags"),
      trust: trustTier(n.data.verified),
      status: str(n.data, "status") ?? "stable",
      stale_after: str(n.data, "stale_after") ?? null,
      hub: hubKindOf(vault.root, n.path),
    });
  }
  const wanted = new Map<string, Set<string>>();
  const addEdge = (source: string, target: string, kind: EdgeKind) => {
    if (source === target || !graph.hasNode(target)) return;
    graph.mergeEdgeWithKey(`${kind}:${source}->${target}`, source, target, { kind });
  };
  for (const n of notes) {
    const source = keyOf(n);
    const members = findMembersBlock(n.text);
    for (const { link, resolved } of noteLinks(vault, n)) {
      if (members && link.start >= members.start && link.start < members.end) continue;
      if (!resolved.path) continue;
      const target = toBundlePath(vault.root, resolved.path);
      if (resolved.wanted) {
        const set = wanted.get(target) ?? new Set<string>();
        set.add(source);
        wanted.set(target, set);
      } else addEdge(source, target, "link");
    }
    for (const t of strList(n.data, "themes"))
      addEdge(source, toBundlePath(vault.root, hubPath(vault.root, "theme", t)), "member");
    for (const s of strList(n.data, "systems"))
      addEdge(source, toBundlePath(vault.root, hubPath(vault.root, "system", s)), "member");
    if (Array.isArray(n.data.sources)) {
      for (const s of n.data.sources as Record<string, unknown>[]) {
        const resource = s && typeof s.resource === "string" ? s.resource : null;
        if (!resource || !resource.startsWith("/")) continue;
        const r = resolveLink(vault, n.path, resource);
        if (r.path && r.exists) addEdge(source, toBundlePath(vault.root, r.path), "source");
      }
    }
    const sup = str(n.data, "superseded_by");
    if (sup) {
      const r = resolveLink(vault, n.path, sup);
      if (r.path) addEdge(source, toBundlePath(vault.root, r.path), "superseded_by");
    }
  }
  graph.setAttribute(
    "wanted",
    [...wanted.entries()]
      .map(([path, from]) => ({ path, from: [...from].sort() }))
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
  );
  return graph;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Louvain communities over body links between non-hub notes. Hubs are left out so clusters
 * reflect the links people wrote rather than theme membership. Deterministic for a given graph.
 */
export function communities(graph: Graph): Map<string, number> {
  const g = new UndirectedGraph();
  graph.forEachNode((key, attrs) => {
    if (!attrs.hub) g.addNode(key);
  });
  graph.forEachEdge((_edge, attrs, source, target) => {
    if (attrs.kind === "member") return;
    if (!g.hasNode(source) || !g.hasNode(target) || source === target) return;
    if (!g.hasEdge(source, target)) g.addEdge(source, target);
  });
  const out = new Map<string, number>();
  if (g.size === 0) return out;
  const mapping = louvain(g, { rng: seeded(42), randomWalk: false });
  for (const [node, community] of Object.entries(mapping)) {
    if (g.degree(node) > 0) out.set(node, community);
  }
  return out;
}

/** Inbound and outbound edges of the given kinds (body links by default), ignoring hub membership. */
export function linkDegree(
  graph: Graph,
  node: string,
  kinds: EdgeKind[] = ["link"],
): { inbound: number; outbound: number } {
  let inbound = 0;
  let outbound = 0;
  graph.forEachInEdge(node, (_e, attrs) => {
    if (kinds.includes(attrs.kind)) inbound++;
  });
  graph.forEachOutEdge(node, (_e, attrs) => {
    if (kinds.includes(attrs.kind)) outbound++;
  });
  return { inbound, outbound };
}

export interface GraphJson {
  okf_version: string;
  nodes: GraphNode[];
  edges: { source: string; target: string; kind: EdgeKind }[];
  wanted: WantedNote[];
}

export function graphToJson(vault: Vault, graph: Graph): GraphJson {
  const nodes: GraphNode[] = [];
  graph.forEachNode((_k, attrs) => nodes.push(attrs));
  nodes.sort((a, b) => (a.path < b.path ? -1 : 1));
  const edges: GraphJson["edges"] = [];
  graph.forEachEdge((_e, attrs, source, target) =>
    edges.push({ source, target, kind: attrs.kind }),
  );
  edges.sort((a, b) =>
    a.source < b.source
      ? -1
      : a.source > b.source
        ? 1
        : a.target < b.target
          ? -1
          : a.target > b.target
            ? 1
            : a.kind < b.kind
              ? -1
              : 1,
  );
  return {
    okf_version: vault.profile.okf_version,
    nodes,
    edges,
    wanted: graph.getAttribute("wanted") ?? [],
  };
}
