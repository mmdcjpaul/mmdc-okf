"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signInMethods } from "@/lib/auth";

export interface LinkResult {
  ok: boolean;
  message: string;
}

/** Dev login: sign in as a fixture principal. Refused unless AUTH_DEV_LOGIN=true. */
export async function devSignIn(formData: FormData): Promise<void> {
  if (!signInMethods().dev) throw new Error("Dev login is disabled");
  const api = auth().api as unknown as {
    signInDev: (input: { body: { userId: string }; headers: Headers }) => Promise<unknown>;
  };
  try {
    await api.signInDev({
      body: { userId: String(formData.get("userId") ?? "") },
      headers: await headers(),
    });
  } catch {
    redirect("/login?error=unknown");
  }
  redirect("/");
}

/** Sends the person to their identity provider. They come back signed in. */
export async function providerSignIn(formData: FormData): Promise<void> {
  const provider = String(formData.get("provider") ?? "");
  const methods = signInMethods();
  if (
    !(provider === "google" && methods.google) &&
    !(provider === "microsoft" && methods.microsoft)
  )
    redirect("/login?error=provider");
  const res = await auth().api.signInSocial({
    body: { provider, callbackURL: "/", errorCallbackURL: "/login" },
    headers: await headers(),
  });
  redirect(res.url ?? "/login?error=provider");
}

/** Emails a sign-in link. The answer is the same whether or not the address may sign in. */
export async function emailLink(_prev: LinkResult | null, formData: FormData): Promise<LinkResult> {
  if (!signInMethods().emailLink) return { ok: false, message: "Signing in by email is off" };
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { ok: false, message: "Enter your work email address" };
  const api = auth().api as unknown as {
    signInMagicLink: (input: {
      body: { email: string; callbackURL: string; errorCallbackURL: string };
      headers: Headers;
    }) => Promise<unknown>;
  };
  try {
    await api.signInMagicLink({
      body: { email, callbackURL: "/", errorCallbackURL: "/login" },
      headers: await headers(),
    });
  } catch {
    return { ok: false, message: "The link could not be sent. Try again in a moment." };
  }
  return {
    ok: true,
    message: `If ${email} can sign in, a link is on its way. It works once, for 15 minutes.`,
  };
}

export async function signOut(): Promise<void> {
  await auth()
    .api.signOut({ headers: await headers() })
    .catch(() => null);
  redirect("/login");
}
