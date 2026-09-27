/**
 * Sign-in, on Better Auth (plans/02-library.md, L1). Better Auth owns sessions, accounts,
 * and verification values, and reads and writes Lore's `users` table. Who may read and
 * write what stays in Lore's own tables and helpers (`permissions.ts`, `principal.ts`).
 *
 * Kept apart from the package's main entry, so the worker does not load it.
 *
 * @packageDocumentation
 */
import {
  accounts,
  getUser,
  listUsers,
  sessions,
  users,
  verifications,
  writeAudit,
  type Db,
} from "@lore/db";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { magicLink } from "better-auth/plugins";
import { z } from "zod";
import { isAllowedDomain } from "./permissions.ts";

export interface SignInConfig {
  db: Db;
  /** Signs session cookies. At least 32 characters in production. */
  secret: string;
  /** Where people open the Library, for example `https://kb.acme.com`. */
  baseURL: string;
  /** Email domains that may sign in. Empty allows every domain, which is for development. */
  allowedDomains: string[];
  google?: { clientId: string; clientSecret: string } | undefined;
  /** Microsoft Entra ID. `tenantId` limits sign-in to one tenant. */
  microsoft?: { clientId: string; clientSecret: string; tenantId: string } | undefined;
  /** Sends the sign-in link. Without it, signing in by email is off. */
  sendSignInLink?: ((to: { email: string; url: string }) => Promise<void>) | undefined;
  /** Sign in as any person by id. For development and tests, refused in production. */
  devLogin: boolean;
  production: boolean;
  /** Added after Lore's own, for example the framework's cookie plugin. */
  plugins?: BetterAuthPlugin[];
}

const METHOD: [RegExp, string][] = [
  [/^\/sign-in\/dev/, "dev"],
  [/^\/magic-link/, "email link"],
  [/^\/callback\/google/, "google"],
  [/^\/callback\/microsoft/, "microsoft"],
];

/** A handle nobody has yet, from the part of the address before the @. */
export function handleFor(email: string, taken: ReadonlySet<string>): string {
  const base =
    email
      .slice(0, Math.max(0, email.lastIndexOf("@")))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "person";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Sign in as a person by id, with no proof. Only ever added when `devLogin` is on. */
function devLogin(): BetterAuthPlugin {
  return {
    id: "lore-dev-login",
    endpoints: {
      signInDev: createAuthEndpoint(
        "/sign-in/dev",
        { method: "POST", body: z.object({ userId: z.string().min(1).max(100) }) },
        async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          if (!user) throw new APIError("NOT_FOUND", { message: "No such person" });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) throw new APIError("FORBIDDEN", { message: "This person cannot sign in" });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ token: session.token, userId: user.id });
        },
      ),
    },
  };
}

export function createSignIn(config: SignInConfig) {
  if (config.devLogin && config.production) throw new Error("Dev login is refused in production");
  const { db } = config;
  const allowed = (email: string) => isAllowedDomain(email, config.allowedDomains);

  return betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { users, sessions, accounts, verifications },
      usePlural: true,
    }),
    user: {
      additionalFields: {
        handle: { type: "string", required: true, input: false },
        role: { type: "string", required: true, defaultValue: "member", input: false },
        serviceAccount: { type: "boolean", required: true, defaultValue: false, input: false },
      },
    },
    socialProviders: {
      ...(config.google
        ? {
            google: {
              clientId: config.google.clientId,
              clientSecret: config.google.clientSecret,
              // Asks Google for one Workspace domain when there is exactly one. The
              // allow-list below is what decides; this only shortens the account chooser.
              ...(config.allowedDomains.length === 1 ? { hd: config.allowedDomains[0] } : {}),
            },
          }
        : {}),
      ...(config.microsoft
        ? {
            microsoft: {
              clientId: config.microsoft.clientId,
              clientSecret: config.microsoft.clientSecret,
              tenantId: config.microsoft.tenantId,
            },
          }
        : {}),
    },
    account: {
      // The same person signing in with Google and with a link is one person, because both
      // prove the address.
      accountLinking: { enabled: true, trustedProviders: ["google", "microsoft"] },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!allowed(user.email))
              throw new APIError("FORBIDDEN", {
                message: "Sign in with your company email address",
              });
            const everyone = await listUsers(db);
            const handle = handleFor(user.email, new Set(everyone.map((u) => u.handle)));
            // The first person in a new deployment looks after it. Everyone after is a member
            // until an admin says otherwise.
            const first = !everyone.some((u) => u.role !== "member" && !u.serviceAccount);
            return {
              data: {
                ...user,
                name: user.name || handle,
                handle,
                role: first ? "owner" : "member",
                serviceAccount: false,
              },
            };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await getUser(db, session.userId);
            // Checked at every sign-in, not only the first: a domain can be taken off the
            // list, and service accounts use tokens, never a browser.
            if (!user || user.serviceAccount || !allowed(user.email)) return false;
          },
          after: async (session, ctx) => {
            const path = ctx?.path ?? "";
            await writeAudit(db, {
              actorId: session.userId,
              action: "auth.sign_in",
              metadata: { method: METHOD.find(([re]) => re.test(path))?.[1] ?? "other" },
            });
          },
        },
      },
    },
    rateLimit: { enabled: config.production },
    telemetry: { enabled: false },
    plugins: [
      ...(config.sendSignInLink
        ? [
            magicLink({
              expiresIn: 15 * 60,
              storeToken: "hashed",
              sendMagicLink: async ({ email, url }) => {
                // Nothing is sent to an address that could not sign in anyway, and the
                // answer is the same either way, so the form does not say who exists.
                if (!allowed(email)) return;
                await config.sendSignInLink!({ email, url });
              },
            }),
          ]
        : []),
      ...(config.devLogin ? [devLogin()] : []),
      ...(config.plugins ?? []),
    ],
  });
}

export type SignIn = ReturnType<typeof createSignIn>;

/** The id of the signed-in person, or null. */
export async function sessionUserId(auth: SignIn, headers: Headers): Promise<string | null> {
  const found = await auth.api.getSession({ headers });
  return found?.user.id ?? null;
}

/**
 * A `cookie` header that signs requests in as the person, for tests and scripts. It needs
 * an instance with dev login on, sharing the database and the secret of the app under test.
 */
export async function sessionCookieFor(auth: SignIn, userId: string): Promise<string> {
  const api = auth.api as unknown as {
    signInDev?: (input: {
      body: { userId: string };
      returnHeaders: true;
    }) => Promise<{ headers: Headers }>;
  };
  if (!api.signInDev) throw new Error("Dev login is off");
  const { headers } = await api.signInDev({ body: { userId }, returnHeaders: true });
  const cookies = headers.getSetCookie().map((c) => c.slice(0, c.indexOf(";")));
  if (cookies.length === 0) throw new Error("No session was created");
  return cookies.join("; ");
}
