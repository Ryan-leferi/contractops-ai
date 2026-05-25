/**
 * Auth boundary barrel (Milestones 3I + 3J).
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
export { SignedCookieAuthProvider } from "./signed-cookie";
export { parseCookieHeader } from "./cookie";
export {
  __resetAuthSessionResolverForTests,
  getAuthSessionResolver,
  requireAuthenticatedActor,
  resolveActorFromRequest,
  resolveSessionFromRequest,
} from "./session-resolver";

// ── Milestone 3J: config + user store + password + signed token ──

export {
  type AuthConfig,
  type AuthMode,
  AuthSessionSecretMissingError,
  AuthSessionSecretWeakError,
  DemoAuthInProductionError,
  UnknownAuthModeError,
  __resetAuthConfigForTests,
  getAuthConfig,
  readAuthConfig,
} from "./config";

export {
  type AuthUser,
  type AuthUserRole,
  type CreateUserInput,
  type UserStore,
  MemoryUserStore,
  SEED_USERS,
  UserAlreadyExistsError,
  __resetUserStoreForTests,
  actorFromUser,
  getUserStore,
  seedDemoUsers,
  verifyUserPasswordById,
} from "./user-store";

export { hashPassword, verifyPassword } from "./password";

export {
  type SessionTokenPayload,
  type TokenErrorCode,
  TokenError,
  createSessionToken,
  verifySessionToken,
} from "./signed-token";

// ── Milestone 3K: auth event log ──

export {
  type AuthEvent,
  type AuthEventRequestContext,
  type AuthEventStore,
  type AuthEventType,
  type NewAuthEventInput,
  AuthEventAppendOnlyViolationError,
  MemoryAuthEventStore,
  __resetAuthEventStoreForTests,
  extractRequestContext,
  getAuthEventStore,
  normalizeEmailForEvent,
  recordAuthEvent,
} from "./auth-events";
