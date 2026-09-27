export const FILE_TYPES = [
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "csv",
  "html",
  "md",
  "txt",
  "png",
  "jpg",
] as const;
export type FileType = (typeof FILE_TYPES)[number];

/** AU-4: what an upload may be, and how large. */
export const LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxPages: 60,
  /** Images in one capture. */
  maxCaptureImages: 10,
  /** Rows of a sheet that are converted; the rest are counted, not dropped silently. */
  maxSheetRows: 500,
} as const;

export const MEDIA_TYPES: Record<FileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
};

export interface ExtractedImage {
  /** File name for `_assets/`, unique within the document. */
  name: string;
  bytes: Uint8Array;
  mediaType: string;
}

export interface Extracted {
  type: FileType;
  /** The document as markdown. Empty when only a model can read it (a scan, an image). */
  markdown: string;
  title: string | null;
  pages: number | null;
  images: ExtractedImage[];
  /** What was lost or cut, in words a person can act on. */
  warnings: string[];
  /**
   * How the text was obtained: `code` is deterministic conversion, `fallback` is the lossy
   * path used when no model may read the file, `none` means there is no text yet.
   */
  method: "code" | "fallback" | "none";
}

/** The file cannot be accepted. The message is shown to the person who uploaded it. */
export class UploadRefused extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UploadRefused";
    this.status = status;
  }
}
