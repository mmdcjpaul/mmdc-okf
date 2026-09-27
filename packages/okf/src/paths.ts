import { posix } from "node:path";

/** File names OKF reserves in every folder. They are generated, not written. */
export const RESERVED_FILES = new Set(["index.md", "log.md"]);

/** The last segment of a repository path. */
export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/** A repository path without its last segment. */
export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** True for paths ending in `.md`. */
export function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

/** True for `index.md` and `log.md` in any folder. */
export function isReserved(path: string): boolean {
  return RESERVED_FILES.has(basename(path));
}

/** `kb/admissions/x.md` → `/admissions/x.md`. */
export function toBundlePath(root: string, repoPath: string): string {
  const prefix = root ? root + "/" : "";
  return "/" + (repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath);
}

/** `/admissions/x.md` → `kb/admissions/x.md`. */
export function fromBundlePath(root: string, bundlePath: string): string {
  const rel = bundlePath.replace(/^\/+/, "");
  return root ? `${root}/${rel}` : rel;
}

/** Accepts a repository path, a bundle path, or a path relative to the bundle root. */
export function normalizeNotePath(root: string, input: string): string {
  const clean = input.replace(/\\/g, "/").replace(/^\.\//, "");
  if (clean.startsWith("/")) return fromBundlePath(root, clean);
  if (root && clean.startsWith(root + "/")) return clean;
  return fromBundlePath(root, clean);
}

/** The path segments below the bundle root. */
export function bundleSegments(root: string, repoPath: string): string[] {
  return toBundlePath(root, repoPath).slice(1).split("/");
}

/** The namespace a note belongs to (its top-level folder), or null for root files and managed folders. */
export function namespaceOf(root: string, repoPath: string): string | null {
  const segs = bundleSegments(root, repoPath);
  if (segs.length < 2) return null;
  const top = segs[0]!;
  return top.startsWith("_") ? null : top;
}

/** Managed folders hold generated or shared files that are not ordinary notes. */
export function isManagedPath(root: string, repoPath: string): boolean {
  return bundleSegments(root, repoPath).some((s) => s === "_meta" || s === "_assets");
}

/** `theme` or `system` for files in `_themes/` or `_systems/`, null for anything else. */
export function hubKindOf(root: string, repoPath: string): "theme" | "system" | null {
  const segs = bundleSegments(root, repoPath);
  if (segs.length !== 2 || isReserved(repoPath)) return null;
  if (segs[0] === "_themes") return "theme";
  if (segs[0] === "_systems") return "system";
  return null;
}

/** Repository path of the hub note for a theme or system. */
export function hubPath(root: string, kind: "theme" | "system", slug: string): string {
  return fromBundlePath(root, `/${kind === "theme" ? "_themes" : "_systems"}/${slug}.md`);
}

/** A note's slug: its file name without `.md`. */
export function slugOf(path: string): string {
  return basename(path).replace(/\.md$/i, "");
}

/** Kebab-case file name from a title. */
export function slugify(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || "note"
  );
}

/** Resolves `..` and `.` segments in a repository path. */
export function normalizePath(path: string): string {
  const out = posix.normalize(path);
  return out === "." ? "" : out.replace(/^\.\//, "");
}

/** The href to write in `from` for a link to `to`, in the given link style. */
export function makeHref(
  root: string,
  from: string,
  to: string,
  style: "absolute" | "relative",
  anchor?: string,
): string {
  let href: string;
  if (style === "absolute") href = toBundlePath(root, to);
  else {
    href = posix.relative(dirname(from) || ".", to);
    if (!href.startsWith(".")) href = "./" + href;
  }
  href = href.replace(/ /g, "%20");
  return anchor ? `${href}#${anchor}` : href;
}

/** Stable, locale-independent comparison for generated listings. */
export function compareText(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}
