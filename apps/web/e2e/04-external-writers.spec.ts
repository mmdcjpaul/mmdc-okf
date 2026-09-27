import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { noteAt, noteUrl, pushFromOutside, signIn } from "./helpers.ts";

test.describe("pushes from outside Lore", () => {
  test("renaming a note keeps its URL working", async ({ page }) => {
    const before = await noteAt("kb/it-support/troubleshoot-single-sign-on.md");
    pushFromOutside("Rename the SSO note", (dir) => {
      renameSync(
        join(dir, "kb/it-support/troubleshoot-single-sign-on.md"),
        join(dir, "kb/it-support/troubleshoot-sso.md"),
      );
    });
    await signIn(page, "alice");
    await page.goto(noteUrl(before));
    await expect(page).toHaveURL(`/n/${before.id}/troubleshoot-sso`);
    await expect(page.getByRole("heading", { level: 1, name: before.title })).toBeVisible();
    const panel = page.getByRole("complementary", { name: "About this note" });
    await expect(panel.getByRole("link", { name: "Rename the SSO note" })).toBeVisible();
    await expect(panel).toContainText("External Editor");
  });

  test("an edit appears with its diff, and script in a note never runs", async ({ page }) => {
    const path = "kb/it-support/it-support-hours-and-contacts.md";
    pushFromOutside("Add weekend hours", (dir) => {
      const file = join(dir, path);
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(/^version: (\d+)\.(\d+)\.(\d+)$/m, (_m, a, b) => {
          return `version: ${a}.${+b + 1}.0`;
        }) +
          "\n## Weekend hours\n\nSaturday 9 to 12.\n\n" +
          "<script>window.__pwned = true</script>\n\n" +
          '<img src="x" onerror="window.__pwned = true">\n\n' +
          "[a link](javascript:window.__pwned=true)\n",
      );
    });
    await signIn(page, "alice");
    const note = await noteAt(path);
    await page.goto(noteUrl(note));
    await expect(page.getByRole("heading", { name: "Weekend hours" })).toBeVisible();
    expect(await page.evaluate(() => (window as { __pwned?: boolean }).__pwned)).toBeUndefined();
    await expect(page.locator("article script")).toHaveCount(0);
    await expect(page.locator("article a[href^='javascript']")).toHaveCount(0);

    await page
      .getByRole("complementary", { name: "About this note" })
      .getByRole("link", { name: "Add weekend hours" })
      .click();
    const diff = page.getByRole("table", { name: "Changes in this commit" });
    await expect(diff).toContainText("Saturday 9 to 12.");
    await expect(diff).toContainText("unchanged line");
    expect(await page.evaluate(() => (window as { __pwned?: boolean }).__pwned)).toBeUndefined();
  });

  test("a major version bump shows as a recent process change", async ({ page }) => {
    const path = "kb/finance/reconcile-bank-accounts.md";
    pushFromOutside("Reconcile weekly instead of monthly", (dir) => {
      const file = join(dir, path);
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(
          /^version: (\d+)\.\d+\.\d+$/m,
          (_m, a) => `version: ${+a + 1}.0.0`,
        ) + "\nReconcile every Friday.\n",
      );
    });
    await signIn(page, "bob");
    await page.goto(noteUrl(await noteAt(path)));
    await expect(page.getByText("Process changed recently")).toBeVisible();
    await page.goto("/");
    await expect(
      page
        .getByRole("region", { name: "Process changes in the last 30 days" })
        .getByRole("link", { name: /Reconcile bank accounts/ }),
    ).toBeVisible();
  });

  test("an image added from outside is served to readers only", async ({ page, browser }) => {
    // A 1x1 PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    pushFromOutside("Add the payroll chart", (dir) => {
      mkdirSync(join(dir, "kb/people-ops/_assets"), { recursive: true });
      writeFileSync(join(dir, "kb/people-ops/_assets/payroll-chart.png"), png);
      const file = join(dir, "kb/people-ops/payroll-calendar.md");
      writeFileSync(
        file,
        readFileSync(file, "utf8") + "\n![Payroll chart](/people-ops/_assets/payroll-chart.png)\n",
      );
    });
    const asset = "/assets/kb/people-ops/_assets/payroll-chart.png";

    await signIn(page, "erin");
    await page.goto(noteUrl(await noteAt("kb/people-ops/payroll-calendar.md")));
    const img = page.getByRole("img", { name: "Payroll chart" });
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
      .toBe(1);

    const redirect = await page.request.get(asset, { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    const signed = redirect.headers().location!;
    expect(signed).toContain("X-Amz-Signature");

    const carol = await browser.newContext();
    const carolPage = await carol.newPage();
    await signIn(carolPage, "carol");
    expect((await carolPage.request.get(asset, { maxRedirects: 0 })).status()).toBe(404);
    await carol.close();
  });
});
