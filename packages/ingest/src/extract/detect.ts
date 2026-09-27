import JSZip from "jszip";
import { LIMITS, UploadRefused, type FileType } from "./types.ts";

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);
const ZIP = [0x50, 0x4b, 0x03, 0x04];

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.subarray(0, sample.length - 3));
    return true;
  } catch {
    return false;
  }
}

/**
 * What a file is, from its bytes. The extension only chooses between formats that look the
 * same inside (the text formats, and the three Office formats, which are all zip archives).
 * A file whose bytes do not match its name is refused rather than guessed at.
 */
export async function detectType(name: string, bytes: Uint8Array): Promise<FileType> {
  if (bytes.length === 0) throw new UploadRefused("The file is empty");
  if (bytes.length > LIMITS.maxBytes)
    throw new UploadRefused(
      `The file is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. The limit is ${LIMITS.maxBytes / 1024 / 1024} MB`,
      413,
    );
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const mismatch = (is: string) =>
    new UploadRefused(`${name} is named like a .${ext} file but its contents are ${is}`);

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    if (ext !== "pdf") throw mismatch("a PDF");
    return "pdf";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    if (ext !== "png") throw mismatch("a PNG image");
    return "png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    if (ext !== "jpg" && ext !== "jpeg") throw mismatch("a JPEG image");
    return "jpg";
  }
  if (startsWith(bytes, ZIP)) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      throw new UploadRefused(`${name} could not be opened: the archive is damaged`);
    }
    const kind = zip.file("word/document.xml")
      ? "docx"
      : zip.file("ppt/presentation.xml")
        ? "pptx"
        : zip.file("xl/workbook.xml")
          ? "xlsx"
          : null;
    if (!kind)
      throw new UploadRefused(`${name} is a zip archive, not a Word, PowerPoint, or Excel file`);
    if (kind !== ext) throw mismatch(`a .${kind} file`);
    return kind;
  }
  // Old binary Office formats and anything else that is not text.
  if (!looksLikeText(bytes)) {
    if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]))
      throw new UploadRefused(
        `${name} is in an old Office format. Save it as .docx, .pptx, or .xlsx and upload that`,
      );
    throw new UploadRefused(`${name} is not a kind of file the Library can read`);
  }
  switch (ext) {
    case "csv":
      return "csv";
    case "html":
    case "htm":
      return "html";
    case "md":
    case "markdown":
      return "md";
    case "txt":
      return "txt";
    default:
      throw new UploadRefused(
        `.${ext} files are not accepted. Upload PDF, DOCX, PPTX, XLSX, CSV, HTML, MD, TXT, PNG, or JPG`,
      );
  }
}
