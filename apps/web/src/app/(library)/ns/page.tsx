import type { Metadata } from "next";
import Link from "next/link";
import { FolderClosed, Lock } from "lucide-react";
import { countBy, listNamespaces } from "@lore/db";
import { PageHeader } from "@/components/PageHeader";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { plural } from "@/lib/format";
import { folderHref } from "@/lib/urls";

export const metadata: Metadata = { title: "Namespaces" };

export default async function NamespacesPage() {
  const { vault, scope } = await requireContext();
  const [namespaces, counts] = await Promise.all([
    listNamespaces(db(), vault.id),
    countBy(db(), scope, "namespace"),
  ]);
  const count = new Map(counts.map((c) => [c.key, c.count]));
  const visible = namespaces.filter((n) => scope.namespaces.includes(n.slug));
  return (
    <div className="mx-auto max-w-[960px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        title="Namespaces"
        description="Top-level areas of the vault. Each has an owning team and its own publishing rules."
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {visible.map((n) => (
          <li key={n.slug}>
            <Link
              href={folderHref(n.slug)}
              className="group block h-full rounded-lg border border-line bg-paper p-5 transition-colors hover:border-faint/50 hover:bg-bg"
            >
              <div className="flex items-center gap-2">
                {n.visibility === "restricted" ? (
                  <Lock size={16} className="text-warn" aria-label="Restricted" />
                ) : (
                  <FolderClosed size={16} className="text-muted" aria-hidden />
                )}
                <p className="flex-1 text-[15px] font-medium text-ink group-hover:text-accent">
                  {n.title}
                </p>
                <span className="text-xs tabular-nums text-faint">
                  {plural(count.get(n.slug) ?? 0, "note")}
                </span>
              </div>
              <p className="mt-2 text-[13.5px] leading-snug text-muted">{n.description}</p>
              <p className="mt-3 text-xs text-faint">
                {n.ownerTeam ? `Owned by ${n.ownerTeam}` : "No owner"} ·{" "}
                {n.visibility === "restricted" ? "Restricted" : "Company-wide"} ·{" "}
                {n.publishing === "auto" ? "Auto publishing" : "Reviewed publishing"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
