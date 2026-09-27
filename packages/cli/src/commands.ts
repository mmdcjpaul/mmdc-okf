import {
  addTerm,
  bump,
  findNoteById,
  fix,
  formatReport,
  generateIndexes,
  hubKindOf,
  lint,
  loadVault,
  mergeTerms,
  moveNote,
  newNote,
  noteLinks,
  normalizeNotePath,
  OverlaySource,
  DiskSource,
  PROFILE_SCHEMA_VERSION,
  renameTerm,
  str,
  strList,
  toBundlePath,
  verify,
  type ChangeClass,
  type ReportFormat,
  type TermKind,
  type Vault,
} from "@lore/okf";
import { list, UsageError, ValidationFailure, type Context } from "./context.ts";
import { openIndex, search, type Hit } from "./search.ts";

// ------------------------------------------------------------------------------------------------
// kb lint

export async function lintCommand(
  ctx: Context,
  paths: string[],
  opts: { fix?: boolean; format?: string },
): Promise<void> {
  const formats = list(opts.format ?? "human") as ReportFormat[];
  for (const f of formats)
    if (!["human", "json", "github"].includes(f))
      throw new UsageError(`Unknown format "${f}"; use human, json, or github`);
  const repoPaths = paths.map((p) => normalizeRepoPath(ctx, p));
  let vault = await ctx.vault();
  let report = await lint(vault, { paths: repoPaths, now: ctx.now });
  if (opts.fix && report.issues.some((i) => i.fixable)) {
    const ops = await fix(vault, report, { now: ctx.now });
    if (ops.length) {
      if (formats.includes("human"))
        ctx.io.err(`Fixed ${ops.length} ${ops.length === 1 ? "file" : "files"}:\n`);
      ctx.apply(ops.map((o) => o));
      vault = await loadVault(new DiskSource(ctx.root));
      report = await lint(vault, { paths: repoPaths, now: ctx.now });
    }
  }
  for (const f of formats) ctx.io.out(formatReport(report, f));
  if (report.errors > 0) throw new ValidationFailure(`${report.errors} lint errors`);
}

