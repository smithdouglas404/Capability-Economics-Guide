import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAdminAction } from "../services/audit-log";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Admin impersonation via Clerk Actor Tokens. Returns a short-lived URL that
 * the admin's browser can follow to start a session as the target user. The
 * session carries the admin's original userId as `actor.sub` so downstream
 * logs know who is really performing any actions.
 *
 * Requires CLERK_SECRET_KEY. The actor token has a 60-second TTL.
 */
router.post("/admin/members/:userId/impersonate", requireAdmin, async (req, res) => {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) { res.status(503).json({ error: "CLERK_SECRET_KEY not configured" }); return; }

  const targetUserId = String(req.params.userId);
  if (!targetUserId) { res.status(400).json({ error: "bad userId" }); return; }

  const auth = getAuth(req);
  const actorUserId = auth?.userId;
  if (!actorUserId) { res.status(401).json({ error: "admin not signed in" }); return; }

  try {
    const response = await fetch("https://api.clerk.com/v1/actor_tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: targetUserId,
        actor: { sub: actorUserId },
        expires_in_seconds: 60,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn({ status: response.status, text }, "[impersonate] clerk actor_tokens failed");
      res.status(response.status).json({ error: "Clerk rejected the request", detail: text });
      return;
    }

    const token = await response.json() as { id: string; token: string; url?: string };

    await logAdminAction(req, {
      action: "impersonate.start",
      targetType: "user",
      targetId: targetUserId,
      details: { actorTokenId: token.id },
    });

    res.json({
      token: token.token,
      url: token.url ?? null,
      expiresInSeconds: 60,
      hint: "Navigate to `url` (or construct the ticket URL) within 60 seconds to establish a session as the target user.",
    });
  } catch (err) {
    logger.error({ err }, "[impersonate] failed");
    res.status(500).json({ error: "Impersonation failed", message: (err as Error).message });
  }
});

export default router;
