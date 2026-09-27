import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { DATABASE_URL, REPO, SLOW } from "./env.ts";
import { CANARY, fileAtHead, gitLog, signIn, type Person } from "./helpers.ts";

const APP = join(REPO, "apps/web/src/app");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
/** Every Admin page and API route, found on disk, so a new one is covered without being listed. */
const adminRoutes = walk(APP)
  .map((f) => relative(APP, f))
  .filter((f) => /(^|\/)admin\//.test(f) && /(page\.tsx|route\.ts)$/.test(f))
  .map(
    (f) =>
      "/" +
      f
        .replace(/\(library\)\//, "")
        .replace(/\/?(page\.tsx|route\.ts)$/, "")
        .replace(/\/$/, ""),
  )
  .sort();

test.describe("Admin is for admins", () => {
  test("the inventory finds the Admin routes", () => {
    expect(adminRoutes).toContain("/admin");
    expect(adminRoutes).toContain("/admin/ai");
    expect(adminRoutes).toContain("/api/admin/audit");
    expect(adminRoutes.length).toBeGreaterThanOrEqual(8);
  });

  for (const who of ["alice", "bob", "carol", "erin"] as Person[]) {
    test(`${who} gets 403 on every Admin route, and sees no Admin link`, async ({ page }) => {
      await signIn(page, who);
      await expect(
        page.getByRole("navigation", { name: "Library" }).getByRole("link", { name: "Admin" }),
      ).toHaveCount(0);
      for (const route of adminRoutes) {
        const res = await page.request.get(route);
        expect(res.status(), route).toBe(403);
        expect(await res.text(), route).not.toMatch(
          /dana@acme\.test|Save key|grant\.set|changeset\.commit/,
        );
      }
    });
  }

  test("signed out, Admin asks for sign-in", async ({ page, request }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    expect((await request.get("/api/admin/audit")).status()).toBe(401);
  });
});

test.describe("Admin", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "dana");
    await page
      .getByRole("navigation", { name: "Library" })
      .getByRole("link", { name: "Admin" })
      .click();
  });

  test("restricting a namespace hides it from people without a grant on their next request", async ({
    page,
    browser,
  }) => {
    const other = await browser.newContext();
    const carol = await other.newPage();
    await signIn(carol, "carol");
    expect((await carol.request.get("/ns/finance")).status()).toBe(200);
    const found = await carol.request.get("/api/search?q=refund+policy");
    expect(
      ((await found.json()) as { hits: { namespace: string }[] }).hits.map((h) => h.namespace),
    ).toContain("finance");

    await page
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: /Namespaces/ })
      .click();
    const finance = page.getByRole("region", { name: "Finance", exact: true });
    await finance.getByLabel("Visibility").selectOption("restricted");
    await finance.getByRole("button", { name: "Save Finance" }).click();
    await expect(finance.getByText("Saved. It applies from the next request")).toBeVisible();

    // No waiting for the commit or the indexer: the next request is already filtered.
    expect((await carol.request.get("/ns/finance")).status()).toBe(404);
    const after = await carol.request.get("/api/search?q=refund+policy&limit=30");
    expect(
      ((await after.json()) as { hits: { namespace: string }[] }).hits.map((h) => h.namespace),
    ).not.toContain("finance");
    await carol.goto("/");
    await expect(
      carol.getByRole("navigation", { name: "Library" }).getByRole("link", { name: /Finance/ }),
    ).toHaveCount(0);
    // Bob has a grant, so he still reads it.
    const third = await browser.newContext();
    const bob = await third.newPage();
    await signIn(bob, "bob");
    expect((await bob.request.get("/ns/finance")).status()).toBe(200);
    await third.close();

    // The vault is the record: the change arrives there as a commit.
    await expect
      .poll(() => fileAtHead(".kb/namespaces.yaml"), { timeout: SLOW })
      .toMatch(/finance:[\s\S]*?visibility: restricted[\s\S]*?it-support:/);
    expect(gitLog("%s")).toBe('kb(vault): change the settings of namespace "finance"');

    // And back, so the specs after this one find the vault as they expect.
    await finance.getByLabel("Visibility").selectOption("company");
    await finance.getByRole("button", { name: "Save Finance" }).click();
    await expect.poll(async () => (await carol.request.get("/ns/finance")).status()).toBe(200);
    await expect
      .poll(() => fileAtHead(".kb/namespaces.yaml"), { timeout: SLOW })
      .not.toMatch(/finance:[\s\S]*?visibility: restricted[\s\S]*?it-support:/);
    await other.close();
  });

  test("a grant takes effect on the person's next request, and is recorded", async ({
    page,
    browser,
  }) => {
    const other = await browser.newContext();
    const carol = await other.newPage();
    await signIn(carol, "carol");
    expect((await carol.request.get("/ns/people-ops")).status()).toBe(404);

    await page
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: /Namespaces/ })
      .click();
    const ns = page.getByRole("region", { name: "People Ops", exact: true });
    await ns.getByLabel("Give access to").selectOption({ label: "Carol Diaz" });
    await ns.getByLabel("Level").selectOption("read");
    await ns.getByRole("button", { name: "Grant", exact: true }).click();
    await expect(ns.getByRole("listitem").filter({ hasText: "Carol Diaz" })).toContainText("Read");
    expect((await carol.request.get("/ns/people-ops")).status()).toBe(200);

    await ns
      .getByRole("listitem")
      .filter({ hasText: "Carol Diaz" })
      .getByRole("button", { name: /Remove/ })
      .click();
    await expect(ns.getByRole("listitem").filter({ hasText: "Carol Diaz" })).toHaveCount(0);
    expect((await carol.request.get("/ns/people-ops")).status()).toBe(404);
    const leaked = await carol.request.get(`/api/search?q=${CANARY}`);
    expect(
      ((await leaked.json()) as { hits: unknown[] }).hits.map((h) => JSON.stringify(h)).join(),
    ).not.toContain("people-ops");
    await other.close();

    await page
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: "Audit log" })
      .click();
    const log = page.getByRole("table");
    await expect(log.getByRole("row").filter({ hasText: "grant.set" }).first()).toContainText(
      "people-ops",
    );
    await expect(log.getByRole("row").filter({ hasText: "grant.remove" }).first()).toContainText(
      "Dana Ito",
    );
  });

  test("a provider key is stored encrypted and never comes back", async ({ page }) => {
    const key = "sk-ant-api03-e2e-secret-value-7Qx9";
    await page
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: "AI", exact: true })
      .click();
    const anthropic = page.getByRole("listitem").filter({ hasText: /^Anthropic/ });
    await expect(anthropic).toContainText("Used by desk.classify");
    await anthropic.getByLabel("Key for Anthropic").fill(key);
    await anthropic.getByRole("button", { name: "Save key" }).click();
    await expect(anthropic.getByText("Key saved. It ends in 7Qx9")).toBeVisible();
    await expect(anthropic.getByText("A key is saved")).toBeVisible();

    const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
    const [row] = await sql`select value from settings where key = 'ai'`;
    const audit =
      await sql`select action, target, metadata from audit_log where action like 'ai.key%'`;
    await sql.end();
    const stored = (row!.value as { keys: Record<string, string> }).keys.anthropic!;
    expect(stored).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain("e2e-secret-value");
    expect(JSON.stringify(audit)).not.toContain("e2e-secret-value");
    expect(audit[0]).toMatchObject({ action: "ai.key_set", target: "anthropic" });

    // Not in any page or API response, as the key or as its ciphertext.
    for (const route of ["/admin/ai", "/admin/audit", "/api/admin/audit", "/admin", "/"]) {
      const body = await (await page.request.get(route)).text();
      expect(body, route).not.toContain("e2e-secret-value");
      expect(body, route).not.toContain(stored);
    }
    await page.reload();
    await expect(page.getByLabel("New key for Anthropic")).toHaveValue("");

    await anthropic.getByRole("button", { name: "Test key" }).click();
    await expect(anthropic.getByText(/The key works/)).toBeVisible();

    page.once("dialog", (d) => void d.accept());
    await anthropic.getByRole("button", { name: "Remove the Anthropic key" }).click();
    await expect(anthropic.getByText("No key", { exact: true })).toBeVisible();
  });

  test("models and budgets are saved, and a model that is not one is refused", async ({ page }) => {
    await page
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: "AI", exact: true })
      .click();
    const form = page.getByRole("region", { name: "Models and budgets" });
    await form.getByLabel("Primary model for desk.rewrite").fill("not a model");
    await form.getByRole("button", { name: "Save models and budgets" }).click();
    await expect(form.getByText(/is not a model. Write it as provider:model/)).toBeVisible();

    await form.getByLabel("Primary model for desk.rewrite").fill("anthropic:claude-haiku-4-5");
    await form.getByLabel("Fallback model for desk.rewrite").fill("openai:a-small-model");
    await form.getByLabel("Whole organization, per month ($)").fill("200");
    await form.getByRole("button", { name: "Save models and budgets" }).click();
    await expect(form.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(form.getByLabel("Fallback model for desk.rewrite")).toHaveValue(
      "openai:a-small-model",
    );
    await expect(page.getByText(/openai:a-small-model: calls are logged/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Usage this month" })).toContainText(
      "of $200 spent",
    );
  });

  test("teams: add, add a member, pin a hub, and the vault learns the team", async ({
    page,
    browser,
  }) => {
    await page
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: "Teams" })
      .click();
    const add = page.getByRole("region", { name: "Add a team" });
    await add.getByLabel("Name").fill("Registrar");
    await add.getByLabel("Slug").fill("registrar");
    await add.getByRole("button", { name: "Add" }).click();
    const team = page.getByRole("region", { name: "Registrar", exact: true });
    await expect(team).toBeVisible();
    await team.getByLabel("Add a person to Registrar").selectOption({ label: "Carol Diaz" });
    await team.getByRole("button", { name: "Add", exact: true }).click();
    await expect(team.getByRole("listitem").filter({ hasText: "Carol Diaz" })).toBeVisible();
    await team.getByLabel("Month-end close").check();
    await team.getByRole("button", { name: "Save Registrar" }).click();
    await expect(team.getByText("Saved", { exact: true })).toBeVisible();

    const other = await browser.newContext();
    const carol = await other.newPage();
    await signIn(carol, "carol");
    await expect(
      carol
        .getByRole("region", { name: "Pinned by your team" })
        .getByRole("link", { name: "Month-end close" }),
    ).toBeVisible();
    await other.close();
    // So `kb lint` accepts the team as an owner, offline.
    await expect
      .poll(() => fileAtHead(".kb/profile.yaml"), { timeout: SLOW })
      .toContain("registrar");

    page.once("dialog", (d) => void d.accept());
    await team.getByRole("button", { name: "Delete Registrar" }).click();
    await expect(page.getByRole("region", { name: "Registrar", exact: true })).toHaveCount(0);
  });

  test("the last admin cannot be demoted", async ({ page }) => {
    const row = page.getByRole("row").filter({ hasText: "Dana Ito" });
    await row.getByLabel("Role of Dana Ito").selectOption("member");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row.getByText("There must be at least one admin")).toBeVisible();
    await page.reload();
    await expect(row.getByLabel("Role of Dana Ito")).toHaveValue("admin");
  });

  test("branding changes the name and the accent everywhere", async ({ page }) => {
    await page
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: /Branding/ })
      .click();
    await page.getByRole("textbox", { name: "Name" }).fill("Acme Handbook");
    await page.getByLabel("Accent colour").fill("#0b6e4f");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Acme Handbook" }).first()).toBeVisible();
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      ),
    ).toBe("#0b6e4f");
    await page.goto("/admin/settings");
    await page.getByLabel("Accent colour").fill("javascript:alert(1)");
    await page
      .getByLabel("Accent colour")
      .evaluate((el: HTMLInputElement) => el.removeAttribute("pattern"));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Write the colour as #rrggbb")).toBeVisible();
    await page.getByRole("textbox", { name: "Name" }).fill("");
    await page.getByLabel("Accent colour").fill("");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  });

  test("a snapshot tags the vault as it is, once", async ({ page }) => {
    await page
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: "Snapshots" })
      .click();
    await page.getByLabel("Name").fill("vault-e2e");
    await page.getByLabel("What it is for").fill("End-to-end test");
    await page.getByRole("button", { name: "Take a snapshot" }).click();
    await expect(page.getByText("Tagged vault-e2e")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Snapshots" }).getByText("vault-e2e"),
    ).toBeVisible();
    // The form goes back to its suggested name once the action has answered.
    await expect(page.getByLabel("Name")).toHaveValue(/^vault-\d{4}-\d{2}$/);
    await page.getByLabel("Name").fill("vault-e2e");
    await page.getByRole("button", { name: "Take a snapshot" }).click();
    await expect(page.getByText("The tag vault-e2e already exists")).toBeVisible();
  });

  test("the audit log can be filtered and exported, and the export is recorded", async ({
    page,
  }) => {
    await page
      .getByRole("navigation", { name: "Admin" })
      .getByRole("link", { name: "Audit log" })
      .click();
    await page.getByLabel("Action").selectOption("changeset.commit");
    await page.getByRole("button", { name: "Filter" }).click();
    const rows = page.getByRole("table").getByRole("row");
    await expect(rows.nth(1)).toContainText("changeset.commit");
    for (const row of (await rows.all()).slice(1))
      await expect(row).toContainText("changeset.commit");

    const csv = await page.request.get("/api/admin/audit?action=changeset.commit");
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toBe('"when","actor","actor_id","action","target","details"');
    expect(text).toContain('"changeset.commit"');
    await page.goto("/admin/audit?action=audit.export");
    await expect(page.getByRole("table").getByRole("row").nth(1)).toContainText("Dana Ito");
  });
});
