import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { REPO, SLOW, WORKER_ENV, WORKER_PORT } from "./env.ts";
import { fileAtHead, gitLog, noteAt, noteUrl, signIn } from "./helpers.ts";

const fixture = (name: string) => join(REPO, "fixtures/uploads", name);

/** How many calls the scripted model has received, from the worker. */
async function modelCalls(page: Page): Promise<number> {
  const res = await page.request.get(`http://127.0.0.1:${WORKER_PORT}/ai/fake`, {
    headers: { authorization: `Bearer ${WORKER_ENV.INTERNAL_API_TOKEN}` },
  });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { count: number }).count;
}

async function upload(page: Page, file: string, namespace: string, theme?: string) {
  await page
    .getByRole("navigation", { name: "Library" })
    .getByRole("link", { name: "Upload" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Upload a document" })).toBeVisible();
  await page.getByLabel(/^File/).setInputFiles(fixture(file));
  await page.getByLabel(/^Namespace/).selectOption(namespace);
  if (theme)
    await page
      .getByRole("group", { name: /^Theme/ })
      .getByText(theme, { exact: true })
      .click();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.waitForURL(/\/uploads\/in_/);
}

test.describe("upload", () => {
  test("a Word document becomes notes: drafted by AI, reviewed, published, searchable", async ({
    page,
    browser,
  }) => {
    const before = await modelCalls(page);
    await signIn(page, "bob");
    await upload(page, "deposit-refund-sop.docx", "finance");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("deposit-refund-sop.docx");
    await expect(page.getByText("Done", { exact: true })).toBeVisible();
    expect(await modelCalls(page)).toBe(before + 1);

    await page.getByRole("link", { name: "See what it produced" }).click();
    await page.waitForURL(/\/changes\/cs_/);
    const changeUrl = page.url();
    await expect(page.getByText("In review", { exact: true })).toBeVisible();
    await expect(page.getByText("AI drafted this and finance publishes manually")).toBeVisible();
    await expect(page.getByRole("region", { name: "What the AI did" })).toContainText(
      "became one How-To",
    );
    await expect(page.getByText(/Skipped "The 30-day refund window"/)).toBeVisible();
    await expect(
      page.getByRole("article", { name: "Refund a tuition deposit to a withdrawn applicant" }),
    ).toContainText("Find the deposit in NetSuite by student ID.");
    await expect(
      page.getByRole("article", { name: "Refund a tuition deposit", exact: true }),
    ).toContainText("Source Document");
    // Bob maintains finance, but it is his own upload: someone else decides.
    await expect(page.getByRole("region", { name: "Your review" })).toHaveCount(0);
    expect(
      fileAtHead("kb/finance/refund-a-tuition-deposit-to-a-withdrawn-applicant.md"),
    ).toBeNull();

    const reviewer = await browser.newContext();
    const dana = await reviewer.newPage();
    await signIn(dana, "dana");
    await dana.goto(changeUrl);
    await dana.getByRole("button", { name: "Approve and publish" }).click();
    await expect(dana.getByText("Published", { exact: true }).first()).toBeVisible();
    await reviewer.close();

    const message = gitLog("%B");
    expect(message).toContain("Source: library-upload");
    expect(message).toContain("Co-authored-by: Bob Chan <bob@acme.test>");
    const text = fileAtHead("kb/finance/refund-a-tuition-deposit-to-a-withdrawn-applicant.md")!;
    expect(text).toContain("generated: { by: lore-ingest/claude-sonnet-5,");
    expect(text).toMatch(/- \{ by: human:dana, at: /);

    // Searchable, and linked to the document it came from.
    await expect(async () => {
      await page.goto("/search?q=refund+tuition+deposit+withdrawn");
      await expect(
        page.getByRole("region", { name: "Results" }).getByRole("listitem").first(),
      ).toContainText("Refund a tuition deposit to a withdrawn applicant", { timeout: 1000 });
    }).toPass({ timeout: SLOW });
    const note = await noteAt("kb/finance/refund-a-tuition-deposit-to-a-withdrawn-applicant.md");
    await page.goto(noteUrl(note));
    const sources = page.getByRole("region", { name: /Sources/ });
    await sources.getByRole("link", { name: "Refund a tuition deposit" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Refund a tuition deposit" }),
    ).toBeVisible();
    await expect(page.locator("article")).toContainText("Source Document");
    await expect(page.locator("article")).toContainText("Deposits are refundable for 30 days");
  });

  test("a PDF is read by the model; in a namespace that publishes automatically it goes straight out", async ({
    page,
  }) => {
    const before = await modelCalls(page);
    await signIn(page, "dana");
    await upload(page, "leave-request.pdf", "it-support");
    await expect(page.getByText("Done", { exact: true })).toBeVisible();
    // One call to read the PDF, one to plan the notes.
    expect(await modelCalls(page)).toBe(before + 2);
    await expect
      .poll(() => fileAtHead("kb/it-support/request-leave-in-the-hr-portal.md"), {
        timeout: SLOW,
      })
      .toContain("type: How-To");
    // Nobody has verified it: it is published as unverified.
    expect(fileAtHead("kb/it-support/request-leave-in-the-hr-portal.md")).not.toContain(
      "verified:",
    );
    await expect(async () => {
      await page.goto(noteUrl(await noteAt("kb/it-support/request-leave-in-the-hr-portal.md")));
      await expect(page.locator("article").getByText("Unverified")).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: SLOW });
  });

  test("with AI processing off, the upload becomes a draft for a person to finish, and no model is called", async ({
    page,
  }) => {
    const before = await modelCalls(page);
    await signIn(page, "dana");
    await page.goto("/upload");
    await page.getByLabel(/^File/).setInputFiles(fixture("leave-request.pdf"));
    await page.getByLabel(/^Namespace/).selectOption("people-ops");
    await expect(page.getByText(/AI processing is turned off for People Ops/)).toBeVisible();
    // Nothing will choose a theme, so the person has to.
    await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
    await page
      .getByRole("group", { name: /^Theme/ })
      .getByText("Onboarding", { exact: true })
      .click();
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.waitForURL(/\/uploads\/in_/);
    await expect(page.getByText("Done", { exact: true })).toBeVisible();
    expect(await modelCalls(page)).toBe(before);

    await expect
      .poll(() => fileAtHead("kb/people-ops/leave-request-procedure-draft.md"), { timeout: SLOW })
      .toContain("status: draft");
    await expect(async () => {
      await page.goto(noteUrl(await noteAt("kb/people-ops/leave-request-procedure-draft.md")));
      await expect(page.getByText("Draft", { exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: SLOW });
    await expect(page.locator("article")).toContainText(
      "Open the HR portal and choose Request leave",
    );
    // The person finishes it in the editor, like any note.
    await expect(page.getByRole("link", { name: "Edit", exact: true })).toBeVisible();
  });

  test("a reader's upload waits until a writer chooses Process now", async ({ page, browser }) => {
    await signIn(page, "carol");
    await upload(page, "month-end-notes.md", "finance");
    await expect(page.getByText("Waiting in the queue")).toBeVisible();
    await expect(page.getByText("A writer in the namespace will process it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Process now" })).toHaveCount(0);
    const id = page.url().split("/").pop()!;
    expect((await page.request.post(`/api/ingest/${id}`)).status()).toBe(403);

    const writer = await browser.newContext();
    const bob = await writer.newPage();
    await signIn(bob, "bob");
    await bob.goto("/uploads");
    await bob
      .getByRole("region", { name: "Waiting for a writer" })
      .getByRole("link", { name: /month-end-notes.md/ })
      .click();
    await bob.getByRole("button", { name: "Process now" }).click();
    await expect(bob.getByText("Done", { exact: true })).toBeVisible();
    await writer.close();
  });

  test("the same file uploaded again is flagged", async ({ page }) => {
    await signIn(page, "bob");
    await upload(page, "deposit-refund-sop.docx", "finance");
    await expect(page.getByText("This file was uploaded before")).toBeVisible();
  });

  test("files are judged by what they are, and people only upload where they can read", async ({
    page,
  }) => {
    await signIn(page, "carol");
    const send = (name: string, bytes: Buffer, namespace = "finance") =>
      page.request.post("/api/ingest", {
        multipart: {
          namespace,
          process: "now",
          file: { name, mimeType: "application/octet-stream", buffer: bytes },
        },
      });
    const refused = async (res: Awaited<ReturnType<typeof send>>, status: number, why: RegExp) => {
      expect(res.status()).toBe(status);
      expect(((await res.json()) as { error: string }).error).toMatch(why);
    };
    const { readFileSync } = await import("node:fs");
    await refused(await send("run.exe", Buffer.from("MZ")), 400, /\.exe files are not accepted/);
    await refused(
      await send("report.pdf", readFileSync(fixture("deposit-refund-sop.docx"))),
      400,
      /named like a \.pdf file/,
    );
    await refused(
      await send("x.svg", Buffer.from("<svg><script>1</script></svg>")),
      400,
      /\.svg files are not accepted/,
    );
    await refused(
      await send("notes.md", Buffer.from("# Notes\n\nSome text.\n"), "people-ops"),
      404,
      /No such namespace/,
    );
    const theme = await page.request.post("/api/ingest", {
      multipart: {
        namespace: "finance",
        theme: "made-up-theme",
        file: {
          name: "notes.md",
          mimeType: "text/markdown",
          buffer: Buffer.from("# Notes\n\nText.\n"),
        },
      },
    });
    await refused(theme, 400, /There is no theme "made-up-theme"/);
  });
});

test.describe("capture", () => {
  test("rough notes and a screenshot become a changeset", async ({ page }) => {
    await signIn(page, "bob");
    await page
      .getByRole("navigation", { name: "Library" })
      .getByRole("link", { name: "Capture" })
      .click();
    await expect(page.getByRole("button", { name: "Save the capture" })).toBeDisabled();
    await page
      .getByLabel("What do you want to record?")
      .fill("month end: cut off vendor bills day 1, then accruals. bank rec on day 2");
    await page.getByLabel("Add screenshots").setInputFiles(fixture("whiteboard.png"));
    await expect(page.getByRole("img", { name: "whiteboard.png" })).toBeVisible();
    await page.getByLabel(/^Namespace/).selectOption("finance");
    await page.getByRole("button", { name: "Save the capture" }).click();
    await page.waitForURL(/\/uploads\/in_/);
    await expect(page.getByText("Done", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "See what it produced" }).click();
    await expect(page.getByText(/From a capture/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Changes" })).toContainText("capture-1.png");
  });
});
