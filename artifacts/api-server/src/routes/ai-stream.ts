/**
 * Streaming AI endpoints — Move 10b of the strategic UX overhaul.
 *
 * Two surfaces get token-by-token streamed output via the Vercel AI SDK:
 *   POST /api/insights/stream                  — industry-level "what should we do" brief
 *   POST /api/capabilities/:id/recommendations/stream — capability-level persona-framed rec
 *
 * Mirrors the /upload-analysis/text-stream pattern: extract the inputs
 * synchronously, then pipe streamText.textStream directly to the response.
 * Client uses @ai-sdk/react useCompletion with streamProtocol: "text".
 *
 * Neither endpoint persists output — these are read-side ad-hoc streams.
 * The admin /insights/generate (writes capability_insights) and the cached
 * /capabilities/:id/recommendations remain for durable storage.
 */
import { Router, type IRouter } from "express";
import { streamText } from "ai";
import { db, industriesTable, capabilitiesTable, capabilityThresholdsTable, cviComponentsTable, dvxComponentsTable, organizationsTable, organizationCapabilitiesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { sonnet } from "../services/workflows/models";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const PERSONA_VOICE: Record<string, string> = {
  pe: "Write for a private equity associate prepping an IC memo. Lead with deal implication (gap-to-leader, cost-to-close, multiple sensitivity). End with the highest-risk caveat.",
  vc: "Write for a venture associate writing a thesis memo. Lead with where capability value is migrating; end with the one founder-question worth asking.",
  f500: "Write for a Fortune 500 strategy lead. Lead with the peer-cohort gap and end with the recommended action (build / buy / partner).",
  student: "Write pedagogically. Define one key term inline, walk through the reasoning, end with one question to think about.",
  professor: "Write academically. Cite methodology, distinguish observation from inference, flag uncertainty appropriately.",
};
const PERSONA_VOICE_DEFAULT = "Write a tight strategic brief: 3-5 sections, plain markdown.";

/**
 * POST /api/insights/stream
 * Body: { industryId, persona?, context? }
 * Streams a markdown brief about the industry's current capability posture.
 */
router.post("/insights/stream", async (req, res) => {
  try {
    const industryId = Number(req.body?.industryId);
    const personaKey = typeof req.body?.persona === "string" ? req.body.persona : null;
    const context = typeof req.body?.context === "string" ? req.body.context.slice(0, 1000) : "";
    // useCompletion's default body uses `prompt` — accept it as an alias for context.
    const userPrompt = typeof req.body?.prompt === "string" ? req.body.prompt.slice(0, 1000) : context;
    if (!Number.isFinite(industryId)) { res.status(400).json({ error: "industryId required" }); return; }

    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId)).limit(1);
    if (!industry) { res.status(404).json({ error: "industry not found" }); return; }

    const rows = await db
      .select({
        name: capabilitiesTable.name,
        score: cviComponentsTable.consensusScore,
        velocity: cviComponentsTable.velocity,
        dvx: dvxComponentsTable.disruptionScore,
        valueChainStage: capabilitiesTable.valueChainStage,
      })
      .from(capabilitiesTable)
      .leftJoin(cviComponentsTable, eq(cviComponentsTable.capabilityId, capabilitiesTable.id))
      .leftJoin(dvxComponentsTable, eq(dvxComponentsTable.capabilityId, capabilitiesTable.id))
      .where(eq(capabilitiesTable.industryId, industryId));

    // Digest only the top 20 capabilities by absolute DVX so the prompt
    // stays bounded — full lists slow generation without adding signal.
    const ranked = rows
      .map(r => ({ ...r, dvxAbs: Math.abs(r.dvx ?? 0) }))
      .sort((a, b) => b.dvxAbs - a.dvxAbs)
      .slice(0, 20)
      .map(r => `- ${r.name} [${r.valueChainStage ?? "—"}] CVI=${r.score?.toFixed(1) ?? "—"} velocity=${r.velocity?.toFixed(2) ?? "—"} DVX=${r.dvx?.toFixed(1) ?? "—"}`)
      .join("\n");

    const voice = (personaKey && PERSONA_VOICE[personaKey]) || PERSONA_VOICE_DEFAULT;

    const stream = streamText({
      model: sonnet,
      system: `You are a capability-economics strategist. Output pure Markdown — no preamble, no code fences. Always include these sections: ## Where to focus, ## What's at risk, ## Next actions, ## Watch list.\n\n${voice}`,
      prompt: `Industry: ${industry.name}

Top 20 capabilities ranked by |DVX| (disruption pressure):
${ranked}

${userPrompt ? `Additional context from the user:\n${userPrompt}\n` : ""}
Now write the strategic brief.`,
      temperature: 0.4,
      maxTokens: 1500,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Transfer-Encoding", "chunked");
    for await (const chunk of stream.textStream) res.write(chunk);
    res.end();
  } catch (err) {
    logger.error({ err }, "[insights/stream] failed");
    if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : "stream failed" });
    else res.end();
  }
});

