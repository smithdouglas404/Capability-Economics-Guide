import type { Request } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, adminAuditLogTable } from "@workspace/db";
import { logger } from "../lib/logger";

export type AuditAction =
  | "membership.approve"
  | "membership.reject"
  | "membership.comp"
  | "membership.hold"
  | "membership.reactivate"
  | "membership.change_tier"
  | "membership.refund"
  | "credits.grant"
  | "credits.deduct"
  | "tier.update"
  | "api_key.issue"
  | "api_key.revoke"
  | "api_key.update"
  | "data_api.request"
  | "data_api.quota_exhausted"
  | "data_api.rate_limited"
  | "impersonate.start"
  | "data.export.csv"
  | "data.export.parquet";

type LogArgs = {
  action: AuditAction;
  targetType?: string;
  targetId?: string | number | null;
  details?: Record<string, unknown>;
};

/**
 * Record an admin action in the audit log. Resolves the actor's email from
 * Clerk (best-effort) so the log stays readable even if the Clerk user is
 * later deleted. Never throws — audit logging must not break the mutation.
 */
export async function logAdminAction(req: Request, args: LogArgs): Promise<void> {
  try {
    const auth = getAuth(req);
    const actorUserId = auth?.userId ?? "shared-admin-key";
    let actorEmail: string | null = null;
    if (auth?.userId) {
      try {
        const user = await clerkClient.users.getUser(auth.userId);
        actorEmail = user.primaryEmailAddress?.emailAddress
          ?? user.emailAddresses[0]?.emailAddress
          ?? null;
      } catch {
        // Ignore — log still records the userId
      }
    }
    await db.insert(adminAuditLogTable).values({
      actorUserId,
      actorEmail,
      action: args.action,
      targetType: args.targetType ?? null,
      targetId: args.targetId != null ? String(args.targetId) : null,
      details: args.details ?? null,
    });
  } catch (err) {
    logger.warn({ err, action: args.action }, "[audit] failed to write audit log");
  }
}
