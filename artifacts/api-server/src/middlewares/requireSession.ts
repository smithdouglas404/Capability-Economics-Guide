import type { Request, Response, NextFunction } from "express";

/**
 * Reject requests that are authenticated only via an API key (Bearer token).
 * Use on developer key-management endpoints (`/me/api-keys*`) so a holder of
 * a scoped v1 API key cannot escalate by minting a broader key for itself.
 *
 * Must be mounted AFTER `clerkMiddleware()` and `apiKeyAuth()`.
 */
export function requireSession() {
  return function requireSessionMiddleware(req: Request, res: Response, next: NextFunction): void {
    const auth = (req as Request & { auth?: { userId?: string | null; viaApiKey?: boolean } }).auth;
    if (!auth?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (auth.viaApiKey) {
      res.status(403).json({
        error: "Session required",
        message: "API-key auth cannot be used to manage API keys. Sign in with your account.",
      });
      return;
    }
    next();
  };
}