/**
 * POST /api/capabilities/:id/recommendations/stream
 * Body: { persona?, prompt? (extra context) }
 * Streams a fresh, persona-framed recommendation for the capability.
 * Doesn't cache — for that path use GET /capabilities/:id/recommendations.
 */
router.post("/capabilities/:id/recommendations/stream", async (req, res) => {
  try {
    const capId = Number(req.params.id);
    if (!Number.isFinite(capId)) { res.status(400).json({ error: "bad id" }); return; }
    const personaKey = typeof req.body?.persona === "string" ? req.body.persona : null;
    const userPrompt = typeof req.body?.prompt === "string" ? req.body.prompt.slice(0, 1000) : "";

    const [row] = await db
      .select({
        name: capabilitiesTable.name,
        description: capabilitiesTable.description,
        industryName: industriesTable.name,
        score: cviComponentsTable.consensusScore,
        velocity: cviComponentsTable.velocity,
        dvx: dvxComponentsTable.disruptionScore,
        valueChainStage: capabilitiesTable.valueChainStage,
      })
      .from(capabilitiesTable)
      .leftJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
      .leftJoin(cviComponentsTable, eq(cviComponentsTable.capabilityId, capabilitiesTable.id))
      .leftJoin(dvxComponentsTable, eq(dvxComponentsTable.capabilityId, capabilitiesTable.id))
      .where(eq(capabilitiesTable.id, capId))
      .limit(1);
    if (!row) { res.status(404).json({ error: "capability not found" }); return; }

    const voice = (personaKey && PERSONA_VOICE[personaKey]) || PERSONA_VOICE_DEFAULT;
    const stream = streamText({
      model: sonnet,
      system: `You are a capability-economics strategist. Output pure Markdown — no preamble, no code fences. Sections: ## Read of the data, ## Recommendation, ## What to watch.\n\n${voice}`,
      prompt: `Capability: ${row.name}
Industry: ${row.industryName ?? "—"}
Value chain stage: ${row.valueChainStage ?? "—"}
CVI: ${row.score?.toFixed(1) ?? "—"} (velocity ${row.velocity?.toFixed(2) ?? "—"})
DVX: ${row.dvx?.toFixed(1) ?? "—"}

Description: ${row.description ?? "—"}

${userPrompt ? `Additional context from the user:\n${userPrompt}\n` : ""}
Now write the persona-framed recommendation.`,
      temperature: 0.4,
      maxTokens: 1200,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Transfer-Encoding", "chunked");
    for await (const chunk of stream.textStream) res.write(chunk);
    res.end();
  } catch (err) {
    logger.error({ err }, "[capabilities/recommendations/stream] failed");
    if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : "stream failed" });
    else res.end();
  }
});

/**
 * POST /api/scorecard/stream
 * Body: { industryId, sessionToken?, persona?, prompt? }
 * Streams a gap-closure plan grounded in the user's actual scorecard.
 * Pulls RED-status capabilities (below cohort yellowMin), reads each
 * gap's EVaR + moat score, and asks Claude for a build/buy/partner
 * recommendation per row. When sessionToken is present we use the
 * user's own organization; otherwise we fall back to the
 * industry-average baseline.
 */
