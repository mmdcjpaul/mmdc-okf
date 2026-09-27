import "server-only";
import { canOn, type Principal } from "@lore/auth";
import {
  canApprove,
  newRecordId,
  toStoredOps,
  type ChangesetIntent,
  type Level,
} from "@lore/changesets";
import {
  createChangeset,
  getNote,
  listTerms,
  updateChangeset,
  type ChangesetRow,
  type NoteRow,
  type Vault,
} from "@lore/db";
import type { FileOp } from "@lore/okf";
import { z } from "zod";
import type { RequestContext } from "./context";
import { db } from "./db";
import { requestProcessing } from "./worker";

const MAX_BODY = 200_000;
const MAX_IMAGES = 10;
const DEFAULT_IMAGE_MB = 2;

const ChangeClass = z.enum(["fix", "addition", "process"]);
const Image = z.object({
  /** File name only; the server decides the folder. */
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,80}\.(png|jpe?g|gif|webp)$/),
  data: z.string().min(1),
});
const Frontmatter = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,60}$/), z.unknown());
const Common = {
  reason: z.string().trim().max(500).optional(),
  summary: z.string().trim().max(300).optional(),
  images: z.array(Image).max(MAX_IMAGES).default([]),
  /** Feedback reports this change resolves. */
  resolves: z
    .array(z.string().regex(/^fb_[0-9A-HJKMNP-TV-Z]{26}$/))
    .max(20)
    .default([]),
};

export const ChangesetRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("edit"),
    noteId: z.string().min(1),
    /** Blob SHA of the note when the editor loaded it. */
    baseSha: z.string().regex(/^[0-9a-f]{40,64}$/),
    body: z.string().max(MAX_BODY),
    set: Frontmatter.default({}),
    unset: z.array(z.string()).max(40).default([]),
    changeClass: ChangeClass,
    verify: z.boolean().default(false),
    ...Common,
  }),
  z.object({
    kind: z.literal("create"),
    namespace: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    folder: z.string().max(120).optional(),
    data: Frontmatter,
    body: z.string().max(MAX_BODY),
    verify: z.boolean().default(false),
    ...Common,
  }),
  z.object({
    kind: z.literal("move"),
    noteId: z.string().min(1),
    /** New file name without `.md`, and optionally a new namespace and folder. */
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/),
    namespace: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .optional(),
    folder: z.string().max(120).optional(),
    ...Common,
  }),
  z.object({ kind: z.literal("verify"), noteId: z.string().min(1), ...Common }),
  z.object({
    kind: z.literal("deprecate"),
    noteId: z.string().min(1),
    /** The note that replaces this one. */
    supersededBy: z.string().min(1),
    ...Common,
  }),
  z.object({ kind: z.literal("delete"), noteId: z.string().min(1), ...Common }),
]);
export type ChangesetRequest = z.infer<typeof ChangesetRequest>;

/**
 * Whether a person publishes a change to this note directly. Notes need write on their
 * namespace. Hubs belong to no namespace: whoever maintains a namespace maintains the hubs.
 */
export function publishes(p: Principal, namespace: string | null): boolean {
  if (namespace !== null) return canOn(p, namespace, "write");
  return p.isAdmin || [...p.access.values()].includes("maintain");
}

export class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function imageLimitBytes(vault: Vault): number {
  const limits = (vault.profile as { limits?: { image_max_mb?: number } }).limits;
  return (limits?.image_max_mb ?? DEFAULT_IMAGE_MB) * 1024 * 1024;
}

const SIGNATURES: [string, number[]][] = [
  ["png", [0x89, 0x50, 0x4e, 0x47]],
  ["jpg", [0xff, 0xd8, 0xff]],
  ["gif", [0x47, 0x49, 0x46, 0x38]],
  ["webp", [0x52, 0x49, 0x46, 0x46]],
];

/** True when the bytes are the kind of image the name says. SVG is not accepted: it can carry script. */
function looksLikeImage(name: string, bytes: Uint8Array): boolean {
  const ext = name.slice(name.lastIndexOf(".") + 1).replace("jpeg", "jpg");
  const sig = SIGNATURES.find(([e]) => e === ext)?.[1];
  return !!sig && sig.every((b, i) => bytes[i] === b);
}

