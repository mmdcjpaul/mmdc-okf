/**
 * `@lore/auth`: namespace permissions, the per-request principal, and dev login sessions.
 *
 * @packageDocumentation
 */
export {
  atLeast,
  computeAccess,
  isAllowedDomain,
  type AccessInput,
  type GrantInfo,
  type Level,
  type NamespaceInfo,
  type Role,
} from "./permissions.ts";
export {
  canOn,
  ForbiddenError,
  loadPrincipal,
  readableNamespaces,
  readScope,
  requireNamespace,
  type Principal,
} from "./principal.ts";
export {
  assertDevLoginAllowed,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  verifySessionToken,
} from "./session.ts";
