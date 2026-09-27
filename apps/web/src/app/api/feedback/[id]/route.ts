import { NextResponse, type NextRequest } from "next/server";
import { dismissReport, getFeedback, getNote, notify, writeAudit } from "@lore/db";
import { z } from "zod";
import { publishes } from "@/lib/changesets";
import { apiContext } from "@/lib/context";
import { db } from "@/lib/db";
import { crossSite } from "@/lib/same-origin";
import { noteHref } from "@/lib/urls";
import { requestHealth } from "@/lib/worker";

const Body = z.object({ reason: z.string().trim().min(3).max(500) });

/**
 * A writer in the namespace closes a report without changing the note, and says why. The
 * other way a report closes is a commit that resolves it.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const refused = crossSite(req);
  if (refused) return refused;
  const report = await getFeedback(db(), (await params).id);
  const note =
    report && report.vaultId === ctx.vault.id
      ? await getNote(db(), ctx.scope, report.noteId)
      : null;
  if (!report || !note || report.kind !== "report")
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!publishes(ctx.principal, note.namespace))
    return NextResponse.json(
      { error: "Only the note's writers can dismiss a report" },
      { status: 403 },
    );
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Say why the report is dismissed" }, { status: 400 });

  const me = ctx.principal.user;
  const done = await dismissReport(db(), report.id, me.id, parsed.data.reason);
  if (!done) return NextResponse.json({ error: "The report is already closed" }, { status: 409 });
  await writeAudit(db(), {
    actorId: me.id,
    action: "feedback.dismiss",
    target: report.id,
    metadata: { noteId: note.id, reason: parsed.data.reason },
  });
  if (report.userId && report.userId !== me.id) {
    await notify(db(), [
      {
        userId: report.userId,
        vaultId: ctx.vault.id,
        kind: "report_dismissed",
        title: `Your report on "${note.title}" was closed`,
        body: `${me.name}: ${parsed.data.reason}`,
        href: noteHref(note),
        dedupeKey: `dismissed:${report.id}`,
      },
    ]);
  }
  await requestHealth(ctx.vault.id, [note.id]);
  return NextResponse.json({ ok: true });
}