function normalizeRepoPath(ctx: Context, p: string): string {
  const abs = p.startsWith("/") && p.startsWith(ctx.root) ? p.slice(ctx.root.length + 1) : p;
  return abs.replace(/^\.\//, "").replace(/\/+$/, "");
}

// ------------------------------------------------------------------------------------------------
// kb new

export async function newCommand(
  ctx: Context,
  type: string,
  title: string,
  opts: {
    ns?: string;
    theme?: string[];
    system?: string[];
    tag?: string[];
    folder?: string;
    draft?: boolean;
    description?: string;
  },
): Promise<void> {
  const vault = await ctx.vault();
  if (!vault.profile.types[type])
    throw new UsageError(
      `Unknown type "${type}". Types: ${Object.keys(vault.profile.types).join(", ")}`,
    );
  if (!opts.ns) throw new UsageError("--ns <namespace> is required");
  if (!vault.namespaces[opts.ns])
    throw new UsageError(
      `Unknown namespace "${opts.ns}". Namespaces: ${Object.keys(vault.namespaces).join(", ")}`,
    );
  const themes = list(opts.theme);
  const systems = list(opts.system);
  const tags = list(opts.tag);
  const unknown = [
    ...themes.filter((t) => !vault.themes.has(t)).map((t) => `theme "${t}"`),
    ...systems.filter((s) => !vault.systems.has(s)).map((s) => `system "${s}"`),
    ...tags.filter((t) => !Object.hasOwn(vault.tags, t)).map((t) => `tag "${t}"`),
  ];
  if (unknown.length)
    throw new UsageError(
      `Unknown ${unknown.join(", ")}. Run kb taxonomy list; never invent terms.`,
    );
  if (!themes.length && !["Theme", "System", "Source Document"].includes(type))
    throw new UsageError("--theme <theme> is required (1 to 3 themes)");
  let ops;
  try {
    ops = newNote(
      vault,
      {
        type,
        title,
        namespace: opts.ns,
        themes,
        systems,
        tags,
        ...(opts.folder ? { folder: opts.folder } : {}),
        ...(opts.draft ? { status: "draft" as const } : {}),
        ...(opts.description ? { description: opts.description } : {}),
      },
      ctx.actor(),
      ctx.now,
    );
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  ctx.apply(ops);
}

// ------------------------------------------------------------------------------------------------
// kb query and kb related

function printHits(ctx: Context, vault: Vault, hits: Hit[], json: boolean, heading?: string): void {
  if (json) return;
  if (heading) ctx.io.out(`${heading}\n`);
  if (!hits.length) {
    ctx.io.out(heading ? "  (none)\n" : "No matching notes.\n");
    return;
  }
  for (const h of hits) {
    ctx.io.out(
      `${heading ? "  " : ""}${toBundlePath(vault.root, h.path)}  [${h.type}${h.namespace ? `, ${h.namespace}` : ""}]\n`,
    );
    ctx.io.out(`${heading ? "  " : ""}  ${h.title}${h.description ? ` - ${h.description}` : ""}\n`);
  }
}

export async function queryCommand(
  ctx: Context,
  text: string,
  opts: { ns?: string; type?: string; limit?: string; json?: boolean },
): Promise<void> {
  const vault = await loadBare(ctx);
  const { index } = openIndex(ctx.root, vault.root);
  const hits = search(index, text, {
    ...(opts.ns ? { namespace: opts.ns } : {}),
    ...(opts.type ? { type: opts.type } : {}),
    limit: opts.limit ? Number(opts.limit) : 10,
  });
  if (opts.json) ctx.io.out(JSON.stringify(hits, null, 2) + "\n");
  else printHits(ctx, vault, hits, false);
}

/** Loads only the profile (and hubs), which is all `kb query` needs. */
async function loadBare(ctx: Context): Promise<Vault> {
  return loadVault(new DiskSource(ctx.root), { only: [] });
}

export async function relatedCommand(
  ctx: Context,
  target: string,
  opts: { remote?: boolean; limit?: string; json?: boolean },
): Promise<void> {
  if (opts.remote) {
    const url = ctx.env.LORE_API_URL;
    throw new ValidationFailure(
      url
        ? "kb related --remote is not available yet (Plan 4 adds the endpoint)"
        : "Lore API not configured (set LORE_API_URL)",
    );
  }
  const vault = await ctx.vault();
  const note = target.startsWith(vault.profile.id_prefix)
    ? findNoteById(vault, target)
    : vault.notes.get(normalizeNotePath(vault.root, target));
  if (!note) throw new UsageError(`No note ${target}`);
  const limit = opts.limit ? Number(opts.limit) : 10;
  const toHit = (path: string): Hit => {
    const n = vault.notes.get(path);
    return {
      path,
      noteId: str(n?.data ?? {}, "id") ?? "",
      title: str(n?.data ?? {}, "title") ?? path,
      description: str(n?.data ?? {}, "description") ?? "",
      type: str(n?.data ?? {}, "type") ?? "",
      namespace: toBundlePath(vault.root, path).split("/")[1] ?? "",
      score: 0,
    };
  };
  const outbound = [
    ...new Set(
      noteLinks(vault, note)
        .filter((l) => l.resolved.exists && l.resolved.path && vault.notes.has(l.resolved.path))
        .map((l) => l.resolved.path!),
    ),
  ].filter((p) => p !== note.path);
  const inbound: string[] = [];
  for (const other of vault.notes.values()) {
    if (
      other.path === note.path ||
      hubKindOf(vault.root, other.path) ||
      other.path.includes("/_meta/")
    )
      continue;
    if (noteLinks(vault, other).some((l) => l.resolved.path === note.path))
      inbound.push(other.path);
  }
  const { index } = openIndex(ctx.root, vault.root);
  const query = [
    str(note.data, "title"),
    str(note.data, "description"),
    ...strList(note.data, "aliases"),
    ...strList(note.data, "tags"),
  ]
    .filter(Boolean)
    .join(" ");
  const exclude = new Set([note.path, ...outbound, ...inbound]);
  const similar = search(index, query, { limit: limit + 20, exclude })
    .filter((h) => !hubKindOf(vault.root, h.path))
    .slice(0, limit);
  const result = {
    note: toHit(note.path),
    outbound: outbound.map(toHit),
    inbound: inbound.sort().map(toHit),
    similar,
  };
  if (opts.json) {
    ctx.io.out(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  ctx.io.out(`${toBundlePath(vault.root, note.path)}  ${result.note.title}\n\n`);
  printHits(ctx, vault, result.outbound.slice(0, limit), false, "Links to");
  printHits(ctx, vault, result.inbound.slice(0, limit), false, "Linked from");
  printHits(ctx, vault, similar, false, "Similar");
}

// ------------------------------------------------------------------------------------------------
// kb index

export async function indexCommand(ctx: Context, opts: { check?: boolean }): Promise<void> {
  const vault = await ctx.vault();
  const ops = await generateIndexes(vault, { now: ctx.now });
  if (opts.check) {
    if (ops.length) {
      ctx.io.out(
        `${ops.length} generated ${ops.length === 1 ? "file is" : "files are"} out of date:\n${ops.map((o) => `  ${o.path}\n`).join("")}Run kb index.\n`,
      );
      throw new ValidationFailure("generated files are out of date");
    }
    ctx.io.out("Generated files are up to date.\n");
    return;
  }
  if (!ops.length) ctx.io.out("Generated files are up to date.\n");
  else ctx.apply(ops);
}

// ------------------------------------------------------------------------------------------------
// kb mv, kb bump, kb verify

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

export async function mvCommand(ctx: Context, from: string, to: string): Promise<void> {
  const vault = await ctx.vault();
  const ops = wrap(() =>
    moveNote(
      vault,
      from,
      to.endsWith(".md") ? to : `${to.replace(/\/+$/, "")}/${from.split("/").pop()}`,
    ),
  );
  ctx.apply(ops);
}

const CLASSES = ["fix", "addition", "process"];

export async function bumpCommand(
  ctx: Context,
  path: string,
  opts: { class?: string; summary?: string },
): Promise<void> {
  if (!opts.class || !CLASSES.includes(opts.class))
    throw new UsageError("--class must be fix, addition, or process");
  const vault = await ctx.vault();
  const actor = ctx.actor();
  const ops = wrap(() =>
    bump(
      vault,
      path,
      opts.class as ChangeClass,
      actor,
      ctx.now,
      opts.summary ? { summary: opts.summary } : {},
    ),
  );
  ctx.apply(ops);
}

export async function verifyCommand(ctx: Context, path: string): Promise<void> {
  const actor = ctx.actor();
  if (!actor.startsWith("human:"))
    throw new UsageError(
      `Only people can verify notes; KB_ACTOR is ${actor}. Verification belongs to people.`,
    );
  const vault = await ctx.vault();
  ctx.apply(wrap(() => verify(vault, path, actor, ctx.now)));
}

// ------------------------------------------------------------------------------------------------
// kb taxonomy

const KINDS = ["theme", "system", "tag"];

function kindOf(kind: string): TermKind {
  if (!KINDS.includes(kind))
    throw new UsageError(`Unknown kind "${kind}"; use theme, system, or tag`);
  return kind as TermKind;
}

export async function taxonomyList(
  ctx: Context,
  opts: { kind?: string; json?: boolean },
): Promise<void> {
  const vault = await loadBare(ctx);
  const data = {
    namespaces: Object.entries(vault.namespaces).map(([slug, n]) => ({
      slug,
      title: n.title,
      description: n.description,
      owner: n.owner ?? null,
    })),
    types: Object.keys(vault.profile.types),
    themes: [...vault.themes.values()].map((h) => ({
      slug: h.slug,
      title: h.title,
      description: h.description,
      aliases: h.aliases,
    })),
    systems: [...vault.systems.values()].map((h) => ({
      slug: h.slug,
      title: h.title,
      description: h.description,
      aliases: h.aliases,
    })),
    tags: Object.entries(vault.tags).map(([slug, t]) => ({
      slug,
      description: t.description,
      aliases: t.aliases,
    })),
    teams: vault.profile.teams,
  };
  const wanted = opts.kind
    ? [opts.kind.endsWith("s") ? opts.kind : `${opts.kind}s`]
    : Object.keys(data);
  for (const k of wanted) if (!(k in data)) throw new UsageError(`Unknown kind "${opts.kind}"`);
  if (opts.json) {
    ctx.io.out(
      JSON.stringify(
        Object.fromEntries(wanted.map((k) => [k, data[k as keyof typeof data]])),
        null,
        2,
      ) + "\n",
    );
    return;
  }
  for (const k of wanted) {
    const items = data[k as keyof typeof data] as (
      string | { slug: string; description?: string; aliases?: string[] }
    )[];
    ctx.io.out(`${k[0]!.toUpperCase()}${k.slice(1)}\n`);
    if (!items.length) ctx.io.out("  (none)\n");
    for (const item of items) {
      if (typeof item === "string") ctx.io.out(`  ${item}\n`);
      else
        ctx.io.out(
          `  ${item.slug}${item.description ? ` - ${item.description}` : ""}${item.aliases?.length ? ` (aliases: ${item.aliases.join(", ")})` : ""}\n`,
        );
    }
    ctx.io.out("\n");
  }
}

export async function taxonomyAdd(
  ctx: Context,
  kind: string,
  slug: string,
  opts: { title?: string; description?: string; alias?: string[] },
): Promise<void> {
  const vault = await ctx.vault();
  const actor = ctx.actor();
  ctx.apply(
    wrap(() =>
      addTerm(
        vault,
        kindOf(kind),
        slug,
        {
          ...(opts.title ? { title: opts.title } : {}),
          ...(opts.description ? { description: opts.description } : {}),
          aliases: list(opts.alias),
        },
        actor,
        ctx.now,
      ),
    ),
  );
}

export async function taxonomyRename(
  ctx: Context,
  kind: string,
  from: string,
  to: string,
): Promise<void> {
  const vault = await ctx.vault();
  ctx.apply(wrap(() => renameTerm(vault, kindOf(kind), from, to, ctx.now)));
}

export async function taxonomyMerge(
  ctx: Context,
  kind: string,
  from: string[],
  opts: { into?: string },
): Promise<void> {
  if (!opts.into) throw new UsageError("--into <term> is required");
  const vault = await ctx.vault();
  ctx.apply(wrap(() => mergeTerms(vault, kindOf(kind), from, opts.into!, ctx.now)));
}

// ------------------------------------------------------------------------------------------------
// kb migrate

export interface Migration {
  from: string;
  to: string;
  description: string;
  run(vault: Vault): Promise<import("@lore/okf").FileOp[]>;
}

/** Registered migrations, keyed by OKF version. Ships with a no-op 0.2 to 0.2 migration. */
export const MIGRATIONS: Migration[] = [
  {
    from: "0.2",
    to: "0.2",
    description: "No changes: the vault is already on OKF 0.2",
    run: async () => [],
  },
];

export async function migrateCommand(
  ctx: Context,
  opts: { to?: string; dryRun?: boolean },
): Promise<void> {
  const vault = await ctx.vault();
  const from = vault.profile.okf_version;
  const to = opts.to ?? "0.2";
  const path = MIGRATIONS.find((m) => m.from === from && m.to === to);
  if (!path)
    throw new UsageError(
      `No migration from OKF ${from} to ${to}. Known: ${MIGRATIONS.map((m) => `${m.from} to ${m.to}`).join(", ")}`,
    );
  const ops = await path.run(vault);
  ctx.io.out(
    `OKF ${from} to ${to} (profile schema ${vault.profile.schema_version}, CLI schema ${PROFILE_SCHEMA_VERSION}): ${path.description}\n`,
  );
  if (!ops.length) {
    ctx.io.out("Nothing to migrate.\n");
    return;
  }
  if (opts.dryRun) {
    for (const op of ops) ctx.io.out(`  would ${op.op} ${op.path}\n`);
    return;
  }
  const after = await lint(await loadVault(new OverlaySource(new DiskSource(ctx.root), ops)), {
    now: ctx.now,
  });
  if (after.errors)
    throw new ValidationFailure(
      `Migration would leave ${after.errors} lint errors; nothing was written`,
    );
  ctx.apply(ops);
}
