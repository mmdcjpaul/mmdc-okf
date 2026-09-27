import { merge } from "node-diff3";

export interface MergeResult {
  text: string;
  /** Places where both sides changed the same lines and a person has to choose. */
  conflicts: number;
}

/**
 * Three-way merge of a note body: what the writer started from, what they wrote, and what
 * is in the vault now. Changes that do not overlap combine on their own. Where they do
 * overlap, both versions are kept between markers for the writer to resolve.
 */
export function mergeBodies(base: string, yours: string, theirs: string): MergeResult {
  const lines = (s: string) => s.replace(/\r\n/g, "\n").split("\n");
  const r = merge(lines(yours), lines(base), lines(theirs), {
    label: { a: "your version", b: "the version in the Library" },
  });
  const out = r.result;
  return {
    text: out.join("\n"),
    conflicts: out.filter((l) => /^<{7}( |$)/.test(l)).length,
  };
}
