import "server-only";
import { createSignIn, type SignIn } from "@lore/auth/sign-in";
import { nextCookies } from "better-auth/next-js";
import { getBranding } from "./branding";
import { db } from "./db";
import { env } from "./env";
import { sendMail } from "./worker";

let cached: SignIn | null = null;

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Which ways of signing in this deployment offers. */
export function signInMethods() {
  const e = env();
  return {
    google: !!(e.AUTH_GOOGLE_CLIENT_ID && e.AUTH_GOOGLE_CLIENT_SECRET),
    microsoft: !!(
      e.AUTH_MICROSOFT_CLIENT_ID &&
      e.AUTH_MICROSOFT_CLIENT_SECRET &&
      e.AUTH_MICROSOFT_TENANT_ID
    ),
    emailLink: e.AUTH_EMAIL_LINK === "true",
    dev: e.AUTH_DEV_LOGIN === "true",
  };
}

export function auth(): SignIn {
  if (cached) return cached;
  const e = env();
  const methods = signInMethods();
  cached = createSignIn({
    db: db(),
    secret: e.APP_SECRET,
    baseURL: e.PUBLIC_URL.replace(/\/$/, ""),
    allowedDomains: e.AUTH_ALLOWED_DOMAINS.split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    google: methods.google
      ? { clientId: e.AUTH_GOOGLE_CLIENT_ID!, clientSecret: e.AUTH_GOOGLE_CLIENT_SECRET! }
      : undefined,
    microsoft: methods.microsoft
      ? {
          clientId: e.AUTH_MICROSOFT_CLIENT_ID!,
          clientSecret: e.AUTH_MICROSOFT_CLIENT_SECRET!,
          tenantId: e.AUTH_MICROSOFT_TENANT_ID!,
        }
      : undefined,
    sendSignInLink: methods.emailLink
      ? async ({ email, url }) => {
          const { name } = await getBranding("the Library");
          const sent = await sendMail({
            to: { name: "", email },
            subject: `Sign in to ${name}`,
            text: `Open this link to sign in to ${name}. It works once, for 15 minutes.\n\n${url}\n\nIf you did not ask for it, ignore this email.`,
            html: `<p>Open this link to sign in to ${escape(name)}. It works once, for 15 minutes.</p><p><a href="${escape(url)}">Sign in to ${escape(name)}</a></p><p>If you did not ask for it, ignore this email.</p>`,
          });
          if (!sent) throw new Error("The sign-in link could not be sent");
        }
      : undefined,
    devLogin: methods.dev,
    production: e.NODE_ENV === "production",
    // Lets sign-in from server actions set the session cookie. It has to be last.
    plugins: [nextCookies()],
  });
  return cached;
}
