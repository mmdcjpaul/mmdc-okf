import { tidy } from "./markdown.ts";
import { LIMITS, UploadRefused, type Extracted } from "./types.ts";

import type { PDFDocumentProxy } from "pdfjs-dist";

interface TextItem {
  str: string;
  transform: number[];
  height: number;
  hasEOL: boolean;
}

interface Opened {
  doc: PDFDocumentProxy;
  close(): Promise<void>;
}

async function open(bytes: Uint8Array): Promise<Opened> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    // pdf.js takes ownership of the buffer it is given.
    data: bytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    return { doc, close: () => task.destroy() };
  } catch (err) {
    await task.destroy().catch(() => {});
    const message = (err as Error).message ?? "";
    if (/password/i.test(message))
      throw new UploadRefused("The PDF is protected with a password. Remove it and upload again");
    throw new UploadRefused("The PDF could not be opened: it may be damaged");
  }
}

/** Pages in a PDF, refusing one that is over the limit (AU-4). */
export async function pdfPages(bytes: Uint8Array): Promise<number> {
  const { doc, close } = await open(bytes);
  try {
    if (doc.numPages > LIMITS.maxPages)
      throw new UploadRefused(
        `The PDF has ${doc.numPages} pages. The limit is ${LIMITS.maxPages}: split it and upload the parts`,
        413,
      );
    return doc.numPages;
  } finally {
    await close();
  }
}

/**
 * The text layer of a PDF, with no model. This is the lossy fallback for when AI is off or
 * not allowed: it reads text in the order the file stores it, guesses headings from font
 * size, and cannot see tables, columns, or scanned pages.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<Extracted> {
  const pages = await pdfPages(bytes);
  const { doc, close } = await open(bytes);
  const warnings = [
    "Converted without AI from the PDF's text layer: tables, columns, and images are not kept. Check it against the original",
  ];
  const parts: string[] = [];
  let title: string | null = null;
  let empty = 0;
  try {
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter((i) => "str" in i) as unknown as TextItem[];
      const sizes = items.filter((i) => i.str.trim()).map((i) => Math.round(i.height));
      const body = sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] ?? 0;

      const lines: { text: string; size: number }[] = [];
      let current = "";
      let size = 0;
      let lastY: number | null = null;
      const flush = () => {
        if (current.trim()) lines.push({ text: current.replace(/\s+/g, " ").trim(), size });
        current = "";
        size = 0;
      };
      for (const item of items) {
        const y = item.transform[5]!;
        if (lastY !== null && Math.abs(y - lastY) > 2) flush();
        current += item.str;
        size = Math.max(size, Math.round(item.height));
        lastY = y;
        if (item.hasEOL) {
          flush();
          lastY = null;
        }
      }
      flush();
      if (lines.length === 0) {
        empty++;
        continue;
      }
      if (pages > 1) parts.push(`<!-- page ${n} -->`);
      for (const line of lines) {
        const heading = body > 0 && line.size >= body * 1.3 && line.text.length < 120;
        if (heading) title ??= line.text;
        parts.push(heading ? `## ${line.text}` : line.text);
      }
    }
  } finally {
    await close();
  }
  if (empty === pages)
    warnings.push("The PDF has no text layer (it is probably a scan), so nothing could be read");
  else if (empty > 0)
    warnings.push(`${empty} of ${pages} pages have no text layer and were skipped`);
  return {
    type: "pdf",
    markdown: empty === pages ? "" : tidy(parts.join("\n\n")),
    title,
    pages,
    images: [],
    warnings,
    method: empty === pages ? "none" : "fallback",
  };
}
