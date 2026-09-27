import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { REPO } from "./env.ts";
import { fileAtHead, gitLog, signIn } from "./helpers.ts";

test.describe("taxonomy", () => {
  test("is for the people who maintain the vocabulary", async ({ page }) => {
    await signIn(page, "alice");
    await expect(
      page.getByRole("navigation", { name: "Library" }).getByRole("link", { name: "Taxonomy" }),
    ).toHaveCount(0);
    expect((await page.request.get("/taxonomy")).status()).toBe(403);
    await signIn(page, "bob");
    await page
      .getByRole("navigation", { name: "Library" })
      .getByRole("link", { name: "Taxonomy" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Taxonomy" })).toBeVisible();
    const tags = page.getByRole("region", { name: "Tags" });
    await expect(tags.getByRole("row").filter({ hasText: "returning-students" })).toContainText(
      "re-enrollment",
    );
  });

  test("a term proposed by an upload waits, is mapped to an existing tag, and the note follows", async ({
    page,
  }) => {
    await signIn(page, "alice");
    await page
      .getByRole("navigation", { name: "Library" })
      .getByRole("link", { name: "Upload" })
      .click();
    await page.getByLabel(/^File/).setInputFiles(join(REPO, "fixtures/uploads/orientation.pptx"));
    await page.getByLabel(/^Namespace/).selectOption("admissions");
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.waitForURL(/\/uploads\/in_/);
    await expect(page.getByText("Done", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "See what it produced" }).click();
    await page.waitForURL(/\/changes\/cs_/);
    const change = page.url();
    await expect(page.getByText("In review", { exact: true })).toBeVisible();
    await expect(page.getByText('Introduces tag "orientation-day"')).toBeVisible();

    // Bob maintains Finance, not Admissions: the proposal is not his to see.
    await signIn(page, "bob");
    await page.goto("/taxonomy");
    await expect(page.getByText("No terms are waiting")).toBeVisible();

    await signIn(page, "dana");
    await expect(
      page.getByRole("navigation", { name: "Library" }).getByRole("link", { name: /Taxonomy/ }),
    ).toContainText("1");
    await page.goto("/taxonomy");
    const proposal = page.getByRole("listitem", { name: "tag orientation-day" });
    await expect(proposal).toContainText("The first day of orientation for new students.");
    await expect(proposal).toContainText('"Welcome new students on day one"');
    await proposal
      .getByLabel("Use an existing tag instead of orientation-day")
      .selectOption("new-students");
    await proposal.getByRole("button", { name: "Use it" }).click();
    await expect(page.getByText("No terms are waiting")).toBeVisible();

    await page.goto(change);
    // The term is settled. What is left is that AI drafted it for a namespace that reviews.
    await expect(page.getByText("In review", { exact: true })).toBeVisible();
    await expect(page.getByText("AI drafted this and admissions publishes manually")).toBeVisible();
    await expect(page.getByText('Introduces tag "orientation-day"')).toHaveCount(0);
    await page.getByRole("button", { name: "Approve and publish" }).click();
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();

    const note = fileAtHead("kb/admissions/welcome-new-students-on-day-one.md")!;
    expect(note).toMatch(/^tags: \[new-students\]$/m);
    expect(fileAtHead(".kb/tags.yaml")).toMatch(/^new-students:.*orientation-day/m);
    expect(fileAtHead(".kb/tags.yaml")).not.toMatch(/^orientation-day:/m);

    await page.goto("/admin/audit?action=taxonomy.alias");
    await expect(page.getByRole("table").getByRole("row").nth(1)).toContainText(
      "tag:orientation-day",
    );
  });

  test("a rename is one change that waits for review, and lands as one commit", async ({
    page,
  }) => {
    await signIn(page, "dana");
    await page.goto("/taxonomy");
    const row = page.getByRole("region", { name: "Tags" }).getByRole("row").filter({
      hasText: "Security controls and policies",
    });
    await row.getByLabel("New name for security").fill("Not A Slug");
    await row
      .getByLabel("New name for security")
      .evaluate((el: HTMLInputElement) => el.removeAttribute("pattern"));
    await row.getByRole("button", { name: "Rename security" }).click();
    await expect(row.getByText("Use lowercase letters, digits, and hyphens")).toBeVisible();
    await row.getByLabel("New name for security").fill("payroll");
    await row.getByRole("button", { name: "Rename security" }).click();
    await expect(row.getByText('The tag "payroll" exists. Merge them instead.')).toBeVisible();

    await row.getByLabel("New name for security").fill("security-controls");
    await row.getByRole("button", { name: "Rename security" }).click();
    await expect(row.getByText(/Sent as one change/)).toBeVisible();

    const waiting = page.getByRole("link", {
      name: 'rename tag "security" to "security-controls"',
    });
    await expect(async () => {
      await page.goto("/review");
      await expect(waiting).toBeVisible({ timeout: 1000 });
    }).toPass();
    await waiting.click();
    await page.getByRole("button", { name: "Approve and publish" }).click();
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
    expect(gitLog("%s")).toBe('kb(vault): rename tag "security" to "security-controls"');
    expect(fileAtHead(".kb/tags.yaml")).toMatch(/^security-controls:.*aliases: \[security\]/m);

    await page.goto("/taxonomy");
    await expect(
      page.getByRole("region", { name: "Tags" }).getByRole("row").filter({
        hasText: "Security controls and policies",
      }),
    ).toContainText("security-controls");
  });
});
