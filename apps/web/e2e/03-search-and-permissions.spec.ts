import { expect, test } from "@playwright/test";
import { CANARY, noteAt, noteUrl, signIn, type Person } from "./helpers.ts";

const CAN_READ_PEOPLE_OPS: Record<Person, boolean> = {
  alice: false,
  bob: false,
  carol: false,
  dana: true,
  erin: true,
};

test.describe("search", () => {
  test("full search finds a note, narrows by facet, and hides deprecated notes", async ({
    page,
  }) => {
    await signIn(page, "alice");
    await page.getByRole("searchbox", { name: "Search the Library" }).fill("returning student");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=returning\+student/);
    const results = page.getByRole("region", { name: "Results" });
    await expect(results.getByRole("listitem").first()).toContainText(
      "Enroll a returning student in Salesforce",
    );

    await page
      .getByRole("complementary", { name: "Filters" })
      .getByRole("link", { name: /How-To/ })
      .click();
    await expect(page).toHaveURL(/type=How-To/);
    for (const item of await results.getByRole("listitem").all())
      await expect(item).toContainText("How-To");

    await page.goto("/search?q=paper+enrollment+form");
    await expect(results).not.toContainText("Submit a paper enrollment form");
    await page.getByRole("link", { name: "Show deprecated notes" }).click();
    await expect(results).toContainText("Submit a paper enrollment form");
  });

  test("Cmd-K finds a note and opens it", async ({ page }) => {
    await signIn(page, "alice");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Search the Library" });
    await dialog.getByRole("combobox").fill("refund policy");
    await dialog
      .getByRole("option", { name: /Refund policy/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Refund policy" })).toBeVisible();
  });
});

test.describe("leak canary", () => {
  for (const who of Object.keys(CAN_READ_PEOPLE_OPS) as Person[]) {
    const allowed = CAN_READ_PEOPLE_OPS[who];

    test(`${who} ${allowed ? "finds" : "cannot find"} restricted content`, async ({ page }) => {
      await signIn(page, who);
      const payroll = await noteAt("kb/people-ops/payroll-calendar.md");

      // The Cmd-K endpoint.
      const api = await page.request.get(`/api/search?q=${CANARY}`);
      expect(api.status()).toBe(200);
      const hits = ((await api.json()) as { hits: { id: string }[] }).hits;
      expect(hits.some((h) => h.id === payroll.id)).toBe(allowed);
      const broad = await page.request.get("/api/search?q=payroll&limit=30");
      const namespaces = ((await broad.json()) as { hits: { namespace: string }[] }).hits.map(
        (h) => h.namespace,
      );
      expect(namespaces.includes("people-ops")).toBe(allowed);

      // The results page.
      await page.goto(`/search?q=${CANARY}`);
      const results = page.getByRole("region", { name: "Results" });
      // Hybrid search always returns its nearest notes, so the list is never empty. What
      // matters is that nothing from the restricted namespace is in it.
      await expect(results.getByRole("listitem").first()).toBeVisible();
      if (allowed) await expect(results).toContainText("Payroll calendar");
      else {
        await expect(results).not.toContainText("Payroll calendar");
        await expect(results).not.toContainText("people-ops");
      }

      // The note itself, its history, and the namespace: 404, never 403.
      const direct = await page.request.get(noteUrl(payroll));
      expect(direct.status()).toBe(allowed ? 200 : 404);
      const sql = await page.request.get(`/n/${payroll.id}/history/${"0".repeat(40)}`);
      expect(sql.status()).toBe(404);
      const ns = await page.request.get("/ns/people-ops");
      expect(ns.status()).toBe(allowed ? 200 : 404);
      if (!allowed) expect(await direct.text()).not.toContain(CANARY);

      // The sidebar.
      await page.goto("/");
      const peopleOps = page
        .getByRole("navigation", { name: "Library" })
        .getByRole("link", { name: /People Ops/ });
      await expect(peopleOps).toHaveCount(allowed ? 1 : 0);
    });
  }

  test("backlinks, hubs, and rendered links never name restricted notes for carol", async ({
    page,
  }) => {
    await signIn(page, "carol");
    // A people-ops note links to this one.
    await page.goto(noteUrl(await noteAt("kb/it-support/set-up-a-new-hire-laptop.md")));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Onboard a new employee");

    await page.goto("/themes/onboarding");
    await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Onboard a new employee");
    await expect(page.locator("a[href*='people-ops']")).toHaveCount(0);

    const hub = await noteAt("kb/_themes/onboarding.md");
    const history = await page.request.get(`/n/${hub.id}`);
    expect(await history.text()).not.toContain("people-ops/");
  });

  test("the same pages do name them for erin", async ({ page }) => {
    await signIn(page, "erin");
    await page.goto("/themes/onboarding");
    await expect(page.getByRole("link", { name: /Onboard a new employee/ }).first()).toBeVisible();
  });
});
