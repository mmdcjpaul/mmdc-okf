import type { NextRequest } from "next/server";
import { listAudit, writeAudit } from "@lore/db";
import { apiAdmin } from "@/lib/context";
import { db } from "@/lib/db";

/** A cell that a spreadsheet will show as text, never run as a formula. */
function cell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

/** The audit log as CSV. The export is itself recorded. */
export async function GET(req: NextRequest) {
  const ctx = await apiAdmin();
  if (ctx instanceof Response) return ctx;
  const q = req.nextUrl.searchParams.get("q")?.slice(0, 100);
  const action = req.nextUrl.searchParams.get("action");
  const entries = await listAudit(db(), {
    ...(q ? { q } : {}),
    ...(action ? { action } : {}),
    limit: 1000,
  });
  await writeAudit(db(), {
    actorId: ctx.principal.user.id,
    action: "audit.export",
    metadata: { rows: entries.length, ...(q ? { q } : {}), ...(action ? { action } : {}) },
  });
  const rows = [
    ["when", "actor", "actor_id", "action", "target", "details"].map(cell).join(","),
    ...entries.map((e) =>
      [
        e.at.toISOString(),
        e.actorName,
        e.actorId,
        e.action,
        e.target,
        Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : "",
      ]
        .map(cell)
        .join(","),
    ),
  ];
  return new Response(rows.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lore-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
