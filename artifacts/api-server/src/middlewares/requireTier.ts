import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { userMembershipsTable, membershipTiersTable, kycVerificationsTable, KYC_LEVELS_BY_TIER } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";

const TIER_RANK: Record<string, number> = {
  discovery: 0,
  briefing: 1,
  workbench: 2,
  platform: 3,
};

const KYC_RANK: Record<string, number> = {
  email: 0,
  identity: 1,
  biometric: 2,
  full: 3,
};

/**
 * Middleware factory that requires the user to have an active membership
 * at or above a minimum tier level.
 *
 * Usage: `router.use("/simulation", requireTier("workbench"))`
 * This allows workbench AND platform users (anything >= workbench).
 */
export function requireTier(minimumTier: string) {
  const minRank = TIER_RANK[minimumTier] ?? 0;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Bypass if admin auth bypass is set (local dev)
    if (process.env.ADMIN_AUTH_BYPASS === "1") { next(); return; }

    const auth = getAuth(req);
    const userId = auth?.userId;

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Find user's active membership
    const [membership] = await db.select({
      status: userMembershipsTable.status,
      tierSlug: membershipTiersTable.slug,
    })
      .from(userMembershipsTable)
      .innerJoin(membershipTiersTable, eq(userMembershipsTable.tierId, membershipTiersTable.id))
      .where(and(
        eq(userMembershipsTable.userId, userId),
        eq(userMembershipsTable.status, "active"),
      ))
      .limit(1);

    // No membership = treat as discovery (free tier)
    const userTier = membership?.tierSlug ?? "discovery";
    const userRank = TIER_RANK[userTier] ?? 0;

    if (userRank < minRank) {
      res.status(403).json({
        error: "Upgrade required",
        currentTier: userTier,
        requiredTier: minimumTier,
        message: `This feature requires the ${minimumTier.charAt(0).toUpperCase() + minimumTier.slice(1)} tier or higher.`,
      });
      return;
    }

    // KYC enforcement: ensure the user has an approved verification at or above
    // the level required by the minimum tier. Discovery requires only email-level KYC.
    const requiredKycLevel = KYC_LEVELS_BY_TIER[minimumTier];
    if (requiredKycLevel) {
      const requiredKycRank = KYC_RANK[requiredKycLevel] ?? 0;
      const approvedKycs = await db.select()
        .from(kycVerificationsTable)
        .where(and(
          eq(kycVerificationsTable.userId, userId),
          eq(kycVerificationsTable.status, "approved"),
        ))
        .orderBy(desc(kycVerificationsTable.createdAt));

      const sufficient = approvedKycs.find((v) => (KYC_RANK[v.kycLevel] ?? -1) >= requiredKycRank);
      if (!sufficient) {
        res.status(403).json({
          error: "KYC required",
          currentTier: userTier,
          requiredTier: minimumTier,
          requiredKycLevel,
          message: `This feature requires identity verification (${requiredKycLevel} level). Complete verification at /kyc.`,
          redirectTo: `/kyc?tierSlug=${minimumTier}`,
        });
        return;
      }
    }

    // Attach tier info to request for downstream use
    (req as any).userTier = userTier;
    (req as any).userId = userId;
    next();
  };
}
