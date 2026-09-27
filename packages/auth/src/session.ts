/** Dev login must never run in production. Call at startup. */
export function assertDevLoginAllowed(env: { NODE_ENV?: string; AUTH_DEV_LOGIN?: string }): void {
  if (env.AUTH_DEV_LOGIN === "true" && env.NODE_ENV === "production") {
    throw new Error("AUTH_DEV_LOGIN=true is refused when NODE_ENV=production");
  }
}
