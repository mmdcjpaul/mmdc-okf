import { communities, graphToJson, linkDegree, buildGraph, type Graph } from "./graph.ts";
import { groupedListing, hubMembers, renderMembersBlock, withMembersBlock } from "./hubs.ts";
import { isStale } from "./lifecycle.ts";
import { str, type ParsedNote } from "./note.ts";
import {
  basename,
  compareText,
  dirname,
  hubKindOf,
  isManagedPath,
  makeHref,
  namespaceOf,
  slugOf,
  toBundlePath,
} from "./paths.ts";
import { readText } from "./source.ts";
import type { FileOp } from "./types.ts";
import { contentNotes, type Vault } from "./vault.ts";

export interface IndexOptions {
  /** Used for the stale counts in the graph report. */
  now?: Date;
}

const REPORT_LIST_LIMIT = 25;

function titleOf(n: ParsedNote): string {
  return str(n.data, "title") ?? slugOf(n.path);
}

function link(vault: Vault, from: string, to: string, text: string): string {
  return `[${text.replace(/([[\]])/g, "\\$1")}](${makeHref(vault.root, from, to, vault.profile.link_style)})`;
}

function folderTitle(vault: Vault, folder: string): string {
  const segs = toBundlePath(vault.root, folder).slice(1).split("/");
  if (segs.length === 1 && vault.namespaces[segs[0]!]) return vault.namespaces[segs[0]!]!.title;
  if (segs[0] === "_themes" && segs.length === 1) return "Themes";
  if (segs[0] === "_systems" && segs.length === 1) return "Systems";
  const last = segs[segs.length - 1] ?? "";
  return last.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function notesUnder(notes: ParsedNote[], folder: string): ParsedNote[] {
  return notes.filter((n) => n.path.startsWith(folder + "/"));
}

function renderRootIndex(vault: Vault, notes: ParsedNote[]): string {
  const from = `${vault.root}/index.md`;
  const lines: string[] = [
    `---\nokf_version: "${vault.profile.okf_version}"\n---\n`,
    `# ${vault.profile.title}\n`,
  ];
  lines.push(
    `Start here. Each namespace, theme, and system below links to its listing or hub. ` +
      `${link(vault, from, `${vault.root}/_meta/graph-report.md`, "The graph report")} maps the most linked notes, clusters, orphans, and gaps.\n`,
  );
  const namespaces = Object.keys(vault.namespaces).sort(compareText);
  lines.push("# Namespaces\n");
  if (!namespaces.length) lines.push("_No namespaces registered._\n");
  else {
    lines.push(
      namespaces
        .map((ns) => {
          const count = notes.filter((n) => namespaceOf(vault.root, n.path) === ns).length;
          const meta = vault.namespaces[ns]!;
          const desc = meta.description.replace(/\s+/g, " ").trim();
          return `* ${link(vault, from, `${vault.root}/${ns}/index.md`, meta.title)}${desc ? ` - ${desc}` : ""} (${count} ${count === 1 ? "note" : "notes"})`;
        })
        .join("\n") + "\n",
    );
  }
  for (const kind of ["theme", "system"] as const) {
    const hubs = [...(kind === "theme" ? vault.themes : vault.systems).values()].sort((a, b) =>
      compareText(a.slug, b.slug),
    );
    lines.push(`# ${kind === "theme" ? "Themes" : "Systems"}\n`);
    if (!hubs.length) {
      lines.push(`_No ${kind} hubs yet._\n`);
      continue;
    }
    lines.push(
      hubs
        .map((h) => {
          const count = hubMembers(vault, kind, h.slug).length;
          const desc = h.description.replace(/\s+/g, " ").trim();
          return `* ${link(vault, from, h.path, h.title)}${desc ? ` - ${desc}` : ""} (${count} ${count === 1 ? "note" : "notes"})`;
        })
        .join("\n") + "\n",
    );
  }
  return lines.join("\n");
}

function renderFolderIndex(
  vault: Vault,
  folder: string,
  all: ParsedNote[],
  folders: string[],
): string {
  const from = `${folder}/index.md`;
  const lines: string[] = [`# ${folderTitle(vault, folder)}\n`];
  const segs = toBundlePath(vault.root, folder).slice(1).split("/");
  const ns = segs.length === 1 ? vault.namespaces[segs[0]!] : undefined;
  if (ns) {
    const desc = ns.description.replace(/\s+/g, " ").trim();
    const owner = ns.owner ? ` Owner: ${ns.owner}.` : "";
    if (desc || owner) lines.push(`${desc}${owner}`.trim() + "\n");
  }
  const children = folders.filter((f) => dirname(f) === folder).sort(compareText);
  if (children.length) {
    lines.push("## Folders\n");
    lines.push(
      children
        .map((c) => {
          const count = notesUnder(all, c).length;
          return `* ${link(vault, from, `${c}/index.md`, basename(c) + "/")} - ${count} ${count === 1 ? "note" : "notes"}`;
        })
        .join("\n") + "\n",
    );
  }
  const direct = all.filter((n) => dirname(n.path) === folder);
  if (direct.length) lines.push(groupedListing(vault, from, direct));
  else if (!children.length) lines.push("_No notes yet._\n");
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n*$/, "\n");
}

