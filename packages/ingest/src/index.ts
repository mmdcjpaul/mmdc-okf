/**
 * `@lore/ingest`: the object store today; extractors and the ingestion pipeline arrive in L8.
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
