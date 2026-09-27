import {
  addTerm,
  buildNoteText,
  bump,
  compactOps,
  fix,
  hubKindOf,
  initialVersion,
  isoInstant,
  isValidVersion,
  lint,
  loadVault,
  MEMBERS_END,
  MEMBERS_START,
  mergeTerms,
  moveNote,
  newId,
  normalizeNotePath,
  OverlaySource,
  parseActor,
  parseNote,
  renameTerm,
  serializeNote,
  slugify,
  str,
  verifications,
  verify,
  type FileOp,
  type FileSource,
  type Issue,
  type Vault,
} from "@lore/okf";
import { analyzeChangeset } from "./analyze.ts";
import { isSafePath } from "./ops.ts";
import { decideReview } from "./review.ts";
import type {
  ChangesetFacts,
  ChangesetIntent,
  Level,
  NoteChange,
  Prepared,
  PrepareInput,
  ReviewContext,
} from "./types.ts";

export interface PrepareContext {
  /** The vault at the head the changeset will be committed on. Must report blob SHAs. */
  src: FileSource;
  /** The submitter's level on each namespace they can read. */
  access: ReadonlyMap<string, Level>;
  isAdmin: boolean;
  now: Date;
  /** Id generator, injectable for deterministic tests. */
  newId?: () => string;
}

const EMPTY_FACTS: ChangesetFacts = {
  notes: [],
  terms: [],
  namespaces: [],
  touchesTaxonomy: false,
  assets: [],
};

function refuse(
  status: Prepared["status"],
  refusal: string,
  extra: Partial<Prepared> = {},
): Prepared {
  return {
    status,
    refusal,
    conflicts: [],
    issues: [],
    warnings: [],
    finalOps: [],
    facts: EMPTY_FACTS,
    decision: { review: true, reasons: [], approverLevel: "write" },
    title: "",
    ...extra,
  };
}

/** Rules whose fixes regenerate files. CI is the only generator, so Lore never applies them. */
const GENERATOR_RULES = new Set(["okf/reserved-files", "lore/hub-members"]);

function isGenerated(root: string, path: string): boolean {
  if (!path.startsWith(root + "/")) return false;
  const segs = path.slice(root.length + 1).split("/");
  const file = segs[segs.length - 1]!;
  return file === "index.md" || file === "log.md" || segs.includes("_meta");
}

function checkPaths(root: string, ops: FileOp[], isAdmin: boolean): string | null {
  for (const op of ops) {
    if (!isSafePath(op.path)) return `"${op.path}" is not a valid path`;
    if (op.path.startsWith(".kb/")) {
      if (op.path === ".kb/tags.yaml") continue;
      if (!isAdmin) return `Only admins change ${op.path}`;
      if (op.path.startsWith(".kb/.cache/")) return `${op.path} is a cache file`;
      continue;
    }
    if (!op.path.startsWith(root + "/")) return `"${op.path}" is outside the vault`;
    if (isGenerated(root, op.path))
      return `${op.path} is generated. Edit the notes it is built from instead`;
  }
  return null;
}

async function reload(src: FileSource, ops: FileOp[]): Promise<Vault> {
  return loadVault(new OverlaySource(src, ops));
}

/** Keys only the pipeline writes. A form cannot set them. */
const PIPELINE_KEYS = new Set(["id", "version", "generated", "verified", "stale_after"]);

/**
 * Puts a hub's generated member list back into an edited body. The Library never shows the
 * list in the editor, because it names notes the reader may not be allowed to see.
 */
export function restoreMembers(baseBody: string, editedBody: string): string {
  const start = baseBody.indexOf(MEMBERS_START);
  const end = baseBody.indexOf(MEMBERS_END);
  if (start < 0 || end < start) return editedBody;
  const clean = stripMembersBlock(editedBody);
  const heading = /(^|\n)#+[ \t]*Members[ \t]*\n+$/i.exec(baseBody.slice(0, start));
  const from = heading ? heading.index + heading[1]!.length : start;
  const block = baseBody.slice(from, end + MEMBERS_END.length);
  return `${clean.replace(/\s+$/, "")}\n\n${block}\n`;
}

