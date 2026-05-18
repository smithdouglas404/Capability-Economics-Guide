/**
 * First-run onboarding for the Capability Workbench.
 *
 * Goal: signed-in user picks an industry → in under 90 seconds, lands on a
 * fully populated workbench board with five top capabilities AND one
 * pre-generated Claude insight already visible on the first card.
 *
 * The insight generation is synchronous (blocking the request for 5-15s)
 * so the redirect lands on a non-empty card. If the LLM is unavailable
 * (no OpenRouter credits, all models fail), the board is still created;
 * we just skip the insight and let the user generate one themselves.
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  cviComponentsTable,
  workbenchBoardsTable,
  workbenchCardsTable,
  workbenchCardInsightsTable,
} from "@workspace/db";
import { and, eq, inArray, sql, asc } from "drizzle-orm";
import { requireSession } from "../middlewares/requireSession";
import { runIdeation, ideationCacheKey, type IdeationKind } from "../services/ideation";
import { deriveLifecycleStage } from "../services/lifecycle";
import { runOnboardingConcierge } from "../services/workflows";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use("/onboarding", requireSession());

const StartBody = z.object({
  industryId: z.number().int().positive(),
});

router.get("/onboarding/state", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  // "Has any board" is the completion check — see also workbench routes.
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(workbenchBoardsTable)
    .where(eq(workbenchBoardsTable.clerkUserId, auth.userId));
  const completed = (row?.c ?? 0) > 0;
  res.json({ completed, boardCount: row?.c ?? 0 });
});

router.post("/onboarding/start", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = StartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, parsed.data.industryId));
  if (!industry) { res.status(404).json({ error: "Industry not found" }); return; }

  // Pick top 5 capabilities for that industry. Ranking: approved + has CVI
  // component + ordered by consensusScore desc. We prefer leaf capabilities
  // since they're the most concrete to ideate against.
  const candidates = await db
    .select({
      cap: capabilitiesTable,
      comp: cviComponentsTable,
    })
    .from(capabilitiesTable)
    .leftJoin(cviComponentsTable, eq(cviComponentsTable.capabilityId, capabilitiesTable.id))
    .where(and(
      eq(capabilitiesTable.industryId, industry.id),
      eq(capabilitiesTable.reviewStatus, "approved"),
    ))
    .orderBy(asc(capabilitiesTable.id));

  // Prefer leaf + scored caps; fall back to anything in the industry.
  const ranked = [...candidates]
    .map(r => ({
      cap: r.cap,
      score: r.comp?.consensusScore ?? r.cap.benchmarkScore ?? 0,
      hasComp: !!r.comp,
      isLeaf: r.cap.isLeaf,
    }))
    .sort((a, b) => {
      // Prefer scored leaf caps first, then unscored leaf, then anything.
      const aRank = (a.hasComp ? 2 : 0) + (a.isLeaf ? 1 : 0);
      const bRank = (b.hasComp ? 2 : 0) + (b.isLeaf ? 1 : 0);
      if (aRank !== bRank) return bRank - aRank;
      return b.score - a.score;
    })
    .slice(0, 5);

  if (ranked.length === 0) {
    res.status(422).json({ error: "No capabilities available for that industry yet — try another." });
    return;
  }

  // ── Create the board ──────────────────────────────────────────────────
  const [board] = await db.insert(workbenchBoardsTable).values({
    clerkUserId: auth.userId,
    name: `Welcome — ${industry.name} starter board`,
    description: `Seeded by onboarding with the five highest-signal capabilities in ${industry.name}. Drag them through Scan → Frame → Ideate → Validate → Launch and run Claude actions on each card.`,
  }).returning();

  // ── Add the 5 cards: 3 in scan, 2 in frame ─────────────────────────────
  const lanePlan: Array<{ lane: string; position: number }> = [
    { lane: "scan", position: 0 },
    { lane: "scan", position: 1 },
    { lane: "scan", position: 2 },
    { lane: "frame", position: 0 },
    { lane: "frame", position: 1 },
  ];

  const insertedCards = await db.insert(workbenchCardsTable).values(
    ranked.map((r, i) => ({
      boardId: board.id,
      capabilityId: r.cap.id,
      lane: lanePlan[i].lane,
      position: lanePlan[i].position,
      notes: i === 0 ? "Onboarding seeded this card — click it and try a Claude action." : null,
      createdBy: auth!.userId!,
    })),
  ).returning();

  // ── Generate one Claude insight synchronously on the first card ──────
  // Picking `lifecycle_outlook` because it's the fastest (smallest token
  // budget) and produces a punchy one-paragraph judgement that immediately
  // communicates the product value.
  let firstInsightId: number | null = null;
  let insightError: string | null = null;
  const firstCard = insertedCards[0];
  const firstCap = ranked[0].cap;
  const firstComp = ranked[0];
  try {
    const ctx = {
      capabilityName: firstCap.name,
      capabilityDescription: firstCap.description,
      industryName: industry.name,
      lifecycleStage: deriveLifecycleStage({
        consensusScore: firstComp.score,
        velocity: candidates.find(c => c.cap.id === firstCap.id)?.comp?.velocity ?? null,
        benchmarkScore: firstCap.benchmarkScore,
      }),
      consensusScore: firstComp.score,
      velocity: candidates.find(c => c.cap.id === firstCap.id)?.comp?.velocity ?? null,
    };
    const kind: IdeationKind = "lifecycle_outlook";
    // When , try the in-process concierge first;
    // its answer becomes the seed insight body. Any null/error falls through
    // to the existing runIdeation path so the legacy behaviour never breaks.
    const workflowResult = await runOnboardingConcierge({
      clerkUserId: auth.userId!,
      clerkOrgId: auth.orgId ?? null,
      selectedIndustry: industry.name,
      signals: { firstCapability: firstCap.name, score: firstComp.score },
    }).catch((err) => {
      logger.warn({ err }, "[onboarding] concierge failed — falling back to runIdeation");
      return null;
    });
    const result = workflowResult
      ? { text: workflowResult.answer, bullets: [], modelUsed: "workflow/onboarding-concierge", fallbackCount: 0 }
      : await runIdeation(kind, ctx);
    const cacheKey = ideationCacheKey(kind, ctx);
    const [saved] = await db.insert(workbenchCardInsightsTable).values({
      cardId: firstCard.id,
      kind,
      cacheKey,
      body: result.text,
      bullets: result.bullets,
      modelUsed: result.modelUsed,
      fallbackCount: result.fallbackCount,
      generatedBy: auth.userId!,
    }).returning();
    firstInsightId = saved.id;
  } catch (err) {
    insightError = err instanceof Error ? err.message : String(err);
    logger.warn({ err, userId: auth.userId, industryId: industry.id }, "[onboarding] first-insight generation failed — proceeding without");
  }

  res.json({
    boardId: board.id,
    boardName: board.name,
    cardCount: insertedCards.length,
    firstInsightGenerated: firstInsightId !== null,
    firstInsightId,
    insightError,
    industryName: industry.name,
  });
});

export default router;
