import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import {
  userMembershipsTable,
  membershipTiersTable,
  kycVerificationsTable,
  KYC_LEVELS_BY_TIER,
  billingOrgMembersTable,
  billingOrganizationsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { isClerkAdmin } from "./requireAdmin";

const TIER_RANK: Record<string, number> = {
  discovery: 0,
  briefing: 1,
  console: 2,
  ledger: 2, // legacy alias
  workbench: 2, // legacy alias
  platform: 3,
};

const KYC_RANK: Record<string, number> = {
  email: 0,
  identity: 1,
  biometric: 2,
  full: 3,
};

/**
 * Server-side check: does this user have an approved KYC at or above the level
 * required by `tierSlug`? Returns { ok: true } when satisfied, otherwise
 * { ok: false, requiredKycLevel } so the caller can return a structured 403
 * with the right redirect target.
 *
 * Use this in any endpoint that grants/upgrades membership server-side
 * (Stripe checkout creation, /me/membership/request, comp endpoints, etc.).
 * Frontend pre-flight is UX only — this is the actual security gate.
 */
export async function checkKycForTier(
  userId: string,
  tierSlug: string,
): Promise<{ ok: true } | { ok: false; requiredKycLevel: string }> {
  const requiredKycLevel = KYC_LEVELS_BY_TIER[tierSlug];
  if (!requiredKycLevel) return { ok: true }; // unknown tier → no KYC requirement
  const requiredRank = KYC_RANK[requiredKycLevel] ?? 0;

  const approved = await db.select()
    .from(kycVerificationsTable)
    .where(and(
      eq(kycVerificationsTable.userId, userId),
      eq(kycVerificationsTable.status, "approved"),
    ));

  const sufficient = approved.find((v) => (KYC_RANK[v.kycLevel] ?? -1) >= requiredRank);
  return sufficient ? { ok: true } : { ok: false, requiredKycLevel };
}

/**
 * Middleware factory that requires the user to have an active membership
 * at or above a minimum tier level.
 *
 * Usage: `router.use("/simulation", requireTier("console"))`
 * This allows The Console AND Platform users (anything >= rank 2).
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

    // Admins bypass every tier/KYC gate — they operate the platform, not consume it.
    if (await isClerkAdmin(userId)) {
      (req as any).userTier = "platform";
      (req as any).userId = userId;
      next();
      return;
    }

    // Find user's active personal membership + every org they belong to.
    // The effective tier is the highest of the two.
    const [personal, orgMemberships] = await Promise.all([
      db.select({ tierSlug: membershipTiersTable.slug })
        .from(userMembershipsTable)
        .innerJoin(membershipTiersTable, eq(userMembershipsTable.tierId, membershipTiersTable.id))
        .where(and(
          eq(userMembershipsTable.userId, userId),
          eq(userMembershipsTable.status, "active"),
        ))
        .limit(1),
      db.select({ tierSlug: membershipTiersTable.slug })
        .from(billingOrgMembersTable)
        .innerJoin(billingOrganizationsTable, eq(billingOrgMembersTable.orgId, billingOrganizationsTable.id))
        .innerJoin(membershipTiersTable, eq(billingOrganizationsTable.tierId, membershipTiersTable.id))
        .where(and(
          eq(billingOrgMembersTable.userId, userId),
          eq(billingOrganizationsTable.status, "active"),
        )),
    ]);

    const candidateSlugs = [personal[0]?.tierSlug, ...orgMemberships.map(o => o.tierSlug)].filter(Boolean) as string[];
    // Rank every candidate, pick the max. Default to "discovery" (free) when none.
    const userTier = candidateSlugs.length
      ? candidateSlugs.reduce((best, slug) => (TIER_RANK[slug] ?? 0) > (TIER_RANK[best] ?? 0) ? slug : best, "discovery")
      : "discovery";
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
