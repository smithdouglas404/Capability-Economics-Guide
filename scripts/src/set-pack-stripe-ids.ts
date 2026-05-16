/**
 * Map Stripe one-time price IDs onto credit_packs rows by slug.
 *
 * Stripe Dashboard work happens in the UI (or via Stripe API): create
 * one Product per credit pack, then a one-time price for each. Copy
 * the resulting price_ID values (prefix "price_") and paste them here.
 *
 * Usage:
 *   STRIPE_PACK_IDS='{"starter":"price_ABC","growth":"price_DEF","pro":"price_GHI","power":"price_JKL"}' \
 *     pnpm --filter @workspace/scripts run set:pack-stripe-ids
 *
 * Idempotent — only updates rows whose stripePriceId is currently
 * different from the supplied value. Re-runs are safe.
 */
import { db, creditPacksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  const raw = process.env.STRIPE_PACK_IDS;
  if (!raw) {
    console.error("STRIPE_PACK_IDS env var required. Format: '{\"starter\":\"price_ABC\",\"growth\":\"price_DEF\",...}'");
    process.exit(1);
  }
  let mapping: Record<string, string>;
  try {
    mapping = JSON.parse(raw);
  } catch (err) {
    console.error("STRIPE_PACK_IDS is not valid JSON:", err);
    process.exit(1);
  }

  const entries = Object.entries(mapping);
  if (entries.length === 0) {
    console.error("STRIPE_PACK_IDS is empty.");
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [slug, priceId] of entries) {
    if (typeof priceId !== "string" || !priceId.startsWith("price_")) {
      errors.push(`${slug}: price id "${priceId}" doesn't look like a Stripe price ID (should start with "price_")`);
      continue;
    }
    const [existing] = await db.select().from(creditPacksTable).where(eq(creditPacksTable.slug, slug)).limit(1);
    if (!existing) {
      errors.push(`${slug}: no credit_packs row found — run seed:payg-tier first?`);
      continue;
    }
    if (existing.stripePriceId === priceId) {
      console.log(`  ${slug}: already set to ${priceId} (skipping)`);
      skipped++;
      continue;
    }
    await db.update(creditPacksTable).set({ stripePriceId: priceId, updatedAt: new Date() }).where(eq(creditPacksTable.slug, slug));
    console.log(`  ${slug}: updated stripePriceId from "${existing.stripePriceId ?? "(null)"}" → "${priceId}"`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} already current.`);
  if (errors.length > 0) {
    console.log("Errors:");
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(2);
  }
}

main().catch(err => {
  console.error("set:pack-stripe-ids failed:", err);
  process.exit(1);
});
