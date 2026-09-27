import { isSafePath, type ChangesetIntent, type DuplicateFlag } from "@lore/changesets";
import { slugify, type FileOp } from "@lore/okf";
import type { Extracted } from "../extract/types.ts";
import type { AtomizePlan } from "./plan.ts";

export interface ExistingNote {
  id: string;
  path: string;
  title: string;
  namespace: string | null;
  blobSha: string;
  /** Whether it is a hub. Hubs are taxonomy; the atomizer does not edit them. */
  hub: boolean;
}

export interface BuildContext {
  bundleRoot: string;
  /** The namespace the submitter chose. Everything the plan writes must be in it. */
  namespace: string;
  /** Namespaces the submitter can read. */
  readable: ReadonlySet<string>;
  /** Looks up a note the plan wants to update. Returns null when it does not exist. */
  note(idOrPath: string): ExistingNote | null;
  /** The uploaded file, for the Source Document note. */
  source: {
    itemId: string;
    fileName: string | null;
    /** Where the original is kept in the bucket. */
    fileKey: string | null;
    title: string;
  };
  extracted: Extracted;
  /** Terms the vocabulary has, to check the plan against. */
  vocabulary: { themes: Set<string>; systems: Set<string>; tags: Set<string>; types: Set<string> };
}

export interface Built {
  intents: ChangesetIntent[];
  ops: FileOp[];
  baseShas: Record<string, string | null>;
  /** The strongest change class among the updates; `addition` when there are only new notes. */
  changeClass: "fix" | "addition" | "process";
  warnings: string[];
  /**
   * Why the plan cannot be used at all. A plan that reaches outside what the submitter may
   * touch is rejected whole: if part of it was steered, none of it is trusted.
   */
  rejected: string | null;
  /** Paths of the notes the plan creates, for the duplicate check. */
  created: { path: string; title: string; description: string; aliases: string[] }[];
  sourcePath: string | null;
}

const RANK = { fix: 0, addition: 1, process: 2 } as const;

function reject(reason: string): Built {
  return {
    intents: [],
    ops: [],
    baseShas: {},
    changeClass: "addition",
    warnings: [],
    rejected: reason,
    created: [],
    sourcePath: null,
  };
}

/** Points image references in extracted markdown at where the images will live. */
function placeImages(markdown: string, extracted: Extracted, namespace: string, stem: string) {
  let out = markdown;
  const files: { from: string; name: string }[] = [];
  for (const [i, img] of extracted.images.entries()) {
    const ext = img.name.slice(img.name.lastIndexOf(".") + 1);
    const name = `${stem}-${i + 1}.${ext}`;
    files.push({ from: img.name, name });
    out = out.replaceAll(`](${img.name})`, `](/${namespace}/_assets/${name})`);
  }
  return { markdown: out, files };
}

/**
 * Turns the atomizer's plan into a changeset, checking everything the plan could get wrong
 * or be steered into. The plan is structure, and only structure that passes here goes on to
 * the changeset pipeline, which lints it and applies the review rules like any other write.
 */
