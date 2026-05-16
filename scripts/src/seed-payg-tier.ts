/**
 * Seed the Pay-as-you-go (payg) membership tier and its credit pack catalog.
 *
 * Inserts a new `payg` row into membership_tiers between discovery (free)
 * and briefing (subscription) — non-subscription, only requires email-level
 * KYC, lets users prepay credits via the credit pack catalog.
 *
 * Inserts the 4 default credit packs:
 *   Starter  $2.50  → 1,000   credits  (sticker)
 *   Growth   $10    → 4,500   credits  (+11% bonus)
 *   Pro      $25    → 12,000  credits  (+20% bonus)
 *   Power    $100   → 55,000  credits  (+37% bonus)
 *
 * All four are admin-editable post-seed (creditPacksTable is just a table).
 *
 * Idempotent: inserts only if rows don't already exist, otherwise no-op.
 * Skip with SKIP_PAYG_SEED=1 in env.
 */
import { db, membershipTiersTable, creditPacksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const PAYG_TIER = {
  slug: "payg",
  name: "Pay as you go",
  tagline: "Prepay for credits — no subscription required",
  description:
    "Buy credits in packs as you need them. Credits expire 1 year after purchase. Full access to assessments, enrichment, research, and marketplace browsing. Upgrade to a subscription tier anytime to unlock monthly allocations and team features.",
  monthlyPriceCents: null,
  annualPriceCents: null,
  seatPriceCents: null,
  isContactSales: false,
  priceLocked: true,
  displayOrder: 5, // between discovery (0) and briefing (10)
  features: [
    "No subscription — pay only for what you use",
    "Credits expire 1 year after purchase",
    "Full access to assessments, research, and enrichment",
    "Browse marketplace + capability detail pages",
    "Upgrade to subscription tier anytime",
  ],
  ctaLabel: "Buy credits",
  highlight: false,
  active: true,
};

const PACKS = [
  {
    slug: "starter",
    displayName: "Starter",
    description: "1,000 credits — try the platform with about 125 research queries or 125 assessments.",
    priceCents: 250,
    creditAmount: 1000,
    displayOrder: 10,
    highlight: null,
  },
  {
    slug: "growth",
    displayName: "Growth",
    description: "4,500 credits with an 11% bonus. Good for ongoing capability research.",
    priceCents: 1000,
    creditAmount: 4500,
    displayOrder: 20,
    highlight: null,
  },
  {
    slug: "pro",
    displayName: "Pro",
    description: "12,000 credits with a 20% bonus. Enough for sustained team-scale research and assessments.",
    priceCents: 2500,
    creditAmount: 12000,
    displayOrder: 30,
    highlight: "most-popular",
  },
  {
    slug: "power",
    displayName: "Power",
    description: "55,000 credits with a 37% bonus. Heavy users; suitable for VCE cycles + C-suite perspectives.",
    priceCents: 10000,
    creditAmount: 55000,
    displayOrder: 40,
    highlight: "best-value",
  },
];

async function main() {
  if (process.env.SKIP_PAYG_SEED === "1") {
    console.log("SKIP_PAYG_SEED=1 — skipping payg tier + credit pack seed.");
    return;
  }

  // Tier
  const [existingTier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.slug, PAYG_TIER.slug)).limit(1);
  if (existingTier) {
    console.log(`Tier '${PAYG_TIER.slug}' already exists (id=${existingTier.id}) — skipping tier insert.`);
  } else {
    const [inserted] = await db.insert(membershipTiersTable).values(PAYG_TIER).returning();
    console.log(`Inserted tier '${inserted.slug}' (id=${inserted.id}).`);
  }

  // Packs
  let packsInserted = 0;
  let packsSkipped = 0;
  for (const pack of PACKS) {
    const [existing] = await db.select().from(creditPacksTable).where(eq(creditPacksTable.slug, pack.slug)).limit(1);
    if (existing) {
      packsSkipped++;
      continue;
    }
    await db.insert(creditPacksTable).values(pack);
    packsInserted++;
  }
  console.log(`Credit packs: ${packsInserted} inserted, ${packsSkipped} already existed.`);
}

main().catch((err) => {
  console.error("Payg seed failed:", err);
  process.exit(1);
});
