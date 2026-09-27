import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseNote, serializeNote } from "../src/note.ts";
import { acmeSource } from "./helpers.ts";

// ------------------------------------------------------------------------------------------------
// Generators: frontmatter written the way people write it, with comments, flow and block
// styles, nested maps, unknown keys, and unicode.

type Scalar = string | number | boolean;

const word = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);
const text = fc.oneof(
  word,
  fc.string({ minLength: 1, maxLength: 30, unit: "grapheme" }),
  fc.constantFrom(
    "Enroll a returning student",
    "Café résumé ✓",
    "日本語のタイトル",
    "value: with colon",
    "#hash",
    "yes",
    "1.0",
  ),
);
const scalar: fc.Arbitrary<Scalar> = fc.oneof(
  text,
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
);

function yamlScalar(v: Scalar, style: number): string {
  if (typeof v !== "string") return String(v);
  if (
    /^[a-z][a-z0-9-]*$/.test(v) &&
    !["yes", "no", "true", "false", "null", "on", "off", "y", "n"].includes(v) &&
    style % 3 === 0
  )
    return v;
  const printable = [...v].every((ch) => {
    const c = ch.codePointAt(0)!;
    return c >= 0x20 && !(c >= 0x7f && c <= 0x9f) && c !== 0x2028 && c !== 0x2029 && c !== 0xfeff;
  });
  if (style % 3 === 1 && printable && !/['\\]/.test(v)) return `'${v}'`;
  return JSON.stringify(v);
}

type Value =
  | { kind: "scalar"; v: Scalar }
  | { kind: "list"; v: Scalar[] }
  | { kind: "map"; v: Record<string, Scalar> };

const value: fc.Arbitrary<Value> = fc.oneof(
  scalar.map((v) => ({ kind: "scalar" as const, v })),
  fc.array(scalar, { maxLength: 4 }).map((v) => ({ kind: "list" as const, v })),
  fc.dictionary(word, scalar, { minKeys: 1, maxKeys: 3 }).map((v) => ({ kind: "map" as const, v })),
);

interface Entry {
  key: string;
  value: Value;
  style: number;
  commentBefore: boolean;
  inlineComment: boolean;
}

const KNOWN = ["type", "title", "description", "version", "themes", "tags", "status", "owner"];

const entries = fc.uniqueArray(
  fc.record({
    key: fc.oneof(
      fc.constantFrom(...KNOWN),
      word.map((w) => `x_${w.replace(/-/g, "_")}`),
    ),
    value,
    style: fc.nat(8),
    commentBefore: fc.boolean(),
    inlineComment: fc.boolean(),
  }),
  { minLength: 1, maxLength: 8, selector: (e) => e.key },
);

function render(entry: Entry): string {
  const lines: string[] = [];
  if (entry.commentBefore) lines.push(`# about ${entry.key}`);
  const inline = entry.inlineComment ? "  # note" : "";
  const { value: v, style } = entry;
  if (v.kind === "scalar") lines.push(`${entry.key}: ${yamlScalar(v.v, style)}${inline}`);
  else if (v.kind === "list") {
    if (v.v.length === 0 || style % 2 === 0)
      lines.push(`${entry.key}: [${v.v.map((x) => yamlScalar(x, style + 1)).join(", ")}]${inline}`);
    else {
      lines.push(`${entry.key}:${inline}`);
      for (const x of v.v) lines.push(`${style % 4 === 1 ? "  " : ""}- ${yamlScalar(x, style)}`);
    }
  } else {
    const pairs = Object.entries(v.v);
    if (style % 2 === 0)
      lines.push(
        `${entry.key}: { ${pairs.map(([k, x]) => `${k}: ${yamlScalar(x, style)}`).join(", ")} }${inline}`,
      );
    else {
      lines.push(`${entry.key}:${inline}`);
      for (const [k, x] of pairs) lines.push(`  ${k}: ${yamlScalar(x, style)}`);
    }
  }
  return lines.join("\n");
}

function expected(entry: Entry): unknown {
  return entry.value.v;
}

const noteText = (list: Entry[], body: string) =>
  `---\n${list.map(render).join("\n")}\n---\n${body}`;
const body = fc.constantFrom(
  "",
  "\n# Heading\n\nBody text.\n",
  "\nPlain body with a [link](/a/b.md).\n",
  "\n```yaml\n---\nnot: frontmatter\n---\n```\n",
);

/** Lines of the top-level pair for `key`: from its line up to the next top-level key or comment. */
function region(textValue: string, key: string): { before: string; after: string } {
  const lines = textValue.split("\n");
  const end = lines.indexOf("---", 1);
  const start = lines.findIndex((l, i) => i > 0 && i < end && l.startsWith(`${key}:`));
  let next = start + 1;
  while (next < end && (lines[next]!.startsWith(" ") || lines[next]!.startsWith("-"))) next++;
  return { before: lines.slice(0, start).join("\n"), after: lines.slice(next).join("\n") };
}

describe("round trip", () => {
  it("parses generated frontmatter to the values that were written", () => {
    fc.assert(
      fc.property(entries, body, (list, b) => {
        const note = parseNote(noteText(list, b), "kb/ns/x.md");
        expect(note.issues).toEqual([]);
        expect(note.data).toEqual(Object.fromEntries(list.map((e) => [e.key, expected(e)])));
      }),
      { numRuns: 300 },
    );
  });

  it("serializes an unmodified note byte-identically", () => {
    fc.assert(
      fc.property(entries, body, (list, b) => {
        const t = noteText(list, b);
        const note = parseNote(t, "kb/ns/x.md");
        expect(serializeNote(note)).toBe(t);
        const clone = { ...note, data: structuredClone(note.data) };
        expect(serializeNote(clone)).toBe(t);
      }),
      { numRuns: 300 },
    );
  });

  it("changes only the modified key's lines", () => {
    fc.assert(
      fc.property(entries, body, fc.nat(), value, (list, b, pick, next) => {
        const t = noteText(list, b);
        const note = parseNote(t, "kb/ns/x.md");
        const target = list[pick % list.length]!;
        const copy = { ...note, data: structuredClone(note.data) };
        copy.data[target.key] = next.v;
        const out = serializeNote(copy);
        const reparsed = parseNote(out, "kb/ns/x.md");
        expect(reparsed.issues).toEqual([]);
        expect(reparsed.data).toEqual({ ...note.data, [target.key]: next.v });
        const a = region(t, target.key);
        const c = region(out, target.key);
        expect(c.before).toBe(a.before);
        expect(c.after).toBe(a.after);
      }),
      { numRuns: 300 },
    );
  });

  it("inserts new keys in the stable order without touching other lines", () => {
    const t = "---\ntype: How-To\n# keep me\ntitle: T\ncustom: { a: 1 }\n---\nBody\n";
    const note = parseNote(t, "kb/ns/x.md");
    note.data.version = "1.0.0";
    note.data.themes = ["enrollment"];
    note.data.verified = [{ by: "human:a", at: "2026-01-01T00:00:00Z" }];
    expect(serializeNote(note)).toBe(
      "---\ntype: How-To\n# keep me\ntitle: T\nversion: 1.0.0\nthemes: [enrollment]\nverified:\n  - { by: human:a, at: 2026-01-01T00:00:00Z }\ncustom: { a: 1 }\n---\nBody\n",
    );
  });

  it("removes keys cleanly", () => {
    const note = parseNote(
      "---\ntype: How-To\nverified:\n  - { by: human:a, at: x }\nstale_after: 2027-01-01T00:00:00Z\nextra: 1\n---\n",
      "p.md",
    );
    delete note.data.verified;
    delete note.data.stale_after;
    expect(serializeNote(note)).toBe("---\ntype: How-To\nextra: 1\n---\n");
  });

  it("round-trips every note in vault-acme byte-identically, and a version bump touches one line", async () => {
    const src = acmeSource();
    const paths = (await src.list("kb/")).filter((p) => p.endsWith(".md"));
    expect(paths.length).toBeGreaterThan(50);
    for (const path of paths) {
      const t = (await src.read(path)) as string;
      const note = parseNote(t, path);
      expect(serializeNote(note)).toBe(t);
      if (typeof note.data.version === "string") {
        note.data.version = "9.9.9";
        const out = serializeNote(note).split("\n");
        const orig = t.split("\n");
        expect(out.length).toBe(orig.length);
        expect(out.filter((l, i) => l !== orig[i])).toEqual(["version: 9.9.9"]);
      }
    }
  });

  it("reports malformed YAML as an issue instead of throwing", () => {
    for (const t of [
      "---\ntitle: [unclosed\n---\n",
      '---\nkey: "unterminated\n---\n',
      "---\ntab:\n\t- x\n---\n",
      "---\na: 1\na: 2\n---\n",
      "---\n- a list\n---\n",
      "---\ntype: x\n",
    ]) {
      const note = parseNote(t, "kb/ns/bad.md");
      expect(note.issues.length).toBeGreaterThan(0);
      expect(note.issues[0]!.rule).toBe("okf/frontmatter");
      expect(serializeNote(note)).toBe(t);
    }
  });
});
