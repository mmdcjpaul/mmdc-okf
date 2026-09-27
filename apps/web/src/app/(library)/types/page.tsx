import type { Metadata } from "next";
import Link from "next/link";
import { countBy } from "@lore/db";
import { PageHeader } from "@/components/PageHeader";
import { TypeIcon } from "@/components/TypeIcon";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { typeHref } from "@/lib/urls";

export const metadata: Metadata = { title: "Types" };

const ABOUT: Record<string, string> = {
  "How-To": "Steps to get one task done.",
  Process: "How work flows between people and systems.",
  Explanation: "Background and reasoning.",
  Reference: "Facts to look up: settings, inventories, contacts.",
  Policy: "Rules people must follow.",
  Decision: "What was decided and why.",
  Runbook: "What on-call does when something breaks.",
  "Request Type": "What people can ask for through the Desk.",
  Action: "Automations the Desk can run.",
  "Source Document": "Original documents that notes were drawn from.",
};

export default async function TypesPage() {
  const { scope } = await requireContext();
  const types = await countBy(db(), scope, "type");
  return (
    <div className="mx-auto max-w-[960px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        title="Types"
        description="Collections of every note of one kind, as a table or as cards."
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {types.map((t) => (
          <li key={t.key}>
            <Link
              href={typeHref(t.key)}
              className="group flex h-full gap-3 rounded-lg border border-line bg-paper p-4 transition-colors hover:border-faint/50 hover:bg-bg"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-line-2 text-ink-2">
                <TypeIcon type={t.key} />
              </span>
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="text-[14px] font-medium text-ink group-hover:text-accent">
                    {t.key}
                  </span>
                  <span className="text-xs tabular-nums text-faint">{t.count}</span>
                </span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">
                  {ABOUT[t.key] ?? ""}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
