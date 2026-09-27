import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { indexNames, Meilisearch } from "@lore/search";
import { REPO, VAULT, WORKER_ENV } from "./env.ts";
import { signIn } from "./helpers.ts";

/** What a reader sees on a page, without what depends on the minute it was opened. */
async function reading(page: Page, path: string): Promise<string> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const text = await page.getByRole("main").innerText();
  return text
    .replace(
      /\b(just now|now|\d+ (second|minute|hour)s? ago|in \d+ (second|minute|hour)s?)\b/g,
      "<when>",
    )
    .replace(/\n{2,}/g, "\n")
    .trim();
}

test.describe("a full reindex", () => {
  // The Library is rebuilt from the repository alone. Everything a reader sees must come
  // back the same: what Postgres and the search indexes hold is a cache of the vault.
  test("from nothing reproduces the same pages and the same search results", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "dana");
    const notes = (await (await page.request.get("/api/search?q=refund&limit=30")).json()) as {
      hits: { id: string; href: string; title: string }[];
    };
    const pages = [
      "/ns/finance",
      "/ns/people-ops",
      "/themes/enrollment",
      "/systems/salesforce",
      "/types/How-To",
      "/tags",
      "/hygiene",
      ...notes.hits.slice(0, 3).map((h) => h.href),
    ];
    const before = new Map<string, string>();
    for (const path of pages) before.set(path, await reading(page, path));
    // Every search document, vectors included. Search results are compared by their best
    // match only: notes that match a query equally well come back in the order the search
    // engine happens to hold them, which a rebuild changes and Lore does not decide.
    const documents = async () => {
      const meili = new Meilisearch({
        host: WORKER_ENV.MEILI_URL!,
        apiKey: WORKER_ENV.MEILI_MASTER_KEY!,
      });
      const names = indexNames(VAULT);
      const all = [];
      for (const uid of [names.notes, names.chunks]) {
        const docs = await meili.index(uid).getDocuments({ limit: 100_000, retrieveVectors: true });
        all.push([...docs.results].sort((x, y) => String(x.id).localeCompare(String(y.id))));
      }
      return all;
    };
    const searches = ["refund policy", "enroll a returning student", "zebra-payroll-canary"];
    const found = async () =>
      Promise.all(
        searches.map(
          async (q) =>
            (
              (await (
                await page.request.get(`/api/search?q=${encodeURIComponent(q)}&limit=5`)
              ).json()) as { hits: { id: string }[] }
            ).hits[0]?.id,
        ),
      );
    const foundBefore = await found();
    expect(foundBefore.every(Boolean)).toBe(true);
    const documentsBefore = await documents();
    expect(documentsBefore[0]!.length).toBeGreaterThan(40);

    const out = execFileSync(
      process.execPath,
      [join(REPO, "apps/worker/src/cli.ts"), "reindex", "--vault", VAULT, "--all"],
      { env: { ...process.env, ...WORKER_ENV }, encoding: "utf8", stdio: "pipe" },
    );
    expect(out).toMatch(/Indexed acme-e2e: \d+ notes, \d+ written/);
    const written = Number(/(\d+) written/.exec(out)![1]);
    expect(written).toBeGreaterThan(40);

    for (const path of pages) expect(await reading(page, path), path).toBe(before.get(path));
    expect(await found()).toEqual(foundBefore);
    expect(await documents()).toEqual(documentsBefore);
  });

  test("keeps what is not in the repository: what people follow and report", async ({ page }) => {
    test.setTimeout(180_000);
    // Follows and reports live in Postgres only. A reindex clears the cache of the vault,
    // not them.
    await signIn(page, "erin");
    const target = "system:salesforce";
    expect(
      (await page.request.post("/api/follows", { data: { target, follow: true } })).status(),
    ).toBe(200);
    const [note] = (
      (await (await page.request.get("/api/search?q=campus+printer")).json()) as {
        hits: { id: string; href: string }[];
      }
    ).hits;
    const reported = await page.request.post("/api/feedback", {
      data: {
        kind: "report",
        noteId: note!.id,
        reason: "outdated",
        comment: "The printers moved.",
      },
    });
    expect(reported.status()).toBeLessThan(300);

    execFileSync(
      process.execPath,
      [join(REPO, "apps/worker/src/cli.ts"), "reindex", "--vault", VAULT, "--all"],
      { env: { ...process.env, ...WORKER_ENV }, stdio: "pipe" },
    );

    await page.goto("/notifications");
    await expect(
      page.getByRole("region", { name: "Following" }).getByRole("link", { name: "Salesforce" }),
    ).toBeVisible();
    await page.goto(note!.href);
    await expect(page.getByText(/Reported as outdated/i).first()).toBeVisible();
    await page.request.post("/api/follows", { data: { target, follow: false } });
  });
});