/** Bundle-absolute path, the form links and `superseded_by` use. */
const bundlePath = (vault: Vault, repoPath: string) =>
  repoPath.slice(vault.bundleRoot.replace(/\/+$/, "").length);

export interface Saved {
  id: string;
  /** True when the worker was told; false when it will find the changeset on its next sweep. */
  queued: boolean;
}

/**
 * Saves what a person asked for as a changeset and hands it to the worker. This is the only
 * way the web app writes to a vault: it never touches Git, and it decides nothing about
 * review. It checks that the person may read what they are changing, and whether they write
 * there (an edit) or not (a suggestion).
 */
export async function saveChangeset(ctx: RequestContext, req: ChangesetRequest): Promise<Saved> {
  const { vault, principal, scope } = ctx;
  const root = vault.bundleRoot.replace(/\/+$/, "");
  const note = async (id: string): Promise<NoteRow> => {
    const found = await getNote(db(), scope, id);
    // Unreadable and missing look the same, so a note's existence is not revealed.
    if (!found) throw new RequestError(404, "Note not found");
    return found;
  };

  let namespace: string | null;
  let intents: ChangesetIntent[];
  let baseShas: Record<string, string | null> = {};
  let changeClass: ChangesetRow["changeClass"] = "fix";
  let verify = false;
  // What the change is called until the worker has prepared it and can say exactly.
  let title: string;

  switch (req.kind) {
    case "edit": {
      const n = await note(req.noteId);
      title = `update "${n.title}"`;
      namespace = n.namespace;
      baseShas = { [n.path]: req.baseSha };
      changeClass = req.changeClass;
      verify = req.verify;
      intents = [{ type: "edit", path: n.path, body: req.body, set: req.set, unset: req.unset }];
      break;
    }
    case "create": {
      if (!scope.namespaces.includes(req.namespace))
        throw new RequestError(404, "No such namespace");
      namespace = req.namespace;
      title = `add "${typeof req.data.title === "string" ? req.data.title : "a note"}"`;
      changeClass = "addition";
      verify = req.verify;
      intents = [
        {
          type: "create",
          namespace: req.namespace,
          ...(req.folder ? { folder: req.folder } : {}),
          data: req.data,
          body: req.body,
        },
      ];
      break;
    }
    case "move": {
      const n = await note(req.noteId);
      title = `move "${n.title}"`;
      if (n.hubKind) throw new RequestError(400, "Rename a theme or system from the taxonomy page");
      const ns = req.namespace ?? n.namespace!;
      if (!scope.namespaces.includes(ns)) throw new RequestError(404, "No such namespace");
      namespace = n.namespace;
      const folder = (req.folder ?? n.folder).replace(/^\/+|\/+$/g, "");
      const to = [root, ns, folder, `${req.slug}.md`].filter(Boolean).join("/");
      if (to === n.path) throw new RequestError(400, "The note is already there");
      baseShas = { [n.path]: n.blobSha, [to]: null };
      intents = [{ type: "move", from: n.path, to }];
      break;
    }
    case "verify": {
      const n = await note(req.noteId);
      title = `verify "${n.title}"`;
      namespace = n.namespace;
      if (n.hubKind || !publishes(principal, namespace))
        throw new RequestError(403, "Only writers in the namespace can verify a note");
      baseShas = { [n.path]: n.blobSha };
      intents = [{ type: "verify", path: n.path }];
      break;
    }
    case "deprecate": {
      const n = await note(req.noteId);
      title = `deprecate "${n.title}"`;
      const replacement = await note(req.supersededBy);
      if (replacement.id === n.id) throw new RequestError(400, "A note cannot replace itself");
      namespace = n.namespace;
      baseShas = { [n.path]: n.blobSha };
      intents = [
        { type: "deprecate", path: n.path, supersededBy: bundlePath(vault, replacement.path) },
      ];
      break;
    }
    case "delete": {
      const n = await note(req.noteId);
      title = `delete "${n.title}"`;
      namespace = n.namespace;
      baseShas = { [n.path]: n.blobSha };
      intents = [{ type: "delete", path: n.path }];
      break;
    }
  }

  const writes = publishes(principal, namespace);
  const reason = req.reason?.trim() || null;
  // AU-3: a suggestion says why.
  if (!writes && !reason)
    throw new RequestError(400, "Say in a sentence why you are suggesting this change");

  const ops: FileOp[] = [];
  if (req.images.length) {
    if (!namespace) throw new RequestError(400, "Images belong to a namespace");
    const limit = imageLimitBytes(vault);
    for (const image of req.images) {
      const bytes = new Uint8Array(Buffer.from(image.data, "base64"));
      if (bytes.length === 0 || bytes.length > limit)
        throw new RequestError(
          413,
          `${image.name} is larger than ${Math.round(limit / 1024 / 1024)} MB`,
        );
      if (!looksLikeImage(image.name, bytes))
        throw new RequestError(400, `${image.name} is not a PNG, JPEG, GIF, or WebP image`);
      ops.push({ op: "put", path: `${root}/${namespace}/_assets/${image.name}`, content: bytes });
    }
  }

  const row = await createChangeset(db(), {
    id: newRecordId("cs"),
    vaultId: vault.id,
    submitterId: principal.user.id,
    actor: `human:${principal.user.handle}`,
    source: writes ? "editor" : "suggest",
    aiDrafted: false,
    changeClass,
    state: "submitted",
    title,
    reason,
    summary: req.summary?.trim() || null,
    // A tick from someone who cannot publish here verifies nothing.
    verify: verify && writes,
    ops: toStoredOps(ops),
    intents,
    baseShas,
    namespaces: namespace ? [namespace] : [],
    resolvesReports: req.resolves,
    submittedAt: new Date(),
  });
  return { id: row.id, queued: await requestProcessing(row.id) };
}

