import type {
  ChangesetDraft,
  ChangesetFacts,
  Level,
  NoteChange,
  ReviewContext,
  ReviewDecision,
  ReviewReason,
} from "./types.ts";

const RANK: Record<Level, number> = { read: 1, write: 2, maintain: 3 };

function holds(ctx: ReviewContext, namespace: string, level: Level): boolean {
  if (ctx.isAdmin) return true;
  const held = ctx.access.get(namespace);
  return held !== undefined && RANK[held] >= RANK[level];
}

/** True when the person holds `level` on at least one namespace. Hubs belong to no namespace. */
function holdsAnywhere(ctx: ReviewContext, level: Level): boolean {
  if (ctx.isAdmin) return true;
  for (const held of ctx.access.values()) if (RANK[held] >= RANK[level]) return true;
  return false;
}

const list = (items: string[]) => items.map((i) => `"${i}"`).join(", ");

function destructive(n: NoteChange): string | null {
  if (n.kind === "deleted") return `deletes "${n.title}"`;
  if (n.status === "deprecated" && n.statusBefore !== "deprecated")
    return `deprecates "${n.title}"`;
  if (n.kind === "moved" && n.namespaceBefore !== n.namespace)
    return `moves "${n.title}" from ${n.namespaceBefore ?? "the hubs"} to ${n.namespace ?? "the hubs"}`;
  return null;
}

const isActionOrRequestType = (n: NoteChange) =>
  [n.type, n.typeBefore].some((t) => t === "Action" || t === "Request Type");

/** Namespaces a person needs a level on to write this changeset, and whether hubs are involved. */
function targets(facts: ChangesetFacts): { namespaces: string[]; taxonomy: boolean } {
  return { namespaces: facts.namespaces, taxonomy: facts.touchesTaxonomy };
}

/**
 * The review rules of PRD 7.3 as a pure function. A changeset goes to review when at least
 * one rule fires; otherwise the writer publishes directly. Each reason says who may approve:
 * writers approve content, maintainers approve taxonomy, destructive changes, and changes to
 * Actions and Request Types.
 */
