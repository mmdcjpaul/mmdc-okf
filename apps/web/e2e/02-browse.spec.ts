import { expect, test } from "@playwright/test";
import { noteAt, noteUrl, signIn } from "./helpers.ts";

test.describe("browse", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "alice");
  });

  test("Home shows the search box, process changes, recent updates, and pinned hubs", async ({
    page,
  }) => {
    await expect(page.getByRole("searchbox", { name: "Search the Library" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recently updated" })).toBeVisible();
    const pinned = page.getByRole("region", { name: "Pinned by your team" });
    await expect(pinned.getByRole("link", { name: "Enrollment" })).toBeVisible();
    await expect(pinned.getByRole("link", { name: "Salesforce" })).toBeVisible();
  });

  for (const [name, path, heading] of [
    ["Themes", "/themes", "Themes"],
    ["Systems", "/systems", "Systems"],
    ["Types", "/types", "Types"],
    ["Tags", "/tags", "Tags"],
  ] as const) {
    test(`the sidebar opens ${name}`, async ({ page }) => {
      await page.getByRole("navigation", { name: "Library" }).getByRole("link", { name }).click();
      await expect(page).toHaveURL(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    });
  }

  test("a namespace lists its notes and folders", async ({ page }) => {
    await page
      .getByRole("navigation", { name: "Library" })
      .getByRole("link", { name: /Admissions/ })
      .click();
    await expect(page).toHaveURL("/ns/admissions");
    await expect(
      page.getByRole("link", { name: /Enroll a returning student in Salesforce/ }).first(),
    ).toBeVisible();
  });

  test("a collection switches between table and cards", async ({ page }) => {
    await page.goto("/types/Runbook");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Runbook");
    await expect(page.getByRole("table")).toBeVisible();
    await page.getByRole("link", { name: "Cards" }).click();
    await expect(page).toHaveURL(/view=cards/);
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("a note page shows its header, links, and history, and links lead to other notes", async ({
    page,
  }) => {
    const note = await noteAt("kb/admissions/enroll-a-returning-student-in-salesforce.md");
    await page.goto(noteUrl(note));
    await expect(page.getByRole("heading", { level: 1, name: note.title })).toBeVisible();
    const panel = page.getByRole("complementary", { name: "About this note" });
    await expect(panel.getByRole("heading", { name: /Backlinks/ })).toBeVisible();
    await expect(panel.getByRole("heading", { name: /History/ })).toBeVisible();

    const firstLink = page.locator("article a[href^='/n/']").first();
    const target = await firstLink.getAttribute("href");
    await firstLink.click();
    await expect(page).toHaveURL(new RegExp(target!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a stale slug redirects to the current URL", async ({ page }) => {
    const note = await noteAt("kb/finance/refund-policy.md");
    await page.goto(`/n/${note.id}/an-old-name`);
    await expect(page).toHaveURL(noteUrl(note));
    await page.goto(`/n/${note.id}`);
    await expect(page).toHaveURL(noteUrl(note));
  });

  test("a hub page shows its introduction, members by type, and graph", async ({ page }) => {
    await page.goto("/themes/enrollment");
    await expect(page.getByRole("heading", { level: 1, name: "Enrollment" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /How-To/ }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Enroll a returning student in Salesforce/ }).first(),
    ).toBeVisible();
  });

  test("banners mark draft, deprecated, and stale notes", async ({ page }) => {
    await page.goto(noteUrl(await noteAt("kb/admissions/manage-the-course-waitlist.md")));
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    await page.goto(noteUrl(await noteAt("kb/admissions/submit-a-paper-enrollment-form.md")));
    await expect(page.getByText("Deprecated", { exact: true })).toBeVisible();
    await expect(page.getByText("Due for review", { exact: true })).toBeVisible();
  });

  test("a link to a note that does not exist yet renders as a wanted note", async ({ page }) => {
    await page.goto(noteUrl(await noteAt("kb/it-support/reset-a-staff-password.md")));
    const wanted = page.locator("article .link-wanted").first();
    await expect(wanted).toBeVisible();
    await expect(wanted).toHaveAttribute("title", /Wanted note/);
  });

  test("history opens the change a commit made", async ({ page }) => {
    const note = await noteAt("kb/finance/refund-policy.md");
    await page.goto(noteUrl(note));
    await page
      .getByRole("complementary", { name: "About this note" })
      .getByRole("link", { name: /Import vault/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/n/${note.id}/history/[0-9a-f]{40}`));
    await expect(page.getByRole("table", { name: "Changes in this commit" })).toBeVisible();
    await expect(page.getByText(/lines? added/)).toBeVisible();
  });
});
