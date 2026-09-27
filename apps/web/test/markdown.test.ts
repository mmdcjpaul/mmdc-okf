import { describe, expect, it } from "vitest";
import { outline, renderMarkdown, type RenderLink } from "@/lib/markdown";
import { pathToPage } from "@/lib/urls";

const link = (over: Partial<RenderLink>): RenderLink => ({
  href: "",
  targetPath: "",
  targetId: null,
  kind: "body",
  wanted: false,
  anchor: null,
  targetNamespace: null,
  targetSlug: null,
  ...over,
});

const LINKS: RenderLink[] = [
  link({
    href: "/finance/refund-policy.md",
    targetPath: "kb/finance/refund-policy.md",
    targetId: "kb_R",
    targetSlug: "refund-policy",
    targetNamespace: "finance",
  }),
  link({
    href: "../people-ops/payroll-calendar.md#dates",
    targetPath: "kb/people-ops/payroll-calendar.md",
    targetId: "kb_P",
    targetSlug: "payroll-calendar",
    targetNamespace: "people-ops",
    anchor: "dates",
  }),
  link({
    href: "/it-support/unlock-a-locked-account.md",
    targetPath: "kb/it-support/unlock-a-locked-account.md",
    wanted: true,
  }),
  link({ href: "/it-support/runbooks/index.md", targetPath: "kb/it-support/runbooks/index.md" }),
  link({
    href: "/finance/_assets/chart.png",
    targetPath: "kb/finance/_assets/chart.png",
    kind: "image",
  }),
];

const render = (md: string, readable = ["finance", "it-support"]) =>
  renderMarkdown(md, { bundleRoot: "kb", links: LINKS, readable: new Set(readable) });

describe("renderMarkdown", () => {
  it("never passes raw HTML or script through", async () => {
    const html = await render(
      'Hi <script>alert(1)</script> <img src=x onerror="alert(2)"> [x](javascript:alert(3))',
    );
    expect(html).not.toMatch(/<script|onerror|javascript:/i);
  });

  it("rewrites note links to stable Library URLs", async () => {
    const html = await render("See [refunds](/finance/refund-policy.md).");
    expect(html).toContain('href="/n/kb_R/refund-policy"');
  });

  it("renders links into unreadable namespaces as plain text", async () => {
    const html = await render("See [payroll](../people-ops/payroll-calendar.md#dates).");
    expect(html).not.toContain("kb_P");
    expect(html).toContain("payroll");
    expect(
      await render("See [payroll](../people-ops/payroll-calendar.md#dates).", ["people-ops"]),
    ).toContain('href="/n/kb_P/payroll-calendar#dates"');
  });

  it("marks wanted notes and maps folder indexes and assets", async () => {
    const html = await render(
      "[unlock](/it-support/unlock-a-locked-account.md) [runbooks](/it-support/runbooks/index.md) ![chart](/finance/_assets/chart.png)",
    );
    expect(html).toContain('class="link-wanted"');
    expect(html).toContain('href="/ns/it-support/runbooks"');
    expect(html).toContain('src="/assets/kb/finance/_assets/chart.png"');
  });

  it("opens external links in a new tab without an opener", async () => {
    const html = await render("[docs](https://example.com)");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("gives headings ids that match the outline", async () => {
    const md = "# Steps\n\n## Check the queue\n\n#### Deep\n\n## Check the queue\n";
    const html = await render(md);
    for (const h of outline(md)) expect(html).toContain(`id="${h.id}"`);
    expect(outline(md).map((h) => h.id)).toEqual(["steps", "check-the-queue", "check-the-queue-1"]);
  });
});

describe("pathToPage", () => {
  it("maps generated indexes to Library pages", () => {
    expect(pathToPage("kb", "kb/index.md")).toBe("/");
    expect(pathToPage("kb", "kb/platform/index.md")).toBe("/ns/platform");
    expect(pathToPage("kb", "kb/platform/runbooks/incident/index.md")).toBe(
      "/ns/platform/runbooks/incident",
    );
    expect(pathToPage("kb", "kb/_themes/index.md")).toBe("/themes");
    expect(pathToPage("kb", "kb/_meta/graph-report.md")).toBeNull();
    expect(pathToPage("kb", "README.md")).toBeNull();
  });
});
