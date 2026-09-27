/**
 * The taxonomy queue (PRD 6.4, AU-10). A changeset that proposes a new theme, system, or tag
 * waits until a maintainer accepts the term, maps it to an existing term as an alias, or
 * rejects it. Each decision is a change to the changeset's intents, which then go through
 * the pipeline again: nothing here writes to the vault.
 */
import type { ChangesetIntent } from "./types.ts";

type Kind = "theme" | "system" | "tag";
const FIELD = { theme: "themes", system: "systems", tag: "tags" } as const;

export interface ProposedTerm {
  kind: Kind;
  slug: string;
  description: string;
  acceptedBy: string | null;
  /** Titles of the notes in the changeset that use the term. */
  usedBy: string[];
}

export type TermDecision =
  | { decision: "accept"; by: string }
  /** Use an existing term instead, and remember the proposed name as another name for it. */
  | { decision: "alias"; into: string; by: string }
  | { decision: "reject" };

export class TermDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermDecisionError";
  }
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function fieldsOf(
  intent: ChangesetIntent,
): { data: Record<string, unknown>; title: string } | null {
  if (intent.type === "create")
    return { data: intent.data, title: String(intent.data.title ?? "A new note") };
  if (intent.type === "edit" && intent.set) return { data: intent.set, title: intent.path };
  return null;
}

/** The terms a changeset proposes, decided or not. */
export function proposedTerms(intents: ChangesetIntent[]): ProposedTerm[] {
  return intents.flatMap((i) =>
    i.type === "add_term"
      ? [
          {
            kind: i.kind,
            slug: i.slug,
            description: i.description,
            acceptedBy: i.acceptedBy ?? null,
            usedBy: intents.flatMap((n) => {
              const f = fieldsOf(n);
              return f && list(f.data[FIELD[i.kind]]).includes(i.slug) ? [f.title] : [];
            }),
          },
        ]
      : [],
  );
}

/**
 * True when the only changes to the vocabulary are ones a maintainer decided in the queue,
 * so the submitter does not need to maintain the vocabulary themselves.
 */
export function vocabularyDecided(
  intents: ChangesetIntent[],
  ops: { path: string }[],
  root: string,
): boolean {
  const hub = (path: string) =>
    path.startsWith(`${root}/_themes/`) || path.startsWith(`${root}/_systems/`);
  if (ops.some((o) => o.path.startsWith(".kb/") || hub(o.path))) return false;
  let decided = 0;
  for (const i of intents) {
    if (i.type === "add_term" || i.type === "add_alias") {
      if (!i.acceptedBy) return false;
      decided += 1;
    } else if (i.type === "edit" || i.type === "delete" || i.type === "verify") {
      if (hub(i.path)) return false;
    } else if (i.type === "move") {
      if (hub(i.from) || hub(i.to)) return false;
    } else if (i.type === "deprecate") {
      if (hub(i.path)) return false;
    } else if (i.type !== "create") return false;
  }
  return decided > 0;
}

/** The intents after a maintainer's decision on one proposed term. */
export function decideTerm(
  intents: ChangesetIntent[],
  term: { kind: Kind; slug: string },
  decision: TermDecision,
): ChangesetIntent[] {
  const proposal = intents.find(
    (i) => i.type === "add_term" && i.kind === term.kind && i.slug === term.slug,
  );
  if (!proposal)
    throw new TermDecisionError(`This change does not propose the ${term.kind} "${term.slug}"`);

  if (decision.decision === "accept")
    return intents.map((i) => (i === proposal ? { ...i, acceptedBy: decision.by } : i));

  const field = FIELD[term.kind];
  const into = decision.decision === "alias" ? decision.into : null;
  if (into === term.slug) throw new TermDecisionError("Choose a different term to map it to");
  const out: ChangesetIntent[] = [];
  for (const intent of intents) {
    if (intent === proposal) {
      if (decision.decision === "alias")
        out.push({
          type: "add_alias",
          kind: term.kind,
          slug: decision.into,
          alias: term.slug,
          acceptedBy: decision.by,
        });
      continue;
    }
    const f = fieldsOf(intent);
    const values = f ? list(f.data[field]) : [];
    if (!f || !values.includes(term.slug)) {
      out.push(intent);
      continue;
    }
    const next: string[] = [];
    for (const v of values) {
      const r = v === term.slug ? into : v;
      if (r !== null && !next.includes(r)) next.push(r);
    }
    // Every note needs a theme. Rejecting its only one would leave a note nobody can publish.
    if (term.kind === "theme" && next.length === 0)
      throw new TermDecisionError(
        `"${f.title}" would be left without a theme. Map the term to an existing theme instead.`,
      );
    const data = { ...f.data, [field]: next };
    out.push(
      intent.type === "create"
        ? { ...intent, data }
        : intent.type === "edit"
          ? { ...intent, set: data }
          : intent,
    );
  }
  return out;
}
