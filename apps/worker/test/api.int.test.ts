import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "../src/api.ts";
import { mirrorFor } from "../src/runtime.ts";
import { createHarness, servicesAvailable, type Harness } from "./harness.ts";

const available = await servicesAvailable();
const TOKEN = "test-internal-token-0123";

describe.skipIf(!available)("worker internal API", () => {
  let h: Harness;
  let server: Server;
  let base: string;
  let head: string;
  const call = (path: string, token: string | null = TOKEN) =>
    fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

  beforeAll(async () => {
    h = await createHarness("api");
    head = (await h.index()).head!;
    const api = createApi({ db: h.db, mirrorFor, token: TOKEN, health: () => ({ up: true }) });
    server = createServer((req, res) => void api(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server?.close();
    await h?.close();
  });

  it("serves health without a token", async () => {
    const res = await call("/health", null);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, up: true });
  });

  it("refuses everything else without the right token", async () => {
    const path = `/vaults/${h.vaultId}/changes/${head}?path=kb/index.md`;
    expect((await call(path, null)).status).toBe(401);
    expect((await call(path, "wrong-token-000000000000")).status).toBe(401);
    expect((await call(path, TOKEN + "x")).status).toBe(401);
  });

  it("returns a file's text before and after a commit", async () => {
    const path = "kb/people-ops/payroll-calendar.md";
    const res = await call(`/vaults/${h.vaultId}/changes/${head}?path=${path}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { after: string };
    expect(body).toMatchObject({ status: "A", before: null, path });
    expect(body.after).toContain("zebra-payroll-canary");
  });

  it("leaves the generated member list out of hub files", async () => {
    const path = "kb/_themes/onboarding.md";
    const raw = (await mirrorFor(`local:${h.bare}`).fileChange(head, path))!.after!;
    expect(raw).toContain("kb:members:start");
    expect(raw).toContain("/people-ops/");
    const res = await call(`/vaults/${h.vaultId}/changes/${head}?path=${path}`);
    const body = (await res.json()) as { after: string };
    expect(body.after).not.toContain("kb:members:start");
    expect(body.after).not.toContain("/people-ops/");
    expect(body.after).toContain("title:");
  });

  it("404s for unknown vaults, untouched files, and malformed commits", async () => {
    expect((await call(`/vaults/nope/changes/${head}?path=kb/index.md`)).status).toBe(404);
    expect((await call(`/vaults/${h.vaultId}/changes/${head}?path=kb/none.md`)).status).toBe(404);
    expect((await call(`/vaults/${h.vaultId}/changes/HEAD?path=kb/index.md`)).status).toBe(404);
    expect((await call(`/vaults/${h.vaultId}/changes/${head}`)).status).toBe(404);
  });

  it("refuses methods it does not serve, and POST without the token", async () => {
    expect((await fetch(base + "/health", { method: "DELETE" })).status).toBe(405);
    expect((await fetch(base + "/health", { method: "POST" })).status).toBe(401);
    const id = "cs_01K0000000000000000000000A";
    expect((await fetch(`${base}/changesets/${id}/process`, { method: "POST" })).status).toBe(401);
  });
});
