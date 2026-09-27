import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { noteAt, noteUrl, signIn } from "./helpers.ts";

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    // The local graph is a WebGL canvas; its notes are also listed as links beside it.
    .exclude("canvas")
    .analyze();
  const summary = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

test.describe("accessibility (WCAG 2.2 AA)", () => {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme });

      test("sign-in", async ({ page }) => {
        await page.goto("/login");
        await expectNoViolations(page);
      });

      test("Home", async ({ page }) => {
        await signIn(page, "alice");
        await expectNoViolations(page);
      });

      test("search results", async ({ page }) => {
        await signIn(page, "alice");
        await page.goto("/search?q=enroll");
        await expect(page.getByRole("region", { name: "Results" })).toBeVisible();
        await expectNoViolations(page);
      });

      test("a note page with banners", async ({ page }) => {
        await signIn(page, "alice");
        await page.goto(noteUrl(await noteAt("kb/admissions/submit-a-paper-enrollment-form.md")));
        await expectNoViolations(page);
      });

      test("a hub page", async ({ page }) => {
        await signIn(page, "alice");
        await page.goto("/themes/enrollment");
        await expectNoViolations(page);
      });

      test("the editor", async ({ page }) => {
        await signIn(page, "alice");
        const note = await noteAt("kb/admissions/enroll-a-returning-student-in-salesforce.md");
        await page.goto(`/edit/${note.id}`);
        await expect(page.getByRole("textbox", { name: "Note body" })).toBeVisible();
        await page.locator("summary", { hasText: "Details" }).click();
        await expect(
          page.getByRole("tabpanel", { name: "Preview" }).locator(".note-body"),
        ).toBeVisible();
        await expectNoViolations(page);
      });

      test("a new note", async ({ page }) => {
        await signIn(page, "carol");
        await page.goto("/new");
        await expect(page.getByRole("textbox", { name: "Note body" })).toBeVisible();
        await expectNoViolations(page);
      });

      test("My changes, Review, Notifications, Upload, Capture, and Uploads", async ({ page }) => {
        await signIn(page, "alice");
        for (const path of [
          "/changes",
          "/review",
          "/notifications",
          "/upload",
          "/capture",
          "/uploads",
        ]) {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expectNoViolations(page);
        }
      });

      test("Graph", async ({ page }) => {
        await signIn(page, "bob");
        await page.goto("/graph");
        await expect(page.getByTestId("global-graph")).toHaveAttribute("data-state", "ready", {
          timeout: 30_000,
        });
        await expectNoViolations(page);
      });

      test("Taxonomy", async ({ page }) => {
        await signIn(page, "bob");
        await page.goto("/taxonomy");
        await expect(page.getByRole("heading", { level: 1, name: "Taxonomy" })).toBeVisible();
        await page.locator("summary", { hasText: "Merge tags" }).click();
        await expectNoViolations(page);
      });

      test("Hygiene and notifications", async ({ page }) => {
        await signIn(page, "bob");
        for (const path of ["/hygiene", "/hygiene?problem=stale&mine=1", "/notifications"]) {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expectNoViolations(page);
        }
      });

      test("Admin", async ({ page }) => {
        await signIn(page, "dana");
        for (const path of [
          "/admin",
          "/admin/teams",
          "/admin/namespaces",
          "/admin/ai",
          "/admin/settings",
          "/admin/audit",
          "/admin/snapshots",
        ]) {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();
          await expectNoViolations(page);
        }
      });

      test("a change in note history", async ({ page }) => {
        await signIn(page, "alice");
        const note = await noteAt("kb/finance/refund-policy.md");
        await page.goto(noteUrl(note));
        await page
          .getByRole("complementary", { name: "About this note" })
          .getByRole("link")
          .filter({ hasText: /Import vault/ })
          .click();
        await expect(page.getByRole("table")).toBeVisible();
        await expectNoViolations(page);
      });
    });
  }
});

test.describe("reading on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("a note reads without sideways scrolling, and the menu works", async ({ page }) => {
    await signIn(page, "alice");
    await page.goto(
      noteUrl(await noteAt("kb/admissions/enroll-a-returning-student-in-salesforce.md")),
    );
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const body = page.locator("article p").first();
    const size = await body.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(15);

    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("dialog", { name: "Navigation" })
      .getByRole("link", { name: "Themes" })
      .click();
    await expect(page).toHaveURL("/themes");
    await expectNoViolations(page);
  });
});
