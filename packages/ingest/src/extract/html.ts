import type { Element, Root } from "hast";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { firstHeading, tidy } from "./markdown.ts";
import type { Extracted } from "./types.ts";

/** Elements that carry no content a note should keep, or that would run or load something. */
const DROP = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "embed",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "svg",
  "template",
  "link",
  "meta",
]);

/**
 * Removes what should not survive conversion. Nothing is fetched: remote images are
 * dropped, because the vault must not depend on, or report to, another server.
 */
function clean() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (!parent || typeof index !== "number") return;
      const remote =
        node.tagName === "img" && /^(https?:)?\/\//i.test(String(node.properties?.src ?? ""));
      const dead =
        node.tagName === "a" &&
        /^\s*(javascript|data|vbscript):/i.test(String(node.properties?.href ?? ""));
      if (DROP.has(node.tagName) || remote) {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
      if (dead) node.properties = {};
      return undefined;
    });
  };
}

/**
 * Gives every table a header row. Word tables have none, and markdown tables need one, so
 * without this the first row of data ends up under an empty header.
 */
function promoteHeaders() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "table") return;
      let hasHeader = false;
      let first: Element | null = null;
      visit(node, "element", (el: Element) => {
        if (el.tagName === "th") hasHeader = true;
        if (el.tagName === "tr" && !first) first = el;
      });
      if (hasHeader || !first) return;
      for (const cell of (first as Element).children) {
        if (cell.type !== "element" || cell.tagName !== "td") continue;
        cell.tagName = "th";
        // A header is already emphasised; bold inside it is noise.
        visit(cell, "element", (el: Element, index, parent) => {
          if (
            (el.tagName === "strong" || el.tagName === "b") &&
            parent &&
            typeof index === "number"
          ) {
            parent.children.splice(index, 1, ...el.children);
            return [SKIP, index];
          }
          return undefined;
        });
      }
    });
  };
}

const pipeline = unified()
  .use(rehypeParse, { fragment: false })
  .use(clean)
  .use(promoteHeaders)
  .use(rehypeRemark)
  // Tables are written without padding, so a changed cell changes one line of the diff.
  .use(remarkGfm, { tablePipeAlign: false })
  .use(remarkStringify, { bullet: "-", emphasis: "_", rule: "-", fences: true });

export async function htmlToMarkdown(html: string): Promise<string> {
  return tidy(String(await pipeline.process(html)));
}

export async function extractHtml(bytes: Uint8Array): Promise<Extracted> {
  const html = new TextDecoder().decode(bytes);
  const markdown = await htmlToMarkdown(html);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || null;
  return {
    type: "html",
    markdown,
    title: firstHeading(markdown) ?? title,
    pages: null,
    images: [],
    warnings: [],
    method: "code",
  };
}
