import { expect, test } from "@playwright/test";
import {
  appendToBody,
  bodyText,
  fileAtHead,
  filesInLastCommit,
  gitLog,
  noteAt,
  noteUrl,
  replaceBody,
  signIn,
} from "./helpers.ts";

const WAITLIST = "kb/finance/approve-vendor-invoices.md";
const ORIENTATION = "kb/admissions/run-new-student-orientation.md";

test.describe("the editor", () => {
  test("a writer edits a note: one commit, credited, and the page shows it at once", async ({
    page,
  }) => {
    const path = "kb/admissions/transcript-evaluation-policy.md";
    const before = fileAtHead(path)!;
    const version = /^version: (\d+)\.(\d+)\.(\d+)$/m.exec(before)!;
    await signIn(page, "alice");
    const note = await noteAt(path);
    await page.goto(noteUrl(note));
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Edit note" })).toBeVisible();

    await appendToBody(page, "\nTranscripts older than ten years need the registrar's sign-off.\n");
    // Fix is preselected for a small change; the writer says when it is more than that.
    await expect(page.getByRole("radio", { name: /^Fix/ })).toBeChecked();
    await page.getByRole("radio", { name: /^Addition/ }).check();
    await expect(page.getByRole("tabpanel", { name: "Preview" })).toContainText(
      "older than ten years",
    );
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL(noteUrl(note));
    await expect(page.locator("article")).toContainText("older than ten years");
    await expect(page.locator("article")).toContainText(
      `v${version[1]}.${Number(version[2]) + 1}.0`,
    );

    expect(gitLog("%B")).toBe(
      [
        `kb(admissions): update "${note.title}"`,
        "",
        "Change-Class: addition",
        expect.stringMatching(/^Changeset: cs_[0-9A-Z]{26}$/),
        "Source: library-editor",
        "Co-authored-by: Alice Reyes <alice@acme.test>",
      ]
        .map((l) => (typeof l === "string" ? l : gitLog("%B").split("\n")[3]))
        .join("\n"),
    );
    expect(gitLog("%B").split("\n")[3]).toMatch(/^Changeset: cs_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(filesInLastCommit()).toEqual([path]);
    // Every byte the writer did not touch is as it was.
    const after = fileAtHead(path)!;
    expect(after.replace(/^version: .*$/m, "").replace(/^generated: .*$/m, "")).toContain(
      before
        .replace(/^version: .*$/m, "")
        .replace(/^generated: .*$/m, "")
        .trimEnd(),
    );
  });

  test("the form changes frontmatter, and only offers terms that exist", async ({ page }) => {
    const path = "kb/admissions/clean-up-duplicate-contacts.md";
    await signIn(page, "alice");
    const note = await noteAt(path);
    await page.goto(`/edit/${note.id}`);
    await page.getByLabel("Description").fill("Find and merge contacts that are the same person.");
    await page.locator("summary", { hasText: "Details" }).click();
    const systems = page.getByRole("group", { name: /Systems/ });
    await expect(systems.getByRole("checkbox", { name: "SIS" })).not.toBeChecked();
    await systems.getByText("SIS", { exact: true }).click();
    await expect(page.getByRole("textbox", { name: /theme/i })).toHaveCount(0);
    await page.getByRole("radio", { name: /^Fix/ }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(noteUrl(note));

    const text = fileAtHead(path)!;
    expect(text).toContain("description: Find and merge contacts that are the same person.");
    expect(text).toMatch(/^systems: \[.*sis.*\]$/m);
    expect(gitLog("%B")).toContain("Change-Class: fix");
  });

  test("[[ searches the vault and inserts a standard link", async ({ page }) => {
    await signIn(page, "alice");
    const note = await noteAt(ORIENTATION);
    await page.goto(`/edit/${note.id}`);
    await appendToBody(page, "\nSee also ");
    await page.keyboard.type("[[refund pol");
    await page.getByRole("option", { name: /Refund policy/ }).click();
    const text = await bodyText(page);
    expect(text).toContain("See also [Refund policy](/finance/refund-policy.md)");
    expect(text).not.toContain("[[");
    // The preview resolves it to the note's page.
    await expect(
      page.getByRole("tabpanel", { name: "Preview" }).getByRole("link", { name: "Refund policy" }),
    ).toHaveAttribute("href", /^\/n\/kb_/);
  });

  test("a pasted image is saved beside the note and shown on its page", async ({ page }) => {
    const path = "kb/admissions/admissions-application-review.md";
    await signIn(page, "alice");
    const note = await noteAt(path);
    await page.goto(`/edit/${note.id}`);
    const editor = page.getByRole("textbox", { name: "Note body" });
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ArrowRight");
    // Paste a 1x1 PNG from the clipboard, as a screenshot would arrive.
    await editor.evaluate((el) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        ),
        (c) => c.charCodeAt(0),
      );
      const data = new DataTransfer();
      data.items.add(new File([bytes], "Review board.png", { type: "image/png" }));
      el.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await expect
      .poll(() => bodyText(page))
      .toMatch(
        /!\[Review board\]\(\/admissions\/_assets\/admissions-application-review-\d{14}\.png\)/,
      );
    // The preview shows it before it is in the vault.
    const preview = page
      .getByRole("tabpanel", { name: "Preview" })
      .getByRole("img", { name: "Review board" });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("src", /^blob:/);

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(noteUrl(note));
    const img = page.locator("article").getByRole("img", { name: "Review board" });
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
      .toBe(1);
    const files = filesInLastCommit();
    expect(files).toHaveLength(2);
    expect(files.find((f) => f.includes("/_assets/"))).toMatch(
      /^kb\/admissions\/_assets\/admissions-application-review-\d{14}\.png$/,
    );
  });

  test("something that is not an image cannot be pasted as one", async ({ page }) => {
    await signIn(page, "alice");
    const note = await noteAt(ORIENTATION);
    await page.goto(`/edit/${note.id}`);
    const editor = page.getByRole("textbox", { name: "Note body" });
    await editor.click();
    await editor.evaluate((el) => {
      const data = new DataTransfer();
      data.items.add(
        new File(
          ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
          "x.svg",
          {
            type: "image/svg+xml",
          },
        ),
      );
      el.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await expect(
      page.getByRole("alert").filter({ hasText: /Only PNG, JPEG, GIF, and WebP/ }),
    ).toBeVisible();
    expect(await bodyText(page)).not.toContain("_assets");
    // And the server refuses it too, whatever the browser sends.
    const forged = await page.request.post("/api/changesets", {
      data: {
        kind: "edit",
        noteId: note.id,
        baseSha: "0".repeat(40),
        body: "x",
        changeClass: "fix",
        images: [
          { name: "x.png", data: Buffer.from("<svg><script>1</script></svg>").toString("base64") },
        ],
      },
    });
    expect(forged.status()).toBe(400);
    expect(((await forged.json()) as { error: string }).error).toMatch(/is not a PNG/);
  });

  test("a note that does not validate is not saved, and says why", async ({ page }) => {
    await signIn(page, "alice");
    const note = await noteAt(ORIENTATION);
    const head = gitLog("%H");
    await page.goto(`/edit/${note.id}`);
    await appendToBody(
      page,
      "\nConnect with postgres://admin:hunter2secret@db.internal.example:5432/app\n",
    );
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/to fix before this can be saved/)).toBeVisible();
    await expect(page.getByText(/Possible secret/)).toBeVisible();
    await expect(page).toHaveURL(`/edit/${note.id}`);
    expect(gitLog("%H")).toBe(head);
  });

  test("a new note starts from its type's template", async ({ page }) => {
    await signIn(page, "alice");
    await page.getByRole("link", { name: "New note" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New note" })).toBeVisible();
    await page.getByLabel("Title").fill("Defer an enrollment to a later term");
    await page.getByLabel("Description").fill("Move an accepted student's start to a later term.");
    await page.getByLabel("Namespace").selectOption("admissions");
    await page
      .getByRole("group", { name: /Themes/ })
      .getByText("Enrollment", { exact: true })
      .click();
    await replaceBody(
      page,
      "# Steps\n\n1. Open the enrollment.\n2. Change the term.\n\n# Related\n\n- [Enrollment](/_themes/enrollment.md)\n",
    );
    // Similar notes come from search, so a writer sees what exists before adding to it.
    await page.getByRole("tab", { name: /Similar notes/ }).click();
    await expect(page.getByRole("tabpanel", { name: /Similar notes/ })).toContainText(/Enroll/);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL(/\/n\/kb_[0-9A-Z]{26}\/defer-an-enrollment-to-a-later-term$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Defer an enrollment to a later term",
    );
    const text = fileAtHead("kb/admissions/defer-an-enrollment-to-a-later-term.md")!;
    expect(text).toMatch(/^id: kb_[0-9A-HJKMNP-TV-Z]{26}$/m);
    expect(text).toContain("version: 1.0.0");
    expect(text).toContain("generated: { by: human:alice,");
    expect(gitLog("%s")).toBe('kb(admissions): add "Defer an enrollment to a later term"');
  });
});

test.describe("suggestions and review", () => {
  test("a reader suggests, a writer approves, and the commit credits both", async ({
    page,
    browser,
  }) => {
    const path = "kb/admissions/how-enrollment-statuses-work.md";
    const note = await noteAt(path);
    const head = gitLog("%H");

    await signIn(page, "carol");
    await page.goto(noteUrl(note));
    await expect(page.getByRole("button", { name: "Mark verified" })).toHaveCount(0);
    await page.getByRole("link", { name: "Suggest an edit" }).click();
    await appendToBody(page, "\nA withdrawn student keeps their ID.\n");
    // AU-3: a suggestion says why.
    await expect(page.getByRole("button", { name: "Send suggestion" })).toBeDisabled();
    await page.getByLabel(/Why are you suggesting this/).fill("The registrar confirmed it.");
    await page.getByRole("button", { name: "Send suggestion" }).click();
    await expect(page.getByRole("heading", { name: "Suggestion sent" })).toBeVisible();
    await expect(page.getByText("The submitter cannot write to admissions")).toBeVisible();
    expect(gitLog("%H")).toBe(head);

    // Carol cannot approve her own suggestion, and the API agrees.
    await page.getByRole("link", { name: "See the change" }).click();
    await page.waitForURL(/\/changes\/cs_/);
    await expect(page.getByRole("region", { name: "Your review" })).toHaveCount(0);
    const id = page.url().split("/").pop()!;
    const own = await page.request.post(`/api/changesets/${id}/review`, {
      data: { decision: "approve" },
    });
    expect(own.status()).toBe(403);

    const reviewer = await browser.newContext();
    const alice = await reviewer.newPage();
    await signIn(alice, "alice");
    await alice
      .getByRole("navigation", { name: "Library" })
      .getByRole("link", { name: /Review/ })
      .click();
    await alice.getByRole("link", { name: new RegExp(note.title) }).click();
    await expect(alice.getByText("The registrar confirmed it.")).toBeVisible();
    await expect(alice.getByRole("table", { name: /Changes to/ })).toContainText(
      "A withdrawn student keeps their ID.",
    );
    await alice.getByRole("button", { name: "Approve and publish" }).click();
    await expect(alice.getByText("Published", { exact: true }).first()).toBeVisible();

    const message = gitLog("%B");
    expect(message).toContain("Source: library-suggestion");
    expect(message).toContain("Co-authored-by: Carol Diaz <carol@acme.test>");
    expect(message).toContain("Co-authored-by: Alice Reyes <alice@acme.test>");
    // Approval counts as the reviewer's verification.
    expect(fileAtHead(path)).toMatch(/by: human:alice, at: /);
    await alice.goto(noteUrl(note));
    await expect(alice.locator("article")).toContainText("A withdrawn student keeps their ID.");
    await reviewer.close();

    // Carol is told.
    await page.goto("/notifications");
    await expect(page.getByText(`Published: update "${note.title}"`)).toBeVisible();
  });

  test("a reviewer can ask for changes, and the writer sends it again", async ({
    page,
    browser,
  }) => {
    const path = "kb/admissions/use-the-student-id-as-the-primary-key.md";
    const note = await noteAt(path);
    await signIn(page, "carol");
    await page.goto(`/edit/${note.id}`);
    await appendToBody(page, "\nThe ID never chnages.\n");
    await page.getByLabel(/Why are you suggesting this/).fill("Worth saying.");
    await page.getByRole("button", { name: "Send suggestion" }).click();
    await page.getByRole("link", { name: "See the change" }).click();
    await page.waitForURL(/\/changes\/cs_/);
    const changeUrl = page.url();

    const reviewer = await browser.newContext();
    const alice = await reviewer.newPage();
    await signIn(alice, "alice");
    await alice.goto(changeUrl);
    await expect(alice.getByRole("button", { name: "Request changes" })).toBeDisabled();
    await alice.getByLabel("Comment").fill("There is a typo in the new sentence.");
    await alice.getByRole("button", { name: "Request changes" }).click();
    await expect(alice.getByText("Changes requested", { exact: true })).toBeVisible();
    await reviewer.close();

    await page.goto("/changes");
    await page
      .getByRole("region", { name: "Waiting for you" })
      .getByRole("link", { name: new RegExp(note.title) })
      .click();
    await expect(page.getByText("There is a typo in the new sentence.")).toBeVisible();
    await page.getByRole("link", { name: "Open it in the editor" }).click();
    await expect.poll(() => bodyText(page)).toContain("The ID never chnages.");
    await replaceBody(page, (await bodyText(page)).replace("chnages", "changes"));
    await page.getByRole("button", { name: "Send suggestion" }).click();
    await expect(page.getByRole("heading", { name: "Suggestion sent" })).toBeVisible();
  });

  test("only maintainers approve a change to a Request Type", async ({ page, browser }) => {
    const path = "kb/finance/request-types/request-access-to-netsuite.md";
    const note = await noteAt(path);
    // Dana is an admin, and even her edit of a Request Type is reviewed.
    await signIn(page, "dana");
    await page.goto(`/edit/${note.id}`);
    await appendToBody(page, "\nAccess is reviewed every quarter.\n");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Sent for review" })).toBeVisible();
    await expect(page.getByText(/which agents and the Desk act on/)).toBeVisible();
    await page.getByRole("link", { name: "See the change" }).click();
    await page.waitForURL(/\/changes\/cs_/);
    const changeUrl = page.url();
    const id = changeUrl.split("/").pop()!;

    // Alice writes in admissions and reads finance: she cannot see or decide this one.
    const other = await browser.newContext();
    const alice = await other.newPage();
    await signIn(alice, "alice");
    expect((await alice.request.get(changeUrl)).status()).toBe(404);
    const refused = await alice.request.post(`/api/changesets/${id}/review`, {
      data: { decision: "approve" },
    });
    expect([403, 404]).toContain(refused.status());
    await other.close();

    // Bob maintains finance.
    const maintainer = await browser.newContext();
    const bob = await maintainer.newPage();
    await signIn(bob, "bob");
    await bob.goto(changeUrl);
    await expect(bob.getByText("This one needs a maintainer.")).toBeVisible();
    await bob.getByRole("button", { name: "Approve and publish" }).click();
    await expect(bob.getByText("Published", { exact: true }).first()).toBeVisible();
    await maintainer.close();
    expect(fileAtHead(path)).toContain("Access is reviewed every quarter.");
  });
});

test.describe("two people, one note", () => {
  test("the second save shows a merge view instead of overwriting", async ({ page, browser }) => {
    const note = await noteAt(WAITLIST);
    await signIn(page, "bob");
    await page.goto(`/edit/${note.id}`);
    await expect(page.getByRole("textbox", { name: "Note body" })).toBeVisible();

    // While Bob has the editor open, Dana saves a change to the same note.
    const second = await browser.newContext();
    const dana = await second.newPage();
    await signIn(dana, "dana");
    await dana.goto(`/edit/${note.id}`);
    const original = await bodyText(dana);
    const firstLine = original.split("\n").find((l) => /^\d+\. /.test(l))!;
    await replaceBody(dana, original.replace(firstLine, `${firstLine} Dana's wording.`));
    await dana.getByRole("button", { name: "Save" }).click();
    await expect(dana).toHaveURL(noteUrl(note));
    await second.close();

    // Bob changes the same line and adds a paragraph elsewhere.
    await replaceBody(
      page,
      original.replace(firstLine, `${firstLine} Bob's wording.`) + "\nBob's new paragraph.\n",
    );
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("Someone else changed this note while you were editing"),
    ).toBeVisible();
    expect(fileAtHead(WAITLIST)).not.toContain("Bob's");

    await page.getByRole("link", { name: "Combine the two versions" }).click();
    await page.waitForURL(/\/changes\/cs_/);
    await expect(page.getByText("Needs merging")).toBeVisible();
    await page.getByRole("link", { name: "Combine the two versions" }).click();
    await page.waitForURL(/\/edit\//);
    await expect(page.getByText(/1 place needs your decision/)).toBeVisible();
    const merged = await bodyText(page);
    expect(merged).toContain("<<<<<<< your version");
    expect(merged).toContain("Bob's wording.");
    expect(merged).toContain("Dana's wording.");
    expect(merged).toContain("Bob's new paragraph."); // what did not overlap merged by itself
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(page.getByText(/Resolve the merge conflict/)).toBeVisible();

    const resolved = merged
      .split("\n")
      .filter((l) => !/^(<{7}|={7}|>{7})/.test(l) && !l.includes("Dana's wording."))
      .join("\n")
      .replace("Bob's wording.", "Bob and Dana's wording.");
    await replaceBody(page, resolved);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(noteUrl(note));
    const text = fileAtHead(WAITLIST)!;
    expect(text).toContain("Bob and Dana's wording.");
    expect(text).toContain("Bob's new paragraph.");
    expect(text).not.toContain("<<<<<<<");
  });
});

test.describe("a process change", () => {
  test("bumps the major version, writes the log, shows the badge, and flags linking notes", async ({
    page,
  }) => {
    const path = "kb/admissions/enroll-a-new-student.md";
    const before = /^version: (\d+)\./m.exec(fileAtHead(path)!)!;
    const note = await noteAt(path);
    await signIn(page, "alice");
    await page.goto(`/edit/${note.id}`);
    await appendToBody(page, "\nCheck the waitlist before creating the enrollment.\n");
    await page.getByRole("radio", { name: /Process change/ }).check();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.getByLabel(/What changed/).fill("The waitlist is checked first.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(noteUrl(note));

    await expect(page.locator("article")).toContainText(`v${Number(before[1]) + 1}.0.0`);
    await expect(page.getByText("Process changed recently")).toBeVisible();
    expect(fileAtHead("kb/admissions/log.md")).toContain(
      `to ${Number(before[1]) + 1}.0.0 by human:alice. The waitlist is checked first.`,
    );
    expect(filesInLastCommit().sort()).toEqual([path, "kb/admissions/log.md"]);

    // A note that links to it is flagged for its writers.
    const linking = await noteAt("kb/admissions/enroll-a-returning-student-in-salesforce.md");
    await expect(async () => {
      await page.goto(noteUrl(linking));
      await expect(page.getByText("A process this note links to changed")).toBeVisible({
        timeout: 1000,
      });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: note.title }).first()).toBeVisible();

    // And the owning team is told.
    await page.goto("/notifications");
    await expect(page.getByText(`Process changed: ${note.title}`)).toBeVisible();
  });
});

test.describe("note actions", () => {
  test("renaming rewrites links in the same commit and keeps the address", async ({ page }) => {
    const path = "kb/admissions/merge-duplicate-student-records.md";
    const note = await noteAt(path);
    await signIn(page, "alice");
    await page.goto(noteUrl(note));
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Move or rename" }).click();
    const dialog = page.getByRole("dialog", { name: "Move or rename" });
    await dialog.getByLabel("File name").fill("Merge duplicate students");
    await dialog.getByRole("button", { name: "Move" }).click();
    await expect(page).toHaveURL(`/n/${note.id}/merge-duplicate-students`);

    expect(fileAtHead(path)).toBeNull();
    expect(fileAtHead("kb/admissions/merge-duplicate-students.md")).toContain(`id: ${note.id}`);
    expect(gitLog("%s")).toBe(`kb(admissions): move "${note.title}"`);
    for (const file of filesInLastCommit().filter((f) => !f.includes("merge-duplicate")))
      expect(fileAtHead(file)).not.toContain("merge-duplicate-student-records.md");
    // The old address still works.
    await page.goto(noteUrl(note));
    await expect(page).toHaveURL(`/n/${note.id}/merge-duplicate-students`);
  });

  test("Mark verified records who checked the note, without a version bump", async ({ page }) => {
    const path = "kb/finance/accrue-unbilled-revenue.md";
    const version = /^version: (.*)$/m.exec(fileAtHead(path)!)![1];
    await signIn(page, "bob");
    await page.goto(noteUrl(await noteAt(path)));
    await page.getByRole("button", { name: "Mark verified" }).click();
    await expect.poll(() => fileAtHead(path), { timeout: 30_000 }).toMatch(/by: human:bob, at: /);
    await expect(page.locator("article").getByText("Verified", { exact: true })).toBeVisible();
    const text = fileAtHead(path)!;
    expect(text).toMatch(/by: human:bob, at: /);
    expect(text).toContain(`version: ${version}`);
    expect(text).toMatch(/^stale_after: /m);
  });

  test("deleting a note is reviewed by a maintainer first", async ({ page }) => {
    const path = "kb/admissions/check-an-applications-status.md";
    await signIn(page, "alice");
    await page.goto(noteUrl(await noteAt(path)));
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("dialog").getByLabel(/Why/).fill("Replaced by the status codes note.");
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/Sent for review: This change deletes/)).toBeVisible();
    expect(fileAtHead(path)).not.toBeNull();
  });
});
