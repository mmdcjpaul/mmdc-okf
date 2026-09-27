/**
 * Renders a note body to sanitized HTML with links rewritten to Library URLs (L5).
 *
 * Raw HTML in notes is dropped by remark-rehype and everything is passed through
 * rehype-sanitize, so an injected `<script>` or `javascript:` link never reaches the page.
 */
import GithubSlugger from "github-slugger";
import type { Element, ElementContent, Root } from "hast";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { assetHref, noteHref, pathToPage } from "./urls";

/** One link from `note_links`, joined with its target note. */
export interface RenderLink {
  href: string;
  targetPath: string;
  targetId: string | null;
  kind: "body" | "image" | "supersedes";
  wanted: boolean;
  anchor: string | null;
  targetNamespace: string | null;
  targetSlug: string | null;
}

export interface RenderOptions {
  bundleRoot: string;
  links: RenderLink[];
  /** Namespaces the reader can see. Links into others render as plain text. */
  readable: Set<string>;
}

const SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  // Heading ids come from rehype-slug and in-note anchors must match them.
  clobberPrefix: "",
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "className", "title", "target", "rel"],
    span: [...(defaultSchema.attributes?.span ?? []), "className", "title"],
    img: [...(defaultSchema.attributes?.img ?? []), "loading", "decoding"],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

function textOf(node: Element): string {
  let out = "";
  visit(node, "text", (t: { value: string }) => {
    out += t.value;
  });
  return out;
}

function toSpan(node: Element, className: string, title: string): void {
  node.tagName = "span";
  node.properties = { className: [className], title };
}

function rewriteLinks(opts: RenderOptions) {
  const byHref = new Map<string, RenderLink>();
  for (const l of opts.links) if (!byHref.has(l.href)) byHref.set(l.href, l);

  return () => (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName === "a") {
        const href = String(node.properties?.href ?? "");
        if (!href || href.startsWith("#")) return;
        if (isExternal(href)) {
          node.properties = {
            ...node.properties,
            target: "_blank",
            rel: ["noopener", "noreferrer"],
          };
          return;
        }
        const link = byHref.get(href);
        if (!link) {
          toSpan(node, "link-missing", "This link points outside the vault");
          return;
        }
        if (link.wanted) {
          toSpan(node, "link-wanted", "Wanted note: not written yet");
          return;
        }
        if (link.targetId && link.targetSlug) {
          if (link.targetNamespace !== null && !opts.readable.has(link.targetNamespace)) {
            node.tagName = "span";
            node.properties = {};
            return;
          }
          node.properties = {
            ...node.properties,
            href: noteHref({ id: link.targetId, slug: link.targetSlug }, link.anchor),
          };
          return;
        }
        const page = pathToPage(opts.bundleRoot, link.targetPath);
        if (page) node.properties = { ...node.properties, href: page };
        else if (link.targetPath.includes("/_assets/"))
          node.properties = { ...node.properties, href: assetHref(link.targetPath) };
        else toSpan(node, "link-missing", "No Library page for this link");
        return;
      }
      if (node.tagName === "img") {
        const src = String(node.properties?.src ?? "");
        if (isExternal(src)) return;
        const link = byHref.get(src);
        if (link && !link.wanted) {
          node.properties = {
            ...node.properties,
            src: assetHref(link.targetPath),
            loading: "lazy",
            decoding: "async",
          };
        } else if (parent && typeof index === "number") {
          const alt = String(node.properties?.alt ?? "image");
          const replacement: ElementContent = {
            type: "element",
            tagName: "span",
            properties: { className: ["link-missing"], title: "Missing image" },
            children: [{ type: "text", value: `[${alt}]` }],
          };
          parent.children[index] = replacement;
        }
      }
      if (node.tagName === "table" && parent && typeof index === "number") {
        // Wide tables scroll inside the reading column instead of the page.
        parent.children[index] = {
          type: "element",
          tagName: "div",
          properties: { className: ["table-wrap"] },
          children: [node],
        };
      }
    });
    // Links with no text (for example images that were removed) get their target as text.
    visit(tree, "element", (node: Element) => {
      if (node.tagName === "a" && textOf(node).trim() === "" && node.children.length === 0) {
        node.children = [{ type: "text", value: String(node.properties?.href ?? "") }];
      }
    });
  };
}

/**
 * Moves body headings one level down. OKF notes start their sections at `#`, and the page
 * already has an h1 (the note title), so rendering them as written gives several h1s.
 */
function demoteHeadings() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const m = /^h([1-6])$/.exec(node.tagName);
      if (m) node.tagName = `h${Math.min(6, Number(m[1]) + 1)}`;
    });
  };
}

export async function renderMarkdown(body: string, opts: RenderOptions): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(demoteHeadings)
    .use(rewriteLinks(opts))
    .use(rehypeSanitize, SCHEMA)
    .use(rehypeStringify)
    .process(body);
  return String(file);
}

/** Headings for the note's outline, with the same ids rehype-slug gives them. */
export function outline(body: string): { depth: number; text: string; id: string }[] {
  const slugger = new GithubSlugger();
  const out: { depth: number; text: string; id: string }[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2]!.replace(/[`*_]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    // Slug every heading so duplicate counters match rehype-slug; list only H1 to H3.
    const id = slugger.slug(text);
    if (m[1]!.length <= 3) out.push({ depth: m[1]!.length, text, id });
  }
  return out;
}
