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
