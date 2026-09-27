# 0006: A local S3 gateway instead of MinIO, and signed URLs for assets

- Status: Accepted
- Date: 2026-09-27
- Plan: 2, section 2 and L5

## Context

Plan 2 lists MinIO as the local object store. MinIO stopped publishing container images
(`docker pull minio/minio` is refused on Docker Hub and Quay), so the plan cannot be followed
as written.

The first pass avoided the question by keeping assets in a folder and having the web app
read them from disk. That broke two rules in Plan 2 section 3: the web container never
touches the file system, and images are served through a signed URL.

## Decision

- The dev compose file runs the Versity S3 gateway (`versity/versitygw`) over a volume. It is
  a single small binary, it checks request signatures, and it needs no setup beyond two keys.
- `ObjectStore` lives in `@lore/ingest` with three implementations: `S3ObjectStore` (any
  S3-compatible store), `FsObjectStore` (tests and single-process use; cannot sign URLs), and
  `MemoryObjectStore` (unit tests).
- The asset route checks that the asset's namespace is readable, then redirects to a URL
  signed for 5 minutes. Unreadable and missing assets both return 404.

## Consequences

- Production uses the same code with the Lightsail bucket's endpoint and keys.
- The store's endpoint must be reachable from browsers. When the server reaches the store
  under a different name than browsers do, set `S3_PUBLIC_ENDPOINT`.
- Assets are served from the store's origin, not the Library's, so an SVG opened directly
  cannot reach a Library session.
- Any S3-compatible server works locally. Set `S3_ENDPOINT` to use another one.
