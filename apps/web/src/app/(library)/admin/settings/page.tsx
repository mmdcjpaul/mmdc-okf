import type { Metadata } from "next";
import { getSetting } from "@lore/db";
import { ActionForm } from "@/components/ActionForm";
import { adminButton, adminInput } from "@/components/admin-styles";
import { requireAdmin } from "@/lib/context";
import { db } from "@/lib/db";
import { saveBranding } from "../actions";

export const metadata: Metadata = { title: "Branding and features" };

export default async function SettingsPage() {
  const ctx = await requireAdmin();
  const [branding, features] = await Promise.all([
    getSetting<Record<string, string | null>>(db(), "branding"),
    getSetting<{ desk?: boolean }>(db(), "features"),
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
        <label className="flex items-center gap-2 text-[13.5px] text-ink-2">
          <input
            type="checkbox"
            name="desk"
            defaultChecked={features?.desk ?? false}
            className="size-4 accent-[var(--accent)]"
          />
          Desk and My tickets
        </label>
      </fieldset>
      <button type="submit" className={adminButton}>
        Save
      </button>
    </ActionForm>
  );
}
