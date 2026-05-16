import { Router } from "express";
import { db } from "@workspace/db";
import {
  nlQueryLogsTable,
  capabilitiesTable,
  capabilityEconomicsTable,
  cviComponentsTable,
  industriesTable,
  organizationsTable,
  organizationCapabilitiesTable,
  tradeSignalsTable,
} from "@workspace/db";
import { eq, sql, desc, and, gt, lt, inArray } from "drizzle-orm";
import { runNlQueryRag } from "../services/rag/nl-query";

const router = Router();

// Natural language query endpoint.
// Defaults to the Claude RAG pipeline (services/rag/nl-query.ts).
// Append ?fallback=1 to force the legacy regex-pattern path (rarely useful;
// kept for debugging only).
router.post("/nl-query", async (req, res) => {
  try {
    const { query, sessionToken } = req.body as { query: string; sessionToken?: string };
    if (!query) { res.status(400).json({ error: "query required" }); return; }

    const useFallback = req.query.fallback === "1";
    if (!useFallback) {
      try {
        const rag = await runNlQueryRag(query);
        await db.insert(nlQueryLogsTable).values({
          sessionToken,
          query,
          response: rag.answer,
          dataReturned: { citations: rag.citations, followUps: rag.followUps, classification: rag.classification, retrievedContextCount: rag.retrievedContextCount },
          modelUsed: "rag-claude",
          durationMs: rag.durationMs,
        });
        res.json({
          query,
          response: rag.answer,
          data: {
            citations: rag.citations,
            followUps: rag.followUps,
            classification: rag.classification,
          },
          durationMs: rag.durationMs,
          costCents: rag.costCents,
        });
        return;
      } catch (ragErr) {
        // If RAG fails (e.g. OPENROUTER_API_KEY missing), fall through to
        // the legacy path so the endpoint never just 500s.
        console.warn("[nl-query] RAG failed, falling back to regex path:", ragErr);
      }
    }

    const start = Date.now();
    const lowerQ = query.toLowerCase();

    // Pattern-match common query types and run appropriate DB queries
    let response = "";
    let data: any = null;

    if (lowerQ.includes("highest") && lowerQ.includes("ai") && (lowerQ.includes("risk") || lowerQ.includes("displacement") || lowerQ.includes("exposure"))) {
      // "Which capabilities have highest AI displacement risk?"
      const rows = await db.select({
        name: capabilitiesTable.name,
        industry: industriesTable.name,
        aiExposure: capabilityEconomicsTable.aiExposureScore,
        aiMonths: capabilityEconomicsTable.aiTimeToDisplacementMonths,
        quadrant: capabilityEconomicsTable.consensusQuadrant,
      })
        .from(capabilityEconomicsTable)
        .leftJoin(capabilitiesTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id))
        .leftJoin(industriesTable, eq(capabilityEconomicsTable.industryId, industriesTable.id))
        .orderBy(sql`${capabilityEconomicsTable.aiExposureScore} desc nulls last`)
        .limit(10);

      data = rows;
      response = `Top 10 capabilities by AI displacement risk:\n\n${rows.map((r, i) =>
        `${i + 1}. **${r.name}** (${r.industry}) — ${r.aiExposure?.toFixed(0) ?? "N/A"}% exposure, ${r.aiMonths?.toFixed(0) ?? "?"} months to displacement, quadrant: ${r.quadrant ?? "unknown"}`
      ).join("\n")}`;

    } else if (lowerQ.includes("lowest") && lowerQ.includes("investment") || (lowerQ.includes("underinvest") || lowerQ.includes("under-invest"))) {
      // "Which capabilities have lowest investment?"
      const rows = await db.select({
        name: capabilitiesTable.name,
        industry: industriesTable.name,
        score: cviComponentsTable.consensusScore,
        velocity: cviComponentsTable.velocity,
      })
        .from(cviComponentsTable)
        .leftJoin(capabilitiesTable, eq(cviComponentsTable.capabilityId, capabilitiesTable.id))
        .leftJoin(industriesTable, eq(cviComponentsTable.industryId, industriesTable.id))
        .orderBy(cviComponentsTable.consensusScore)
        .limit(10);

      data = rows;
      response = `Bottom 10 capabilities by consensus score (proxy for investment):\n\n${rows.map((r, i) =>
        `${i + 1}. **${r.name}** (${r.industry}) — Score: ${r.score?.toFixed(1)}, Velocity: ${r.velocity?.toFixed(2)}`
      ).join("\n")}`;

    } else if (lowerQ.includes("moat") && (lowerQ.includes("strongest") || lowerQ.includes("highest") || lowerQ.includes("best"))) {
      const rows = await db.select({
        name: capabilitiesTable.name,
        industry: industriesTable.name,
        halfLife: capabilityEconomicsTable.halfLifeMonths,
        revenue: capabilityEconomicsTable.revenueExposureMm,
        quadrant: capabilityEconomicsTable.consensusQuadrant,
      })
        .from(capabilityEconomicsTable)
        .leftJoin(capabilitiesTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id))
        .leftJoin(industriesTable, eq(capabilityEconomicsTable.industryId, industriesTable.id))
        .orderBy(sql`${capabilityEconomicsTable.halfLifeMonths} desc nulls last`)
        .limit(10);

      data = rows;
      response = `Top 10 capabilities by moat strength (half-life):\n\n${rows.map((r, i) =>
        `${i + 1}. **${r.name}** (${r.industry}) — Half-life: ${r.halfLife?.toFixed(0) ?? "N/A"} months, Revenue: $${r.revenue?.toFixed(1) ?? "?"}M, Quadrant: ${r.quadrant ?? "unknown"}`
      ).join("\n")}`;

    } else if (lowerQ.includes("evar") || lowerQ.includes("value at risk")) {
      const rows = await db.select({
        name: capabilitiesTable.name,
        industry: industriesTable.name,
        revenue: capabilityEconomicsTable.revenueExposureMm,
        halfLife: capabilityEconomicsTable.halfLifeMonths,
        margin: capabilityEconomicsTable.marginStructurePct,
      })
        .from(capabilityEconomicsTable)
        .leftJoin(capabilitiesTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id))
        .leftJoin(industriesTable, eq(capabilityEconomicsTable.industryId, industriesTable.id))
        .orderBy(sql`${capabilityEconomicsTable.revenueExposureMm} desc nulls last`)
        .limit(10);

      data = rows
        .filter((r) => r.halfLife != null && r.revenue != null && r.margin != null)
        .map((r) => {
          const hl = r.halfLife!;
          const rev = r.revenue!;
          const m = r.margin! / 100;
          return { ...r, evar12: rev * m * (1 - Math.pow(0.5, 12 / hl)), evar36: rev * m * (1 - Math.pow(0.5, 36 / hl)) };
        });
      response = data.length
        ? `Top capabilities by Enterprise Value at Risk:\n\n${(data as any[]).map((r: any, i: number) =>
            `${i + 1}. **${r.name}** (${r.industry}) — 12mo EVaR: $${r.evar12.toFixed(1)}M, 36mo EVaR: $${r.evar36.toFixed(1)}M`
      ).join("\n")}`
        : "No capabilities have complete EVaR data (revenue, margin, and half-life all required).";

    } else if (lowerQ.match(/\b(banking|insurance|healthcare|manufacturing|technology|retail)\b/)) {
      const industryName = lowerQ.match(/\b(banking|insurance|healthcare|manufacturing|technology|retail)\b/)![1];
      const [industry] = await db.select().from(industriesTable).where(sql`lower(${industriesTable.name}) like ${`%${industryName}%`}`);
      if (industry) {
        const caps = await db.select({
          name: capabilitiesTable.name,
          score: capabilitiesTable.benchmarkScore,
        })
          .from(capabilitiesTable)
          .where(and(eq(capabilitiesTable.industryId, industry.id), eq(capabilitiesTable.isLeaf, true)))
          .orderBy(sql`${capabilitiesTable.benchmarkScore} desc`);

        data = caps;
        response = `${industry.name} — ${caps.length} capabilities:\n\n${caps.map((c, i) =>
          `${i + 1}. **${c.name}** — Benchmark: ${c.score?.toFixed(0) ?? "N/A"}`
        ).join("\n")}`;
      } else {
        response = `Industry "${industryName}" not found in the database.`;
      }

    } else if (lowerQ.includes("signal") || lowerQ.includes("trade")) {
      const signals = await db.select().from(tradeSignalsTable)
        .where(eq(tradeSignalsTable.resolved, false))
        .orderBy(desc(tradeSignalsTable.strength))
        .limit(10);

      data = signals;
      response = signals.length
        ? `Active trade signals (${signals.length}):\n\n${signals.map((s, i) =>
            `${i + 1}. **${s.signal.toUpperCase()}** — Strength: ${s.strength.toFixed(0)}, Spread: ${s.spreadPct?.toFixed(1)}%, CE Quad: ${s.ceQuadrant}`
          ).join("\n")}`
        : "No active trade signals. Run signal generation first.";

    } else {
      // General capability search
      const rows = await db.select({
        name: capabilitiesTable.name,
        industry: industriesTable.name,
        score: capabilitiesTable.benchmarkScore,
        desc: capabilitiesTable.description,
      })
        .from(capabilitiesTable)
        .leftJoin(industriesTable, eq(capabilitiesTable.industryId, industriesTable.id))
        .where(sql`lower(${capabilitiesTable.name}) like ${`%${lowerQ.split(" ").slice(0, 3).join("%")}%`}`)
        .limit(10);

      if (rows.length) {
        data = rows;
        response = `Found ${rows.length} matching capabilities:\n\n${rows.map((r, i) =>
          `${i + 1}. **${r.name}** (${r.industry}) — Score: ${r.score?.toFixed(0) ?? "N/A"}`
        ).join("\n")}`;
      } else {
        response = `I searched for capabilities matching your query but didn't find specific matches. Try asking about:\n- "Which capabilities have highest AI displacement risk?"\n- "Show me EVaR leaders"\n- "Strongest moats"\n- "Banking capabilities"\n- "Active trade signals"`;
      }
    }

    const durationMs = Date.now() - start;

    // Log the query
    await db.insert(nlQueryLogsTable).values({
      sessionToken,
      query,
      response,
      dataReturned: data,
      modelUsed: "pattern-match",
      durationMs,
    });

    res.json({ query, response, data, durationMs });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get query history
router.get("/nl-query/history", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : undefined;
    const rows = token
      ? await db.select().from(nlQueryLogsTable).where(eq(nlQueryLogsTable.sessionToken, token)).orderBy(desc(nlQueryLogsTable.createdAt)).limit(20)
      : await db.select().from(nlQueryLogsTable).orderBy(desc(nlQueryLogsTable.createdAt)).limit(20);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
