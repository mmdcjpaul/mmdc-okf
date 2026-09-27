/**
 * The changeset job (plans/02-library.md, L2 and L6). Every write in Lore, whatever its
 * source, passes through here: prepare and lint in memory, apply the review rules, and
 * commit with a compare-and-swap on the branch head.
 */
import { computeAccess, type Level } from "@lore/auth";
import {
  commitMessage,
  fromStoredOps,
  prepareChangeset,
  toStoredOps,
  type Prepared,
} from "@lore/changesets";
import {
  approversOf,
  getChangeset,
  getUser,
  getVault,
  grantsFor,
  getFeatures,
  listNamespaces,
  notify,
  reviewsOf,
  teamIdsOf,
  transitionChangeset,
  updateChangeset,
  writeAudit,
  type ChangesetRow,
  type Db,
  type Vault,
} from "@lore/db";
import { GitTreeSource, type GitProvider, type Mirror, type VaultRef } from "@lore/git";
import type { Logger } from "pino";

export interface ChangesetDeps {
  db: Db;
  log: Logger;
  mirrorFor: (repository: string) => Mirror;
  syncMirror?: (repository: string) => Promise<void>;
  providerFor: (repository: string) => GitProvider;
  now?: () => Date;
}

export type ProcessOutcome =
  | { state: "committed"; sha: string }
  | { state: "in_review" | "draft" | "conflicted" | "rejected" }
  | { state: "skipped"; reason: string };

/** A head that moves this many times while we try to commit means something is wrong. */
const MAX_ATTEMPTS = 3;

const vaultRef = (v: Vault): VaultRef => ({ id: v.id, repository: v.repository, branch: v.branch });

async function accessOf(
  db: Db,
  vaultId: string,
  userId: string | null,
): Promise<{ access: Map<string, Level>; isAdmin: boolean; name: string; email: string } | null> {
  if (!userId) return null;
  const user = await getUser(db, userId);
  if (!user) return null;
  const teams = await teamIdsOf(db, userId);
  const [grants, namespaces] = await Promise.all([
    grantsFor(db, vaultId, userId, teams),
    listNamespaces(db, vaultId),
  ]);
  return {
    access: computeAccess({
      role: user.role,
      grants: grants.map((g) => ({ namespace: g.namespace, level: g.level })),
      namespaces,
    }),
    isAdmin: user.role !== "member",
    name: user.name,
    email: user.email,
  };
}

async function prepare(
  deps: ChangesetDeps,
  vault: Vault,
  cs: ChangesetRow,
  head: string,
  approvedBy: string | null,
): Promise<Prepared> {
  const submitter = await accessOf(deps.db, vault.id, cs.submitterId);
  const root = vault.bundleRoot.replace(/\/+$/, "");
  const src = await new GitTreeSource(deps.mirrorFor(vault.repository), head).load([
    root + "/",
    ".kb/",
  ]);
  return prepareChangeset(
    {
      id: cs.id,
      source: cs.source,
      aiDrafted: cs.aiDrafted,
      changeClass: cs.changeClass,
      actor: cs.actor,
      verify: cs.verify,
      summary: cs.summary,
      ops: fromStoredOps(cs.ops),
      intents: cs.intents,
      baseShas: cs.baseShas,
      duplicates: cs.duplicates,
      approvedBy,
    },
    {
      src,
      // A changeset with no person behind it (the Gardener, say) can read everything and
      // write nothing, so it always goes to review.
      access:
        submitter?.access ??
        new Map((await listNamespaces(deps.db, vault.id)).map((n) => [n.slug, "read" as const])),
      isAdmin: submitter?.isAdmin ?? false,
      now: deps.now?.() ?? new Date(),
      autoPublishing: (await getFeatures(deps.db)).autoPublishing,
    },
  );
}

function record(p: Prepared, head: string, cs: ChangesetRow) {
  // What the ingestion pipeline said about the document stays with the changeset. The lint
  // warnings are replaced on every preparation, since the vault may have changed.
  const fromIngest = cs.ingestItemId ? cs.warnings.filter((w) => !/^[^\s:]+\.md: /.test(w)) : [];
  return {
    finalOps: toStoredOps(p.finalOps),
    preparedHead: head,
    namespaces: p.facts.namespaces,
    noteIds: p.facts.notes.filter((n) => n.primary || n.kind !== "updated").map((n) => n.id),
    title: p.title,
    warnings: [...new Set([...fromIngest, ...p.warnings])],
    issues: p.issues.map((i) => ({
      rule: i.rule,
      severity: i.severity,
      path: i.path,
      ...(i.line !== undefined ? { line: i.line } : {}),
      message: i.message,
    })),
    reviewReasons: p.decision.reasons,
    approverLevel: p.decision.approverLevel,
  };
}

/**
 * Processes one changeset to its next resting state. Safe to call twice: each step claims
 * the changeset with a state transition, so a second caller finds nothing to do.
 */
