import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { DATABASE_URL } from "./env.ts";
import { CANARY, signIn } from "./helpers.ts";

test.describe("following", () => {
  test("follow a note and a hub, see them under Following, and stop", async ({ page }) => {
    await signIn(page, "carol");
    await page.goto("/search?q=refund+policy");
    await page.getByRole("link", { name: "Refund policy" }).first().click();
    const follow = page.getByRole("button", { name: "Follow this note" });
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    await follow.click();
    await expect(follow).toHaveAttribute("aria-pressed", "true");
    await expect(follow).toHaveText("Following");

    await page.goto("/themes/month-end-close");
    await page.getByRole("button", { name: "Follow Month-end close" }).click();
    await expect(page.getByRole("button", { name: "Follow Month-end close" })).toHaveText(
      "Following",
    );

    await page.goto("/notifications");
    const following = page.getByRole("region", { name: "Following" });
    await expect(following.getByRole("link", { name: "Refund policy" })).toBeVisible();
    await expect(following.getByRole("link", { name: "Month-end close" })).toBeVisible();
    await following.getByRole("button", { name: "Follow Refund policy" }).click();
    await expect(following.getByRole("link", { name: "Refund policy" })).toHaveCount(0);
    await following.getByRole("button", { name: "Follow Month-end close" }).click();
    await expect(following.getByText("Choose Follow on a note")).toBeVisible();
  });

  test("a note you cannot read cannot be followed", async ({ page }) => {
    await signIn(page, "dana");
    const hidden = await page.request.get(`/api/search?q=${CANARY}`);
    const id = ((await hidden.json()) as { hits: { id: string }[] }).hits[0]!.id;
    await signIn(page, "carol");
    const res = await page.request.post("/api/follows", { data: { target: id, follow: true } });
    expect(res.status()).toBe(404);
    const bad = await page.request.post("/api/follows", {
      data: { target: "theme:../../x", follow: true },
    });
    expect(bad.status()).toBe(400);
    const none = await page.request.post("/api/follows", {
      data: { target: "theme:no-such-theme", follow: true },
    });
    expect(none.status()).toBe(404);
  });

  test("email preferences are saved", async ({ page }) => {
    await signIn(page, "erin");
    await page.goto("/notifications");
    const email = page.getByRole("group", { name: "Email to erin@acme.test" });
    await expect(email.getByLabel(/Weekly digest/)).toBeChecked();
    await email.getByLabel(/Weekly digest/).uncheck();
    await expect(email.getByText("Saved")).toBeVisible();
    await page.reload();
    await expect(email.getByLabel(/Weekly digest/)).not.toBeChecked();
    await expect(email.getByLabel(/Notifications/)).toBeChecked();
    const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
    const rows =
      await sql`select email_digest, email_notifications from user_prefs where user_id = 'erin'`;
    await sql.end();
    expect(rows[0]).toMatchObject({ email_digest: false, email_notifications: true });
    await email.getByLabel(/Weekly digest/).check();
    await expect(email.getByText("Saved")).toBeVisible();
  });
});

test.describe("hygiene", () => {
  test("lists notes worst health first, with what is wrong", async ({ page }) => {
    await signIn(page, "bob");
    await page
      .getByRole("navigation", { name: "Library" })
      .getByRole("link", { name: "Hygiene" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Hygiene" })).toBeVisible();
    const table = page
      .getByRole("region", { name: "Notes that need attention" })
      .getByRole("table");
    const scores = (await table.locator("tbody tr td:first-child").allInnerTexts()).map(Number);
    expect(scores.length).toBeGreaterThan(2);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));

    await page.getByRole("link", { name: /^Review due/ }).click();
    await expect(
      table.getByRole("row").filter({ hasText: "Approve vendor invoices" }),
    ).toContainText("Review due");
    await page.getByRole("link", { name: "Owned by my teams" }).click();
    await expect(page).toHaveURL(/mine=1/);
    for (const row of (await table.getByRole("row").all()).slice(1))
      await expect(row).toContainText("finance-systems");
  });

  test("shows nothing from a namespace the person cannot read", async ({ page }) => {
    await signIn(page, "carol");
    await page.goto("/hygiene");
    await expect(page.getByRole("region", { name: "Health by namespace" })).not.toContainText(
      "People Ops",
    );
    const forced = await page.request.get("/hygiene?ns=people-ops");
    expect(await forced.text()).not.toContain("Payroll");
    await signIn(page, "erin");
    await page.goto("/hygiene");
    await expect(page.getByRole("region", { name: "Health by namespace" })).toContainText(
      "People Ops",
    );
  });
});
