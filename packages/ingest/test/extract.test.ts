import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectType,
  extractWithCode,
  inspect,
  LIMITS,
  needsModel,
  UploadRefused,
} from "../src/extract/index.ts";

const UPLOADS = resolve(import.meta.dirname, "../../../fixtures/uploads");
const GOLDEN = resolve(import.meta.dirname, "golden");
const read = (name: string) => new Uint8Array(readFileSync(join(UPLOADS, name)));
const files = readdirSync(UPLOADS).sort();

describe("extractors: golden output for every fixture", () => {
  it("covers every accepted file type", () => {
    const types = new Set(files.map((f) => f.slice(f.lastIndexOf(".") + 1)));
    expect([...types].sort()).toEqual(
      ["csv", "docx", "html", "md", "pdf", "png", "pptx", "txt", "xlsx"].sort(),
    );
  });

  it.each(files)("%s", async (name) => {
    const bytes = read(name);
    const { type } = await inspect(name, bytes);
    const out = await extractWithCode(name, bytes, type);
    const golden = join(GOLDEN, `${name}.md`);
    const actual =
      `<!-- type: ${out.type}; method: ${out.method}; title: ${out.title ?? ""}; pages: ${out.pages ?? ""}; ` +
      `images: ${out.images.map((i) => i.name).join(", ")} -->\n` +
      out.warnings.map((w) => `<!-- warning: ${w} -->\n`).join("") +
      out.markdown;
    if (process.env.UPDATE_GOLDEN || !existsSync(golden)) writeFileSync(golden, actual);
    expect(actual).toBe(readFileSync(golden, "utf8"));
  });
});

