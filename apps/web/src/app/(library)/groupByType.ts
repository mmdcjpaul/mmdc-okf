import type { NoteCard } from "@lore/db";

/** Groups notes by type, in the profile's type order, then alphabetically. */
export function groupByType(notes: NoteCard[], typeOrder: string[]): [string, NoteCard[]][] {
  const map = new Map<string, NoteCard[]>();
  for (const n of notes) map.set(n.type, [...(map.get(n.type) ?? []), n]);
  const rank = (t: string) => {
    const i = typeOrder.indexOf(t);
    return i < 0 ? typeOrder.length : i;
  };
  return [...map].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

export function profileTypes(profile: Record<string, unknown>): string[] {
  const types = profile.types;
  return types && typeof types === "object" ? Object.keys(types) : [];
}
