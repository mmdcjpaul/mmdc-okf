import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Dev login sessions (`AUTH_DEV_LOGIN=true`): an HMAC-signed cookie holding the user id.
 * Better Auth replaces this for real sign-in (L1); the principal helpers stay the same.
 */
export const SESSION_COOKIE = "lore_session";
const MAX_AGE_S = 60 * 60 * 24 * 7;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(userId: string, secret: string, now = Date.now()): string {
  const payload = `${Buffer.from(userId).toString("base64url")}.${Math.floor(now / 1000) + MAX_AGE_S}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the user id, or null for a missing, forged, or expired token. */
export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [user, exp, mac] = parts as [string, string, string];
  const expected = Buffer.from(sign(`${user}.${exp}`, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(exp) * 1000 < now) return null;
  return Buffer.from(user, "base64url").toString("utf8");
}

export const SESSION_MAX_AGE_S = MAX_AGE_S;

/** Dev login must never run in production. Call at startup. */
export function assertDevLoginAllowed(env: { NODE_ENV?: string; AUTH_DEV_LOGIN?: string }): void {
  if (env.AUTH_DEV_LOGIN === "true" && env.NODE_ENV === "production") {
    throw new Error("AUTH_DEV_LOGIN=true is refused when NODE_ENV=production");
  }
}
