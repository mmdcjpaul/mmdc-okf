import { expect, test } from "@playwright/test";
import { NAMES, signIn, type Person } from "./helpers.ts";

test.describe("sign-in", () => {
  test("signed-out people are sent to sign-in, and APIs refuse them", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    expect((await request.get("/api/search?q=enroll")).status()).toBe(401);
    // Missing and unreadable assets look the same: 404.
    expect((await request.get("/assets/kb/finance/_assets/none.png")).status()).toBe(404);
  });

  for (const who of Object.keys(NAMES) as Person[]) {
    test(`${who} can sign in`, async ({ page }) => {
      await signIn(page, who);
      await expect(page.getByRole("navigation", { name: "Library" })).toBeVisible();
    });
  }

  test("service accounts are not offered", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /Alice Reyes/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Multica/ })).toHaveCount(0);
  });

  test("signing out ends the session, here and on the server", async ({ page }) => {
    await signIn(page, "alice");
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name.endsWith("session_token"))!;
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/themes");
    await expect(page).toHaveURL(/\/login/);
    // The old cookie is no good to anyone who kept a copy.
    const kept = await page.request.get("/api/search?q=enroll", {
      headers: { cookie: `${session.name}=${session.value}` },
    });
    expect(kept.status()).toBe(401);
  });

  test("a made-up session cookie is nobody", async ({ request }) => {
    const res = await request.get("/api/search?q=enroll", {
      headers: { cookie: "better-auth.session_token=alice.forged" },
    });
    expect(res.status()).toBe(401);
  });

  test("sign-ins are in the audit log, with how", async ({ page }) => {
    await signIn(page, "dana");
    await page.goto("/admin/audit?action=auth.sign_in");
    const first = page.getByRole("table").getByRole("row").nth(1);
    await expect(first).toContainText("Dana Ito");
    await expect(first).toContainText('"method":"dev"');
  });

  test("a sign-in link arrives by email, works once, and signs the person in", async ({
    page,
    request,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("carol@acme.test");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("status")).toContainText("If carol@acme.test can sign in");

    const mailpit = process.env.TEST_MAILPIT_URL ?? "http://127.0.0.1:8025";
    let id = "";
    await expect
      .poll(async () => {
        const found = (await (
          await request.get(
            `${mailpit}/api/v1/search?query=${encodeURIComponent('to:carol@acme.test subject:"Sign in to"')}`,
          )
        ).json()) as { messages: { ID: string }[] };
        id = found.messages[0]?.ID ?? "";
        return id;
      })
      .not.toBe("");
    const mail = (await (await request.get(`${mailpit}/api/v1/message/${id}`)).json()) as {
      Text: string;
    };
    await request.delete(`${mailpit}/api/v1/messages`, { data: { IDs: [id] } });
    const link = /http:\/\/localhost:\d+\/api\/auth\/magic-link\/verify\S+/.exec(mail.Text)![0];

    await page.goto(link);
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Carol");
    // The link is spent.
    await page.context().clearCookies();
    await page.goto(link);
    await expect(page).toHaveURL(/\/login\?error=INVALID_TOKEN/);
    await expect(page.getByText("That link has been used or has expired")).toBeVisible();
  });

  test("an address outside the company's domains is sent nothing, and told the same", async ({
    page,
    request,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("mallory@elsewhere.test");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("status")).toContainText(
      "If mallory@elsewhere.test can sign in, a link is on its way",
    );
    // A link for someone who may sign in, sent afterwards, arrives. Hers never does.
    await page.getByLabel("Work email").fill("erin@acme.test");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    const mailpit = process.env.TEST_MAILPIT_URL ?? "http://127.0.0.1:8025";
    const to = async (address: string) =>
      (
        (await (
          await request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)
        ).json()) as { messages: { ID: string }[] }
      ).messages;
    await expect.poll(async () => (await to("erin@acme.test")).length).toBeGreaterThan(0);
    expect(await to("mallory@elsewhere.test")).toEqual([]);
    await request.delete(`${mailpit}/api/v1/messages`, {
      data: { IDs: (await to("erin@acme.test")).map((m) => m.ID) },
    });
  });

  test("something that is not an address is refused", async ({ page }) => {
    // Who may sign in (the allow-list) is tested in packages/auth, against the database.
    await page.goto("/login");
    await page.getByLabel("Work email").fill("not-an-address");
    await page.getByLabel("Work email").evaluate((el: HTMLInputElement) => (el.type = "text"));
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("status")).toContainText("Enter your work email address");
  });

  test("the GitHub webhook takes deliveries from anyone, and tells them nothing", async ({
    request,
  }) => {
    expect((await request.post("/api/webhooks/github", { data: {} })).status()).toBe(400);
    const forged = await request.post("/api/webhooks/github", {
      headers: { "x-github-event": "push", "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
      data: { ref: "refs/heads/main", after: "a".repeat(40), repository: { full_name: "a/b" } },
    });
    // Taken, checked by the worker, and dropped: the same answer a real push would get.
    expect(forged.status()).toBe(202);
    expect(await forged.json()).toEqual({ received: true });
    expect((await request.get("/api/webhooks/github")).status()).toBe(405);
  });
});
