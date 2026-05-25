/**
 * SignedCookieAuthProvider (Milestone 3J).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Second `AuthSessionResolver` implementation. Reads the       │
 *   │ HMAC-signed session cookie set by `POST /api/auth/login`,    │
 *   │ verifies the signature + expiry, loads the user from the     │
 *   │ user store, and returns the corresponding `Actor`.           │
 *   │                                                              │
 *   │ Rejects:                                                     │
 *   │   - missing cookie         → resolveActor throws             │
 *   │                              InvalidSessionError              │
 *   │                              (no demo default in this mode). │
 *   │   - malformed token        → InvalidSessionError              │
 *   │   - bad signature          → InvalidSessionError              │
 *   │   - expired token          → InvalidSessionError              │
 *   │   - user not found         → InvalidSessionError              │
 *   │   - user disabled_at != null → InvalidSessionError            │
 *   │                                                              │
 *   │ The route handler turns InvalidSessionError into HTTP 401 +  │
 *   │ a `Set-Cookie` that clears the bad cookie (matches the 3I    │
 *   │ DemoSessionAuthProvider error contract exactly).             │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * NOT production authentication YET — see ADR-017. Still missing:
 * OAuth / SSO integration, project-level RBAC, audit of auth events
 * themselves, password rotation policy, account lockout.
 */
import { getAuthConfig } from "./config";
import { parseCookieHeader } from "./cookie";
import { TokenError, verifySessionToken } from "./signed-token";
import {
  type AuthSession,
  type AuthSessionResolver,
  InvalidSessionError,
} from "./types";
import { actorFromUser, getUserStore } from "./user-store";

export class SignedCookieAuthProvider implements AuthSessionResolver {
  async resolveSession(request: Request): Promise<AuthSession | null> {
    const config = getAuthConfig();
    if (!config.sessionSecret) {
      // Defensive — `readAuthConfig` rejects this combination at boot,
      // so reaching this branch means a test/dev override bypassed it.
      throw new InvalidSessionError(
        "AUTH_SESSION_SECRET is not configured",
        "MISSING_SECRET",
      );
    }
    const cookieHeader = request.headers.get("cookie");
    const token = parseCookieHeader(cookieHeader, config.cookieName);
    if (token === null) return null;

    let payload;
    try {
      payload = verifySessionToken(token, config.sessionSecret);
    } catch (err) {
      const code = err instanceof TokenError ? err.code : "UNKNOWN";
      throw new InvalidSessionError(
        `signed session cookie rejected (${code})`,
        code,
      );
    }

    const user = await getUserStore().getUserById(payload.user_id);
    if (!user) {
      throw new InvalidSessionError(
        `signed session user_id="${payload.user_id}" not found`,
        "UNKNOWN_USER",
      );
    }
    if (user.disabled_at) {
      throw new InvalidSessionError(
        `signed session user "${user.id}" is disabled (since ${user.disabled_at})`,
        "DISABLED_USER",
      );
    }

    return { actor: actorFromUser(user), source: "signed_cookie" };
  }

  async resolveActor(request: Request): Promise<AuthSession> {
    const sess = await this.resolveSession(request);
    if (sess) return sess;
    // Signed-cookie mode has NO default. A missing cookie is a real
    // auth failure — the route handler turns this into a 401 so the
    // client can render a login form.
    throw new InvalidSessionError("no session cookie present", "NO_COOKIE");
  }
}
