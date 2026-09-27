/** Library URLs. Note URLs use the id so they survive renames and moves (LB-4). */

export function noteHref(n: { id: string; slug: string }, anchor?: string | null): string {
  return `/n/${encodeURIComponent(n.id)}/${encodeURIComponent(n.slug)}${anchor ? `#${anchor}` : ""}`;
}

export function folderHref(namespace: string, folder = ""): string {
  const tail = folder ? "/" + folder.split("/").map(encodeURIComponent).join("/") : "";
  return `/ns/${encodeURIComponent(namespace)}${tail}`;
}

export function termHref(kind: "theme" | "system" | "tag", slug: string): string {
  const base = kind === "theme" ? "themes" : kind === "system" ? "systems" : "tags";
  return `/${base}/${encodeURIComponent(slug)}`;
}

export function typeHref(type: string): string {
  return `/types/${encodeURIComponent(type)}`;
}

export function assetHref(path: string): string {
  return `/assets/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Maps a vault path that is not a note (a folder or a generated index) to a Library page:
 * `kb/platform/runbooks/index.md` becomes the runbooks folder, `kb/_themes/` the Themes list.
 */
export function pathToPage(bundleRoot: string, repoPath: string): string | null {
  const rel = repoPath.startsWith(bundleRoot + "/") ? repoPath.slice(bundleRoot.length + 1) : null;
  if (rel === null) return null;
  const clean = rel.replace(/(^|\/)index\.md$/, "").replace(/\/$/, "");
  if (clean === "" || clean === "log.md") return "/";
  const segs = clean.split("/");
  if (segs[0] === "_themes") return segs.length === 1 ? "/themes" : null;
  if (segs[0] === "_systems") return segs.length === 1 ? "/systems" : null;
  if (segs[0]!.startsWith("_") || segs.some((s) => s.endsWith(".md"))) return null;
  return folderHref(segs[0]!, segs.slice(1).join("/"));
}
