// The global graph on the 20,000-note vault, in a real browser (plans/02-library.md, L10).
// Run by `pnpm scale:library`, or by itself against a Library that is already up:
//   BASE_URL=http://127.0.0.1:3200 SESSION="<cookie header>" node scripts/scale/graph-check.ts
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const web = join(resolve(import.meta.dirname, "../.."), "apps/web");
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export interface Result {
  step: string;
  value: string;
  limit: string;
  ok: boolean;
}

/**
 * Opens the graph in a real browser and watches the main thread. A task that holds it for
 * more than a second is a freeze: the page would not answer a click in that time.
 */
export async function checkGraph(base: string, session: string): Promise<Result[]> {
  const results: Result[] = [];
  const { chromium } = createRequire(join(web, "package.json"))(
    "@playwright/test",
  ) as typeof import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // `session` is a cookie header: `name=value; name=value`.
    await context.addCookies(
      session.split("; ").map((c) => ({
        name: c.slice(0, c.indexOf("=")),
        value: c.slice(c.indexOf("=") + 1),
        url: base,
      })),
    );
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __longest: number };
      w.__longest = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__longest = Math.max(w.__longest, e.duration);
      }).observe({ type: "longtask", buffered: true });
    });
    const started = performance.now();
    await page.goto(`${base}/graph`);
    const graph = page.getByTestId("global-graph");
    await graph.and(page.locator('[data-state="layout"], [data-state="ready"]')).waitFor({
      timeout: 60_000,
    });
    const drawn = performance.now() - started;
    const status = await graph.getByRole("status").innerText();
    const notes = Number(/of ([\d,]+) notes/.exec(status)?.[1]?.replace(/,/g, "") ?? 0);

    // While the layout runs, the page must still answer.
    const t = performance.now();
    await graph.getByLabel("Colour by").selectOption("theme");
    await graph.getByLabel("Type", { exact: true }).selectOption({ index: 1 });
    await page.waitForFunction(
      (before) => document.querySelector('[role="status"]')?.textContent !== before,
      status,
    );
    const answered = performance.now() - t;
    await graph.and(page.locator('[data-state="ready"]')).waitFor({ timeout: 60_000 });
    const settled = performance.now() - started;
    const longest = await page.evaluate(
      () => (window as unknown as { __longest: number }).__longest,
    );
    results.push(
      {
        step: "graph: notes drawn",
        value: notes.toLocaleString("en"),
        limit: "19,000 or more",
        ok: notes >= 19_000,
      },
      { step: "graph: first drawn", value: seconds(drawn), limit: "10 s", ok: drawn < 10_000 },
      {
        step: "graph: longest main-thread task",
        value: `${Math.round(longest)} ms`,
        limit: "1000 ms",
        ok: longest < 1000,
      },
      {
        step: "graph: filter answered while arranging",
        value: `${Math.round(answered)} ms`,
        limit: "1000 ms",
        ok: answered < 1000,
      },
      { step: "graph: arranged", value: seconds(settled), limit: "40 s", ok: settled < 40_000 },
    );
  } finally {
    await browser.close();
  }
  return results;
}

if (import.meta.main) {
  const out = await checkGraph(process.env.BASE_URL!, process.env.SESSION!);
  console.table(out.map((r) => ({ ...r, ok: r.ok ? "yes" : "NO" })));
  if (out.some((r) => !r.ok)) process.exitCode = 1;
}
