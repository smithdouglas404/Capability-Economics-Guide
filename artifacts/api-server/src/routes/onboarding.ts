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
import { runOnboardingConcierge, type OnboardingConciergeOutput } from "../services/workflows";
import { invokeWorkflowAndWait, InngestInvokeBypassError } from "../inngest/invoke";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use("/onboarding", requireSession());

const StartBody = z.object({
  industryId: z.number().int().positive(),
  // Optional onboarding signals — captured by the multi-step guided flow.
  // They flow into the board name/description and the concierge prompt;
  // never required, so the legacy "just give me an industryId" caller path
  // continues to work unchanged.
  persona: z.enum(["pe", "vc", "f500", "student", "professor"]).nullable().optional(),
  goal: z.string().max(200).nullable().optional(),
  freeFormDescription: z.string().max(2000).nullable().optional(),
});

const SuggestBody = z.object({
  description: z.string().min(8).max(2000),
  persona: z.enum(["pe", "vc", "f500", "student", "professor"]).nullable().optional(),
});

/**
 * Free-form concierge endpoint. The user types a sentence like
 * "I'm a CFO at a regional bank looking at digital-banking risk" and the
 * onboarding-concierge workflow returns a recommended industry hint plus
 * a short narrative answer. The frontend uses this to pre-fill the
 * industry pick step. Never persists anything; always safe to call.
 */
router.post("/onboarding/suggest", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = SuggestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  const description = parsed.data.description;
  const persona = parsed.data.persona ?? null;

  // First — try to match against an existing industry by name (cheap,
  // deterministic). The concierge workflow can run alongside; whichever
  // comes back useful gets returned. Never throws on LLM failure.
  const all = await db
    .select({ id: industriesTable.id, name: industriesTable.name, slug: industriesTable.slug })
    .from(industriesTable);
  const desc = description.toLowerCase();
  let matchedIndustry: { id: number; name: string; slug: string } | null = null;
  for (const ind of all) {
    const hay = `${ind.name} ${ind.slug}`.toLowerCase();
    const tokens = hay.split(/[\s/_-]+/).filter(t => t.length > 3);
    if (tokens.some(t => desc.includes(t))) {
      matchedIndustry = ind;
      break;
    }
  }

  let conciergeAnswer: string | null = null;
  try {
    const input = {
      clerkUserId: auth.userId,
      clerkOrgId: auth.orgId ?? null,
      selectedIndustry: matchedIndustry?.name,
      signals: { freeFormDescription: description, persona },
    };
    let result: OnboardingConciergeOutput | null;
    try {
      result = await invokeWorkflowAndWait<OnboardingConciergeOutput>(
        "workflow/onboarding-concierge",
        input,
        { timeoutMs: 30_000 },
      );
    } catch (e) {
      if (e instanceof InngestInvokeBypassError) {
        result = await runOnboardingConcierge(input);
      } else {
        throw e;
      }
    }
    if (result) conciergeAnswer = result.answer;
  } catch (err) {
    logger.warn({ err }, "[onboarding] suggest: concierge call failed — returning deterministic match only");
  }

  res.json({
    suggestedIndustry: matchedIndustry,
    answer: conciergeAnswer,
  });
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

/**
 * Fetch the top-5 ranked capabilities for an industry — the same set the
 * /start endpoint would seed into a workbench board, but without creating
 * anything. Used by the onboarding preview UI to show "here's what your
 * dashboard will look like" before the user commits.
 */
async function rankTopCapabilities(industryId: number) {
  const candidates = await db
    .select({
      cap: capabilitiesTable,
      comp: cviComponentsTable,
    })
    .from(capabilitiesTable)
    .leftJoin(cviComponentsTable, eq(cviComponentsTable.capabilityId, capabilitiesTable.id))
    .where(and(
      eq(capabilitiesTable.industryId, industryId),
      eq(capabilitiesTable.reviewStatus, "approved"),
    ))
    .orderBy(asc(capabilitiesTable.id));

  const ranked = [...candidates]
    .map(r => ({
      cap: r.cap,
      comp: r.comp,
      score: r.comp?.consensusScore ?? r.cap.benchmarkScore ?? 0,
      hasComp: !!r.comp,
      isLeaf: r.cap.isLeaf,
    }))
    .sort((a, b) => {
      const aRank = (a.hasComp ? 2 : 0) + (a.isLeaf ? 1 : 0);
      const bRank = (b.hasComp ? 2 : 0) + (b.isLeaf ? 1 : 0);
      if (aRank !== bRank) return bRank - aRank;
      return b.score - a.score;
    })
    .slice(0, 5);

  return { candidates, ranked };
}

router.get("/onboarding/preview", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const industryId = Number(req.query.industryId);
  if (!Number.isFinite(industryId) || industryId <= 0) {
    res.status(400).json({ error: "industryId required" });
    return;
  }
  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
  if (!industry) { res.status(404).json({ error: "Industry not found" }); return; }
  const { ranked } = await rankTopCapabilities(industryId);
  // Average consensus score across the top-5 — close enough to a "mini CVI
  // snapshot" for the preview card without hitting the full CVI compute path.
  const scored = ranked.filter(r => r.hasComp);
  const cviPreview = scored.length > 0
    ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length)
    : null;
  res.json({
    industryName: industry.name,
    cviPreview,
    capabilities: ranked.map(r => ({
      id: r.cap.id,
      name: r.cap.name,
      description: r.cap.description,
      score: r.hasComp ? Math.round(r.score) : null,
      isLeaf: r.isLeaf,
    })),
  });
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

  const { candidates, ranked } = await rankTopCapabilities(industry.id);

  if (ranked.length === 0) {
    res.status(422).json({ error: "No capabilities available for that industry yet — try another." });
    return;
  }

  // ── Create the board ──────────────────────────────────────────────────
  // If the guided flow gathered a goal, weave it into the board description
  // so the user lands on something that reflects the framing they gave us.
  const goalSuffix = parsed.data.goal ? ` Your stated goal: "${parsed.data.goal.trim()}".` : "";
  const [board] = await db.insert(workbenchBoardsTable).values({
    clerkUserId: auth.userId,
    name: `Welcome — ${industry.name} starter board`,
    description: `Seeded by onboarding with the five highest-signal capabilities in ${industry.name}. Drag them through Scan → Frame → Ideate → Validate → Launch and run Claude actions on each card.${goalSuffix}`,
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
    const conciergeInput = {
      clerkUserId: auth.userId!,
      clerkOrgId: auth.orgId ?? null,
      selectedIndustry: industry.name,
      signals: {
        firstCapability: firstCap.name,
        score: firstComp.score,
        persona: parsed.data.persona ?? undefined,
        goal: parsed.data.goal ?? undefined,
        freeFormDescription: parsed.data.freeFormDescription ?? undefined,
      },
    };
    const workflowResult: OnboardingConciergeOutput | null = await (async () => {
      try {
        return await invokeWorkflowAndWait<OnboardingConciergeOutput>(
          "workflow/onboarding-concierge",
          conciergeInput,
          { timeoutMs: 30_000 },
        );
      } catch (e) {
        if (e instanceof InngestInvokeBypassError) {
          return await runOnboardingConcierge(conciergeInput);
        }
        logger.warn({ err: e }, "[onboarding] concierge failed — falling back to runIdeation");
        return null;
      }
    })();
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
