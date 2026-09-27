import "server-only";
import { posix } from "node:path";
import { linkTargets, readableAssets, type ReadScope } from "@lore/db";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { db } from "./db";
import { renderMarkdown, type RenderLink } from "./markdown";

const parser = unified().use(remarkParse).use(remarkGfm);
const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");

export interface PreviewInput {
  bundleRoot: string;
  /** Repository path of the note being edited; relative links resolve from its folder. */
  notePath: string;
  body: string;
  scope: ReadScope;
  /** Paths of images pasted in this editing session, which are not in the vault yet. */
  pendingAssets?: string[];
}

/** Repository path and anchor of a link written in a note. Null for anything outside the vault. */
export function resolveHref(
  bundleRoot: string,
  notePath: string,
  href: string,
): { path: string; anchor: string | null } | null {
  const hash = href.indexOf("#");
  const raw = decodeURIComponent(hash >= 0 ? href.slice(0, hash) : href);
  const anchor = hash >= 0 ? href.slice(hash + 1) || null : null;
  if (!raw) return null;
  const path = raw.startsWith("/")
    ? posix.normalize(bundleRoot + raw)
    : posix.normalize(posix.join(posix.dirname(notePath), raw));
  if (path !== bundleRoot && !path.startsWith(bundleRoot + "/")) return null;
  return { path, anchor };
}

/**
 * Renders text that is not in the vault yet, with the same renderer and the same rules as a
 * note page: sanitized, links into unreadable namespaces as plain text, missing notes shown
 * as wanted.
 */
export async function renderPreview(input: PreviewInput): Promise<string> {
  const { bundleRoot, notePath, body, scope } = input;
  const hrefs = new Map<string, { path: string; anchor: string | null; image: boolean }>();
  visit(parser.parse(body), (node) => {
    if (node.type !== "link" && node.type !== "image" && node.type !== "definition") return;
    const href = (node as { url: string }).url;
    if (!href || href.startsWith("#") || isExternal(href) || hrefs.has(href)) return;
    const resolved = resolveHref(bundleRoot, notePath, href);
    if (resolved)
      hrefs.set(href, {
        ...resolved,
        image: node.type === "image" || resolved.path.includes("/_assets/"),
      });
  });

  const paths = [...new Set([...hrefs.values()].map((h) => h.path))];
  const [targets, assets] = await Promise.all([
    linkTargets(
      db(),
      scope.vaultId,
      paths.filter((p) => p.endsWith(".md")),
    ),
    readableAssets(
      db(),
      scope,
      paths.filter((p) => p.includes("/_assets/")),
    ),
  ]);
  const byPath = new Map(targets.map((t) => [t.path, t]));
  const present = new Set([...assets, ...(input.pendingAssets ?? [])]);

  const links: RenderLink[] = [...hrefs].map(([href, h]) => {
    const target = byPath.get(h.path);
    const isNote = h.path.endsWith(".md") && !/(^|\/)(index|log)\.md$/.test(h.path);
    return {
      href,
      targetPath: h.path,
      targetId: target?.id ?? null,
      kind: h.image ? "image" : "body",
      wanted: h.image ? !present.has(h.path) : isNote && !target,
      anchor: h.anchor,
      targetNamespace: target?.namespace ?? null,
      targetSlug: target?.slug ?? null,
    };
  });
  return renderMarkdown(body, { bundleRoot, links, readable: new Set(scope.namespaces) });
}
