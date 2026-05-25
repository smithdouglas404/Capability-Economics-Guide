/**
 * Maintenance-mode gate driven by the system_flags.llm_enabled flag.
 *
 * When llm_enabled is "false", every /api/* request is rejected with a
 * 503 and the user-facing maintenance message — EXCEPT a small allowlist
 * needed so admins can re-enable the system:
 *
 *   - /api/health, /api/health/*       (uptime monitors)
 *   - /api/admin/system-flags          (the toggle itself)
 *   - /api/admin/system-flags/*        (other flag rotation routes)
 *
 * Login routes are NOT exempt — a disabled instance presents the
 * maintenance message at login, which is the explicit user requirement.
 *
 * Mount AFTER auth (Clerk + apiKey) so we still know who the caller is
 * for audit logging, but BEFORE the main router so no LLM-using handler
 * runs.
 */

import type { Request, Response, NextFunction } from "express";
import { isLlmEnabled, getMaintenanceMessage } from "../services/system-flags";
import { logger } from "../lib/logger";

const ALLOW_PREFIXES = [
  "/health",
  "/admin/system-flags",
];

function isAllowed(reqPath: string): boolean {
  // Express mounts this at /api so paths here are relative — e.g. "/health"
  // matches a request to /api/health.
  if (reqPath === "/health") return true;
  return ALLOW_PREFIXES.some((p) => reqPath === p || reqPath.startsWith(`${p}/`));
}

export function maintenanceGate() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isAllowed(req.path)) {
      return next();
    }
    try {
      if (await isLlmEnabled()) {
        return next();
      }
      const message = await getMaintenanceMessage();
      logger.info(
        { path: req.path, method: req.method },
        "maintenance-gate: returning 503 (llm_enabled=false)",
      );
      res.status(503).json({
        error: "maintenance",
        message,
        retryAfterSeconds: 60,
      });
      return;
    } catch (err) {
      logger.warn({ err }, "maintenance-gate: flag check failed — falling through");
      return next();
    }
  };
}
