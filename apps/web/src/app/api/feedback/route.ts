import { NextResponse, type NextRequest } from "next/server";
import { newRecordId } from "@lore/changesets";
import {
  FeedbackLimitError,
  getNote,
  listNamespaces,
  notify,
  readersOf,
  recordFeedback,
  removeHelpful,
  REPORT_REASONS,
  teamPeople,
} from "@lore/db";
import { z } from "zod";
import { apiContext } from "@/lib/context";
import { db } from "@/lib/db";
import { crossSite } from "@/lib/same-origin";
import { noteHref } from "@/lib/urls";
import { requestHealth } from "@/lib/worker";

const REASONS = REPORT_REASONS.map((r) => r.value) as [string, ...string[]];
const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("helpful"), noteId: z.string().min(1) }),
  z.object({ kind: z.literal("not_helpful"), noteId: z.string().min(1) }),
  z.object({
    kind: z.literal("report"),
    noteId: z.string().min(1),
    reason: z.enum(REASONS),
    comment: z.string().trim().max(1000).optional(),
  }),
]);

/** Helpful, or Report an issue, on a note the person can read (AU-15). */
export async function POST(req: NextRequest) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const refused = crossSite(req);
  if (refused) return refused;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  const input = parsed.data;
  const note = await getNote(db(), ctx.scope, input.noteId);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const me = ctx.principal.user;

  if (input.kind === "not_helpful") {
    await removeHelpful(db(), ctx.vault.id, note.id, me.id);
  } else {
    try {
      const row = await recordFeedback(db(), {
        id: newRecordId("fb"),
        vaultId: ctx.vault.id,
        noteId: note.id,
        userId: me.id,
        kind: input.kind,
        ...(input.kind === "report"
          ? { reason: input.reason as never, comment: input.comment ?? null }
          : {}),
      });
      if (input.kind === "report") {
        // The owner is told, by name: reports are not anonymous (PRD 7.7).
        const namespaces = await listNamespaces(db(), ctx.vault.id);
        const team =
          note.owner ?? namespaces.find((n) => n.slug === note.namespace)?.ownerTeam ?? null;
        const readers = note.namespace ? await readersOf(db(), ctx.vault.id, note.namespace) : null;
        const label = REPORT_REASONS.find((r) => r.value === input.reason)?.label ?? input.reason;
        await notify(
          db(),
          (team ? await teamPeople(db(), team) : [])
            .filter((u) => u.id !== me.id && (!readers || readers.has(u.id)))
            .map((u) => ({
              userId: u.id,
              vaultId: ctx.vault.id,
              kind: "report",
              title: `Reported: ${note.title}`,
              body: `${me.name} says it is ${label.toLowerCase()}${input.comment ? `: ${input.comment}` : "."}`,
              href: noteHref(note),
              dedupeKey: `report:${row.id}`,
            })),
        );
      }
    } catch (err) {
      if (err instanceof FeedbackLimitError)
        return NextResponse.json({ error: err.message }, { status: 429 });
      throw err;
    }
  }
  await requestHealth(ctx.vault.id, [note.id]);
  return NextResponse.json({ ok: true });
}
