import { Router, type IRouter } from "express";
import {
  listActiveEvents,
  listAllEvents,
  createMacroEvent,
  deleteMacroEvent,
  computeGlobalMacroShock,
  runWorldScanAllIndustries,
  type EventType,
  type SentimentDirection,
  getCapabilityImpactExplanations,
} from "../services/macro-events";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/macro-events", async (_req, res) => {
  try {
    const all = await listAllEvents();
    res.json({ events: all, total: all.length });
  } catch (err) {
    console.error("macro-events list failed:", err);
    res.status(500).json({ error: "Failed to list events" });
  }
});

// Fire-and-forget trigger that runs inside the api-server process (survives shell exits).
// Triggers (1) world-scan replacement of stale events with cap-tagged versions, and
// (2) backfill triangulation of all currently un-triangulated children.
router.post("/macro-events/_trigger-backfill", async (_req, res) => {
  const { runWorldScanAllIndustries } = await import("../services/macro-events");
  const { triangulateCapability } = await import("../services/triangulation");
  const { db: _db } = await import("@workspace/db");
  const { capabilitiesTable: _caps, industriesTable: _inds, sourceTriangulationsTable: _tri } = await import("@workspace/db");
  res.json({ started: true, ts: new Date().toISOString() });
  // World-scan in background (refreshes events with cap tags via the new prompt)
  setImmediate(async () => {
    try {
      console.log("[trigger] world-scan starting");
      const r = await runWorldScanAllIndustries();
      console.log("[trigger] world-scan done:", JSON.stringify(r.perIndustry));
    } catch (err) { console.error("[trigger] world-scan error:", err); }
  });
  // Triangulation backfill in background (Perplexity, ~5-10 min)
  setImmediate(async () => {
    try {
      console.log("[trigger] triangulation backfill starting");
      const all = await _db.select({ id: _caps.id, name: _caps.name, industryId: _caps.industryId, parentId: _caps.parentCapabilityId }).from(_caps);
      const inds = await _db.select().from(_inds);
      const indMap = new Map(inds.map((i) => [i.id, i.name]));
      const triRows = await _db.select({ capId: _tri.capabilityId }).from(_tri);
      const haveTri = new Set(triRows.map((t) => t.capId));
      const targets = all.filter((c) => c.parentId !== null && !haveTri.has(c.id));
      console.log(`[trigger] ${targets.length} children to triangulate`);
      const CONCURRENCY = 4;
      let done = 0, failed = 0;
      for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const batch = targets.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (cap) => {
          const industryName = indMap.get(cap.industryId) || "Unknown";
          try {
            await triangulateCapability(industryName, cap.name, cap.industryId, cap.id);
            done++;
            if (done % 10 === 0) console.log(`[trigger] tri ${done}/${targets.length} (${failed} failed)`);
          } catch (err) {
            failed++;
            console.error(`[trigger] tri fail ${industryName}/${cap.name}:`, err instanceof Error ? err.message : err);
          }
        }));
      }
      console.log(`[trigger] triangulation backfill complete: ${done} ok, ${failed} failed`);
    } catch (err) { console.error("[trigger] triangulation error:", err); }
  });
});

router.get("/macro-events/affected-capabilities", async (_req, res) => {
  try {
    const impacts = await getCapabilityImpactExplanations();
    res.json({ impacts });
  } catch (err) {
    console.error("affected-capabilities failed:", err);
    res.status(500).json({ error: "Failed to compute capability impacts" });
  }
});

router.get("/macro-events/active", async (_req, res) => {
  try {
    const [active, shock] = await Promise.all([listActiveEvents(), computeGlobalMacroShock()]);
    res.json({
      active,
      shock,
      summary: {
        total: active.length,
        avgSeverity: active.length ? Math.round((active.reduce((s, e) => s + e.severity, 0) / active.length) * 10) / 10 : 0,
        sentimentShock: shock.sentimentShock,
        volatilityBoost: shock.volatilityBoost,
      },
    });
  } catch (err) {
    console.error("macro-events active failed:", err);
    res.status(500).json({ error: "Failed to get active events" });
  }
});

const VALID_TYPES: EventType[] = ["war", "regulation", "tech_shift", "economic", "disaster", "other"];
const VALID_DIRECTIONS: SentimentDirection[] = ["positive", "negative", "neutral"];

const VALID_MACRO_SOURCES = ["admin", "world_scan", "manual"] as const;

router.post("/macro-events", requireAdmin, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const eventType = String(body.eventType ?? "other") as EventType;
    if (!VALID_TYPES.includes(eventType)) {
      res.status(400).json({ error: "Invalid eventType" });
      return;
    }
    const sentimentDirection = String(body.sentimentDirection ?? "negative") as SentimentDirection;
    if (!VALID_DIRECTIONS.includes(sentimentDirection)) {
      res.status(400).json({ error: "Invalid sentimentDirection" });
      return;
    }
    const severity = Number(body.severity);
    if (!Number.isFinite(severity) || severity < 0 || severity > 10) {
      res.status(400).json({ error: "severity must be 0-10" });
      return;
    }
    const title = String(body.title ?? "").trim();
    if (!title) {
      res.status(400).json({ error: "title required" });
      return;
    }
    const description = String(body.description ?? "").trim();

    const rawSource = typeof body.source === "string" ? body.source.trim() : "";
    const source = (VALID_MACRO_SOURCES as readonly string[]).includes(rawSource)
      ? (rawSource as (typeof VALID_MACRO_SOURCES)[number])
      : "admin";

    const event = await createMacroEvent({
      eventType,
      severity,
      title,
      description,
      affectedIndustryIds: Array.isArray(body.affectedIndustryIds) ? (body.affectedIndustryIds as number[]).map(Number).filter(Number.isFinite) : [],
      affectedCapabilityIds: Array.isArray(body.affectedCapabilityIds) ? (body.affectedCapabilityIds as number[]).map(Number).filter(Number.isFinite) : [],
      sentimentDirection,
      decayDays: Number.isFinite(Number(body.decayDays)) ? Number(body.decayDays) : 14,
      source,
      createdBy: "admin",
    });
    res.json({ event });
  } catch (err) {
    console.error("macro-events create failed:", err);
    res.status(500).json({ error: "Failed to create event" });
  }
});

router.delete("/macro-events/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const ok = await deleteMacroEvent(id);
    res.json({ deleted: ok });
  } catch (err) {
    console.error("macro-events delete failed:", err);
    res.status(500).json({ error: "Failed to delete event" });
  }
});

router.post("/macro-events/scan-now", requireAdmin, async (_req, res) => {
  try {
    const result = await runWorldScanAllIndustries();
    res.json(result);
  } catch (err) {
    console.error("macro-events scan failed:", err);
    res.status(500).json({ error: "Failed to scan" });
  }
});

export default router;
