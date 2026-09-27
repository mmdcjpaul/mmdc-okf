import "server-only";
import { cache } from "react";
import { getSetting } from "@lore/db";
import { db } from "./db";

/** Per-deployment branding (LB-8), edited in Admin (L9). */
export interface Branding {
  name: string;
  logoUrl: string | null;
  /** Accent color as a CSS color. */
  accent: string | null;
  deskGreeting: string | null;
}

export const getBranding = cache(async (fallbackName: string): Promise<Branding> => {
  const stored = await getSetting<Partial<Branding>>(db(), "branding");
  return {
    name: stored?.name || fallbackName,
    logoUrl: stored?.logoUrl ?? null,
    accent: stored?.accent && /^#[0-9a-f]{3,8}$/i.test(stored.accent) ? stored.accent : null,
    deskGreeting: stored?.deskGreeting ?? null,
  };
});
