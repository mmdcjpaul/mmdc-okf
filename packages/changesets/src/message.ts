import type { ChangeClass } from "@lore/okf";

export interface CommitMessageInput {
  /** Namespaces the changeset writes to. */
  namespaces: string[];
  /** Subject without the prefix, for example `update "Enroll a returning student"`. */
  title: string;
  changeClass: ChangeClass;
  changesetId: string;
  /** Where the change came from, for example `library-editor`. */
  source: string;
  /** People to credit. The first is the submitter. */
  coAuthors: { name: string; email: string }[];
  /** Feedback reports the commit resolves. */
  resolvesReports?: string[];
  /** Why the change was made, shown in the body. */
  reason?: string | null;
}

/** Source names as they appear in commit trailers. */
export const SOURCE_TRAILER: Record<string, string> = {
  editor: "library-editor",
  suggest: "library-suggestion",
  upload: "library-upload",
  capture: "library-capture",
  gardener: "gardener",
  agent: "agent",
};

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The fixed commit message format from TECH_STACK section 6, which people and the indexer
 * both read:
 *
 *   kb(admissions): update "Enroll a returning student in Salesforce"
 *
 *   Change-Class: process
 *   Changeset: cs_01J9ZB4M3FQ8R2T6V0X4Z8C2E6
 *   Source: library-editor
 *   Co-authored-by: Maria Reyes <maria.reyes@acme.edu>
 *
 * The trailers form one block with no blank line inside it. Git only treats the last
 * paragraph of a message as trailers, so a blank line before `Co-authored-by` would hide
 * `Change-Class` from `git log --format=%(trailers)` and from the indexer.
 */
export function commitMessage(input: CommitMessageInput): string {
  const scope =
    input.namespaces.length === 1
      ? input.namespaces[0]!
      : input.namespaces.length === 0
        ? "vault"
        : "multiple";
  const subject = oneLine(`kb(${scope}): ${input.title}`).slice(0, 200);
  const body = input.reason ? [oneLine(input.reason), ""] : [];
  const trailers = [
    `Change-Class: ${input.changeClass}`,
    `Changeset: ${input.changesetId}`,
    `Source: ${SOURCE_TRAILER[input.source] ?? oneLine(input.source)}`,
    ...(input.resolvesReports ?? []).map((id) => `Resolves-Report: ${oneLine(id)}`),
  ];
  const seen = new Set<string>();
  const credits = input.coAuthors
    .filter((a) => {
      const key = a.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    // A name or address with a newline or angle bracket could forge a trailer.
    .map(
      (a) =>
        `Co-authored-by: ${oneLine(a.name).replace(/[<>]/g, "")} <${oneLine(a.email).replace(/[<>\s]/g, "")}>`,
    );
  return [subject, "", ...body, ...trailers, ...credits, ""].join("\n");
}
