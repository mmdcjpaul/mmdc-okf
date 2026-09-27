import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertObjectKey,
  blobKey,
  FsObjectStore,
  MemoryObjectStore,
  S3ObjectStore,
  type ObjectStore,
} from "../src/index.ts";

const S3 = {
  endpoint: process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9002",
  region: "us-east-1",
  bucket: "lore-test",
  accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "lore",
  secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? "lore-dev-secret",
};

async function s3Available(): Promise<boolean> {
  try {
    await fetch(S3.endpoint, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    if (process.env.LORE_REQUIRE_SERVICES) throw new Error("The object store is not reachable");
    return false;
  }
}
const available = await s3Available();

const BYTES = new Uint8Array([137, 80, 78, 71, 0, 255, 1, 2]);
const KEY = blobKey("3b18e512dba79e4c8300dd08aeb37f8e728b8dad");

function contract(name: string, make: () => Promise<ObjectStore>) {
  describe(name, () => {
    let store: ObjectStore;
    beforeAll(async () => {
      store = await make();
    });

    it("stores and returns bytes unchanged", async () => {
      expect(await store.get("blobs/00/missing")).toBeNull();
      expect(await store.has("blobs/00/missing")).toBe(false);
      await store.put(KEY, BYTES, { contentType: "image/png" });
      expect(await store.has(KEY)).toBe(true);
      expect([...(await store.get(KEY))!]).toEqual([...BYTES]);
    });

    it("rejects keys that could leave the store", async () => {
      for (const bad of ["../etc/passwd", "a//b", "a/./b", "/abs", "a b", ""]) {
        await expect(store.get(bad), bad).rejects.toThrow(/Invalid object key/);
      }
    });
  });
}

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lore-objects-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

contract("MemoryObjectStore", async () => new MemoryObjectStore());
contract("FsObjectStore", async () => new FsObjectStore(dir));

describe("FsObjectStore", () => {
  it("cannot sign URLs", async () => {
    expect(await new FsObjectStore(dir).signedUrl()).toBeNull();
  });
});

describe.skipIf(!available)("S3ObjectStore", () => {
  const store = new S3ObjectStore(S3);
  beforeAll(() => store.ensureBucket());
  afterAll(() => store.close());

  contract("contract", async () => store);

  it("signs a URL that serves the bytes with the requested type, without credentials", async () => {
    await store.put(KEY, BYTES, { contentType: "application/octet-stream" });
    const url = await store.signedUrl(KEY, { expiresIn: 60, contentType: "image/png" });
    const res = await fetch(url!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...BYTES]);
  });

  it("refuses the same object without a signature, and a tampered signature", async () => {
    const url = new URL((await store.signedUrl(KEY, { expiresIn: 60 }))!);
    expect((await fetch(url.origin + url.pathname)).status).toBe(403);
    url.searchParams.set("X-Amz-Signature", "0".repeat(64));
    expect((await fetch(url)).status).toBe(403);
  });

  it("signs for the public endpoint when one is set", async () => {
    const split = new S3ObjectStore({ ...S3, publicEndpoint: "https://files.example.test" });
    const url = await split.signedUrl(KEY, { expiresIn: 60 });
    expect(new URL(url!).origin).toBe("https://files.example.test");
    split.close();
  });
});

describe("keys", () => {
  it("derives blob keys from SHAs only", () => {
    expect(KEY).toBe("blobs/3b/18e512dba79e4c8300dd08aeb37f8e728b8dad");
    expect(() => blobKey("../x")).toThrow();
    expect(() => assertObjectKey("uploads/01J9/report.pdf")).not.toThrow();
  });
});