export function buildChangeset(plan: AtomizePlan | null, ctx: BuildContext): Built {
  const { namespace, bundleRoot: root, source, extracted } = ctx;
  if (!ctx.readable.has(namespace)) return reject(`The submitter cannot read ${namespace}`);

  const warnings: string[] = [...extracted.warnings];
  const intents: ChangesetIntent[] = [];
  const baseShas: Record<string, string | null> = {};
  const created: Built["created"] = [];
  let changeClass: Built["changeClass"] = "addition";
  let sawUpdate = false;

  // The Source Document note: the extracted text, kept in the vault for provenance. The
  // original file stays in the bucket, so binaries stay out of Git.
  const stem = slugify(source.title).slice(0, 60) || "upload";
  const sourcePath = `${root}/${namespace}/references/${stem}.md`;
  const sourceHref = sourcePath.slice(root.length);
  const placed = placeImages(extracted.markdown, extracted, namespace, stem);
  const ops: FileOp[] = extracted.images.map((img, i) => ({
    op: "put",
    path: `${root}/${namespace}/_assets/${placed.files[i]!.name}`,
    content: img.bytes,
  }));
  const hasText = extracted.markdown.trim() !== "";
  if (hasText || extracted.images.length) {
    intents.push({
      type: "create",
      namespace,
      folder: "references",
      data: {
        type: "Source Document",
        title: source.title,
        description: `Extracted text of ${source.fileName ? `the uploaded file ${source.fileName}` : "a capture"}.`,
        ...(source.fileKey ? { resource: `lore://uploads/${source.itemId}` } : {}),
      },
      body:
        "# Extracted text\n\n" +
        (hasText
          ? placed.markdown.replace(/^(#{1,5}) /gm, "#$1 ")
          : placed.files.map((f) => `![${f.from}](/${namespace}/_assets/${f.name})`).join("\n\n")) +
        "\n",
    });
    baseShas[sourcePath] = null;
  }
  const sourceRef = {
    id: "source",
    resource: sourceHref,
    title: source.title,
  };

  if (plan) {
    for (const term of plan.proposedTerms) {
      const known =
        term.kind === "theme"
          ? ctx.vocabulary.themes
          : term.kind === "system"
            ? ctx.vocabulary.systems
            : ctx.vocabulary.tags;
      if (known.has(term.slug)) continue;
      intents.push({
        type: "add_term",
        kind: term.kind,
        slug: term.slug,
        description: term.description,
      });
      warnings.push(`Proposes the ${term.kind} "${term.slug}": ${term.reason}`);
    }
    const proposed = new Set(plan.proposedTerms.map((t) => `${t.kind}:${t.slug}`));
    const unknown = (kind: "theme" | "system" | "tag", set: Set<string>, slugs: string[]) =>
      slugs.filter((s) => !set.has(s) && !proposed.has(`${kind}:${s}`));

    for (const item of plan.items) {
      if (item.action === "skip") {
        warnings.push(`Skipped "${item.covered}": ${item.reason}`);
        continue;
      }
      if (item.action === "create") {
        if (item.namespace !== namespace) {
          return reject(
            `The plan writes to ${item.namespace}, which is not the namespace the submitter chose (${namespace})`,
          );
        }
        if (!ctx.vocabulary.types.has(item.type))
          return reject(`The plan uses a type that does not exist: ${item.type}`);
        if (["Theme", "System", "Source Document", "Graph Report"].includes(item.type))
          return reject(`The plan creates a ${item.type}, which uploads cannot do`);
        const invented = [
          ...unknown("theme", ctx.vocabulary.themes, item.themes),
          ...unknown("system", ctx.vocabulary.systems, item.systems),
          ...unknown("tag", ctx.vocabulary.tags, item.tags),
        ];
        if (invented.length)
          warnings.push(
            `"${item.title}" uses terms that are not in the vocabulary: ${invented.join(", ")}`,
          );
        const path = `${root}/${namespace}/${slugify(item.title)}.md`;
        if (!isSafePath(path)) return reject(`The plan has a title that cannot be a file name`);
        if (created.some((c) => c.path === path)) {
          warnings.push(`The plan has two notes titled "${item.title}"; the second was left out`);
          continue;
        }
        intents.push({
          type: "create",
          namespace,
          data: {
            type: item.type,
            title: item.title,
            description: item.description,
            themes: item.themes,
            systems: item.systems,
            tags: item.tags,
            ...(hasText ? { sources: [sourceRef] } : {}),
          },
          body: item.body,
        });
        baseShas[path] = null;
        created.push({ path, title: item.title, description: item.description, aliases: [] });
        continue;
      }
      // update
      const note = ctx.note(item.target);
      if (!note) return reject(`The plan updates a note that does not exist: ${item.target}`);
      if (note.hub)
        return reject(`The plan edits the hub "${note.title}", which uploads cannot do`);
      if (note.namespace === null || !ctx.readable.has(note.namespace)) {
        // Said without naming the note: the submitter may not know it exists.
        return reject("The plan updates a note the submitter cannot read");
      }
      if (note.namespace !== namespace) {
        return reject(
          `The plan updates "${note.title}" in ${note.namespace}, which is not the namespace the submitter chose (${namespace})`,
        );
      }
      if (intents.some((i) => i.type === "edit" && i.path === note.path)) {
        warnings.push(`The plan updates "${note.title}" twice; the second update was left out`);
        continue;
      }
      intents.push({
        type: "edit",
        path: note.path,
        body: item.body,
        set: item.description ? { description: item.description } : {},
      });
      baseShas[note.path] = note.blobSha;
      if (!sawUpdate || RANK[item.changeClass] > RANK[changeClass]) changeClass = item.changeClass;
      sawUpdate = true;
    }
  }

  return {
    intents,
    ops,
    baseShas,
    changeClass: sawUpdate ? changeClass : "addition",
    warnings,
    rejected: null,
    created,
    sourcePath: intents.length ? sourcePath : null,
  };
}

/** Thresholds from PRD 7.4. They depend on the embedding model and are tuned on real data. */
export const DUPLICATE = { likely: 0.92, related: 0.85 } as const;

export interface Neighbour {
  id: string;
  title: string;
  path: string;
  cosine: number;
}

/**
 * The second duplicate check, after drafting: each new note against the vault. A likely
 * duplicate blocks publishing without review; a related note gets a link and a warning.
 */
export function flagDuplicates(
  created: { path: string; title: string }[],
  neighbours: Map<string, Neighbour[]>,
): { flags: DuplicateFlag[]; warnings: string[]; related: Map<string, Neighbour[]> } {
  const flags: DuplicateFlag[] = [];
  const warnings: string[] = [];
  const related = new Map<string, Neighbour[]>();
  for (const note of created) {
    for (const n of neighbours.get(note.path) ?? []) {
      const sameTitle = n.title.trim().toLowerCase() === note.title.trim().toLowerCase();
      if (n.cosine >= DUPLICATE.likely || sameTitle) {
        flags.push({ path: note.path, otherId: n.id, kind: "duplicate", score: n.cosine });
        warnings.push(
          `"${note.title}" is a likely duplicate of "${n.title}". Merge them, keep both with links, or discard the new one`,
        );
      } else if (n.cosine >= DUPLICATE.related) {
        related.set(note.path, [...(related.get(note.path) ?? []), n]);
        warnings.push(`"${note.title}" is related to "${n.title}"; a link to it was added`);
      }
    }
  }
  return { flags, warnings, related };
}

/** Adds links to related notes under the note's Related section. */
export function linkRelated(body: string, related: Neighbour[], bundleRoot: string): string {
  if (related.length === 0) return body;
  const lines = related
    .map((n) => `- [${n.title.replace(/([[\]])/g, "\\$1")}](${n.path.slice(bundleRoot.length)})`)
    .filter((l) => !body.includes(l.slice(l.indexOf("]("))));
  if (lines.length === 0) return body;
  const m = /^#+\s*Related\s*$/m.exec(body);
  if (!m) return `${body.replace(/\s*$/, "")}\n\n# Related\n\n${lines.join("\n")}\n`;
  const at = m.index + m[0].length;
  return `${body.slice(0, at)}\n\n${lines.join("\n")}${body.slice(at).replace(/^\n*/, "\n")}`;
}
