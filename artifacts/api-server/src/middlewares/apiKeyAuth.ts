import type { Request, Response, NextFunction } from "express";
import { resolveApiKey } from "../services/api-keys";

/**
 * Express middleware that turns `Authorization: Bearer ce_live_...` into a
 * Clerk-compatible auth shape so `getAuth(req)` — which every existing route
 * already uses — sees the same `userId` it would for a signed-in Clerk
 * session.
 *
 * Mount AFTER `clerkMiddleware()` so a real Clerk session takes precedence.
 * The bearer token only fills in when Clerk produced no user (i.e. the caller
 * is a programmatic client, not a browser with a Clerk cookie).
 */
export function apiKeyAuth() {
  return async function apiKeyAuthMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const reqWithAuth = req as Request & { auth?: { userId?: string | null } };
    if (reqWithAuth.auth?.userId) { next(); return; }

    const header = req.headers.authorization;
    if (!header) { next(); return; }

    try {
      const result = await resolveApiKey(header);
      if (result) {
        // Minimum shape @clerk/express.getAuth returns — just enough that
        // handlers that only look at auth.userId work unchanged.
        reqWithAuth.auth = {
          userId: result.userId,
          sessionId: null,
          sessionClaims: null,
          orgId: null,
          orgRole: null,
          orgSlug: null,
          orgPermissions: [],
          actor: null,
          __type: "authenticated",
          apiKeyId: result.keyId,
          // Marker so downstream guards (requireSession) can distinguish a
          // bearer-API-key caller from a real Clerk browser session and refuse
          // sensitive operations like minting more keys.
          viaApiKey: true,
        } as unknown as typeof reqWithAuth.auth;
      }
    } catch {
      // Any lookup failure → leave req.auth untouched (will 401 at the route).
    }

    next();
  };
}