function renderGraphReport(vault: Vault, graph: Graph, notes: ParsedNote[], now: Date): string {
  const from = `${vault.root}/_meta/graph-report.md`;
  const byBundle = new Map(notes.map((n) => [toBundlePath(vault.root, n.path), n]));
  const nlink = (bundle: string) => {
    const n = byBundle.get(bundle);
    return n ? link(vault, from, n.path, titleOf(n)) : `\`${bundle}\``;
  };
  const content = notes.filter((n) => !hubKindOf(vault.root, n.path));
  const tiers = { human: 0, machine: 0, unverified: 0 };
  graph.forEachNode((_k, a) => {
    if (!a.hub) tiers[a.trust]++;
  });
  const stale = content
    .filter((n) => n.data.status !== "deprecated" && isStale(n, now))
    .sort((a, b) => compareText(titleOf(a), titleOf(b)));
  const unverified = content
    .filter(
      (n) => graph.getNodeAttribute(toBundlePath(vault.root, n.path), "trust") === "unverified",
    )
    .sort((a, b) => compareText(titleOf(a), titleOf(b)));
  const drafts = content.filter((n) => n.data.status === "draft").length;
  const deprecatedCount = content.filter((n) => n.data.status === "deprecated").length;
  let linkEdges = 0;
  graph.forEachEdge((_e, a) => {
    if (a.kind === "link") linkEdges++;
  });
  const wanted = graph.getAttribute("wanted") ?? [];
  const degrees = content.map((n) => {
    const key = toBundlePath(vault.root, n.path);
    return { key, ...linkDegree(graph, key) };
  });
  const orphans = content
    .map((n) => toBundlePath(vault.root, n.path))
    .filter((key) => {
      const d = linkDegree(graph, key, ["link", "source", "superseded_by"]);
      return d.inbound === 0 && d.outbound === 0;
    })
    .sort();

  const out: string[] = [
    "---",
    "type: Graph Report",
    "title: Vault graph report",
    "description: Generated map of the vault for agents - most linked notes, clusters, coverage, orphans, wanted notes, and review status.",
    "---",
    "",
    "# Summary",
    "",
    `- Notes: ${content.length} (plus ${vault.themes.size} theme hubs and ${vault.systems.size} system hubs) in ${Object.keys(vault.namespaces).length} namespaces`,
    `- Links between notes: ${linkEdges}. Wanted notes: ${wanted.length}. Orphans: ${orphans.length}.`,
    `- Trust: ${tiers.human} human-reviewed, ${tiers.machine} machine-confirmed, ${tiers.unverified} unverified.`,
    `- Review: ${stale.length} stale, ${drafts} draft, ${deprecatedCount} deprecated.`,
    "",
    "# Most linked notes",
    "",
  ];
  const top = degrees
    .filter((d) => d.inbound > 0)
    .sort((a, b) => b.inbound - a.inbound || (a.key < b.key ? -1 : 1))
    .slice(0, 15);
  out.push(
    top.length
      ? top
          .map(
            (d, i) =>
              `${i + 1}. ${nlink(d.key)} - ${d.inbound} inbound ${d.inbound === 1 ? "link" : "links"}`,
          )
          .join("\n")
      : "_No links yet._",
  );
  out.push("", "# Clusters", "");
  out.push("Groups of notes that link to each other (Louvain communities over body links).", "");
  const comm = communities(graph);
  const groups = new Map<number, string[]>();
  for (const [node, c] of comm) groups.set(c, [...(groups.get(c) ?? []), node]);
  const clusters = [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((members) => {
      const ranked = members
        .map((m) => ({ m, d: linkDegree(graph, m) }))
        .sort(
          (a, b) =>
            b.d.inbound + b.d.outbound - (a.d.inbound + a.d.outbound) || (a.m < b.m ? -1 : 1),
        )
        .map((x) => x.m);
      const themeCounts = new Map<string, number>();
      for (const m of members)
        for (const t of graph.getNodeAttribute(m, "themes"))
          themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
      const theme = [...themeCounts.entries()].sort(
        (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
      )[0]?.[0];
      const themeTitle = theme ? (vault.themes.get(theme)?.title ?? theme) : "Unthemed";
      const lead = graph.getNodeAttribute(ranked[0]!, "title");
      return { label: `${themeTitle}: ${lead}`, ranked };
    })
    .sort((a, b) => b.ranked.length - a.ranked.length || compareText(a.label, b.label));
  if (!clusters.length) out.push("_No clusters yet._");
  clusters.forEach((c, i) => {
    out.push(`## ${i + 1}. ${c.label} (${c.ranked.length} notes)`, "");
    const shown = c.ranked.slice(0, 8).map((m) => `- ${nlink(m)}`);
    if (c.ranked.length > 8) shown.push(`- and ${c.ranked.length - 8} more`);
    out.push(shown.join("\n"), "");
  });
  for (const kind of ["theme", "system"] as const) {
    const hubs = [...(kind === "theme" ? vault.themes : vault.systems).values()].sort((a, b) =>
      compareText(a.slug, b.slug),
    );
    out.push("", `# Notes per ${kind}`, "");
    if (!hubs.length) {
      out.push(`_No ${kind} hubs._`);
      continue;
    }
    out.push(`| ${kind === "theme" ? "Theme" : "System"} | Notes |`, "| --- | --- |");
    for (const h of hubs)
      out.push(
        `| ${link(vault, from, h.path, h.title)} | ${hubMembers(vault, kind, h.slug).length} |`,
      );
  }
  const listSection = (heading: string, items: string[], empty: string) => {
    out.push("", `# ${heading}`, "");
    if (!items.length) out.push(empty);
    else {
      out.push(items.slice(0, REPORT_LIST_LIMIT).join("\n"));
      if (items.length > REPORT_LIST_LIMIT)
        out.push(`- and ${items.length - REPORT_LIST_LIMIT} more`);
    }
  };
  listSection(
    "Orphans",
    orphans.map((o) => `- ${nlink(o)}`),
    "_No orphans._",
  );
  listSection(
    "Wanted notes",
    wanted.map((w) => `- \`${w.path}\` - linked from ${w.from.map(nlink).join(", ")}`),
    "_No wanted notes._",
  );
  listSection(
    "Stale notes",
    stale.map(
      (n) =>
        `- ${link(vault, from, n.path, titleOf(n))} - review was due ${str(n.data, "stale_after")}`,
    ),
    "_No stale notes._",
  );
  listSection(
    "Unverified notes",
    unverified.map((n) => `- ${link(vault, from, n.path, titleOf(n))}`),
    "_Every note has been verified._",
  );
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

/**
 * Regenerates every generated file: `index.md` in each folder (the root one declares
 * `okf_version`), hub member lists, `_meta/graph.json`, and `_meta/graph-report.md`.
 * Returns ops only for files whose content changes, so a second run returns none.
 */
export async function generateIndexes(vault: Vault, opts: IndexOptions = {}): Promise<FileOp[]> {
  const now = opts.now ?? new Date();
  const notes = contentNotes(vault).sort((a, b) => (a.path < b.path ? -1 : 1));
  const wanted = new Map<string, string>();

  wanted.set(`${vault.root}/index.md`, renderRootIndex(vault, notes));

  const folders = new Set<string>();
  for (const n of notes) {
    let d = dirname(n.path);
    while (d && d !== vault.root && d.startsWith(vault.root + "/")) {
      folders.add(d);
      d = dirname(d);
    }
  }
  for (const ns of Object.keys(vault.namespaces)) {
    if (vault.files.some((f) => f.startsWith(`${vault.root}/${ns}/`)))
      folders.add(`${vault.root}/${ns}`);
  }
  const folderList = [...folders].filter((f) => !isManagedPath(vault.root, f + "/x")).sort();
  for (const folder of folderList)
    wanted.set(`${folder}/index.md`, renderFolderIndex(vault, folder, notes, folderList));

  const hubTexts = new Map<string, string>();
  for (const [kind, hubs] of [
    ["theme", vault.themes],
    ["system", vault.systems],
  ] as const) {
    for (const hub of hubs.values()) {
      const note = vault.notes.get(hub.path);
      if (!note || note.issues.length) continue;
      const block = renderMembersBlock(vault, hub.path, hubMembers(vault, kind, hub.slug));
      hubTexts.set(hub.path, withMembersBlock(note.text, block));
    }
  }

  const graph = buildGraph(vault);
  wanted.set(
    `${vault.root}/_meta/graph.json`,
    JSON.stringify(graphToJson(vault, graph), null, 2) + "\n",
  );
  wanted.set(`${vault.root}/_meta/graph-report.md`, renderGraphReport(vault, graph, notes, now));

  const ops: FileOp[] = [];
  const paths = [...wanted.keys()].sort();
  const current = await Promise.all(paths.map((p) => readText(vault.src, p)));
  paths.forEach((p, i) => {
    if (current[i] !== wanted.get(p)) ops.push({ op: "put", path: p, content: wanted.get(p)! });
  });
  for (const [path, text] of [...hubTexts.entries()].sort()) {
    if (vault.notes.get(path)?.text !== text) ops.push({ op: "put", path, content: text });
  }
  // Index files left behind in folders that no longer hold notes.
  for (const path of vault.reserved) {
    if (basename(path) === "index.md" && !wanted.has(path) && !isManagedPath(vault.root, path)) {
      ops.push({ op: "delete", path });
    }
  }
  return ops;
}
