/** Helpers the editor shares with its tests. No DOM, no React. */

/** The href to write in a note at `fromPath` for a link to `toPath`, in the vault's link style. */
export function linkHref(
  bundleRoot: string,
  fromPath: string,
  toPath: string,
  style: "absolute" | "relative",
): string {
  const strip = (p: string) => (p.startsWith(bundleRoot + "/") ? p.slice(bundleRoot.length) : p);
  if (style === "absolute") return encodeSpaces(strip(toPath));
  const from = fromPath.split("/").slice(0, -1);
  const to = toPath.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.length - i;
  const rel = [...Array<string>(up).fill(".."), ...to.slice(i)].join("/");
  return encodeSpaces(up === 0 ? `./${rel}` : rel);
}

const encodeSpaces = (s: string) => s.replace(/ /g, "%20");

/** A standard markdown link. Brackets in the title are escaped so the link stays intact. */
export function markdownLink(title: string, href: string): string {
  return `[${title.replace(/([[\]])/g, "\\$1")}](${href})`;
}

/**
 * The `[[` being typed before the cursor, if any: where it starts and what has been typed
 * after it. Null once the brackets are closed or the line has moved on.
 */
export function openWikilink(before: string): { from: number; query: string } | null {
  const at = before.lastIndexOf("[[");
  if (at < 0) return null;
  const query = before.slice(at + 2);
  if (/[\]\n]/.test(query) || query.length > 80) return null;
  return { from: at, query };
}

export type ChangeClass = "fix" | "addition" | "process";

/**
 * The change class to preselect. Small edits that touch no heading and no numbered step are
 * probably a Fix; anything larger is probably an Addition. A Process change is never
 * preselected: saying that the old instructions are now wrong is the writer's call.
 */
export function suggestChangeClass(before: string, after: string): ChangeClass {
  const a = before.split("\n");
  const b = after.split("\n");
  const counts = new Map<string, number>();
  for (const l of a) counts.set(l, (counts.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of b) {
    const n = counts.get(l) ?? 0;
    if (n > 0) counts.set(l, n - 1);
    else added.push(l);
  }
  const removed = [...counts].flatMap(([l, n]) => Array<string>(n).fill(l));
  const changed = [...added, ...removed].filter((l) => l.trim() !== "");
  if (changed.length === 0) return "fix";
  const structural = changed.some((l) => /^\s*(#{1,6}\s|\d+[.)]\s)/.test(l));
  const words = (ls: string[]) => ls.join(" ").split(/\s+/).filter(Boolean).length;
  const net = Math.abs(words(added) - words(removed));
  return !structural && changed.length <= 4 && net <= 25 ? "fix" : "addition";
}

/** Lines still carrying merge markers. A note cannot be saved until there are none. */
export function conflictMarkers(text: string): number[] {
  const out: number[] = [];
  text.split("\n").forEach((l, i) => {
    if (/^(<{7}|={7}|>{7})( |$)/.test(l)) out.push(i + 1);
  });
  return out;
}

/** A file name for a pasted image: the note's slug, a short stamp, and the right extension. */
export function pastedImageName(slug: string, mime: string, now: Date, n: number): string | null {
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[
    mime
  ];
  if (!ext) return null;
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const base = (slug || "image").replace(/[^a-z0-9-]/g, "").slice(0, 40) || "image";
  return `${base}-${stamp}${n ? `-${n}` : ""}.${ext}`;
}

/** Only the keys whose value changed, so the pipeline leaves every other key's bytes alone. */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { set: Record<string, unknown>; unset: string[] } {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  const empty = (v: unknown) =>
    v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    if (empty(b)) {
      if (!empty(a)) unset.push(key);
    } else set[key] = b;
  }
  return { set, unset: unset.sort() };
}
