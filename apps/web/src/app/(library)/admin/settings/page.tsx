import type { Metadata } from "next";
import { getFeatures, getSetting, type Features } from "@lore/db";
import { ActionForm } from "@/components/ActionForm";
import { adminButton, adminInput } from "@/components/admin-styles";
import { requireAdmin } from "@/lib/context";
import { db } from "@/lib/db";
import { saveBranding } from "../actions";

const FEATURES: { name: keyof Features; label: string; hint: string }[] = [
  { name: "capture", label: "Capture", hint: "Paste rough notes and have them turned into notes." },
  { name: "graph", label: "Graph view", hint: "The map of every note and the links between them." },
  {
    name: "gardener",
    label: "Gardener",
    hint: "Looks for duplicates, orphans, and wanted notes every week, and proposes fixes for review.",
  },
  {
    name: "autoPublishing",
    label: "Auto publishing",
    hint: "Lets namespaces set to publish by themselves do so. Off, every AI draft is reviewed.",
  },
  { name: "desk", label: "Desk and My tickets", hint: "Needs the Desk to be set up." },
];

export const metadata: Metadata = { title: "Branding and features" };

export default async function SettingsPage() {
  const ctx = await requireAdmin();
  const [branding, features] = await Promise.all([
    getSetting<Record<string, string | null>>(db(), "branding"),
    getFeatures(db()),
  ]);
  return (
    <ActionForm action={saveBranding} className="max-w-xl space-y-4">
      <label className="block text-[13px] font-medium text-ink">
        Name
        <input
          name="name"
          defaultValue={branding?.name ?? ""}
          placeholder={ctx.vault.title}
          maxLength={60}
          className={`${adminInput} mt-1`}
        />
      </label>
      <label className="block text-[13px] font-medium text-ink">
        Logo address
        <input
          name="logoUrl"
          defaultValue={branding?.logoUrl ?? ""}
          placeholder="https://"
          className={`${adminInput} mt-1`}
        />
      </label>
      <label className="block text-[13px] font-medium text-ink">
        Accent colour
        <input
          name="accent"
          defaultValue={branding?.accent ?? ""}
          placeholder="#4b50d8"
          pattern="#[0-9a-fA-F]{6}"
          aria-describedby="accent-help"
          className={`${adminInput} mt-1 w-40 font-mono text-[13px]`}
        />
        <span id="accent-help" className="mt-1 block text-[12.5px] font-normal text-muted">
          Used for links and buttons. Choose one dark enough to read on white: a contrast of 4.5 to
          1 or more.
        </span>
      </label>
      <label className="block text-[13px] font-medium text-ink">
        Desk greeting
        <textarea
          name="deskGreeting"
          defaultValue={branding?.deskGreeting ?? ""}
          rows={2}
          maxLength={300}
          className={`${adminInput} mt-1 h-auto py-2`}
        />
      </label>
      <fieldset>
        <legend className="mb-1 text-[13px] font-medium text-ink">Features</legend>
        <div className="space-y-1.5">
          {FEATURES.map((f) => (
            <label key={f.name} className="flex items-start gap-2 text-[13.5px] text-ink-2">
              <input
                type="checkbox"
                name={f.name}
                defaultChecked={features[f.name]}
                className="mt-0.5 size-4 accent-[var(--accent)]"
              />
              <span>
                {f.label}
                <span className="block text-[12.5px] text-muted">{f.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" className={adminButton}>
        Save
      </button>
    </ActionForm>
  );
}
