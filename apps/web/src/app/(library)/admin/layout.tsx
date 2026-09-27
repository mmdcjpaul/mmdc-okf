import type { ReactNode } from "react";
import { NavLink } from "@/components/NavLink";
import { requireAdmin } from "@/lib/context";

const TABS = [
  ["/admin", "People", true],
  ["/admin/teams", "Teams", false],
  ["/admin/namespaces", "Namespaces and grants", false],
  ["/admin/ai", "AI", false],
  ["/admin/settings", "Branding and features", false],
  ["/admin/audit", "Audit log", false],
  ["/admin/snapshots", "Snapshots", false],
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-[1080px] px-5 pb-20 pt-10 md:px-10">
      <h1 className="text-[26px] font-semibold tracking-[-0.015em] text-ink">Admin</h1>
      <nav aria-label="Admin" className="mb-8 mt-4 flex flex-wrap gap-1 border-b border-line pb-2">
        {TABS.map(([href, label, exact]) => (
          <NavLink key={href} href={href} exact={exact}>
            {label}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  );
}
