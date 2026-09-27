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

  test("signing out ends the session", async ({ page }) => {
    await signIn(page, "alice");
    await page.context().clearCookies({ name: "lore_session" });
    await page.goto("/themes");
    await expect(page).toHaveURL(/\/login/);
  });
});