export function decideReview(cs: ChangesetDraft, ctx: ReviewContext): ReviewDecision {
  const reasons: ReviewReason[] = [];
  const { namespaces, taxonomy } = targets(cs.facts);
  const primary = cs.facts.notes.filter((n) => n.primary || n.kind !== "updated");

  // 1. The submitter cannot write to the target namespace.
  const unwritable = namespaces.filter((ns) => !holds(ctx, ns, "write"));
  if (unwritable.length) {
    reasons.push({
      rule: 1,
      code: "no-write-access",
      message: `The submitter cannot write to ${unwritable.join(", ")}`,
      level: "write",
    });
  } else if (taxonomy && !cs.vocabularyDecided && !holdsAnywhere(ctx, "maintain")) {
    reasons.push({
      rule: 1,
      code: "no-write-access",
      message: "The submitter does not maintain the vocabulary",
      level: "maintain",
    });
  }

  if (cs.aiDrafted) {
    // 2. AI drafted it and the namespace is in manual mode.
    const manual = namespaces.filter((ns) => (ctx.publishing[ns] ?? "manual") === "manual");
    if (manual.length || namespaces.length === 0) {
      reasons.push({
        rule: 2,
        code: "ai-manual-namespace",
        message: manual.length
          ? `AI drafted this and ${manual.join(", ")} publishes manually`
          : "AI drafted this change to the vocabulary",
        level: "write",
      });
    }
    // 3. AI proposes a Process change, or changes a note that a person has verified.
    if (cs.changeClass === "process" && primary.some((n) => n.kind !== "created")) {
      reasons.push({
        rule: 3,
        code: "ai-process-change",
        message: "AI proposes a Process change",
        level: "write",
      });
    }
    const verified = primary.filter((n) => n.humanVerified && n.kind !== "created");
    if (verified.length) {
      reasons.push({
        rule: 3,
        code: "ai-changes-verified",
        message: `AI changes ${list(verified.map((n) => n.title))}, which a person has verified`,
        level: "write",
      });
    }
  }

  // 4. It introduces a new namespace, theme, system, or tag.
  // A term a maintainer accepted in the taxonomy queue has had its review.
  const accepted = new Set(cs.acceptedTerms ?? []);
  const added = cs.facts.terms.filter(
    (t) => t.change === "added" && !accepted.has(`${t.kind}:${t.slug}`),
  );
  if (added.length) {
    reasons.push({
      rule: 4,
      code: "new-term",
      message: `Introduces ${added.map((t) => `${t.kind} "${t.slug}"`).join(", ")}`,
      level: "maintain",
    });
  }

  // 5. It is flagged as a likely duplicate of an existing note or as contradicting one.
  const duplicates = cs.duplicates.filter((d) => d.kind === "duplicate");
  if (duplicates.length) {
    reasons.push({
      rule: 5,
      code: "likely-duplicate",
      message: `Likely duplicate of ${duplicates.map((d) => d.otherId).join(", ")}`,
      level: "write",
    });
  }
  const contradictions = cs.duplicates.filter((d) => d.kind === "contradiction");
  if (contradictions.length) {
    reasons.push({
      rule: 5,
      code: "contradiction",
      message: `May contradict ${contradictions.map((d) => d.otherId).join(", ")}`,
      level: "write",
    });
  }

  // 6. It deletes, merges, or deprecates notes, or moves them between namespaces.
  const removedTerms = cs.facts.terms.filter((t) => t.change === "removed");
  const harm = [
    ...cs.facts.notes.map(destructive).filter((m): m is string => m !== null),
    ...removedTerms.map((t) => `removes or merges ${t.kind} "${t.slug}"`),
  ];
  if (harm.length) {
    reasons.push({
      rule: 6,
      code: "destructive",
      message: `This change ${harm.join("; ")}`,
      level: "maintain",
    });
  }

  // 7. It creates or changes an Action or Request Type note.
  const special = cs.facts.notes.filter((n) => isActionOrRequestType(n) && n.textChanged);
  if (special.length) {
    reasons.push({
      rule: 7,
      code: "action-or-request-type",
      message: `Changes ${list(special.map((n) => n.title))}, which agents and the Desk act on`,
      level: "maintain",
    });
  }

  // 8. Validation found problems that the automatic repair could not fix.
  if (cs.unrepaired.length) {
    reasons.push({
      rule: 8,
      code: "validation",
      message: `${cs.unrepaired.length} validation ${cs.unrepaired.length === 1 ? "problem" : "problems"} could not be repaired automatically`,
      level: "write",
    });
  }

  return {
    review: reasons.length > 0,
    reasons,
    approverLevel: reasons.some((r) => r.level === "maintain") ? "maintain" : "write",
  };
}

/**
 * Whether a person may approve a changeset: the approver level on every namespace it writes
 * to, or on any namespace when it only changes hubs and vocabulary.
 *
 * Nobody approves their own changeset, so a destructive change always has a second pair of
 * eyes. Admins are the exception: a company with one admin must not be able to lock itself
 * out, and an admin can already change the repository directly.
 */
export function canApprove(
  changeset: {
    namespaces: string[];
    approverLevel: "write" | "maintain";
    submitterId: string | null;
  },
  reviewer: { id: string; access: ReadonlyMap<string, Level>; isAdmin: boolean },
): boolean {
  const own = changeset.submitterId !== null && changeset.submitterId === reviewer.id;
  if (own && !reviewer.isAdmin) return false;
  const ctx: ReviewContext = { access: reviewer.access, isAdmin: reviewer.isAdmin, publishing: {} };
  if (changeset.namespaces.length === 0) return holdsAnywhere(ctx, changeset.approverLevel);
  return changeset.namespaces.every((ns) => holds(ctx, ns, changeset.approverLevel));
}
