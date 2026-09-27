import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blobKey, S3ObjectStore } from "../src/index.ts";

const S3 = {
  endpoint: process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9002",
  region: "us-east-1",
  bucket: "lore-test",
  accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "lore",
  secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? "lore-dev-secret",
};

async function reachable(): Promise<boolean> {
  try {
    await fetch(S3.endpoint, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}
if (!(await reachable())) {
  throw new Error(`The object store is not reachable at ${S3.endpoint}. Run \`pnpm services:up\`.`);
}

const BYTES = new Uint8Array([137, 80, 78, 71, 0, 255, 1, 2]);
const KEY = blobKey("3b18e512dba79e4c8300dd08aeb37f8e728b8dad");

describe("S3ObjectStore", () => {
  const store = new S3ObjectStore(S3);
  beforeAll(() => store.ensureBucket());
  afterAll(() => store.close());

  it("stores and returns bytes unchanged", async () => {
    expect(await store.get("blobs/00/missing")).toBeNull();
    expect(await store.has("blobs/00/missing")).toBe(false);
    await store.put(KEY, BYTES, { contentType: "image/png" });
    expect(await store.has(KEY)).toBe(true);
    expect([...(await store.get(KEY))!]).toEqual([...BYTES]);
  });

  it("rejects keys that could leave the store", async () => {
    for (const bad of ["../etc/passwd", "a//b", "/abs", ""]) {
      await expect(store.get(bad), bad).rejects.toThrow(/Invalid object key/);
    }
  });

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
