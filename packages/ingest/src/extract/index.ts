import { detectType } from "./detect.ts";
import { extractHtml } from "./html.ts";
import { firstHeading, tidy } from "./markdown.ts";
import { extractDocx, extractPptx, extractSheets } from "./office.ts";
import { extractPdfText, pdfPages } from "./pdf.ts";
import { MEDIA_TYPES, type Extracted, type FileType } from "./types.ts";

export { detectType } from "./detect.ts";
export { htmlToMarkdown } from "./html.ts";
export { extractPdfText, pdfPages } from "./pdf.ts";
export {
  FILE_TYPES,
  LIMITS,
  MEDIA_TYPES,
  UploadRefused,
  type Extracted,
  type ExtractedImage,
  type FileType,
} from "./types.ts";

/** File types only a model can read well. Everything else is converted by code. */
export function needsModel(type: FileType): boolean {
  return type === "pdf" || type === "png" || type === "jpg";
}

/**
 * Converts a file to markdown with deterministic code, never a model, and never a network
 * request. For PDFs this is the lossy text-layer fallback; for images there is no text to
 * read, so the image itself is kept for a person to describe.
 */
export async function extractWithCode(
  name: string,
  bytes: Uint8Array,
  type: FileType,
): Promise<Extracted> {
  switch (type) {
    case "docx":
      return extractDocx(bytes);
    case "pptx":
      return extractPptx(bytes);
    case "xlsx":
    case "csv":
      return extractSheets(bytes, type);
    case "html":
      return extractHtml(bytes);
    case "md":
    case "txt": {
      const text = tidy(new TextDecoder().decode(bytes));
      return {
        type,
        markdown: text,
        title: type === "md" ? firstHeading(text) : (text.split("\n")[0]?.slice(0, 120) ?? null),
        pages: null,
        images: [],
        warnings: [],
        method: "code",
      };
    }
    case "pdf":
      return extractPdfText(bytes);
    case "png":
    case "jpg": {
      const file =
        name
          .toLowerCase()
          .replace(/[^a-z0-9.]+/g, "-")
          .replace(/^-+|-+$/g, "") || `image.${type}`;
      return {
        type,
        markdown: "",
        title: null,
        pages: 1,
        images: [{ name: file, bytes, mediaType: MEDIA_TYPES[type] }],
        warnings: ["An image has no text to convert. It is attached for a person to describe"],
        method: "none",
      };
    }
  }
}

/** Checks a file and says what it is. Throws `UploadRefused` for anything not accepted. */
export async function inspect(
  name: string,
  bytes: Uint8Array,
): Promise<{ type: FileType; pages: number | null }> {
  const type = await detectType(name, bytes);
  return { type, pages: type === "pdf" ? await pdfPages(bytes) : null };
}
