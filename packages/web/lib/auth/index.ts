/**
 * Auth boundary barrel (Milestone 3I).
 *
 * Routes / tests import from here, never from the individual files —
 * keeps the public surface small and lets a future real-auth
 * provider replace the internals without breaking call sites.
 */
export {
  type AuthActor,
  type AuthSession,
  type AuthSessionResolver,
  InvalidSessionError,
  OperationActorIdNotAllowedError,
  UnauthenticatedError,
} from "./types";
export {
  DemoSessionAuthProvider,
  DEMO_SESSION_COOKIE_MAX_AGE_SECONDS,
  DEMO_SESSION_COOKIE_NAME,
} from "./demo-session";
export { parseCookieHeader } from "./cookie";
export {
  __resetAuthSessionResolverForTests,
  getAuthSessionResolver,
  requireAuthenticatedActor,
  resolveActorFromRequest,
  resolveSessionFromRequest,
} from "./session-resolver";
