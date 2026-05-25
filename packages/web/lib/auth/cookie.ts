/**
 * Tiny Cookie header helpers (Milestone 3I).
 *
 * We don't pull in a Cookie-parsing dep for two reasons:
 *
 *   1. We need exactly one cookie name (`contractops_demo_actor`) with
 *      a strictly bounded value (an actor id from a hardcoded
 *      registry). The full `Cookie` spec — RFC 6265 §4.2 — is
 *      overkill.
 *   2. The Next.js App Router's `NextResponse.cookies.set()` handles
 *      the response side. We only need to PARSE the request side, so
 *      one tiny function is enough.
 *
 * Both helpers are pure — no React, no Next — so the auth resolver
 * can run in Node tests against a constructed `Request` object.
 */

/**
 * Parse a single cookie value out of a raw `Cookie` request header.
 * Returns the URL-decoded value, or `null` if the cookie isn't set.
 *
 *   parseCookieHeader("a=1; contractops_demo_actor=lawyer_kim", "contractops_demo_actor")
 *     → "lawyer_kim"
 *
 *   parseCookieHeader("a=1; b=2", "contractops_demo_actor")
 *     → null
 *
 *   parseCookieHeader(null, "contractops_demo_actor")
 *     → null
 *
 * Duplicate names (technically allowed by RFC 6265) return the first
 * occurrence — matching what most browsers + servers do in practice.
 */
export function parseCookieHeader(
  header: string | null | undefined,
  name: string,
): string | null {
  if (!header) return null;
  const pairs = header.split(";");
  for (const raw of pairs) {
    const pair = raw.trim();
    if (pair.length === 0) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const k = pair.slice(0, eq).trim();
    if (k !== name) continue;
    const v = pair.slice(eq + 1).trim();
    try {
      return decodeURIComponent(v);
    } catch {
      // Malformed percent-encoding — return the raw value rather
      // than throwing. The auth layer will reject unknown actor ids
      // anyway, so a junk cookie just maps to InvalidSessionError.
      return v;
    }
  }
  return null;
}
