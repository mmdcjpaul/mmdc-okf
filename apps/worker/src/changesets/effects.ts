/**
 * What follows a Process change (PRD 6.6 and 7.6): owners and followers are told, and notes
 * that link to the changed note are flagged for their owners.
 *
 * These run after indexing, not in the editor, so a major version bump pushed from Obsidian
 * has exactly the same effects as one saved in the Library (AU-14).
 */
import {
  clearFlags,
  flagNotes,
  followersOfAny,
  getNote,
  listNamespaces,
  notesLinkingTo,
  notify,
  readersOf,
  resolveReports,
  teamPeople,
  type Db,
  type NewNotification,
} from "@lore/db";
import type { IndexResult } from "../indexer/index-vault.ts";

export interface EffectsResult {
  notified: number;
  flagged: number;
  /** Notes whose reports a commit resolved; their health needs recomputing. */
  resolved: string[];
}

async function ownerTeamOf(db: Db, vaultId: string, ns: string | null): Promise<string | null> {
  if (!ns) return null;
  return (await listNamespaces(db, vaultId)).find((n) => n.slug === ns)?.ownerTeam ?? null;
}

/** Null means everyone: hubs belong to no namespace. */
async function canRead(db: Db, vaultId: string, ns: string | null): Promise<Set<string> | null> {
  return ns ? readersOf(db, vaultId, ns) : null;
}

export async function applyIndexEffects(db: Db, result: IndexResult): Promise<EffectsResult> {
  const out: EffectsResult = { notified: 0, flagged: 0, resolved: [] };
  if (result.skipped || !result.head) return out;
  // A report closes when the commit that resolves it has been indexed (PRD 7.7).
  const bySha = new Map<string, string[]>();
  for (const r of result.resolvedReports) bySha.set(r.sha, [...(bySha.get(r.sha) ?? []), r.id]);
  for (const [sha, ids] of bySha)
    out.resolved.push(...(await resolveReports(db, result.vaultId, ids, sha)));
  // A note that changed has been looked at: its own flags are settled.
  await clearFlags(db, result.vaultId, result.changed);
  // The first index of a vault replays its whole history. Nobody needs telling about that.
  if (!result.previousHead) return out;

  // Effects are for owners, whatever namespace the note is in.
  const scope = {
    vaultId: result.vaultId,
    namespaces: (await listNamespaces(db, result.vaultId)).map((n) => n.slug),
  };
  for (const noteId of result.processChanged) {
    const note = await getNote(db, scope, noteId);
    if (!note || !note.processChangedAt || !note.lastCommitSha) continue;
    const readers = await canRead(db, result.vaultId, note.namespace);
    const href = `/n/${encodeURIComponent(note.id)}/${note.slug}`;
    const ownerTeam = note.owner ?? (await ownerTeamOf(db, result.vaultId, note.namespace));
    const people = new Map<string, string>();
    for (const u of ownerTeam ? await teamPeople(db, ownerTeam) : []) people.set(u.id, "own");
    // Following a hub follows the notes filed under it.
    const followed = [
      note.id,
      ...note.themes.map((t) => `theme:${t}`),
      ...note.systems.map((s) => `system:${s}`),
    ];
    for (const id of await followersOfAny(db, result.vaultId, followed))
      if (!people.has(id)) people.set(id, "follow");

    const items: NewNotification[] = [];
    for (const [userId, why] of people) {
      if (readers && !readers.has(userId)) continue;
      items.push({
        userId,
        vaultId: result.vaultId,
        kind: "process_change",
        title: `Process changed: ${note.title}`,
        body:
          why === "own"
            ? `A note your team owns changed${note.lastChangedBy ? `, by ${note.lastChangedBy}` : ""}.`
            : "A note you follow, or a note under a hub you follow, changed.",
        href,
        dedupeKey: `process:${note.id}:${note.lastCommitSha}`,
      });
    }

    const linking = await notesLinkingTo(db, result.vaultId, note.id);
    await flagNotes(
      db,
      linking.map((l) => ({
        vaultId: result.vaultId,
        noteId: l.id,
        causeNoteId: note.id,
        causeSha: note.lastCommitSha!,
        changedAt: note.processChangedAt!,
      })),
    );
    out.flagged += linking.length;
    for (const l of linking) {
      const team = l.owner ?? (await ownerTeamOf(db, result.vaultId, l.namespace));
      const allowed = await canRead(db, result.vaultId, l.namespace);
      for (const u of team ? await teamPeople(db, team) : []) {
        if (allowed && !allowed.has(u.id)) continue;
        items.push({
          userId: u.id,
          vaultId: result.vaultId,
          kind: "linked_note_changed",
          title: `Check "${l.title}"`,
          // The changed note may be in a namespace this person cannot read, so it is not named.
          body: "It links to a process that changed, and may need updating too.",
          href: `/n/${encodeURIComponent(l.id)}/${l.slug}`,
          dedupeKey: `flag:${l.id}:${note.id}:${note.lastCommitSha}`,
        });
      }
    }
    out.notified += await notify(db, items);
  }
  return out;
}
