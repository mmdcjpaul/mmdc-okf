import { createDb, listAudit, seedPrincipals, setUserRole, upsertVault, type Db } from "@lore/db";
import { migrateDb } from "@lore/db/migrate";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSignIn,
  handleFor,
  sessionCookieFor,
  sessionUserId,
  type SignInConfig,
} from "../src/sign-in.ts";

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgres://lore:lore@127.0.0.1:5433/lore";
const NAME = "lore_test_sign_in";
const BASE = "http://localhost:3000";
const SECRET = "a-secret-for-tests-that-is-long-enough";

let db: Db;
let links: { email: string; url: string }[];

const make = (over: Partial<SignInConfig> = {}) =>
  createSignIn({
    db,
    secret: SECRET,
    baseURL: BASE,
    allowedDomains: ["acme.test"],
    devLogin: true,
    production: false,
    sendSignInLink: async (to) => void links.push(to),
    ...over,
  });
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.slice(0, c.indexOf(";")))
    .join("; ");
const post = (auth: ReturnType<typeof make>, path: string, body: unknown, cookie = "") =>
  auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
const who = (auth: ReturnType<typeof make>, cookie: string) =>
  sessionUserId(auth, new Headers({ cookie }));
const people = () =>
  db.$client`select id, handle, email, role, email_verified from users order by created_at, id`;

