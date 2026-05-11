/**
 * Idempotent seed of the design-thinking pattern stories (Uber, Stripe, OpenAI).
 *
 * Imports the same SEED + upsert logic that the admin endpoint
 * POST /api/admin/patterns/seed uses, so the catalog stays in lock-step
 * across CLI (Railway boot chain) and admin trigger.
 *
 * Skip mechanism: set `SKIP_PATTERNS_SEED=1` to bypass on a deploy.
 */
import { seedDisruptionPatterns } from "../../artifacts/api-server/src/services/disruption-patterns-seed";

async function main(): Promise<void> {
  if (process.env.SKIP_PATTERNS_SEED === "1" || process.env.SKIP_PATTERNS_SEED === "true") {
    console.log("[seed-patterns] SKIP_PATTERNS_SEED set — skipping");
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("[seed-patterns] DATABASE_URL not set — refusing to run");
    process.exit(1);
  }
  try {
    const result = await seedDisruptionPatterns();
    console.log(`[seed-patterns] inserted=${result.inserted} updated=${result.updated}`);
    process.exit(0);
  } catch (err) {
    console.error("[seed-patterns] failed:", err);
    process.exit(1);
  }
}

main();