/** A hub's text without its generated member list. */
export function stripMembersBlock(body: string): string {
  const start = body.indexOf(MEMBERS_START);
  const end = body.indexOf(MEMBERS_END);
  if (start < 0 || end < start) return body;
  const before = body.slice(0, start).replace(/\n#+[ \t]*Members[ \t]*\n+$/i, "\n");
  return before + body.slice(end + MEMBERS_END.length);
}

function createPath(vault: Vault, intent: Extract<ChangesetIntent, { type: "create" }>): string {
  const title = str(intent.data, "title");
  if (!title) throw new Error("A new note needs a title");
  if (!Object.hasOwn(vault.namespaces, intent.namespace))
    throw new Error(`Unknown namespace "${intent.namespace}"`);
  const folder = (intent.folder ?? "").replace(/^\/+|\/+$/g, "");
  if (folder && !folder.split("/").every((s) => /^[a-z0-9][a-z0-9-]*$/.test(s)))
    throw new Error(`"${folder}" is not a valid folder`);
  return [vault.root, intent.namespace, folder, `${slugify(title)}.md`].filter(Boolean).join("/");
}

function applyIntent(vault: Vault, intent: ChangesetIntent, actor: string, now: Date): FileOp[] {
  switch (intent.type) {
    case "edit": {
      const path = normalizeNotePath(vault.root, intent.path);
      const note = vault.notes.get(path);
      if (!note) throw new Error(`No note at ${path}`);
      const copy = { ...note, data: structuredClone(note.data) };
      for (const [k, v] of Object.entries(intent.set ?? {})) {
        if (PIPELINE_KEYS.has(k)) continue;
        if (v === null || v === undefined || (Array.isArray(v) && v.length === 0 && k !== "themes"))
          delete copy.data[k];
        else copy.data[k] = v;
      }
      for (const k of intent.unset ?? []) if (!PIPELINE_KEYS.has(k)) delete copy.data[k];
      if (intent.body !== undefined) {
        const body = intent.body.replace(/\r\n/g, "\n");
        const lead = /^\n*/.exec(note.body)![0];
        const next = hubKindOf(vault.root, path) ? restoreMembers(note.body, body) : body;
        copy.body = lead + next.replace(/^\n+/, "").replace(/\s*$/, "\n");
      }
      return [{ op: "put", path, content: serializeNote(copy) }];
    }
    case "create": {
      const path = createPath(vault, intent);
      if (vault.notes.has(path)) throw new Error(`A note already exists at ${path}`);
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(intent.data)) {
        if (PIPELINE_KEYS.has(k) || v === null || v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        data[k] = v;
      }
      return [
        { op: "put", path, content: buildNoteText(data, intent.body.replace(/\r\n/g, "\n")) },
      ];
    }
    case "move":
      return moveNote(vault, intent.from, intent.to);
    case "delete": {
      const path = normalizeNotePath(vault.root, intent.path);
      if (!vault.notes.has(path)) throw new Error(`No note at ${path}`);
      return [{ op: "delete", path }];
    }
    case "deprecate": {
      const path = normalizeNotePath(vault.root, intent.path);
      const note = vault.notes.get(path);
      if (!note) throw new Error(`No note at ${path}`);
      const copy = { ...note, data: structuredClone(note.data) };
      copy.data.status = "deprecated";
      copy.data.superseded_by = intent.supersededBy;
      return [{ op: "put", path, content: serializeNote(copy) }];
    }
    case "verify":
      return verify(vault, intent.path, actor, now);
    case "rename_term":
      return renameTerm(vault, intent.kind, intent.from, intent.to, now);
    case "merge_terms":
      return mergeTerms(vault, intent.kind, intent.from, intent.into, now);
    case "add_term":
      return addTerm(
        vault,
        intent.kind,
        intent.slug,
        { description: intent.description },
        actor,
        now,
      );
  }
}

/** Paths an intent changes on purpose, as opposed to the links it rewrites along the way. */
function intentPaths(vault: Vault, intent: ChangesetIntent): string[] {
  switch (intent.type) {
    case "edit":
      return [normalizeNotePath(vault.root, intent.path)];
    case "create":
      return [createPath(vault, intent)];
    case "move":
      return [normalizeNotePath(vault.root, intent.from), normalizeNotePath(vault.root, intent.to)];
    case "delete":
    case "deprecate":
    case "verify":
      return [normalizeNotePath(vault.root, intent.path)];
    default:
      return [];
  }
}

function quote(n: NoteChange): string {
  return `"${n.title}"`;
}

/** A subject line that says what the changeset does, for the commit and the review queue. */
export function describeChangeset(facts: ChangesetFacts, intents: ChangesetIntent[]): string {
  const term = intents.find(
    (i) => i.type === "rename_term" || i.type === "merge_terms" || i.type === "add_term",
  );
  if (term?.type === "rename_term") return `rename ${term.kind} "${term.from}" to "${term.to}"`;
  if (term?.type === "merge_terms")
    return `merge ${term.kind} ${term.from.map((f) => `"${f}"`).join(", ")} into "${term.into}"`;
  if (term?.type === "add_term") return `add ${term.kind} "${term.slug}"`;

  const main = facts.notes.filter((n) => n.primary || n.kind !== "updated");
  const verb = (n: NoteChange) =>
    n.kind === "created"
      ? "add"
      : n.kind === "deleted"
        ? "delete"
        : n.status === "deprecated" && n.statusBefore !== "deprecated"
          ? "deprecate"
          : n.kind === "moved"
            ? n.textChanged
              ? "move and update"
              : "move"
            : "update";
  if (main.length === 1) return `${verb(main[0]!)} ${quote(main[0]!)}`;
  if (main.length > 1) {
    const verbs = new Set(main.map(verb));
    const v = verbs.size === 1 ? [...verbs][0]! : "change";
    return main.length <= 3
      ? `${v} ${main.map(quote).join(", ")}`
      : `${v} ${quote(main[0]!)} and ${main.length - 1} more notes`;
  }
  if (facts.assets.length) return `update ${facts.assets.length === 1 ? "an image" : "images"}`;
  return "update the vault";
}

/**
 * Turns what a writer submitted into what gets committed, the same way for every writer:
 * checks for conflicts, expands intents, stamps versions and provenance, repairs what is
 * safe to repair, lints the result in memory, and applies the review rules.
 *
 * Nothing is written. The caller commits `finalOps` when the status is `ready` and the
 * decision does not ask for review.
 */
export async function prepareChangeset(
  input: PrepareInput,
  ctx: PrepareContext,
): Promise<Prepared> {
  const { src, now } = ctx;
  const makeId = ctx.newId;

  // 1. Has anything the submitter started from changed since?
  const conflicts: string[] = [];
  for (const [path, base] of Object.entries(input.baseShas)) {
    const current = src.blobSha ? await src.blobSha(path) : null;
    if ((current ?? null) !== (base ?? null)) conflicts.push(path);
  }
  if (conflicts.length) {
    return refuse("conflicted", "Files changed after the draft was made", {
      conflicts: conflicts.sort(),
    });
  }

  const before = await loadVault(src);
  const root = before.root;
  const bad = checkPaths(root, input.ops, ctx.isAdmin);
  if (bad) return refuse("forbidden", bad);
  if (input.ops.length === 0 && input.intents.length === 0)
    return refuse("invalid", "The changeset changes nothing");

  // 2. The submitter's changes, then each intent in order.
  let ops = compactOps(input.ops);
  let vault = ops.length ? await reload(src, ops) : before;
  const primary = new Set(
    input.ops.filter((o) => !o.path.includes("/_assets/")).map((o) => o.path),
  );
  const verifyOnly = new Set<string>();
  for (const intent of input.intents) {
    let produced: FileOp[];
    try {
      produced = applyIntent(vault, intent, input.actor, now);
    } catch (err) {
      return refuse("invalid", (err as Error).message);
    }
    for (const p of intentPaths(vault, intent)) {
      primary.add(p);
      if (intent.type === "verify" && !input.ops.some((o) => o.path === p)) verifyOnly.add(p);
    }
    ops = compactOps([...ops, ...produced]);
    vault = await reload(src, ops);
  }

  // 3. Who may read what. A person cannot write where they cannot read.
  let facts = analyzeChangeset(before, vault, ops, primary);
  const unreadable = facts.namespaces.filter((ns) => !ctx.isAdmin && !ctx.access.has(ns));
  if (unreadable.length)
    return refuse("forbidden", `No access to ${unreadable.join(", ")}`, { facts });
  const writable = (ns: string | null) =>
    ns === null
      ? ctx.isAdmin || [...ctx.access.values()].includes("maintain")
      : ctx.isAdmin || ["write", "maintain"].includes(ctx.access.get(ns) ?? "");

  // 4. Versions and provenance on the notes the submitter changed.
  const human = parseActor(input.actor)?.kind === "human";
  /** Drafts being published: they become 1.0.0 instead of taking a bump. */
  const publishDraft = new Set<string>();
  const stamped: FileOp[] = [];
  for (const n of facts.notes) {
    if (!n.to || !n.primary || n.hub !== null) continue;
    const note = vault.notes.get(n.to);
    if (!note || note.issues.some((i) => i.rule === "okf/frontmatter")) continue;
    if (n.kind === "created") {
      const copy = { ...note, data: structuredClone(note.data) };
      if (!str(copy.data, "id")) copy.data.id = makeId?.() ?? newId(vault.profile.id_prefix, now);
      if (!isValidVersion(copy.data.version))
        copy.data.version = initialVersion(str(copy.data, "status"));
      copy.data.generated = { by: input.actor, at: isoInstant(now) };
      // Only the pipeline records verification; a draft cannot arrive already verified.
      delete copy.data.verified;
      delete copy.data.stale_after;
      const text = serializeNote(copy);
      if (text !== note.text) stamped.push({ op: "put", path: n.to, content: text });
    } else if (n.textChanged && !verifyOnly.has(n.to)) {
      // The version and verification always continue from what is in Git, whatever the
      // submitted text says, so nobody can skip a bump or carry a verification forward.
      const old = before.notes.get(n.from!);
      const copy = { ...note, data: structuredClone(note.data) };
      const oldVersion = old ? str(old.data, "version") : undefined;
      if (isValidVersion(oldVersion)) copy.data.version = oldVersion;
      else if (!isValidVersion(copy.data.version))
        copy.data.version = initialVersion(str(copy.data, "status"));
      if (old?.data.verified === undefined) delete copy.data.verified;
      else copy.data.verified = structuredClone(old.data.verified);
      if (old?.data.stale_after === undefined) delete copy.data.stale_after;
      else copy.data.stale_after = old.data.stale_after;
      if (old?.data.generated !== undefined)
        copy.data.generated = structuredClone(old.data.generated);
      if (old && str(old.data, "id")) copy.data.id = str(old.data, "id");
      const publishing =
        n.statusBefore === "draft" &&
        n.status !== "draft" &&
        /^0\./.test(String(copy.data.version));
      const text = serializeNote(copy);
      if (text !== note.text) stamped.push({ op: "put", path: n.to, content: text });
      if (publishing) publishDraft.add(n.to);
    }
  }
  if (stamped.length) {
    ops = compactOps([...ops, ...stamped]);
    vault = await reload(src, ops);
  }
  for (const n of facts.notes) {
    if (!n.to || !n.primary || n.hub !== null || n.kind === "created") continue;
    if (!n.textChanged || verifyOnly.has(n.to)) continue;
    const note = vault.notes.get(n.to);
    if (!note || !isValidVersion(str(note.data, "version"))) continue;
    let produced: FileOp[];
    if (publishDraft.has(n.to)) {
      const copy = { ...note, data: structuredClone(note.data) };
      copy.data.version = "1.0.0";
      copy.data.generated = { by: input.actor, at: isoInstant(now) };
      produced = [{ op: "put", path: n.to, content: serializeNote(copy) }];
    } else {
      produced = bump(vault, n.to, input.changeClass, input.actor, now, {
        ...(input.summary ? { summary: input.summary } : {}),
      });
    }
    ops = compactOps([...ops, ...produced]);
    vault = await reload(src, ops);
  }
  // 5. Verification: the writer's tick, and the reviewer's approval.
  const verifiers: string[] = [];
  if (input.verify && human) verifiers.push(input.actor);
  if (input.approvedBy && parseActor(input.approvedBy)?.kind === "human")
    verifiers.push(input.approvedBy);
  for (const by of new Set(verifiers)) {
    for (const n of facts.notes) {
      if (!n.to || !n.primary || n.hub !== null || n.kind === "deleted") continue;
      if (verifyOnly.has(n.to) && by === input.actor) continue;
      // The writer's own tick counts only where they may publish.
      if (by === input.actor && by !== input.approvedBy && !writable(n.namespace)) continue;
      const note = vault.notes.get(n.to);
      if (!note || str(note.data, "status") === "draft") continue;
      if (verifications(note.data.verified).some((v) => v.by === by && v.at === isoInstant(now)))
        continue;
      ops = compactOps([...ops, ...verify(vault, n.to, by, now)]);
      vault = await reload(src, ops);
    }
  }

  // 6. Repair what is safe to repair, then lint what the changeset touches.
  const touched = () =>
    ops.filter((o) => o.op === "put" && o.path.endsWith(".md")).map((o) => o.path);
  const lintOpts = { now, paths: touched() };
  let report = await lint(vault, lintOpts);
  const repairable = {
    ...report,
    issues: report.issues.filter((i) => i.fixable && !GENERATOR_RULES.has(i.rule)),
  };
  if (repairable.issues.length) {
    const repairs = (
      await fix(vault, repairable, { now, ...(makeId ? { newId: makeId } : {}) })
    ).filter((o) => !isGenerated(root, o.path));
    if (repairs.length) {
      ops = compactOps([...ops, ...repairs]);
      vault = await reload(src, ops);
      report = await lint(vault, { now, paths: touched() });
    }
  }
  const issues = report.issues.filter((i) => !GENERATOR_RULES.has(i.rule));
  const errors = issues.filter((i) => i.severity === "error");

  // Drop ops that ended up changing nothing, so the commit holds only real changes.
  const finalOps: FileOp[] = [];
  for (const op of ops) {
    const base = await src.read(op.path);
    if (op.op === "delete") {
      if (base !== null) finalOps.push(op);
    } else if (!sameContent(base, op.content)) finalOps.push(op);
  }
  facts = analyzeChangeset(before, vault, finalOps, primary);

  const reviewCtx: ReviewContext = {
    access: ctx.access,
    isAdmin: ctx.isAdmin,
    publishing: Object.fromEntries(
      Object.entries(vault.namespaces).map(([slug, ns]) => [slug, ns.publishing]),
    ),
  };
  // People fix their own validation errors before anything is sent on. AI output gets one
  // repair attempt from the ingestion pipeline, and what is left goes to a reviewer.
  const unrepaired: Issue[] = input.aiDrafted ? errors : [];
  const decision = decideReview(
    {
      source: input.source,
      aiDrafted: input.aiDrafted,
      changeClass: input.changeClass,
      facts,
      unrepaired,
      duplicates: input.duplicates ?? [],
    },
    reviewCtx,
  );

  const warnings = [
    ...issues.filter((i) => i.severity === "warning").map((i) => `${i.path}: ${i.message}`),
    ...(input.duplicates ?? [])
      .filter((d) => d.kind === "duplicate" && (d.score ?? 1) < 0.92)
      .map((d) => `${d.path} is related to ${d.otherId}`),
  ];
  const title = describeChangeset(facts, input.intents);
  if (finalOps.length === 0)
    return refuse("invalid", "The changeset changes nothing", { facts, title });
  if (errors.length && !input.aiDrafted) {
    return {
      status: "invalid",
      refusal: `${errors.length} ${errors.length === 1 ? "problem" : "problems"} to fix before this can be saved`,
      conflicts: [],
      issues,
      warnings,
      finalOps,
      facts,
      decision,
      title,
    };
  }
  return {
    status: "ready",
    refusal: null,
    conflicts: [],
    issues,
    warnings,
    finalOps,
    facts,
    decision,
    title,
  };
}

function sameContent(a: string | Uint8Array | null, b: string | Uint8Array): boolean {
  if (a === null) return false;
  if (typeof a === "string" && typeof b === "string") return a === b;
  return Buffer.from(a).equals(Buffer.from(b));
}

/** Re-parses text the way the pipeline will, for callers that build ops from a form. */
export function noteIdOf(text: string, path: string): string | undefined {
  return str(parseNote(text, path).data, "id");
}
