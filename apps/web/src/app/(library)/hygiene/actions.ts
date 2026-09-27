"use server";

import { revalidatePath } from "next/cache";
import { getFeatures, listGardenerRuns } from "@lore/db";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { requestGardener } from "@/lib/worker";

export interface Result {
  ok: boolean;
  message: string;
}

/**
 * Asks for a Gardener run now. Admins run it for the vault or any namespace; maintainers
 * for a namespace they maintain.
 */
export async function runGardenerNow(_prev: Result | null, form: FormData): Promise<Result> {
  const ctx = await requireContext();
  const { principal, vault } = ctx;
  const namespace = String(form.get("namespace") ?? "").trim() || null;
  const allowed = namespace
    ? principal.isAdmin || principal.access.get(namespace) === "maintain"
    : principal.isAdmin;
  if (!allowed)
    return {
      ok: false,
      message: namespace
        ? "Only the people who maintain this namespace can run the Gardener for it"
        : "Only admins run the Gardener for the whole vault",
    };
  if (!(await getFeatures(db())).gardener)
    return { ok: false, message: "The Gardener is switched off. An admin can switch it on." };
  const [running] = (await listGardenerRuns(db(), vault.id, { namespace, limit: 1 })).filter(
    (r) => r.state === "running",
  );
  if (running) return { ok: false, message: "A run is already in progress" };
  if (!(await requestGardener(vault.id, namespace, principal.user.id)))
    return { ok: false, message: "The worker could not be reached. Try again in a moment." };
  revalidatePath("/hygiene");
  return { ok: true, message: "Started. What it finds appears here in a moment." };
}
