import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  userMembershipsTable,
  membershipTiersTable,
  creditAccountsTable,
  creditTransactionsTable,
  creditPurchasesTable,
  kycVerificationsTable,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GDPR-style data export. Returns every piece of per-user data we hold in one
 * downloadable JSON payload. The client sets `Content-Disposition` so browsers
 * offer it as a file download.
 */
router.get("/me/export", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [memberships, creditAccount, transactions, purchases, kyc] = await Promise.all([
    db.select().from(userMembershipsTable).where(eq(userMembershipsTable.userId, auth.userId)).orderBy(desc(userMembershipsTable.requestedAt)),
    db.select().from(creditAccountsTable).where(eq(creditAccountsTable.userId, auth.userId)),
    db.select().from(creditTransactionsTable).where(eq(creditTransactionsTable.userId, auth.userId)).orderBy(desc(creditTransactionsTable.createdAt)),
    db.select().from(creditPurchasesTable).where(eq(creditPurchasesTable.userId, auth.userId)).orderBy(desc(creditPurchasesTable.createdAt)),
    db.select().from(kycVerificationsTable).where(eq(kycVerificationsTable.userId, auth.userId)).orderBy(desc(kycVerificationsTable.createdAt)),
  ]);

  const tiers = await db.select().from(membershipTiersTable);
  const tierMap = new Map(tiers.map(t => [t.id, t]));
  const enrichedMemberships = memberships.map(m => ({ ...m, tier: tierMap.get(m.tierId) ?? null }));

  const payload = {
    exportedAt: new Date().toISOString(),
    userId: auth.userId,
    memberships: enrichedMemberships,
    creditAccount: creditAccount[0] ?? null,
    transactions,
    purchases,
    kyc,
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="capability-economics-data-${auth.userId}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

/** User-initiated cancellation of their own active membership. Sets status to cancelled (on hold). */
router.post("/me/membership/cancel", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [current] = await db
    .select()
    .from(userMembershipsTable)
    .where(eq(userMembershipsTable.userId, auth.userId))
    .orderBy(desc(userMembershipsTable.requestedAt))
    .limit(1);
  if (!current) { res.status(404).json({ error: "No membership found" }); return; }
  if (current.status !== "active") { res.status(409).json({ error: "Only active memberships can be cancelled", current: current.status }); return; }
  await db.update(userMembershipsTable).set({
    status: "cancelled",
    notes: `${current.notes ?? ""}\n[user] Cancelled by user at ${new Date().toISOString()}`.trim(),
    updatedAt: new Date(),
  }).where(eq(userMembershipsTable.id, current.id));
  res.json({ ok: true, membershipId: current.id });
});

export default router;
