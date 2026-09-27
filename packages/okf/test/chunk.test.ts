import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { chunkNote, tiktokenCounter } from "../src/chunk.ts";
import { parseMarkdown, parseNote } from "../src/note.ts";
import { loadVault } from "../src/vault.ts";
import { CHUNK_GOLDEN_NOTES, GOLDEN_DIR } from "./golden-notes.ts";
import { acmeSource } from "./helpers.ts";

describe("chunkNote goldens", () => {
  it.each(CHUNK_GOLDEN_NOTES)("%s", async (path) => {
    const vault = await loadVault(acmeSource());
    const golden = JSON.parse(
      readFileSync(join(GOLDEN_DIR, path.replace(/\//g, "__") + ".chunks.json"), "utf8"),
    );
    expect(JSON.parse(JSON.stringify(chunkNote(vault.notes.get(path)!, vault)))).toEqual(golden);
  });

  it("builds the contextual header and resolves footnotes to source titles", async () => {
    const vault = await loadVault(acmeSource());
    const chunks = chunkNote(
      vault.notes.get("kb/admissions/enroll-a-returning-student-in-salesforce.md")!,
      vault,
    );
    expect(chunks[0]!.header).toBe(
      [
        "Note: Enroll a returning student in Salesforce (How-To, admissions)",
        "Summary: Reactivate a former student's record and open a new enrollment without creating a duplicate contact.",
        "Themes: enrollment. Systems: salesforce, sis.",
        "Section: When to use this / Steps / Related",
      ].join("\n"),
    );
    expect(chunks[0]!.id).toBe("kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D#0");
    expect(chunks.flatMap((c) => c.footnotes)).toEqual([
      { id: "sis-sop", title: "SIS enrollment SOP (2025)" },
    ]);
    expect(chunks[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ------------------------------------------------------------------------------------------------
// Property tests over generated markdown.

const sentence = fc
  .array(
    fc.constantFrom(
      "enrollment",
      "student",
      "record",
      "Salesforce",
      "deposit",
      "open",
      "the",
      "a",
      "check",
      "status",
      "sync",
      "nightly",
    ),
    { minLength: 4, maxLength: 18 },
  )
  .map((w) => w.join(" ") + ".");
const paragraph = fc.array(sentence, { minLength: 1, maxLength: 12 }).map((s) => s.join(" "));
const list = fc
  .array(sentence, { minLength: 1, maxLength: 60 })
  .map((items) => items.map((s, i) => `${i + 1}. ${s}`).join("\n"));
const code = fc
  .array(sentence, { minLength: 1, maxLength: 30 })
  .map((l) => "```\n" + l.join("\n") + "\n```");
const table = fc
  .array(sentence, { minLength: 1, maxLength: 20 })
  .map((rows) => "| A | B |\n| --- | --- |\n" + rows.map((r) => `| ${r} | x |`).join("\n"));
const block = fc.oneof(
  { weight: 5, arbitrary: paragraph },
  { weight: 2, arbitrary: list },
  { weight: 1, arbitrary: code },
  { weight: 1, arbitrary: table },
);
const heading = fc
  .tuple(fc.integer({ min: 1, max: 4 }), sentence)
  .map(([d, s]) => `${"#".repeat(d)} ${s.slice(0, 30)}`);
const bodyArb = fc
  .array(fc.oneof({ weight: 1, arbitrary: heading }, { weight: 3, arbitrary: block }), {
    minLength: 1,
    maxLength: 25,
  })
  .map((b) => b.join("\n\n") + "\n");

function note(body: string) {
  return parseNote(
    `---\ntype: How-To\ntitle: Generated\ndescription: A generated note.\nid: kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D\nthemes: [enrollment]\n---\n\n${body}`,
    "kb/admissions/generated.md",
  );
}

describe("chunkNote properties", () => {
  it("covers every body character exactly once, in order", () => {
    fc.assert(
      fc.property(bodyArb, (body) => {
        const n = note(body);
        const chunks = chunkNote(n, null);
        let cursor = n.bodyOffset;
        for (const c of chunks) {
          expect(c.start).toBeGreaterThanOrEqual(cursor);
          expect(n.text.slice(cursor, c.start).trim()).toBe("");
          expect(n.text.slice(c.start, c.end)).toBe(c.text);
          cursor = c.end;
        }
        expect(n.text.slice(cursor).trim()).toBe("");
      }),
      { numRuns: 60 },
    );
  });

  it("keeps chunks within 700 tokens unless a chunk is one indivisible block", () => {
    fc.assert(
      fc.property(bodyArb, (body) => {
        for (const c of chunkNote(note(body), null)) {
          if (c.tokens <= 700) continue;
          const blocks = parseMarkdown(c.text).children.filter((b) => b.type !== "heading");
          const indivisible =
            blocks.length === 1 && (blocks[0]!.type !== "list" || blocks[0]!.children.length === 1);
          expect(indivisible, `chunk of ${c.tokens} tokens has ${blocks.length} blocks`).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(bodyArb, (body) => {
        expect(chunkNote(note(body), null)).toEqual(chunkNote(note(body), null));
      }),
      { numRuns: 30 },
    );
  });

  it("splits a long numbered procedure between items and repeats the heading", () => {
    const steps = Array.from(
      { length: 120 },
      (_, i) =>
        `${i + 1}. Open the enrollment record and check the status field carefully before saving.`,
    ).join("\n");
    const chunks = chunkNote(note(`# Steps\n\n${steps}\n`), null);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.headingPath).toEqual(["Steps"]);
      expect(c.header).toContain("Section: Steps");
      expect(c.tokens).toBeLessThanOrEqual(700);
    }
  });

  it("uses a pluggable token counter", () => {
    const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
    const chunks = chunkNote(note("# A\n\nshort\n\n# B\n\nalso short\n"), null, {
      countTokens: words,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.tokens).toBe(words(chunks[0]!.text));
    expect(tiktokenCounter("hello world")).toBe(2);
  });
});
