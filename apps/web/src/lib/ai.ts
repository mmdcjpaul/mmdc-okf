import "server-only";
import { getSetting } from "@lore/db";
import { db } from "./db";
import { env } from "./env";

/**
 * Whether a model can be called: AI is on, and when it is live, at least one provider key
 * is configured. Forms use this to say what will happen; the worker decides what does.
 */
export async function aiAvailable(): Promise<boolean> {
  const mode = env().AI_MODE;
  if (mode === "off") return false;
  if (mode === "fake") return true;
  const settings = await getSetting<{ keys?: Record<string, string> }>(db(), "ai");
  return Object.values(settings?.keys ?? {}).some(Boolean);
}
