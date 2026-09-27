/**
 * One Gardener run (PRD 7.5, AU-11): look at a namespace or the whole vault, write down what
 * was found, and put proposals in the review queue. It reads Git and the index, and the only
 * thing it writes is changesets that wait for a person.
 */
import { newRecordId, prepareChangeset, toStoredOps } from "@lore/changesets";
import {
  createChangeset,
  finishGardenerRun,
  gardenerNotes,
  getSetting,
  getVault,
  listNamespaces,
  proposedKeys,
  recordProposal,
  startGardenerRun,
  writeAudit,
  type Db,
  type GardenerRunRow,
} from "@lore/db";
import { GitTreeSource, type Mirror } from "@lore/git";
import { loadVault } from "@lore/okf";
import type { Meilisearch } from "@lore/search";
import type { Logger } from "pino";
import { NO_GAPS, type GapSource } from "../notify/gaps.ts";
import { buildReport, neighbours } from "./find.ts";
import { proposals as makeProposals } from "./propose.ts";
import { DEFAULT_GARDENER, type GardenerReport, type GardenerSettings } from "./report.ts";

export interface GardenerDeps {
  db: Db;
  meili: Meilisearch;
  log: Logger;
  mirrorFor: (repository: string) => Mirror;
  gaps?: GapSource;
  /** Hands a new changeset to the pipeline. */
  onChangeset?: (id: string) => Promise<void>;
  now?: () => Date;
}

export interface GardenerOptions {
  vaultId: string;
  /** One namespace, or null for the whole vault. */
  namespace?: string | null;
  /** Who asked. Null for the weekly schedule. */
  requestedBy?: string | null;
}

/** What a changeset from nobody may do: read every namespace, write to none. */
export function systemAccess(namespaces: string[]): Map<string, "read"> {
  return new Map(namespaces.map((ns) => [ns, "read" as const]));
}

export async function gardenerSettings(db: Db): Promise<GardenerSettings> {
  const stored = await getSetting<Partial<GardenerSettings>>(db, "gardener");
  const out = { ...DEFAULT_GARDENER };
  for (const key of Object.keys(out) as (keyof GardenerSettings)[]) {
    const v = stored?.[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

export async function runGardener(
  deps: GardenerDeps,
  opts: GardenerOptions,
): Promise<GardenerRunRow> {
  const { db, log } = deps;
  const now = () => deps.now?.() ?? new Date();
  const vault = await getVault(db, opts.vaultId);
  if (!vault) throw new Error(`Unknown vault ${opts.vaultId}`);
  const namespace = opts.namespace ?? null;
  if (namespace && !(await listNamespaces(db, vault.id)).some((n) => n.slug === namespace))
    throw new Error(`Unknown namespace ${namespace}`);

  const run = await startGardenerRun(db, {
    id: newRecordId("gr", now()),
    vaultId: vault.id,
    namespace,
    requestedBy: opts.requestedBy ?? null,
    at: now(),
  });
  try {
    const mirror = deps.mirrorFor(vault.repository);
    const head = await mirror.resolve(`refs/heads/${vault.branch}`);
    if (!head) throw new Error("The vault has no commits");
    if (vault.lastIndexedHead !== head)
      throw new Error("The vault is being indexed. Run the Gardener again in a moment.");
    const root = vault.bundleRoot.replace(/\/+$/, "");
    const src = await new GitTreeSource(mirror, head).load([root + "/", ".kb/"]);
    const loaded = await loadVault(src);
    const settings = await gardenerSettings(db);
    const notes = await gardenerNotes(db, vault.id, namespace);
    const near = await neighbours(deps.meili, vault.slug, notes);
    const gaps = await (deps.gaps ?? NO_GAPS).gaps({
      vaultId: vault.id,
      namespaces: namespace ? [namespace] : Object.keys(loaded.namespaces),
      since: new Date(now().getTime() - 30 * 24 * 3_600_000),
      limit: 50,
    });
    const report: GardenerReport = buildReport({ notes, loaded, near, namespace, gaps, settings });
    const made = makeProposals({ report, notes, loaded, near });
    report.skipped.push(...made.skipped);

    const already = await proposedKeys(
      db,
      vault.id,
      made.proposals.map((p) => p.key),
      new Date(now().getTime() - settings.repeatAfterDays * 24 * 3_600_000),
    );
    const created: string[] = [];
    for (const p of made.proposals) {
      if (already.has(p.key)) continue;
      if (created.length >= settings.maxProposals) {
        report.skipped.push({ what: p.key, why: "This run had made its share of proposals" });
        continue;
      }
      // Checked before it is saved, so the review queue only gets proposals that can be
      // published as they are.
      const dry = await prepareChangeset(
        {
          id: "cs_dry_run",
          source: "gardener",
          aiDrafted: false,
          changeClass: p.changeClass,
          actor: "process:gardener",
          verify: false,
          ops: [],
          intents: p.intents,
          baseShas: p.baseShas,
        },
        { src, access: systemAccess(Object.keys(loaded.namespaces)), isAdmin: false, now: now() },
      );
      const errors = dry.issues.filter((i) => i.severity === "error");
      if (dry.status !== "ready" || errors.length || !dry.decision.review) {
        report.skipped.push({
          what: p.key,
          why: dry.refusal ?? errors[0]?.message ?? "It would not have waited for review",
        });
        continue;
      }
      const cs = await createChangeset(db, {
        id: newRecordId("cs", now()),
        vaultId: vault.id,
        submitterId: null,
        actor: "process:gardener",
        source: "gardener",
        aiDrafted: false,
        changeClass: p.changeClass,
        state: "submitted",
        title: dry.title,
        reason: p.why,
        ops: toStoredOps([]),
        intents: p.intents,
        baseShas: p.baseShas,
        namespaces: p.namespaces,
        submittedAt: now(),
      });
      await recordProposal(db, { vaultId: vault.id, key: p.key, changesetId: cs.id, at: now() });
      created.push(cs.id);
    }
    const done = await finishGardenerRun(db, run.id, {
      state: "done",
      report: report as unknown as Record<string, unknown>,
      proposals: created,
      at: now(),
    });
    await writeAudit(db, {
      actorId: opts.requestedBy ?? null,
      action: "gardener.run",
      target: namespace ?? "vault",
      metadata: { run: run.id, proposals: created.length, notes: report.notes },
    });
    for (const id of created) await deps.onChangeset?.(id);
    log.info({ run: run.id, namespace, proposals: created.length }, "gardener run finished");
    return done;
  } catch (err) {
    log.warn({ err, run: run.id }, "gardener run failed");
    return finishGardenerRun(db, run.id, {
      state: "failed",
      error: (err as Error).message,
      at: now(),
    });
  }
}
