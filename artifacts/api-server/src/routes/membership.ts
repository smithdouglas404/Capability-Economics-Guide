import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { membershipTiersTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { z } from "zod/v4";

const router: IRouter = Router();

const DEFAULT_TIERS = [
  {
    slug: "briefing",
    name: "Briefing",
    tagline: "Read the framework. See the data.",
    description:
      "For analysts, board members, and consultants who need the Capability Economics framework and the curated research without running their own studies.",
    monthlyPriceCents: 29900,
    annualPriceCents: 299000,
    isContactSales: false,
    priceLocked: false,
    displayOrder: 1,
    features: [
      "Read access to all 58 curated capabilities across 6 industries",
      "Full economic narratives: traditional vs economic view, with $ figures",
      "AI exposure scores + time-to-displacement for every capability",
      "Knowledge graph and force-directed dependency view",
      "C-Suite perspectives by role",
      "Weekly insights feed and case studies",
      "Single seat",
    ],
    ctaLabel: "Start Briefing",
    highlight: false,
    active: true,
  },
  {
    slug: "workbench",
    name: "Workbench",
    tagline: "Run the analysis on your own situation.",
    description:
      "For operating executives doing internal strategy work — bring your own org, your own assessments, and your own short list of capabilities into the framework.",
    monthlyPriceCents: 149900,
    annualPriceCents: 1499000,
    isContactSales: false,
    priceLocked: false,
    displayOrder: 2,
    features: [
      "Everything in Briefing",
      "Run your own assessments (voice, document, job posting → analysis)",
      "Build and save an organization profile",
      "Project management and saved exports",
      "Submit up to 10 custom capabilities per month into the review queue",
      "CE Alpha portfolio scoring",
      "Up to 5 seats",
    ],
    ctaLabel: "Start Workbench",
    highlight: true,
    active: true,
  },
  {
    slug: "platform",
    name: "Platform",
    tagline: "The full Capability Economics engine, on your industries.",
    description:
      "For PE firms, large enterprise strategy teams, and consulting firms who need bespoke industry coverage, full review-queue control, and an analyst on call.",
    monthlyPriceCents: null,
    annualPriceCents: 2500000,
    isContactSales: true,
    priceLocked: true,
    displayOrder: 3,
    features: [
      "Everything in Workbench, with no caps",
      "Autonomous discovery agent — generate capability research for any industry you ask for",
      "Full review queue admin: approve, reject-with-comment, terminate",
      "Custom industries and bespoke c-suite role mappings",
      "API access, SSO, audit logs",
      "Quarterly analyst briefing and white-label reports",
      "Unlimited seats",
    ],
    ctaLabel: "Talk to sales",
    highlight: false,
    active: true,
  },
];

async function ensureSeeded() {
  const existing = await db.select().from(membershipTiersTable);
  if (existing.length === 0) {
    await db.insert(membershipTiersTable).values(DEFAULT_TIERS);
  }
}

router.get("/membership/tiers", async (_req, res) => {
  await ensureSeeded();
  const tiers = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.active, true)).orderBy(asc(membershipTiersTable.displayOrder));
  res.json(tiers);
});

router.get("/membership/tiers/all", async (_req, res) => {
  await ensureSeeded();
  const tiers = await db.select().from(membershipTiersTable).orderBy(asc(membershipTiersTable.displayOrder));
  res.json(tiers);
});

const PatchBody = z.object({
  name: z.string().min(2).max(80).optional(),
  tagline: z.string().min(2).max(200).optional(),
  description: z.string().min(2).max(2000).optional(),
  monthlyPriceCents: z.number().int().min(0).max(100000000).nullable().optional(),
  annualPriceCents: z.number().int().min(0).max(100000000).nullable().optional(),
  features: z.array(z.string().min(1).max(300)).max(20).optional(),
  ctaLabel: z.string().min(2).max(40).optional(),
  highlight: z.boolean().optional(),
  active: z.boolean().optional(),
  isContactSales: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(99).optional(),
});

router.patch("/membership/tiers/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [existing] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  if (existing.priceLocked && (parsed.data.annualPriceCents !== undefined || parsed.data.monthlyPriceCents !== undefined)) {
    res.status(403).json({ error: `Tier "${existing.name}" has its price locked. Unlock it in the schema if you really need to change.` });
    return;
  }
  await db.update(membershipTiersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(membershipTiersTable.id, id));
  const [updated] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, id));
  res.json(updated);
});

export default router;
