import { str, strList, type ParsedNote } from "./note.ts";
import { compareText, makeHref } from "./paths.ts";
import { contentNotes, type Vault } from "./vault.ts";

export const MEMBERS_START = "<!-- kb:members:start -->";
export const MEMBERS_END = "<!-- kb:members:end -->";

/** Orders type names as the profile lists them, with unknown types last in name order. */
export function typeOrder(vault: Vault, types: Iterable<string>): string[] {
  const known = Object.keys(vault.profile.types);
  return [...new Set(types)].sort((a, b) => {
    const ia = known.indexOf(a);
    const ib = known.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return compareText(a, b);
  });
}

/** One listing line in the OKF index style: `* [Title](href) - description`. */
export function listingLine(vault: Vault, from: string, note: ParsedNote): string {
  const title = str(note.data, "title") ?? note.path;
  const desc = (str(note.data, "description") ?? "").replace(/\s+/g, " ").trim();
  const status = str(note.data, "status");
  const badge = status === "draft" ? " (draft)" : status === "deprecated" ? " (deprecated)" : "";
  const href = makeHref(vault.root, from, note.path, vault.profile.link_style);
  return `* [${title.replace(/([[\]])/g, "\\$1")}](${href})${badge}${desc ? ` - ${desc}` : ""}`;
}

/** Notes grouped by type, sorted by title, rendered as `## Type` sections. */
export function groupedListing(vault: Vault, from: string, notes: ParsedNote[], level = 2): string {
  const byType = new Map<string, ParsedNote[]>();
  for (const n of notes) {
    const t = str(n.data, "type") ?? "Untyped";
    byType.set(t, [...(byType.get(t) ?? []), n]);
  }
  const hashes = "#".repeat(level);
  return typeOrder(vault, byType.keys())
    .map((t) => {
      const items = byType
        .get(t)!
        .sort(
          (a, b) =>
            compareText(str(a.data, "title") ?? a.path, str(b.data, "title") ?? b.path) ||
            compareText(a.path, b.path),
        )
        .map((n) => listingLine(vault, from, n));
      return `${hashes} ${t}\n\n${items.join("\n")}\n`;
    })
    .join("\n");
}

/** Notes that belong in a hub's member list: every non-deprecated content note that names the hub. */
export function hubMembers(vault: Vault, kind: "theme" | "system", slug: string): ParsedNote[] {
  const field = kind === "theme" ? "themes" : "systems";
  return contentNotes(vault).filter(
    (n) =>
      strList(n.data, field).includes(slug) &&
      str(n.data, "status") !== "deprecated" &&
      !["Theme", "System"].includes(str(n.data, "type") ?? ""),
  );
}

export function renderMembersBlock(vault: Vault, hubPath: string, members: ParsedNote[]): string {
  const inner = members.length ? groupedListing(vault, hubPath, members) : "_No notes yet._\n";
  return `${MEMBERS_START}\n\n${inner}\n${MEMBERS_END}`;
}

/** The member block's position in a text, or null when the markers are missing. */
export function findMembersBlock(text: string): { start: number; end: number } | null {
  const start = text.indexOf(MEMBERS_START);
  if (start < 0) return null;
  const endMarker = text.indexOf(MEMBERS_END, start);
  if (endMarker < 0) return null;
  return { start, end: endMarker + MEMBERS_END.length };
}

/** Replaces the block between the markers, or appends a Members section when the markers are missing. */
export function withMembersBlock(text: string, block: string): string {
  const found = findMembersBlock(text);
  if (found) return text.slice(0, found.start) + block + text.slice(found.end);
  const trimmed = text.replace(/\s+$/, "");
  return `${trimmed}\n\n# Members\n\n${block}\n`;
}
