import { expect, test } from "@playwright/test";
import { CANARY, gitLog, signIn } from "./helpers.ts";

test.describe("the Gardener", () => {
  test("is run from Hygiene, reports what it found, and proposes without publishing", async ({
    page,
  }) => {
    const before = gitLog("%H");
    await signIn(page, "dana");
    await page.goto("/hygiene");
    const gardener = page.getByRole("region", { name: "Gardener" });
    await gardener.getByLabel("Run it now for").selectOption({ label: "The whole vault" });
    await gardener.getByRole("button", { name: "Run the Gardener" }).click();
    await expect(gardener.getByText(/^Last run .* for the whole vault/)).toBeVisible({
      timeout: 30_000,
    });
    // Earlier specs edit the notes of the near-duplicate pair, so that finding is checked in
    // the worker's own tests, against the fixture as it is.
    await expect(gardener.getByRole("link", { name: "Set up a campus printer" })).toBeVisible();
    await expect(gardener.getByText("/it-support/unlock-a-locked-account.md")).toBeVisible();

    const proposals = gardener.getByRole("list", { name: "Proposals" });
    const made = await proposals.getByRole("listitem").count();
    expect(made).toBeGreaterThanOrEqual(2);
    await expect(proposals.getByText("waiting for review")).toHaveCount(made, { timeout: 20_000 });
    expect(gitLog("%H")).toBe(before);

    await proposals.getByRole("link", { name: 'add "Unlock a locked account"' }).click();
    await expect(page.getByText("In review", { exact: true })).toBeVisible();
    await expect(
      page.getByText("The Gardener proposed this. It publishes nothing by itself"),
    ).toBeVisible();
    await expect(page.getByText(/which does not exist. This adds it as a draft/)).toBeVisible();
    await page.getByLabel("Comment").fill("The link is a mistake; it will be removed.");
    await page.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("Not published", { exact: true }).first()).toBeVisible();
    expect(gitLog("%H")).toBe(before);
  });

  test("shows each reader only what they can read, and lets maintainers run their own namespace", async ({
    page,
  }) => {
    await signIn(page, "erin");
    await page.goto("/hygiene");
    const gardener = page.getByRole("region", { name: "Gardener" });
    await expect(gardener.getByText(/^Last run/)).toBeVisible();
    // Erin maintains nothing, so there is nothing to run.
    await expect(gardener.getByRole("button", { name: "Run the Gardener" })).toHaveCount(0);
    // And she approves nothing in those namespaces, so the proposals are not hers to open.
    await expect(gardener.getByRole("list", { name: "Proposals" })).toHaveCount(0);

    await signIn(page, "bob");
    await page.goto("/hygiene");
    const options = page
      .getByRole("region", { name: "Gardener" })
      .getByLabel("Run it now for")
      .getByRole("option");
    await expect(options).toHaveText(["Finance"]);
  });
});

test.describe("the graph", () => {
  test("draws the notes the reader can see, with filters and a list to read", async ({ page }) => {
    await signIn(page, "carol");
    await page
      .getByRole("navigation", { name: "Library" })
      .getByRole("link", { name: "Graph" })
      .click();
    const graph = page.getByTestId("global-graph");
    await expect(graph).toHaveAttribute("data-state", /layout|ready/);
    await expect(graph.getByRole("status")).toContainText(/^\d+ of \d+ notes, \d+ links/);
    await expect(graph).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(graph.locator("canvas").first()).toBeVisible();

    await expect(graph.getByRole("list", { name: "Colours" })).toContainText("Admissions");
    await expect(graph.getByRole("list", { name: "Colours" })).not.toContainText("People Ops");
    const total = await graph.getByRole("status").innerText();
    await graph.getByLabel("Namespace", { exact: true }).selectOption("finance");
    await expect(graph.getByRole("status")).not.toHaveText(total);
    await graph.getByLabel("Colour by").selectOption("theme");
    await expect(graph.getByRole("list", { name: "Colours" })).toContainText("Enrollment");

    const linked = graph.getByRole("region", { name: "Most linked notes" });
    await expect(linked.getByRole("listitem").first()).toContainText(/\d+ links/);
    await linked.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/n\/kb_/);
  });

  test("the data never includes a namespace the reader cannot read", async ({ page }) => {
    await signIn(page, "carol");
    const res = await page.request.get("/api/graph");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("people-ops");
    expect(body).not.toContain("Payroll calendar");
    expect(body).not.toContain(CANARY);
    const data = JSON.parse(body) as { nodes: unknown[][]; edges: number[][] };
    expect(data.nodes.length).toBeGreaterThan(20);
    for (const [s, t] of data.edges) {
      expect(s).toBeLessThan(data.nodes.length);
      expect(t).toBeLessThan(data.nodes.length);
    }

    await signIn(page, "erin");
    const more = (await (await page.request.get("/api/graph")).json()) as { nodes: unknown[][] };
    expect(more.nodes.length).toBeGreaterThan(data.nodes.length);
    expect(JSON.stringify(more)).toContain("people-ops");
  });

  test("signed out, the data asks for sign-in", async ({ request }) => {
    expect((await request.get("/api/graph")).status()).toBe(401);
  });
});

test.describe("features", () => {
  test("an admin switches Capture and the graph off, and they are gone for everyone", async ({
    page,
    browser,
  }) => {
    await signIn(page, "dana");
    await page.goto("/admin/settings");
    await page.getByLabel(/^Capture/).uncheck();
    await page.getByLabel(/^Graph view/).uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    const other = await browser.newContext();
    const alice = await other.newPage();
    await signIn(alice, "alice");
    const nav = alice.getByRole("navigation", { name: "Library" });
    await expect(nav.getByRole("link", { name: "Capture" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Graph" })).toHaveCount(0);
    expect((await alice.request.get("/capture")).status()).toBe(404);
    expect((await alice.request.get("/graph")).status()).toBe(404);
    expect((await alice.request.get("/api/graph")).status()).toBe(404);

    await page.getByLabel(/^Capture/).check();
    await page.getByLabel(/^Graph view/).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await alice.reload();
    await expect(nav.getByRole("link", { name: "Capture" })).toBeVisible();
    await other.close();
  });
});