export async function processChangeset(deps: ChangesetDeps, id: string): Promise<ProcessOutcome> {
  const { db, log } = deps;
  const found = await getChangeset(db, id);
  if (!found) return { state: "skipped", reason: "No such changeset" };
  const vault = await getVault(db, found.vaultId);
  if (!vault) return { state: "skipped", reason: "No such vault" };

  const approved = found.state === "approved";
  const cs = await transitionChangeset(
    db,
    id,
    ["submitted", "approved", "committing"],
    "committing",
    {
      error: null,
    },
  );
  if (!cs) return { state: "skipped", reason: `Changeset is ${found.state}` };

  let approver: { actor: string; name: string; email: string } | null = null;
  if (approved || found.state === "committing") {
    const approval = (await reviewsOf(db, id)).filter((r) => r.decision === "approve").at(-1);
    const user = approval?.reviewerId ? await getUser(db, approval.reviewerId) : null;
    if (user) approver = { actor: `human:${user.handle}`, name: user.name, email: user.email };
  }

  const provider = deps.providerFor(vault.repository);
  const ref = vaultRef(vault);
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const head = await provider.head(ref);
      if (!head) throw new Error(`${vault.repository} has no commits on ${vault.branch}`);
      // The vault is read from the mirror, which has to have the head the provider reports.
      await deps.syncMirror?.(vault.repository);
      const p = await prepare(deps, vault, cs, head, approver?.actor ?? null);

      if (p.status === "conflicted") {
        await updateChangeset(db, id, {
          state: "conflicted",
          conflicts: p.conflicts,
          attempts: attempt,
        });
        log.info({ id, conflicts: p.conflicts }, "changeset conflicted");
        return { state: "conflicted" };
      }
      if (p.status === "forbidden") {
        await updateChangeset(db, id, { state: "rejected", error: p.refusal, attempts: attempt });
        await writeAudit(db, {
          actorId: cs.submitterId,
          action: "changeset.refused",
          target: id,
          metadata: { reason: p.refusal },
        });
        return { state: "rejected" };
      }
      if (p.status === "invalid") {
        // Back to the writer, with what to fix.
        await updateChangeset(db, id, {
          ...record(p, head, cs),
          state: "draft",
          error: p.refusal,
          attempts: attempt,
        });
        return { state: "draft" };
      }
      if (p.decision.review && !approver) {
        await updateChangeset(db, id, {
          ...record(p, head, cs),
          state: "in_review",
          attempts: attempt,
        });
        const reviewers = (
          await approversOf(db, vault.id, p.facts.namespaces, p.decision.approverLevel)
        ).filter((u) => u !== cs.submitterId);
        const author = cs.submitterId ? await getUser(db, cs.submitterId) : null;
        await notify(
          db,
          reviewers.map((userId) => ({
            userId,
            vaultId: vault.id,
            kind: "review_request",
            title: `Review: ${p.title}`,
            body: `${author?.name ?? "Lore"} ${cs.source === "suggest" ? "suggests" : "submitted"} a change${p.facts.namespaces.length ? ` in ${p.facts.namespaces.join(", ")}` : ""}.`,
            href: `/changes/${id}`,
            // Once per version of the changeset: an edit in review asks again.
            dedupeKey: `review:${id}:${cs.updatedAt.getTime()}`,
          })),
        );
        log.info({ id, reasons: p.decision.reasons.map((r) => r.code) }, "changeset in review");
        return { state: "in_review" };
      }

      const submitter = cs.submitterId ? await getUser(db, cs.submitterId) : null;
      const message = commitMessage({
        namespaces: p.facts.namespaces,
        title: p.title,
        changeClass: cs.changeClass,
        changesetId: cs.id,
        source: cs.source,
        reason: cs.reason,
        resolvesReports: cs.resolvesReports,
        coAuthors: [
          ...(submitter ? [{ name: submitter.name, email: submitter.email }] : []),
          ...(approver ? [{ name: approver.name, email: approver.email }] : []),
        ],
      });
      await updateChangeset(db, id, { ...record(p, head, cs), attempts: attempt });
      const result = await provider.commit(ref, {
        ops: p.finalOps,
        message,
        expectedHead: head,
      });
      if ("sha" in result) {
        await updateChangeset(db, id, {
          state: "committed",
          commitSha: result.sha,
          committedAt: deps.now?.() ?? new Date(),
          conflicts: [],
        });
        await writeAudit(db, {
          actorId: cs.submitterId,
          action: "changeset.commit",
          target: id,
          metadata: {
            sha: result.sha,
            source: cs.source,
            changeClass: cs.changeClass,
            namespaces: p.facts.namespaces,
            ...(approver ? { approvedBy: approver.actor } : {}),
          },
        });
        if (approver && cs.submitterId) {
          await notify(db, [
            {
              userId: cs.submitterId,
              vaultId: vault.id,
              kind: "change_published",
              title: `Published: ${p.title}`,
              body: `${approver.name} approved your change.`,
              href: `/changes/${id}`,
              dedupeKey: `published:${id}`,
            },
          ]);
        }
        log.info({ id, sha: result.sha, attempt }, "changeset committed");
        return { state: "committed", sha: result.sha };
      }
      // Someone pushed in between. Prepare again on the new head: if none of the files this
      // changeset started from changed, it still applies; otherwise it is conflicted.
      log.info({ id, attempt, head: result.headMoved }, "head moved; preparing again");
    }
    await updateChangeset(db, id, {
      state: "conflicted",
      error: `The branch kept moving; gave up after ${MAX_ATTEMPTS} attempts`,
      attempts: MAX_ATTEMPTS,
    });
    return { state: "conflicted" };
  } catch (err) {
    // Leave it for the next sweep rather than losing the write.
    await updateChangeset(db, id, {
      state: approved ? "approved" : "submitted",
      error: (err as Error).message,
      attempts: cs.attempts + 1,
    });
    log.error({ id, err: (err as Error).message }, "changeset failed; will retry");
    throw err;
  }
}
