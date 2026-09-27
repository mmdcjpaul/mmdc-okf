import type { Db } from "@lore/db";
import { describe, expect, it, vi } from "vitest";
import { CaptureRefused, createCaptureItem } from "../src/capture.ts";
import { MemoryObjectStore } from "../src/object-store.ts";

vi.mock("@lore/db", async (original) => ({
  ...(await original<typeof import("@lore/db")>()),
  createIngestItem: vi.fn(async (_db: unknown, row: unknown) => row),
}));
const { createIngestItem } = await import("@lore/db");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
const base = {
  vaultId: "acme",
  submitterId: "svc-desk",
  namespace: "finance",
  text: "A student was refunded twice because the first refund was posted to the wrong term.",
};
const deps = () => ({ db: {} as Db, objects: new MemoryObjectStore() });

describe("createCaptureItem", () => {
  it("stores the text, the hints, and the images, and returns the item's id", async () => {
    const d = deps();
    const { id } = await createCaptureItem(d, {
      ...base,
      text: `  ${base.text}\n`,
      images: [
        { name: "one.png", bytes: PNG },
        { name: "two.jpeg", bytes: JPG },
      ],
      hints: { theme: "month-end-close", tags: ["refunds"] },
    });
    expect(id).toMatch(/^in_/);
    expect(vi.mocked(createIngestItem).mock.lastCall![1]).toMatchObject({
      id,
      vaultId: "acme",
      submitterId: "svc-desk",
      kind: "capture",
      namespace: "finance",
      fileName: null,
      hints: {
        theme: "month-end-close",
        tags: ["refunds"],
        text: base.text,
        images: [
          { key: `uploads/${id}/image-1.png`, name: "capture-1.png", mediaType: "image/png" },
          { key: `uploads/${id}/image-2.jpg`, name: "capture-2.jpg", mediaType: "image/jpeg" },
        ],
      },
    });
    expect(await d.objects.get(`uploads/${id}/image-1.png`)).toEqual(PNG);
  });

  it("takes a screenshot with no words, and refuses nothing at all", async () => {
    await expect(
      createCaptureItem(deps(), { ...base, text: "", images: [{ name: "a.png", bytes: PNG }] }),
    ).resolves.toMatchObject({ id: expect.any(String) });
    await expect(createCaptureItem(deps(), { ...base, text: "too short" })).rejects.toMatchObject({
      status: 400,
      message: "Write a few words, or add a screenshot",
    });
  });

  it("refuses what is too long, too many, too large, or not an image, and stores nothing", async () => {
    const d = deps();
    const put = vi.spyOn(d.objects, "put");
    const calls = vi.mocked(createIngestItem).mock.calls.length;
    const refused = async (over: Partial<Parameters<typeof createCaptureItem>[1]>) =>
      createCaptureItem(d, { ...base, ...over }).catch((e: unknown) => e);

    expect(await refused({ text: "x".repeat(60_001) })).toMatchObject({ status: 413 });
    expect(
      await refused({ images: Array.from({ length: 11 }, () => ({ name: "a.png", bytes: PNG })) }),
    ).toMatchObject({ status: 400, message: "A capture can have up to 10 images" });
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect(await refused({ images: [{ name: "big.png", bytes: big }] })).toMatchObject({
      status: 413,
      message: "big.png is larger than 5 MB",
    });
    // A good image first, then a file that only claims to be one.
    const svg = new TextEncoder().encode("<svg onload=alert(1)>");
    const mixed = await refused({
      images: [
        { name: "a.png", bytes: PNG },
        { name: "b.png", bytes: svg },
      ],
    });
    expect(mixed).toBeInstanceOf(CaptureRefused);
    expect(mixed).toMatchObject({ message: "b.png is not a PNG or JPEG image" });
    expect(put).not.toHaveBeenCalled();
    expect(vi.mocked(createIngestItem).mock.calls.length).toBe(calls);
  });
});