router.post("/scorecard/stream", async (req, res) => {
  try {
    const industryId = Number(req.body?.industryId);
    if (!Number.isFinite(industryId)) { res.status(400).json({ error: "industryId required" }); return; }
    const sessionToken = typeof req.body?.sessionToken === "string" ? req.body.sessionToken : null;
    const personaKey = typeof req.body?.persona === "string" ? req.body.persona : null;
    const userPrompt = typeof req.body?.prompt === "string" ? req.body.prompt.slice(0, 1000) : "";

    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId)).limit(1);
    if (!industry) { res.status(404).json({ error: "industry not found" }); return; }

    // Pull capabilities + thresholds + user's score (if any).
    const rows = await db
      .select({
        capId: capabilitiesTable.id,
        name: capabilitiesTable.name,
        cviScore: cviComponentsTable.consensusScore,
        cviVelocity: cviComponentsTable.velocity,
        dvxScore: dvxComponentsTable.disruptionScore,
        valueChainStage: capabilitiesTable.valueChainStage,
        greenMin: capabilityThresholdsTable.greenMin,
        yellowMin: capabilityThresholdsTable.yellowMin,
      })
      .from(capabilitiesTable)
      .leftJoin(cviComponentsTable, eq(cviComponentsTable.capabilityId, capabilitiesTable.id))
      .leftJoin(dvxComponentsTable, eq(dvxComponentsTable.capabilityId, capabilitiesTable.id))
      .leftJoin(capabilityThresholdsTable, eq(capabilityThresholdsTable.capabilityId, capabilitiesTable.id))
      .where(eq(capabilitiesTable.industryId, industryId));

    // User scores if signed-in session is present.
    let userScores = new Map<number, number>();
    let userOrgName: string | null = null;
    if (sessionToken) {
      const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken)).limit(1);
      if (org) {
        userOrgName = org.name;
        const ocs = await db.select().from(organizationCapabilitiesTable).where(eq(organizationCapabilitiesTable.organizationId, org.id));
        for (const oc of ocs) userScores.set(oc.capabilityId, oc.maturityScore);
      }
    }

    // Rank: gap to greenMin (or yellow if green not set), then by DVX impact.
    const gaps = rows.map(r => {
      const myScore = userScores.get(r.capId) ?? r.cviScore ?? 50;
      const target = r.greenMin ?? r.yellowMin ?? 70;
      return { ...r, myScore, target, gap: target - myScore };
    }).filter(g => g.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 12);

    if (gaps.length === 0) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.write(`# Gap-closure plan — ${industry.name}\n\nNo capability gaps detected at the green-threshold band. Your scorecard is in healthy territory.\n`);
      res.end();
      return;
    }

    const digest = gaps.map(g => `- **${g.name}** [stage: ${g.valueChainStage ?? "—"}] · your score: ${g.myScore.toFixed(1)} · target: ${g.target} · gap: ${g.gap.toFixed(1)} · DVX: ${g.dvxScore?.toFixed(1) ?? "—"}`).join("\n");

    const voice = (personaKey && PERSONA_VOICE[personaKey]) || PERSONA_VOICE_DEFAULT;
    const stream = streamText({
      model: sonnet,
      system: `You write capability-gap closure plans. Output pure Markdown — no preamble, no code fences. For each gap give: 1) the build/buy/partner recommendation, 2) an order-of-magnitude cost estimate, 3) which DVX flag means urgency. Group by stage of value chain. Sections: ## Closure plan summary, ## Top priorities (3-5 gaps with full treatment), ## Watch list (remaining gaps with shorter notes).\n\n${voice}`,
      prompt: `Industry: ${industry.name}
${userOrgName ? `Organization: ${userOrgName}` : "Mode: industry-average baseline (no specific org)"}

Capability gaps (where your score is below the green-threshold band):
${digest}

${userPrompt ? `User context:\n${userPrompt}\n` : ""}
Write the closure plan.`,
      temperature: 0.4,
      maxTokens: 1800,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Transfer-Encoding", "chunked");
    for await (const chunk of stream.textStream) res.write(chunk);
    res.end();
  } catch (err) {
    logger.error({ err }, "[scorecard/stream] failed");
    if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : "stream failed" });
    else res.end();
  }
});

/**
 * POST /api/vcr/draft-brief/stream
 * Body: { prompt? (user's framing), persona? }
 * Streams a "preview brief" of how the Virtual Capability Engineer would
 * frame the engagement before the user kicks off the multi-day full run.
 * Lets them iterate on the brief cheaply before committing budget.
 */
router.post("/vcr/draft-brief/stream", async (req, res) => {
  try {
    const userPrompt = typeof req.body?.prompt === "string" ? req.body.prompt.slice(0, 4000) : "";
    const personaKey = typeof req.body?.persona === "string" ? req.body.persona : null;
    if (userPrompt.trim().length < 20) { res.status(400).json({ error: "Type at least 20 characters describing the engagement." }); return; }

    const voice = (personaKey && PERSONA_VOICE[personaKey]) || PERSONA_VOICE_DEFAULT;
    const stream = streamText({
      model: sonnet,
      system: `You are a strategy associate framing a research engagement. Output pure Markdown — no preamble, no code fences. Sections: ## Engagement frame (what we'd be researching), ## Capability hypotheses (3-5 the engineer would investigate), ## Research questions (5-8 specific questions the engineer would answer), ## Decision the buyer gets (what they'd be able to decide after the full run completes).\n\n${voice}\n\nThis is a PREVIEW — flag any vague inputs the user should sharpen before running the full multi-day research campaign.`,
      prompt: `User's framing of the engagement:

${userPrompt}

Now write the preview brief.`,
      temperature: 0.4,
      maxTokens: 1500,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Transfer-Encoding", "chunked");
    for await (const chunk of stream.textStream) res.write(chunk);
    res.end();
  } catch (err) {
    logger.error({ err }, "[vcr/draft-brief/stream] failed");
    if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : "stream failed" });
    else res.end();
  }
});

export default router;
