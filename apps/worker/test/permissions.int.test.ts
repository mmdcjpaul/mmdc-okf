import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FailingEmbedder, HashEmbedder } from "@lore/ai";
import { loadPrincipal, readScope } from "@lore/auth";
import { backlinks, getNote, listNotes, type ReadScope } from "@lore/db";
import { searchChunks, searchNotes, similarNotes } from "@lore/search";
import { createHarness, servicesAvailable, type Harness } from "./harness.ts";

const available = await servicesAvailable();
const CANARY = "zebra-payroll-canary";

describe.skipIf(!available)("leak canary across read paths", () => {
  let h: Harness;
  let canaryId: string;
  const scopes: Record<string, ReadScope> = {};
  const vector = new HashEmbedder().embedOne(CANARY);

  beforeAll(async () => {
    h = await createHarness("leak");
    await h.index();
    for (const who of ["carol", "erin", "dana", "alice"]) {
      scopes[who] = readScope((await loadPrincipal(h.db, h.vaultId, who))!);
    }
    const all = await listNotes(h.db, scopes.dana!, { limit: 1000 });
    canaryId = all.find((n) => n.path.endsWith("people-ops/payroll-calendar.md"))!.id;
  });
  afterAll(async () => {
    await h?.close();
  });

  const cases: [string, number][] = [
    ["carol", 0],
    ["alice", 0],
    ["erin", 1],
    ["dana", 1],
  ];

  for (const [who, expected] of cases) {
    it(`${who} sees the canary ${expected ? "" : "nowhere"}`, async () => {
      const scope = scopes[who]!;
      for (const v of [null, vector]) {
        const notes = await searchNotes(h.meili, {
          vaultSlug: h.slug,
          scope,
          q: CANARY,
          vector: v,
        });
        expect(notes.hits.filter((x) => x.id === canaryId)).toHaveLength(expected);
        const chunks = await searchChunks(h.meili, {
          vaultSlug: h.slug,
          scope,
          q: CANARY,
          vector: v,
        });
        expect(chunks.hits.some((c) => c.note_id === canaryId)).toBe(expected > 0);
      }
      expect((await getNote(h.db, scope, canaryId)) !== null).toBe(expected > 0);
      const listed = await listNotes(h.db, scope, { namespace: "people-ops" });
      expect(listed.some((n) => n.id === canaryId)).toBe(expected > 0);
    });
  }

  it("similar notes and backlinks never cross into unreadable namespaces", async () => {
    const carol = scopes.carol!;
    const all = await listNotes(h.db, scopes.dana!, { limit: 1000 });
    for (const n of all.slice(0, 25)) {
      const similar = await similarNotes(h.meili, {
        vaultSlug: h.slug,
        scope: carol,
        noteId: n.id,
        limit: 20,
      });
      expect(similar.every((s) => s.namespace !== "people-ops")).toBe(true);
      const inbound = await backlinks(h.db, carol, n.id);
      expect(inbound.every((s) => s.namespace !== "people-ops")).toBe(true);
    }
  });

  it("keyword search works with no query vector (LB-6)", async () => {
    const res = await searchNotes(h.meili, {
      vaultSlug: h.slug,
      scope: scopes.alice!,
      q: "refund",
      vector: null,
    });
    expect(res.hits.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!available)("indexing when embeddings fail", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness("noembed");
    h.deps.embedder = new FailingEmbedder();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("still indexes and serves keyword search", async () => {
    const r = await h.index();
    expect(r.notes).toBe(56);
    expect(r.embedded).toBe(0);
    const scope = readScope((await loadPrincipal(h.db, h.vaultId, "alice"))!);
    const res = await searchNotes(h.meili, { vaultSlug: h.slug, scope, q: "laptop" });
    expect(res.hits.length).toBeGreaterThan(0);
  });
});