describe("extractors", () => {
  it("keep a Word document's structure", async () => {
    const out = await extractWithCode("x.docx", read("deposit-refund-sop.docx"), "docx");
    expect(out.title).toBe("Refund a tuition deposit");
    expect(out.markdown).toContain("# Refund a tuition deposit");
    expect(out.markdown).toContain("## Steps");
    expect(out.markdown).toMatch(/1\. Find the deposit in NetSuite by student ID\./);
    expect(out.markdown).toContain("| Refund amounts | Finance Systems |");
  });

  it("read slides in order, with speaker notes", async () => {
    const out = await extractWithCode("x.pptx", read("orientation.pptx"), "pptx");
    expect(out.pages).toBe(3);
    expect(out.markdown).toMatch(/## Slide 1: New student orientation[\s\S]*## Slide 2: Day one/);
    expect(out.markdown).toContain("- Activate your LMS account");
    expect(out.markdown).toContain("> Speaker notes: Remind students that IDs");
  });

  it("turn every sheet into a table, escaping what would break one", async () => {
    const out = await extractWithCode("x.xlsx", read("enrollment-codes.xlsx"), "xlsx");
    expect(out.markdown).toContain("## Status codes");
    expect(out.markdown).toContain("## Deposits");
    expect(out.markdown).toContain("| WDR | Withdrawn \\| refunded | Admissions |");
    expect(out.markdown).toContain("| Autumn 2026 | 500 | 30 |");
    const csv = await extractWithCode("x.csv", read("enrollment-codes.csv"), "csv");
    expect(csv.markdown).toContain("| WDR | Withdrawn \\| refunded | Admissions |");
  });

  it("say so when a sheet is cut short", async () => {
    const rows = [
      "id,name",
      ...Array.from({ length: LIMITS.maxSheetRows + 50 }, (_, i) => `${i},n${i}`),
    ];
    const out = await extractWithCode("x.csv", new TextEncoder().encode(rows.join("\n")), "csv");
    expect(out.warnings[0]).toMatch(/has 550 rows; the first 500 were read/);
    // The header, the rule under it, and 500 rows.
    expect(out.markdown.split("\n").filter((l) => l.startsWith("| ")).length).toBe(502);
  });

  it("strip scripts, styles, navigation, handlers, and remote images from HTML", async () => {
    const out = await extractWithCode("x.html", read("printer-setup.html"), "html");
    expect(out.title).toBe("Set up the campus printer");
    expect(out.markdown).toContain("2. Add the printer named `CAMPUS-01`.");
    expect(out.markdown).toContain("| 1 | A4 |");
    expect(out.markdown).toContain("[the printer list](https://intranet.example/it/printers)");
    for (const gone of [
      "pwned",
      "evil.example",
      "font-family",
      "tracking.gif",
      "onclick",
      "alert",
      "Home",
    ])
      expect(out.markdown, gone).not.toContain(gone);
  });

  it("read a PDF's text layer as the no-AI fallback, and say what was lost", async () => {
    const out = await extractWithCode("x.pdf", read("leave-request.pdf"), "pdf");
    expect(out).toMatchObject({ method: "fallback", pages: 2, title: "Leave request procedure" });
    expect(out.markdown).toContain("## Leave request procedure");
    expect(out.markdown).toContain("2. Pick the dates and the type of leave.");
    expect(out.markdown).toContain("## Carrying leave over");
    expect(out.warnings[0]).toMatch(/Converted without AI/);
  });

  it("keep an image for a person to describe when no model may read it", async () => {
    const out = await extractWithCode("White board.PNG", read("whiteboard.png"), "png");
    expect(out).toMatchObject({ method: "none", markdown: "" });
    expect(out.images.map((i) => i.name)).toEqual(["white-board.png"]);
  });

  it("treat a document's instructions as text, like everything else in it", async () => {
    const out = await extractWithCode("x.docx", read("laptop-return-injection.docx"), "docx");
    expect(out.markdown).toContain("Ignore all previous instructions");
    expect(out.markdown).toContain("3. Hand the laptop to IT Support.");
  });

  it("only PDFs and images need a model", () => {
    expect(["pdf", "png", "jpg"].every((t) => needsModel(t as never))).toBe(true);
    expect(
      ["docx", "pptx", "xlsx", "csv", "html", "md", "txt"].some((t) => needsModel(t as never)),
    ).toBe(false);
  });
});

describe("what is accepted", () => {
  const text = (s: string) => new TextEncoder().encode(s);

  it("goes by the file's bytes, not its name", async () => {
    await expect(detectType("report.pdf", read("deposit-refund-sop.docx"))).rejects.toThrow(
      /named like a .pdf file but its contents are a .docx file/,
    );
    await expect(detectType("photo.png", read("leave-request.pdf"))).rejects.toThrow(/a PDF/);
    await expect(detectType("notes.docx", read("orientation.pptx"))).rejects.toThrow(
      /a .pptx file/,
    );
    expect(await detectType("SOP.DOCX", read("deposit-refund-sop.docx"))).toBe("docx");
  });

  it.each([
    ["empty.txt", new Uint8Array(), /empty/],
    ["run.exe", text("MZ plain"), /\.exe files are not accepted/],
    ["script.sh", text("#!/bin/sh\nrm -rf /"), /\.sh files are not accepted/],
    ["image.svg", text("<svg><script>1</script></svg>"), /\.svg files are not accepted/],
    ["binary.txt", new Uint8Array([1, 2, 0, 3, 255, 254]), /not a kind of file/],
    ["old.doc", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), /old Office format/],
    ["archive.docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), /damaged/],
  ])("refuses %s", async (name, bytes, why) => {
    const err = await detectType(name, bytes).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadRefused);
    expect((err as Error).message).toMatch(why);
  });

  it("refuses a file over 25 MB", async () => {
    const big = new Uint8Array(LIMITS.maxBytes + 1).fill(65);
    await expect(detectType("big.txt", big)).rejects.toMatchObject({ status: 413 });
  });

  it("refuses a PDF over 60 pages", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    for (let i = 0; i < LIMITS.maxPages + 1; i++) pdf.addPage([200, 200]);
    const bytes = await pdf.save();
    await expect(inspect("long.pdf", bytes)).rejects.toThrow(/has 61 pages. The limit is 60/);
  });
});
