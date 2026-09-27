import { describe, expect, it } from "vitest";
import { conflictMarkers } from "../src/components/editor/links";
import { mergeBodies } from "../src/lib/merge";

const base = "# Steps\n\n1. Open the record.\n2. Set the status.\n\n# Related\n\n- A link\n";

describe("mergeBodies", () => {
  it("combines changes that do not overlap", () => {
    const yours = base.replace("Open the record", "Open the student's record");
    const theirs = base.replace("- A link", "- A link\n- Another link");
    const m = mergeBodies(base, yours, theirs);
    expect(m.conflicts).toBe(0);
    expect(m.text).toContain("Open the student's record");
    expect(m.text).toContain("- Another link");
    expect(conflictMarkers(m.text)).toEqual([]);
  });

  it("keeps both versions where they overlap, for the writer to choose", () => {
    const yours = base.replace("Set the status.", "Set the status to Returning.");
    const theirs = base.replace("Set the status.", "Set the status to Active.");
    const m = mergeBodies(base, yours, theirs);
    expect(m.conflicts).toBe(1);
    expect(m.text).toContain("<<<<<<< your version\n2. Set the status to Returning.");
    expect(m.text).toContain("2. Set the status to Active.\n>>>>>>> the version in the Library");
    expect(conflictMarkers(m.text)).toHaveLength(3);
    expect(m.text).toContain("# Related"); // the rest is untouched
  });

  it("takes the other side's change when only they changed", () => {
    const theirs = base + "\nA new paragraph.\n";
    expect(mergeBodies(base, base, theirs)).toEqual({ text: theirs, conflicts: 0 });
  });

  it("is a no-op when both made the same change", () => {
    const same = base.replace("status", "state");
    expect(mergeBodies(base, same, same)).toEqual({ text: same, conflicts: 0 });
  });
});
