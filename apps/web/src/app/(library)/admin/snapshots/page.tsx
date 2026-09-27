import type { Metadata } from "next";
import { Banner } from "@lore/ui";
import { ActionForm } from "@/components/ActionForm";
import { adminButton, adminInput } from "@/components/admin-styles";
import { requireAdmin } from "@/lib/context";
import { listSnapshots } from "@/lib/worker";
import { takeSnapshot } from "../actions";

export const metadata: Metadata = { title: "Snapshots" };

export default async function SnapshotsPage() {
  const ctx = await requireAdmin();
  const found = await listSnapshots(ctx.vault.id);
  const month = new Date().toISOString().slice(0, 7);
  return (
    <div className="space-y-8">
      <section aria-label="Take a snapshot" className="max-w-xl">
        <p className="mb-3 text-[13px] text-muted">
          A snapshot is a Git tag on the vault as it is now. Auditors can be pointed at it, and it
          stays as it was whatever changes afterwards.
        </p>
        <ActionForm action={takeSnapshot}>
          <label className="block text-[13px] font-medium text-ink">
            Name
            <input
              name="name"
              required
              defaultValue={`vault-${month}`}
              pattern="[a-z0-9][a-z0-9._-]*"
              className={`${adminInput} mt-1 font-mono text-[13px]`}
            />
          </label>
          <label className="mt-3 block text-[13px] font-medium text-ink">
            What it is for
            <input name="note" placeholder="September audit" className={`${adminInput} mt-1`} />
          </label>
          <button type="submit" className={`${adminButton} mt-3`}>
            Take a snapshot
          </button>
        </ActionForm>
      </section>
      <section aria-label="Snapshots">
        <h2 className="mb-2 text-[15px] font-semibold text-ink">Snapshots</h2>
        {!found ? (
          <Banner kind="info" title="The list cannot be shown right now">
            The worker did not answer. Try again in a moment.
          </Banner>
        ) : found.tags.length === 0 ? (
          <p className="text-[13.5px] text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-line-2 rounded-lg border border-line">
            {found.tags.map((t) => (
              <li
                key={t.name}
                className="flex flex-wrap items-baseline gap-3 px-3 py-2 text-[13.5px]"
              >
                <span className="font-mono text-ink">{t.name}</span>
                <span className="font-mono text-[12.5px] text-muted">{t.sha.slice(0, 7)}</span>
                <span className="ml-auto text-muted">
                  {t.taggedAt ? new Date(t.taggedAt).toISOString().slice(0, 10) : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
