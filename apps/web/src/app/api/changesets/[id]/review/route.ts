import { NextResponse, type NextRequest } from "next/server";
import { addReview, getChangeset, notify, transitionChangeset, writeAudit } from "@lore/db";
import { z } from "zod";
import { canApproveChangeset } from "@/lib/changesets";
import { apiContext } from "@/lib/context";
import { crossSite } from "@/lib/same-origin";
import { db } from "@/lib/db";
import { requestProcessing } from "@/lib/worker";

const Body = z
  .object({
    decision: z.enum(["approve", "request_changes", "reject"]),
    comment: z.string().trim().max(1000).optional(),
  })
  // Sending something back without saying why leaves the writer guessing.
  .refine((b) => b.decision === "approve" || !!b.comment, {
    message: "Say what should change, or why this is rejected",
  });

/**
 * A reviewer's decision. Who may decide is enforced here, on the server, from the level the
 * review rules asked for: writers approve content, maintainers approve taxonomy, destructive
 * changes, and Actions and Request Types (AU-8).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const refused = crossSite(req);
  if (refused) return refused;

  const id = (await params).id;
  const cs = await getChangeset(db(), id);
  // A changeset the person may not approve looks the same as one that does not exist.
  if (!cs || cs.vaultId !== ctx.vault.id)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (cs.state !== "in_review")
    return NextResponse.json({ error: "This change is no longer in review" }, { status: 409 });
  if (!canApproveChangeset(ctx.principal, cs))
    return NextResponse.json({ error: "You cannot review this change" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  const { decision, comment } = parsed.data;
  const next =
    decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes_requested";
  const moved = await transitionChangeset(db(), id, ["in_review"], next, {
    error: decision === "reject" ? (comment ?? null) : null,
  });
  if (!moved)
    return NextResponse.json({ error: "Someone else just reviewed this change" }, { status: 409 });

  const me = ctx.principal.user;
  await addReview(db(), { changesetId: id, reviewerId: me.id, decision, comment: comment ?? null });
  await writeAudit(db(), {
    actorId: me.id,
    action: `changeset.${decision}`,
    target: id,
    metadata: { namespaces: cs.namespaces, approverLevel: cs.approverLevel },
  });
  if (decision !== "approve" && cs.submitterId) {
    await notify(db(), [
      {
        userId: cs.submitterId,
        vaultId: ctx.vault.id,
        kind: decision === "reject" ? "change_rejected" : "changes_requested",
        title:
          decision === "reject" ? `Not published: ${cs.title}` : `Changes requested: ${cs.title}`,
        body: `${me.name}: ${comment}`,
        href: `/changes/${id}`,
        dedupeKey: `${decision}:${id}:${Date.now()}`,
      },
    ]);
  }
  const queued = decision === "approve" ? await requestProcessing(id) : false;
  return NextResponse.json({ id, state: next, queued });
}
