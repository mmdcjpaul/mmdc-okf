import JSZip from "jszip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { htmlToMarkdown } from "./html.ts";
import { firstHeading, table, tidy } from "./markdown.ts";
import { LIMITS, type Extracted, type ExtractedImage } from "./types.ts";

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Word: mammoth to HTML, then to markdown. Embedded images are kept beside the text. */
export async function extractDocx(bytes: Uint8Array): Promise<Extracted> {
  const images: ExtractedImage[] = [];
  const warnings: string[] = [];
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const ext = IMAGE_EXT[image.contentType];
        if (!ext) {
          warnings.push(`An embedded ${image.contentType} image was left out`);
          return { src: "" };
        }
        const name = `image-${images.length + 1}.${ext}`;
        images.push({
          name,
          bytes: new Uint8Array(await image.readAsBuffer()),
          mediaType: image.contentType,
        });
        return { src: name };
      }),
    },
  );
  for (const m of result.messages)
    if (m.type === "warning" && !/Unrecognised paragraph style/.test(m.message))
      warnings.push(m.message);
  const markdown = await htmlToMarkdown(result.value);
  return {
    type: "docx",
    markdown,
    title: firstHeading(markdown),
    pages: null,
    images,
    warnings,
    method: "code",
  };
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

/** Paragraphs of text in a slide or notes part, in document order. */
function paragraphs(xml: string): { text: string; bullet: boolean; title: boolean }[] {
  const out: { text: string; bullet: boolean; title: boolean }[] = [];
  for (const shape of xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) ?? []) {
    const title = /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(shape);
    if (/<p:ph\b[^>]*type="(sldNum|dt|ftr|sldImg)"/.test(shape)) continue;
    for (const para of shape.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? []) {
      const text = (para.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) ?? [])
        .map((t) => decode(t.replace(/<[^>]+>/g, "")))
        .join("")
        .trim();
      if (!text) continue;
      out.push({ text, bullet: /<a:bu(Char|AutoNum)\b/.test(para), title });
    }
  }
  return out;
}

/** PowerPoint: the text of each slide and its speaker notes, read from the archive. */
export async function extractPptx(bytes: Uint8Array): Promise<Extracted> {
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files)
    .map((name) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: m[0], n: Number(m[1]) }))
    .sort((a, b) => a.n - b.n);
  const warnings: string[] = [];
  const kept = slides.slice(0, LIMITS.maxPages);
  if (slides.length > kept.length)
    warnings.push(`Only the first ${LIMITS.maxPages} of ${slides.length} slides were read`);

  const parts: string[] = [];
  let title: string | null = null;
  for (const slide of kept) {
    const paras = paragraphs(await zip.file(slide.name)!.async("string"));
    const heading = paras.find((p) => p.title) ?? paras[0];
    title ??= heading?.text ?? null;
    parts.push(`## Slide ${slide.n}${heading ? `: ${heading.text}` : ""}`);
    const rest = paras.filter((p) => p !== heading);
    if (rest.length)
      parts.push(
        rest
          .map((p) => (p.bullet ? `- ${p.text}` : p.text))
          .join("\n\n")
          .replace(/\n\n- /g, "\n- "),
      );
    const notes = zip.file(`ppt/notesSlides/notesSlide${slide.n}.xml`);
    if (notes) {
      const text = paragraphs(await notes.async("string"))
        .map((p) => p.text)
        .join(" ");
      if (text) parts.push(`> Speaker notes: ${text}`);
    }
  }
  const media = Object.keys(zip.files).filter((n) => n.startsWith("ppt/media/")).length;
  if (media)
    warnings.push(
      `${media} ${media === 1 ? "picture was" : "pictures were"} not read; only text is`,
    );
  return {
    type: "pptx",
    markdown: tidy(parts.join("\n\n")),
    title,
    pages: slides.length,
    images: [],
    warnings,
    method: "code",
  };
}

/** Excel and CSV: each sheet as a table. Formulas are read as their last computed value. */
export function extractSheets(bytes: Uint8Array, type: "xlsx" | "csv"): Extracted {
  const wb =
    type === "csv"
      ? XLSX.read(new TextDecoder().decode(bytes), { type: "string", raw: true })
      : XLSX.read(bytes, { type: "array" });
  const warnings: string[] = [];
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, blankrows: false, defval: "" })
      .filter((r) => r.some((c) => String(c).trim() !== ""));
    if (rows.length === 0) continue;
    if (type === "xlsx") parts.push(`## ${name}`);
    parts.push(table(rows.slice(0, LIMITS.maxSheetRows + 1)));
    if (rows.length > LIMITS.maxSheetRows + 1)
      warnings.push(
        `${type === "xlsx" ? `Sheet "${name}"` : "The file"} has ${rows.length - 1} rows; the first ${LIMITS.maxSheetRows} were read`,
      );
  }
  return {
    type,
    markdown: tidy(parts.join("\n\n")),
    title: type === "xlsx" ? (wb.SheetNames[0] ?? null) : null,
    pages: null,
    images: [],
    warnings,
    method: "code",
  };
}
