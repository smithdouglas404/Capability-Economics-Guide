/**
 * Seed the single-row `alpha_config` table with the quadrant→EV multiples
 * and the methodology link that used to live as inline constants inside
 * `pages/alpha.tsx`'s TraceabilityDialog.
 *
 * Idempotent: inserts row id=1 if missing, otherwise no-op.
 *
 * Skip with SKIP_ALPHA_CONFIG_SEED=1 in env.
 */
import { db, alphaConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const DEFAULTS = {
  quadrantHot: 15,
  quadrantEmerging: 10,
  quadrantCooling: 7,
  quadrantTableStakes: 4,
  quadrantDeclining: 1,
  methodologyUrl: "/methodology#quadrant-multiples",
};

async function main(): Promise<void> {
  if (process.env.SKIP_ALPHA_CONFIG_SEED === "1") {
    console.log("[seed:alpha-config] SKIP_ALPHA_CONFIG_SEED=1 — skipping");
    return;
  }

  const [existing] = await db.select().from(alphaConfigTable).where(eq(alphaConfigTable.id, 1));
  if (existing) {
    console.log("[seed:alpha-config] row already exists — skipping");
    return;
  }
  await db.insert(alphaConfigTable).values({
    id: 1,
    ...DEFAULTS,
  });
  console.log("[seed:alpha-config] inserted row with quadrant multiples");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed:alpha-config] failed:", err);
    process.exit(1);
  });
