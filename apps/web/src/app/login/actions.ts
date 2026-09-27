"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@lore/auth";
import { getUser, writeAudit } from "@lore/db";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** Dev login: sign in as a fixture principal. Refused unless AUTH_DEV_LOGIN=true. */
export async function devSignIn(formData: FormData): Promise<void> {
  if (env().AUTH_DEV_LOGIN !== "true") throw new Error("Dev login is disabled");
  const userId = String(formData.get("userId") ?? "");
  const user = await getUser(db(), userId);
  if (!user) redirect("/login?error=unknown");
  const jar = await cookies();
  jar.set(SESSION_COOKIE, createSessionToken(user.id, env().APP_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  await writeAudit(db(), { actorId: user.id, action: "auth.sign_in", metadata: { method: "dev" } });
  redirect("/");
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
