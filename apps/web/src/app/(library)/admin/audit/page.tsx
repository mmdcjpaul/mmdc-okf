import type { Metadata } from "next";
import Link from "next/link";
import { auditActions, listAudit } from "@lore/db";
import { adminInput, adminQuiet } from "@/components/admin-styles";
import { requireAdmin } from "@/lib/context";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Audit log" };

const PAGE = 100;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; action?: string; page?: string }>;
}) {
  await requireAdmin();
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const [entries, actions] = await Promise.all([
    listAudit(db(), {
      ...(query.q ? { q: query.q.slice(0, 100) } : {}),
      ...(query.action ? { action: query.action } : {}),
      limit: PAGE + 1,
      offset: (page - 1) * PAGE,
    }),
    auditActions(db()),
  ]);
  const href = (p: number, path = "/admin/audit") => {
    const sp = new URLSearchParams();
    if (query.q) sp.set("q", query.q);
    if (query.action) sp.set("action", query.action);
    if (p > 1) sp.set("page", String(p));
    return `${path}${sp.size ? `?${sp}` : ""}`;
  };
  return (
    <section aria-label="Audit log">
      <p className="mb-3 max-w-2xl text-[13px] text-muted">
        Sign-ins, grant changes, commits made through Lore, approvals, settings, and exports. Kept
        for one year.
      </p>
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <label className="text-[13px] font-medium text-ink">
          Search
          <input name="q" defaultValue={query.q ?? ""} className={`${adminInput} mt-1 w-56`} />
        </label>
        <label className="text-[13px] font-medium text-ink">
          Action
          <select
            name="action"
            defaultValue={query.action ?? ""}
            className={`${adminInput} mt-1 w-56`}
          >
            <option value="">Any</option>
            {actions.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={adminQuiet}>
          Filter
        </button>
        <a href={href(1, "/api/admin/audit")} className={adminQuiet} download>
          Export as CSV
        </a>
      </form>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-bg text-[12px] uppercase tracking-wide text-faint">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                When
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Who
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Action
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Target
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-2">
            {entries.slice(0, PAGE).map((e) => (
              <tr key={e.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink-2">
                  <time dateTime={e.at.toISOString()}>
                    {e.at.toISOString().slice(0, 16).replace("T", " ")}
                  </time>
                </td>
                <td className="px-3 py-2 text-ink">{e.actorName ?? e.actorId ?? "Lore"}</td>
                <td className="px-3 py-2 font-mono text-[12.5px] text-ink">{e.action}</td>
                <td className="px-3 py-2 font-mono text-[12.5px] text-ink-2">{e.target}</td>
                <td className="max-w-[360px] break-words px-3 py-2 font-mono text-[12px] text-muted">
                  {Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-muted">Nothing matches.</p>
      ) : null}
      <nav aria-label="Pages" className="mt-4 flex justify-between text-[13.5px]">
        {page > 1 ? (
          <Link href={href(page - 1)} className="text-accent hover:underline">
            Newer
          </Link>
        ) : (
          <span />
        )}
        {entries.length > PAGE ? (
          <Link href={href(page + 1)} className="text-accent hover:underline">
            Older
          </Link>
        ) : null}
      </nav>
    </section>
  );
}
