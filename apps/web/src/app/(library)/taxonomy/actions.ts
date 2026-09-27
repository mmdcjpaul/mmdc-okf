"use server";

import { revalidatePath } from "next/cache";
import { decideTerm, newRecordId, TermDecisionError, type ChangesetIntent } from "@lore/changesets";
import {
  createChangeset,
  getChangeset,
  listTerms,
  transitionChangeset,
  writeAudit,
} from "@lore/db";
import { canSeeChangeset } from "@/lib/changesets";
import { requireMaintainer } from "@/lib/context";
import { db } from "@/lib/db";
import { requestProcessing } from "@/lib/worker";

export interface Result {
  ok: boolean;
  message: string;
}
const done = (message: string): Result => ({ ok: true, message });
const failed = (message: string): Result => ({ ok: false, message });
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
type Kind = "theme" | "system" | "tag";
const kindOf = (form: FormData): Kind | null => {
  const k = text(form, "kind");
  return k === "theme" || k === "system" || k === "tag" ? k : null;
};

/** Accept a proposed term, map it to an existing one, or reject it (AU-10). */
export async function decide(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireMaintainer();
  const kind = kindOf(form);
  const slug = text(form, "slug");
  const decision = text(form, "decision");
  const into = text(form, "into");
  if (!kind || !SLUG.test(slug)) return failed("No such term");
  const cs = await getChangeset(db(), text(form, "changeset"));
  if (!cs || cs.vaultId !== ctx.vault.id || !canSeeChangeset(ctx.principal, cs))
    return failed("No such change");
  if (cs.state !== "in_review") return failed("This change is no longer waiting for review");

  const me = `human:${ctx.principal.user.handle}`;
  let intents: ChangesetIntent[];
  try {
    if (decision === "accept")
      intents = decideTerm(cs.intents, { kind, slug }, { decision, by: me });
    else if (decision === "reject") intents = decideTerm(cs.intents, { kind, slug }, { decision });
    else if (decision === "alias") {
      const known = (await listTerms(db(), ctx.vault.id)).some(
        (t) => t.kind === kind && t.slug === into && t.state === "active",
      );
      if (!known) return failed(`Choose the ${kind} to use instead`);
      intents = decideTerm(cs.intents, { kind, slug }, { decision, into, by: me });
    } else return failed("Choose accept, use an existing term, or reject");
  } catch (err) {
    if (err instanceof TermDecisionError) return failed(err.message);
    throw err;
  }

  // Back through the pipeline: the notes are linted with the vocabulary as decided, and the
  // review rules are applied again.
  const moved = await transitionChangeset(db(), cs.id, ["in_review"], "submitted", {
    intents,
    error: null,
    issues: [],
    submittedAt: new Date(),
  });
  if (!moved) return failed("Someone else has just changed this. Reload the page.");
  await writeAudit(db(), {
    actorId: ctx.principal.user.id,
    action: `taxonomy.${decision}`,
    target: `${kind}:${slug}`,
    metadata: { changeset: cs.id, ...(decision === "alias" ? { into } : {}) },
  });
  await requestProcessing(cs.id);
  revalidatePath("/taxonomy");
  revalidatePath("/", "layout");
  return done(
    decision === "accept"
      ? `Accepted "${slug}"`
      : decision === "alias"
        ? `"${slug}" is now another name for "${into}"`
        : `Rejected "${slug}"`,
  );
}

async function vocabularyChange(intent: ChangesetIntent, title: string, action: string) {
  const ctx = await requireMaintainer();
  const row = await createChangeset(db(), {
    id: newRecordId("cs"),
    vaultId: ctx.vault.id,
    submitterId: ctx.principal.user.id,
    actor: `human:${ctx.principal.user.handle}`,
    source: "editor",
    changeClass: "fix",
    state: "submitted",
    title,
    ops: [],
    intents: [intent],
    baseShas: {},
    submittedAt: new Date(),
  });
  await writeAudit(db(), {
    actorId: ctx.principal.user.id,
    action,
    target: title,
    metadata: { changeset: row.id },
  });
  await requestProcessing(row.id);
  revalidatePath("/taxonomy");
  return row.id;
}

/** Renames a term in every note that uses it, as one changeset and one commit. */
export async function rename(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireMaintainer();
  const kind = kindOf(form);
  const from = text(form, "from");
  const to = text(form, "to");
  if (!kind) return failed("No such term");
  if (!SLUG.test(to)) return failed("Use lowercase letters, digits, and hyphens");
  const terms = (await listTerms(db(), ctx.vault.id)).filter((t) => t.kind === kind);
  if (!terms.some((t) => t.slug === from)) return failed(`There is no ${kind} "${from}"`);
  if (from === to) return failed("That is its name already");
  if (terms.some((t) => t.slug === to))
    return failed(`The ${kind} "${to}" exists. Merge them instead.`);
  const id = await vocabularyChange(
    { type: "rename_term", kind, from, to },
    `rename ${kind} "${from}" to "${to}"`,
    "taxonomy.rename",
  );
  return done(`Sent as one change. Follow it under My changes (${id.slice(-6)}).`);
}

/** Merges terms into one in every note that uses them, as one changeset and one commit. */
export async function merge(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireMaintainer();
  const kind = kindOf(form);
  const into = text(form, "into");
  const from = [...new Set(form.getAll("from").map(String))].filter((f) => f !== into);
  if (!kind) return failed("No such term");
  const known = new Set(
    (await listTerms(db(), ctx.vault.id)).filter((t) => t.kind === kind).map((t) => t.slug),
  );
  if (!known.has(into)) return failed(`Choose the ${kind} to keep`);
  if (from.length === 0) return failed("Choose at least one term to merge into it");
  if (from.length > 20) return failed("Merge at most 20 terms at a time");
  const unknown = from.find((f) => !known.has(f));
  if (unknown) return failed(`There is no ${kind} "${unknown}"`);
  const id = await vocabularyChange(
    { type: "merge_terms", kind, from, into },
    `merge ${kind} ${from.map((f) => `"${f}"`).join(", ")} into "${into}"`,
    "taxonomy.merge",
  );
  return done(`Sent as one change. Follow it under My changes (${id.slice(-6)}).`);
}
