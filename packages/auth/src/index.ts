/**
 * `@lore/auth`: namespace permissions and the per-request principal. Sign-in is `@lore/auth/sign-in`.
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
export { assertDevLoginAllowed } from "./session.ts";
