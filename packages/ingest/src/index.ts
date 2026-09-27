/**
 * `@lore/ingest`: from an uploaded file or a capture to a draft changeset. Extractors that
 * convert files with code, the atomizer's plan and the checks on it, and the object store
 * where originals are kept.
 *
 * @packageDocumentation
 */
export {
  assertObjectKey,
  blobKey,
  FsObjectStore,
  MemoryObjectStore,
  S3ObjectStore,
  type ObjectStore,
  type S3Options,
  type SignedUrlOptions,
} from "./object-store.ts";
export {
  detectType,
  extractPdfText,
  extractWithCode,
  FILE_TYPES,
  htmlToMarkdown,
  inspect,
  LIMITS,
  MEDIA_TYPES,
  needsModel,
  pdfPages,
  UploadRefused,
  type Extracted,
  type ExtractedImage,
  type FileType,
} from "./extract/index.ts";
export {
  buildChangeset,
  DUPLICATE,
  flagDuplicates,
  linkRelated,
  type BuildContext,
  type Built,
  type ExistingNote,
  type Neighbour,
} from "./pipeline/build.ts";
export {
  ATOMIZE_INSTRUCTIONS,
  AtomizePlan,
  EXTRACT_INSTRUCTIONS,
  ExtractedDocument,
  PlanItem,
  ProposedTerm,
} from "./pipeline/plan.ts";
export {
  runIngest,
  type Draft,
  type IngestDeps,
  type IngestInput,
  type IngestItem,
  type IngestResult,
  type SimilarNote,
} from "./pipeline/run.ts";