beforeAll(async () => {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${NAME} with (force)`);
    await admin.unsafe(`create database ${NAME}`);
  } catch (err) {
    throw new Error("Postgres is not reachable. Run `pnpm services:up`.", { cause: err });
  } finally {
    await admin.end();
  }
  db = createDb(ADMIN_URL.replace(/\/[^/]+$/, `/${NAME}`), { max: 4 });
  await migrateDb(db);
  await upsertVault(db, {
    id: "acme",
    slug: "acme",
    title: "Acme",
    repository: "local:/nowhere",
    branch: "main",
    bundleRoot: "kb",
  });
});
afterAll(() => db?.$client.end({ timeout: 5 }));
beforeEach(async () => {
  links = [];
  await db.$client`delete from users`;
  await db.$client`delete from verifications`;
  await db.$client`delete from audit_log`;
});

async function signInByLink(auth: ReturnType<typeof make>, email: string) {
  const asked = await post(auth, "/sign-in/magic-link", { email, callbackURL: "/" });
  expect(asked.status).toBe(200);
  const link = links.at(-1);
  if (!link || link.email !== email) return { asked, opened: null, cookie: "" };
  const opened = await auth.handler(new Request(link.url, { headers: { origin: BASE } }));
  return { asked, opened, cookie: cookieOf(opened) };
}

describe("handleFor", () => {
  it("makes a handle from the address, and a different one when it is taken", () => {
    expect(handleFor("Maria.Reyes@acme.test", new Set())).toBe("maria-reyes");
    expect(handleFor("maria.reyes@acme.test", new Set(["maria-reyes"]))).toBe("maria-reyes-2");
    expect(handleFor("maria.reyes@acme.test", new Set(["maria-reyes", "maria-reyes-2"]))).toBe(
      "maria-reyes-3",
    );
    expect(handleFor("@acme.test", new Set())).toBe("person");
  });
});

describe("signing in by email link", () => {
  it("the first person in a new deployment owns it; the next is a member", async () => {
    const auth = make();
    const first = await signInByLink(auth, "dana@acme.test");
    expect(first.opened!.status).toBe(302);
    expect(first.opened!.headers.get("location")).toBe(`${BASE}/`);
    const second = await signInByLink(auth, "alice@acme.test");
    expect(await people()).toEqual([
      expect.objectContaining({ handle: "dana", role: "owner", email_verified: true }),
      expect.objectContaining({ handle: "alice", role: "member", email_verified: true }),
    ]);
    const [dana, alice] = await people();
    expect(await who(auth, first.cookie)).toBe(dana!.id);
    expect(await who(auth, second.cookie)).toBe(alice!.id);
  });

  it("a person outside the allowed domains cannot create an account, and is sent nothing", async () => {
    const auth = make();
    const { asked } = await signInByLink(auth, "mallory@elsewhere.test");
    // The same answer as for anyone, so the form does not say who may sign in.
    expect(await asked.json()).toEqual({ status: true });
    expect(links).toEqual([]);
    expect(await people()).toEqual([]);
  });

  it("refuses them even with a link in hand", async () => {
    // A link made while the domain was allowed, opened after it was taken off the list.
    const before = make({ allowedDomains: ["acme.test", "elsewhere.test"] });
    await post(before, "/sign-in/magic-link", { email: "mallory@elsewhere.test" });
    const now = make();
    const opened = await now.handler(new Request(links[0]!.url, { headers: { origin: BASE } }));
    expect(cookieOf(opened)).not.toMatch(/session_token=[^;]+\w/);
    expect(await people()).toEqual([]);
  });

  it("a link works once", async () => {
    const auth = make();
    const { cookie } = await signInByLink(auth, "dana@acme.test");
    expect(await who(auth, cookie)).toBeTruthy();
    const again = await auth.handler(new Request(links[0]!.url, { headers: { origin: BASE } }));
    expect(again.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(cookieOf(again)).not.toContain("session_token");
  });

  it("is off when there is nothing to send links with", async () => {
    const auth = make({ sendSignInLink: undefined });
    const res = await post(auth, "/sign-in/magic-link", { email: "dana@acme.test" });
    expect(res.status).toBe(404);
  });
});

describe("people who are already there", () => {
  beforeEach(async () => {
    await seedPrincipals(db, "acme", {
      teams: [],
      users: [
        {
          id: "alice",
          name: "Alice Reyes",
          email: "alice@acme.test",
          role: "member",
          serviceAccount: false,
          teams: [],
        },
        {
          id: "dana",
          name: "Dana Ito",
          email: "dana@acme.test",
          role: "admin",
          serviceAccount: false,
          teams: [],
        },
        {
          id: "svc",
          name: "Agent",
          email: "svc@acme.test",
          role: "member",
          serviceAccount: true,
          teams: [],
        },
      ],
      grants: [],
    });
  });

  it("sign in as themselves: the link finds the person by address and changes nothing else", async () => {
    const auth = make();
    const { cookie } = await signInByLink(auth, "alice@acme.test");
    expect(await who(auth, cookie)).toBe("alice");
    expect((await people()).map((p) => [p.id, p.role])).toEqual([
      ["alice", "member"],
      ["dana", "admin"],
      ["svc", "member"],
    ]);
  });

  it("a role changed in Admin holds at the next request, with the same session", async () => {
    const auth = make();
    const cookie = await sessionCookieFor(auth, "alice");
    await setUserRole(db, "alice", "admin");
    expect(await who(auth, cookie)).toBe("alice");
    expect((await people())[0]).toMatchObject({ id: "alice", role: "admin" });
  });

  it("service accounts do not sign in through the browser", async () => {
    const auth = make();
    await expect(sessionCookieFor(auth, "svc")).rejects.toThrow();
    const { cookie } = await signInByLink(auth, "svc@acme.test");
    expect(await who(auth, cookie)).toBeNull();
  });

  it("a person whose domain was taken off the list can no longer sign in", async () => {
    const auth = make({ allowedDomains: ["other.test"] });
    await expect(sessionCookieFor(auth, "alice")).rejects.toThrow();
  });

  it("signing out ends the session", async () => {
    const auth = make();
    const cookie = await sessionCookieFor(auth, "alice");
    expect(await who(auth, cookie)).toBe("alice");
    const out = await post(auth, "/sign-out", {}, cookie);
    expect(out.status).toBe(200);
    expect(await who(auth, cookie)).toBeNull();
    expect(await db.$client`select id from sessions where user_id = 'alice'`).toEqual([]);
  });

  it("a cookie that was changed, or signed with another secret, is nobody", async () => {
    const auth = make();
    const cookie = await sessionCookieFor(auth, "alice");
    expect(
      await who(
        auth,
        cookie.replace(/=(.)/, (_, c: string) => `=${c === "a" ? "b" : "a"}`),
      ),
    ).toBeNull();
    expect(
      await who(make({ secret: "another-secret-that-is-also-long-enough" }), cookie),
    ).toBeNull();
    expect(await who(auth, "")).toBeNull();
  });

  it("writes each sign-in to the audit log, with how", async () => {
    const auth = make();
    await sessionCookieFor(auth, "dana");
    await signInByLink(auth, "alice@acme.test");
    const log = (await listAudit(db, { action: "auth.sign_in" })).map((e) => [
      e.actorId,
      e.metadata.method,
    ]);
    expect(log).toEqual([
      ["alice", "email link"],
      ["dana", "dev"],
    ]);
  });
});

describe("dev login", () => {
  it("does not exist unless it is switched on", async () => {
    const auth = make({ devLogin: false });
    const res = await post(auth, "/sign-in/dev", { userId: "alice" });
    expect(res.status).toBe(404);
    await expect(sessionCookieFor(auth, "alice")).rejects.toThrow("Dev login is off");
  });

  it("is refused in production", () => {
    expect(() => make({ production: true })).toThrow("Dev login is refused in production");
  });
});

describe("identity providers", () => {
  it("are offered when configured, and send people to the provider", async () => {
    const auth = make({
      google: { clientId: "g-id", clientSecret: "g-secret" },
      microsoft: { clientId: "m-id", clientSecret: "m-secret", tenantId: "tenant-1" },
    });
    const google = await post(auth, "/sign-in/social", { provider: "google", callbackURL: "/" });
    const g = new URL(((await google.json()) as { url: string }).url);
    expect(g.origin).toBe("https://accounts.google.com");
    expect(g.searchParams.get("client_id")).toBe("g-id");
    expect(g.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/google`);
    expect(g.searchParams.get("hd")).toBe("acme.test");

    const entra = await post(auth, "/sign-in/social", { provider: "microsoft", callbackURL: "/" });
    const m = new URL(((await entra.json()) as { url: string }).url);
    expect(m.origin).toBe("https://login.microsoftonline.com");
    expect(m.pathname).toContain("/tenant-1/");
    expect(m.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/microsoft`);
  });

  it("are not offered when not configured", async () => {
    const res = await post(make(), "/sign-in/social", { provider: "google", callbackURL: "/" });
    expect(res.status).toBe(404);
  });
});
