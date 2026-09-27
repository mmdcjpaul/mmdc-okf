import {
  AiUnavailableError,
  asData,
  BudgetExceededError,
  InvalidOutputError,
  type Embedder,
  type GatewayLike,
} from "@lore/ai";
import type { ChangesetIntent, DuplicateFlag, Prepared } from "@lore/changesets";
import type { FileOp, Issue, Vault } from "@lore/okf";
import { extractWithCode, needsModel } from "../extract/index.ts";
import {
  MEDIA_TYPES,
  type Extracted,
  type ExtractedImage,
  type FileType,
} from "../extract/types.ts";
import {
  buildChangeset,
  flagDuplicates,
  linkRelated,
  type Built,
  type ExistingNote,
  type Neighbour,
} from "./build.ts";
import {
  ATOMIZE_INSTRUCTIONS,
  AtomizePlan,
  EXTRACT_INSTRUCTIONS,
  ExtractedDocument,
} from "./plan.ts";

export interface SimilarNote extends ExistingNote {
  description: string;
  type: string;
  body: string;
}

export interface IngestItem {
  id: string;
  kind: "upload" | "capture";
  namespace: string;
  hints: { theme?: string; tags?: string[]; type?: string; target?: string };
  fileName: string | null;
  fileKey: string | null;
  fileType: FileType | null;
}

export interface IngestInput {
  item: IngestItem;
  /** The uploaded file. */
  bytes?: Uint8Array;
  /** A capture's text and screenshots. */
  text?: string;
  images?: ExtractedImage[];
  submitter: { id: string; handle: string; readable: ReadonlySet<string> };
  vaultId: string;
}

export interface IngestDeps {
  gateway: GatewayLike;
  embedder: Embedder | null;
  /** The vault at the branch head: vocabulary, profile, and notes. */
  vault: Vault;
  /** Existing notes most like the text, among those the submitter can read. */
  similar(text: string, limit: number): Promise<SimilarNote[]>;
  /** Runs the changeset pipeline without committing, to see what lint says. */
  dryRun(draft: Draft): Promise<Prepared>;
  now(): Date;
}

/** What the pipeline hands to the changeset pipeline. */
export interface Draft {
  source: "upload" | "capture";
  aiDrafted: boolean;
  /** `human:<id>` when no model wrote anything, `lore-ingest/<model>` otherwise. */
  actor: string;
  changeClass: "fix" | "addition" | "process";
  ops: FileOp[];
  intents: ChangesetIntent[];
  baseShas: Record<string, string | null>;
  aiSummary: string | null;
  warnings: string[];
  duplicates: DuplicateFlag[];
}

export type IngestResult =
  | { status: "draft"; draft: Draft; extracted: Extracted; modelCalls: number }
  /** Nothing is wrong with the item; it waits, for example for next month's budget. */
  | { status: "waiting"; reason: string; extracted: Extracted | null }
  | { status: "refused"; reason: string; extracted: Extracted | null }
  | { status: "failed"; reason: string; extracted: Extracted | null };

const stemOf = (name: string | null) =>
  (name ?? "capture")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim() || "Upload";

function vocabularyOf(vault: Vault) {
  const tag = ([slug, t]: [string, { description?: string; aliases?: string[] }]) =>
    `- ${slug}${t.description ? `: ${t.description}` : ""}${t.aliases?.length ? ` (also: ${t.aliases.join(", ")})` : ""}`;
  const hub = (h: { slug: string; title: string; description: string; aliases: string[] }) =>
    `- ${h.slug}: ${h.title}. ${h.description}${h.aliases.length ? ` (also: ${h.aliases.join(", ")})` : ""}`;
  const types = Object.keys(vault.profile.types).filter(
    (t) => !["Theme", "System", "Source Document", "Graph Report"].includes(t),
  );
  // Sorted, so the text is the same on every call and the provider's cache can hold it.
  const text = [
    "# Vocabulary",
    "## Types\n" + types.map((t) => `- ${t}`).join("\n"),
    "## Namespaces\n" +
      Object.entries(vault.namespaces)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([slug, n]) => `- ${slug}: ${n.title}. ${n.description}`)
        .join("\n"),
    "## Themes\n" +
      [...vault.themes.values()]
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map(hub)
        .join("\n"),
    "## Systems\n" +
      [...vault.systems.values()]
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map(hub)
        .join("\n"),
    "## Tags\n" +
      Object.entries(vault.tags)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(tag)
        .join("\n"),
  ].join("\n\n");
  return {
    text,
    sets: {
      themes: new Set(vault.themes.keys()),
      systems: new Set(vault.systems.keys()),
      tags: new Set(Object.keys(vault.tags)),
      types: new Set(types),
    },
  };
}

