import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertObjectKey,
  blobKey,
  FsObjectStore,
  MemoryObjectStore,
  type ObjectStore,
} from "../src/index.ts";

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

describe("keys", () => {
  it("derives blob keys from SHAs only", () => {
    expect(KEY).toBe("blobs/3b/18e512dba79e4c8300dd08aeb37f8e728b8dad");
    expect(() => blobKey("../x")).toThrow();
    expect(() => assertObjectKey("uploads/01J9/report.pdf")).not.toThrow();
  });
});