/** Sends a changeset that came back to its writer (draft or conflicted) through again. */
export async function resubmit(id: string): Promise<boolean> {
  await updateChangeset(db(), id, { state: "submitted", error: null, submittedAt: new Date() });
  return requestProcessing(id);
}

export function accessOf(p: Principal): {
  id: string;
  access: ReadonlyMap<string, Level>;
  isAdmin: boolean;
} {
  return { id: p.user.id, access: p.access, isAdmin: p.isAdmin };
}

/** Who may look at a changeset: its submitter, and anyone who could approve it. */
export function canSeeChangeset(p: Principal, cs: ChangesetRow): boolean {
  if (cs.vaultId !== p.vaultId) return false;
  if (cs.submitterId === p.user.id || p.isAdmin) return true;
  // Its content is from these namespaces, so the person must at least read them all.
  if (!cs.namespaces.every((ns) => p.access.has(ns))) return false;
  return canApprove(
    { namespaces: cs.namespaces, approverLevel: cs.approverLevel ?? "write", submitterId: null },
    accessOf(p),
  );
}

export function canApproveChangeset(p: Principal, cs: ChangesetRow): boolean {
  if (cs.vaultId !== p.vaultId || cs.state !== "in_review") return false;
  return canApprove(
    {
      namespaces: cs.namespaces,
      approverLevel: cs.approverLevel ?? "write",
      submitterId: cs.submitterId,
    },
    accessOf(p),
  );
}

/** The vocabulary a form offers: only what exists, so nobody invents a term by typing. */
export async function vocabulary(vault: Vault) {
  const terms = await listTerms(db(), vault.id);
  const pick = (kind: string) =>
    terms
      .filter((t) => t.kind === kind && t.state === "active")
      .map((t) => ({ slug: t.slug, title: t.title, description: t.description }));
  const profile = vault.profile as {
    types?: Record<string, unknown>;
    teams?: string[];
    custom_fields?: { name: string; type: string; values?: string[]; required?: boolean }[];
    link_style?: "absolute" | "relative";
  };
  return {
    themes: pick("theme"),
    systems: pick("system"),
    tags: pick("tag"),
    types: Object.keys(profile.types ?? {}).filter(
      (t) => !["Theme", "System", "Graph Report", "Source Document"].includes(t),
    ),
    teams: profile.teams ?? [],
    customFields: profile.custom_fields ?? [],
    linkStyle: profile.link_style ?? "absolute",
  };
}
export type Vocabulary = Awaited<ReturnType<typeof vocabulary>>;
