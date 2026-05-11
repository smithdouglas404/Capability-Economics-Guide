/**
 * Idempotent seed of the 8 substantive marketplace research reports.
 *
 * Designed to be safe-on-every-restart so it can sit in the Dockerfile CMD
 * chain alongside `pnpm db push` and `pnpm seed`. Re-running the seed
 * inserts brand-new listings only on first deploy; subsequent runs update
 * description/price/featured-flag for existing rows but never duplicate.
 *
 * The seeded content (8 reports, hand-written placeholders for
 * Technology / Insurance / Healthcare / FinTech / cross-industry) lives
 * in artifacts/api-server/src/services/marketplace-seed.ts. We import it
 * here rather than duplicating, so the same catalog is reachable from:
 *  - this CLI (Railway / local one-shot)
 *  - the admin endpoint POST /api/admin/marketplace/seed-reports
 *
 * Skip mechanism: set `SKIP_MARKETPLACE_SEED=1` to bypass on a deploy.
 */
import { seedMarketplaceReports } from "../../artifacts/api-server/src/services/marketplace-seed";

async function main(): Promise<void> {
  if (process.env.SKIP_MARKETPLACE_SEED === "1" || process.env.SKIP_MARKETPLACE_SEED === "true") {
    console.log("[seed-marketplace-reports] SKIP_MARKETPLACE_SEED set — skipping");
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("[seed-marketplace-reports] DATABASE_URL not set — refusing to run");
    process.exit(1);
  }
  try {
    const result = await seedMarketplaceReports();
    console.log(`[seed-marketplace-reports] sellerId=${result.sellerId} inserted=${result.inserted} updated=${result.updated} unchanged=${result.unchanged}`);
    process.exit(0);
  } catch (err) {
    console.error("[seed-marketplace-reports] failed:", err);
    process.exit(1);
  }
}

main();
