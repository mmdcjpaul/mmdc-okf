/**
 * Captures: rough text and screenshots that become notes (AU-5). The Library's Capture page
 * makes them, and so does the Desk when a resolved ticket is worth writing down (Plan 3).
 */
import { createHash } from "node:crypto";
import { newRecordId } from "@lore/changesets";
import { createIngestItem, type Db } from "@lore/db";
import { LIMITS } from "./extract/index.ts";
import type { ObjectStore } from "./object-store.ts";

/** The capture cannot be taken as it is. `status` is the HTTP status that says so. */
export class CaptureRefused extends Error {
  readonly status: 400 | 413;
  constructor(status: 400 | 413, message: string) {
    super(message);
    this.name = "CaptureRefused";
    this.status = status;
  }
}

export interface CaptureInput {
  vaultId: string;
  /** Who the notes are written for. The pipeline works with what this person may read. */
  submitterId: string;
  /** Where the notes go. The caller has checked that the submitter may read it. */
  namespace: string;
  text: string;
  images?: { name: string; bytes: Uint8Array }[];
  hints?: {
    theme?: string;
    tags?: string[];
    /** Id of the note the capture updates. */
    target?: string;
  };
}

export const CAPTURE_LIMITS = {
  minCharacters: 20,
  maxCharacters: 60_000,
  maxImages: LIMITS.maxCaptureImages,
  maxImageBytes: 5 * 1024 * 1024,
} as const;

const IMAGES: [extension: string, mediaType: string, signature: number[]][] = [
  ["png", "image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["jpg", "image/jpeg", [0xff, 0xd8, 0xff]],
];

/**
 * Stores a capture and its images, ready for the ingestion job. It checks what a capture
 * may hold, not who may make one: the caller decides that, and starts the job.
 */
export async function createCaptureItem(
  deps: { db: Db; objects: ObjectStore },
  input: CaptureInput,
): Promise<{ id: string }> {
  const text = input.text.trim();
  const images = input.images ?? [];
  if (text.length < CAPTURE_LIMITS.minCharacters && images.length === 0)
    throw new CaptureRefused(400, "Write a few words, or add a screenshot");
  if (text.length > CAPTURE_LIMITS.maxCharacters)
    throw new CaptureRefused(413, "The text is too long for one capture");
  if (images.length > CAPTURE_LIMITS.maxImages)
    throw new CaptureRefused(400, `A capture can have up to ${CAPTURE_LIMITS.maxImages} images`);
  // Every image is checked before any is stored, so a refused capture leaves nothing behind.
  const kinds = images.map((img) => {
    if (img.bytes.length > CAPTURE_LIMITS.maxImageBytes)
      throw new CaptureRefused(413, `${img.name} is larger than 5 MB`);
    const kind = IMAGES.find(([, , sig]) => sig.every((b, j) => img.bytes[j] === b));
    if (!kind) throw new CaptureRefused(400, `${img.name} is not a PNG or JPEG image`);
    return kind;
  });

  const id = newRecordId("in");
  const stored: { key: string; name: string; mediaType: string }[] = [];
  for (const [i, img] of images.entries()) {
    const [extension, mediaType] = kinds[i]!;
    const key = `uploads/${id}/image-${i + 1}.${extension}`;
    await deps.objects.put(key, img.bytes, { contentType: mediaType });
    stored.push({ key, name: `capture-${i + 1}.${extension}`, mediaType });
  }
  await createIngestItem(deps.db, {
    id,
    vaultId: input.vaultId,
    submitterId: input.submitterId,
    kind: "capture",
    namespace: input.namespace,
    hints: { ...input.hints, text, images: stored },
    fileName: null,
    fileHash: createHash("sha256").update(text).digest("hex"),
  });
  return { id };
}
