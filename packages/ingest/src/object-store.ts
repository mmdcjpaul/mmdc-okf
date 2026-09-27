import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Where bytes live: vault assets keyed by blob SHA, and uploaded source documents. The vault
 * keeps markdown in Git; binaries that people upload stay out of it (PRD 7.2).
 */
export interface ObjectStore {
  has(key: string): Promise<boolean>;
  put(key: string, bytes: Uint8Array, opts?: { contentType?: string }): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /**
   * A short-lived URL a browser can fetch directly, or null when this store cannot serve
   * browsers. The caller checks permissions before asking for one.
   */
  signedUrl(key: string, opts: SignedUrlOptions): Promise<string | null>;
}

export interface SignedUrlOptions {
  /** Lifetime in seconds. */
  expiresIn: number;
  /** Content type the response should carry. */
  contentType?: string;
}

/** Keys are path-like, with no empty, `.` or `..` segments. */
export function assertObjectKey(key: string): void {
  const ok =
    /^[A-Za-z0-9._\-/]{1,512}$/.test(key) &&
    key.split("/").every((s) => s !== "" && s !== "." && s !== "..");
  if (!ok) throw new Error(`Invalid object key ${JSON.stringify(key)}`);
}

/** Key of a vault asset, from its Git blob SHA. */
export function blobKey(blobSha: string): string {
  if (!/^[0-9a-f]{40,64}$/.test(blobSha)) throw new Error(`Invalid blob SHA ${blobSha}`);
  return `blobs/${blobSha.slice(0, 2)}/${blobSha.slice(2)}`;
}

/** A folder on disk. For tests and single-process setups; it cannot sign URLs. */
export class FsObjectStore implements ObjectStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private pathOf(key: string): string {
    assertObjectKey(key);
    return join(this.dir, key);
  }

  async has(key: string): Promise<boolean> {
    const p = this.pathOf(key);
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const p = this.pathOf(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const p = this.pathOf(key);
    try {
      return new Uint8Array(await readFile(p));
    } catch {
      return null;
    }
  }

  async signedUrl(): Promise<string | null> {
    return null;
  }
}

/** In memory, for unit tests. */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();

  async has(key: string): Promise<boolean> {
    assertObjectKey(key);
    return this.objects.has(key);
  }

  async put(key: string, bytes: Uint8Array, opts: { contentType?: string } = {}): Promise<void> {
    assertObjectKey(key);
    this.objects.set(key, { bytes, contentType: opts.contentType });
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertObjectKey(key);
    return this.objects.get(key)?.bytes ?? null;
  }

  async signedUrl(key: string, opts: SignedUrlOptions): Promise<string | null> {
    assertObjectKey(key);
    return this.objects.has(key) ? `memory://${key}?expires=${opts.expiresIn}` : null;
  }
}

export interface S3Options {
  /** Endpoint the server uses to reach the store. */
  endpoint: string;
  /**
   * Endpoint browsers use, when it differs from `endpoint` (for example a Docker network
   * name inside, a public host outside). Signed URLs are made for this one.
   */
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing, which MinIO-like stores need. Defaults to true. */
  forcePathStyle?: boolean;
}

/** Any S3-compatible store: the Lightsail bucket in production, a local gateway in development. */
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly signer: S3Client;
  private readonly bucket: string;

  constructor(opts: S3Options) {
    const base = {
      region: opts.region,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      forcePathStyle: opts.forcePathStyle ?? true,
    };
    this.client = new S3Client({ ...base, endpoint: opts.endpoint });
    this.signer =
      opts.publicEndpoint && opts.publicEndpoint !== opts.endpoint
        ? new S3Client({ ...base, endpoint: opts.publicEndpoint })
        : this.client;
    this.bucket = opts.bucket;
  }

  /** Creates the bucket when it is missing. For development and tests. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async has(key: string): Promise<boolean> {
    assertObjectKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  }

  async put(key: string, bytes: Uint8Array, opts: { contentType?: string } = {}): Promise<void> {
    assertObjectKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: opts.contentType ?? "application/octet-stream",
      }),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertObjectKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async signedUrl(key: string, opts: SignedUrlOptions): Promise<string | null> {
    assertObjectKey(key);
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: opts.contentType,
        // Never let an asset run as a page in its own right.
        ResponseContentDisposition: "inline",
      }),
      { expiresIn: opts.expiresIn },
    );
  }

  close(): void {
    this.client.destroy();
    if (this.signer !== this.client) this.signer.destroy();
  }
}

function isMissing(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}