function profileOf(vault: Vault): string {
  const l = vault.profile.limits;
  return [
    "# Rules of this vault",
    `- Notes link with ${vault.profile.link_style} paths.`,
    `- At most ${l.max_themes} themes and ${l.max_tags} tags per note.`,
    `- Aim for under ${l.words_warn} words. Over ${l.words_error} is refused.`,
    "- Sections by type:",
    ...Object.keys(vault.profile.types).map((t) => `  - ${t}`),
  ].join("\n");
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};
const card = (n: { title: string; description: string }) => `${n.title}\n${n.description}`;

/**
 * From upload to a draft changeset (PRD 7.2, stages 2 to 6). Commits nothing: the result
 * goes to the changeset pipeline, which lints it and applies the review rules.
 *
 * When AI is off, or the namespace does not allow AI processing, no model is called. The
 * file is converted by code and becomes a draft note for a person to finish.
 */
export async function runIngest(
  input: IngestInput,
  deps: IngestDeps,
  opts: { aiAllowed: boolean },
): Promise<IngestResult> {
  const { item, submitter } = input;
  const { gateway, vault } = deps;
  const root = vault.root;
  let calls = 0;
  let extracted: Extracted | null = null;

  const useAi = opts.aiAllowed && gateway.mode !== "off" && (await gateway.ready("ingest.atomize"));
  const who = { userId: submitter.id, vaultId: input.vaultId, namespace: item.namespace };

  try {
    // 2. Extract.
    if (item.kind === "capture") {
      extracted = {
        type: "md",
        markdown: (input.text ?? "").trim() + "\n",
        title: null,
        pages: null,
        images: input.images ?? [],
        warnings: [],
        method: "code",
      };
    } else {
      if (!input.bytes || !item.fileType)
        return { status: "failed", reason: "The file is missing", extracted };
      const type = item.fileType;
      extracted = await extractWithCode(item.fileName ?? `upload.${type}`, input.bytes, type);
      if (useAi && needsModel(type) && (await gateway.ready("ingest.extract"))) {
        const read = await gateway.generate({
          task: "ingest.extract",
          instructions: EXTRACT_INSTRUCTIONS,
          input: `Convert the attached ${type === "pdf" ? "PDF" : "image"} to markdown.`,
          images: [{ bytes: input.bytes, mediaType: MEDIA_TYPES[type] }],
          schema: ExtractedDocument,
          ...who,
        });
        calls++;
        extracted = {
          ...extracted,
          markdown: read.output.markdown.trim() + "\n",
          title: read.output.title || extracted.title,
          warnings: read.output.unreadable.map((u) => `Could not be read: ${u}`),
          method: "code",
        };
      }
    }
    const title = (extracted.title ?? stemOf(item.fileName)).slice(0, 160);
    const vocabulary = vocabularyOf(vault);
    const notesByKey = new Map<string, ExistingNote>();
    const remember = (n: ExistingNote) => {
      notesByKey.set(n.id, n);
      notesByKey.set(n.path, n);
    };

    const build = (plan: AtomizePlan | null): Built =>
      buildChangeset(plan, {
        bundleRoot: root,
        namespace: item.namespace,
        readable: submitter.readable,
        note: (key) => notesByKey.get(key) ?? null,
        source: { itemId: item.id, fileName: item.fileName, fileKey: item.fileKey, title },
        extracted: extracted!,
        vocabulary: vocabulary.sets,
      });

    // Without AI: the converted text becomes a draft note for a person to finish.
    if (!useAi) {
      const built = build(null);
      if (built.rejected) return { status: "refused", reason: built.rejected, extracted };
      const stem = title.toLowerCase();
      const related = item.hints.theme
        ? `- [${item.hints.theme}](/_themes/${item.hints.theme}.md)`
        : "";
      const intents: ChangesetIntent[] = [
        ...built.intents,
        {
          type: "create",
          namespace: item.namespace,
          data: {
            type: item.hints.type ?? "Reference",
            // The Source Document has the title; the draft says what it is.
            title: `${title} (draft)`.slice(0, 160),
            description: `Converted from ${item.fileName ?? "a capture"} without AI. Not yet reviewed.`,
            themes: item.hints.theme ? [item.hints.theme] : [],
            tags: item.hints.tags ?? [],
            status: "draft",
            ...(built.sourcePath
              ? {
                  sources: [{ id: "source", resource: built.sourcePath.slice(root.length), title }],
                }
              : {}),
          },
          body:
            (extracted.markdown.trim() ||
              extracted.images
                .map(
                  (_img, i) =>
                    `![${stem}](/${item.namespace}/_assets/${built.ops[i]!.path.split("/").pop()})`,
                )
                .join("\n\n")) + `\n\n# Related\n\n${related || "<!-- link to a hub -->"}\n`,
        },
      ];
      return {
        status: "draft",
        extracted,
        modelCalls: calls,
        draft: {
          source: item.kind,
          aiDrafted: false,
          actor: `human:${submitter.handle}`,
          changeClass: "addition",
          ops: built.ops,
          intents,
          baseShas: built.baseShas,
          aiSummary: null,
          warnings: [
            ...built.warnings,
            opts.aiAllowed
              ? "AI is not available, so the file was converted without it and saved as a draft"
              : `AI processing is turned off for ${item.namespace}, so the file was converted without it and saved as a draft`,
          ],
          duplicates: [],
        },
      };
    }

    // 3. Context: similar notes, the vocabulary, the rules.
    const similar = await deps.similar(`${title}\n${extracted.markdown.slice(0, 4000)}`, 8);
    const target = item.hints.target
      ? (similar.find((s) => s.id === item.hints.target) ??
        (await deps.similar(item.hints.target, 1)).find((s) => s.id === item.hints.target))
      : undefined;
    const known = [
      ...new Map([...(target ? [target] : []), ...similar].map((s) => [s.id, s])).values(),
    ];
    known.forEach(remember);

    const material = [
      `The submitter chose the namespace: ${item.namespace}`,
      item.hints.theme ? `The submitter suggests the theme: ${item.hints.theme}` : "",
      item.hints.tags?.length
        ? `The submitter suggests the tags: ${item.hints.tags.join(", ")}`
        : "",
      target
        ? `The submitter says this updates the note with id ${target.id} ("${target.title}").`
        : "",
      "",
      "# Existing notes most similar to the document",
      known.length
        ? known
            .map((s) =>
              asData(
                `existing note; id ${s.id}; path ${s.path.slice(root.length)}; type ${s.type}; title ${s.title}`,
                s.body,
              ),
            )
            .join("\n\n")
        : "None.",
      "",
      "# The document",
      asData(item.fileName ?? "capture", extracted.markdown),
    ]
      .filter((l, i, all) => l !== "" || all[i - 1] !== "")
      .join("\n");

    // 4. Atomize.
    const atomize = async (feedback?: string) => {
      const res = await gateway.generate({
        task: "ingest.atomize",
        instructions: ATOMIZE_INSTRUCTIONS,
        context: [vocabulary.text, profileOf(vault)],
        input: feedback
          ? `${material}\n\n# Problems with your previous plan\n\n${feedback}\n\nReturn the whole plan again with these fixed.`
          : material,
        ...(item.kind === "capture" && extracted!.images.length
          ? { images: extracted!.images.map((i) => ({ bytes: i.bytes, mediaType: i.mediaType })) }
          : {}),
        schema: AtomizePlan,
        ...who,
      });
      calls++;
      return res;
    };

    const finish = async (plan: AtomizePlan, model: string) => {
      let built = build(plan);
      if (built.rejected)
        return { built, prepared: null, flags: [] as DuplicateFlag[], extra: [] as string[] };

      // 5a. The second duplicate check: each new note against the vault.
      let flags: DuplicateFlag[] = [];
      let extra: string[] = [];
      if (deps.embedder && built.created.length) {
        const neighbours = new Map<string, Neighbour[]>();
        for (const note of built.created) {
          const near = (await deps.similar(card(note), 5)).filter((s) => !s.hub);
          if (near.length === 0) continue;
          const [mine, ...theirs] = await deps.embedder.embed([card(note), ...near.map(card)]);
          neighbours.set(
            note.path,
            near
              .map((s, i) => ({
                id: s.id,
                title: s.title,
                path: s.path,
                cosine: cosine(mine!, theirs[i]!),
              }))
              .sort((a, b) => b.cosine - a.cosine),
          );
        }
        const found = flagDuplicates(built.created, neighbours);
        flags = found.flags;
        extra = found.warnings;
        if (found.related.size) {
          built = {
            ...built,
            intents: built.intents.map((i) => {
              if (i.type !== "create" || i.folder === "references") return i;
              const path = built.created.find((c) => c.title === i.data.title)?.path;
              const related = path ? found.related.get(path) : undefined;
              return related ? { ...i, body: linkRelated(i.body, related, root) } : i;
            }),
          };
        }
      }
      const draft: Draft = {
        source: item.kind,
        aiDrafted: true,
        actor: `lore-ingest/${model.slice(model.indexOf(":") + 1)}`,
        changeClass: built.changeClass,
        ops: built.ops,
        intents: built.intents,
        baseShas: built.baseShas,
        aiSummary: plan.summary,
        warnings: [...built.warnings, ...extra],
        duplicates: flags,
      };
      // 5b. Lint, in memory, exactly as the commit will.
      return { built, prepared: await deps.dryRun(draft), flags, extra, draft };
    };

    let answer = await atomize();
    let result = await finish(answer.output, answer.model);
    const errorsOf = (p: Prepared | null): Issue[] =>
      p ? p.issues.filter((i) => i.severity === "error") : [];
    const problems = (r: typeof result) =>
      r.built.rejected
        ? null // A plan that reaches outside its bounds is not repaired; it is refused.
        : r.prepared?.status === "invalid" &&
            r.prepared.refusal &&
            errorsOf(r.prepared).length === 0
          ? r.prepared.refusal
          : errorsOf(r.prepared).length
            ? errorsOf(r.prepared)
                .map((i) => `- ${i.path.slice(root.length)}: ${i.message}`)
                .join("\n")
            : null;

    // One automatic repair attempt, with the problems fed back.
    const first = problems(result);
    if (first) {
      answer = await atomize(first);
      result = await finish(answer.output, answer.model);
    }
    if (result.built.rejected)
      return { status: "refused", reason: result.built.rejected, extracted };
    if (result.prepared?.status === "forbidden")
      return { status: "refused", reason: result.prepared.refusal ?? "Not allowed", extracted };
    if (!result.draft || result.draft.intents.length === 0)
      return { status: "failed", reason: "The plan changes nothing", extracted };
    return { status: "draft", draft: result.draft, extracted, modelCalls: calls };
  } catch (err) {
    if (err instanceof BudgetExceededError)
      return {
        status: "waiting",
        reason: `${err.message}. It will be processed when there is budget again`,
        extracted,
      };
    if (err instanceof AiUnavailableError)
      return { status: "waiting", reason: `${err.message}. It will be tried again`, extracted };
    if (err instanceof InvalidOutputError)
      return { status: "failed", reason: "The model did not return a usable plan", extracted };
    throw err;
  }
}
