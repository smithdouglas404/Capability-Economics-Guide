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
} from "../services/macro-events";
import { getResolvedCatalog } from "../services/macro-events-catalog";
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

router.post("/macro-events", requireAdmin, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const eventType = String(body.eventType ?? "other") as EventType;
    if (!VALID_TYPES.includes(eventType)) return res.status(400).json({ error: "Invalid eventType" });
    const sentimentDirection = String(body.sentimentDirection ?? "negative") as SentimentDirection;
    if (!VALID_DIRECTIONS.includes(sentimentDirection)) return res.status(400).json({ error: "Invalid sentimentDirection" });
    const severity = Number(body.severity);
    if (!Number.isFinite(severity) || severity < 0 || severity > 10) return res.status(400).json({ error: "severity must be 0-10" });
    const title = String(body.title ?? "").trim();
    if (!title) return res.status(400).json({ error: "title required" });
    const description = String(body.description ?? "").trim();

    const event = await createMacroEvent({
      eventType,
      severity,
      title,
      description,
      affectedIndustryIds: Array.isArray(body.affectedIndustryIds) ? (body.affectedIndustryIds as number[]).map(Number).filter(Number.isFinite) : [],
      affectedCapabilityIds: Array.isArray(body.affectedCapabilityIds) ? (body.affectedCapabilityIds as number[]).map(Number).filter(Number.isFinite) : [],
      sentimentDirection,
      decayDays: Number.isFinite(Number(body.decayDays)) ? Number(body.decayDays) : 14,
      source: typeof body.source === "string" && body.source ? String(body.source) : "admin",
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
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const ok = await deleteMacroEvent(id);
    res.json({ deleted: ok });
  } catch (err) {
    console.error("macro-events delete failed:", err);
    res.status(500).json({ error: "Failed to delete event" });
  }
});

router.get("/macro-events/catalog", async (_req, res) => {
  try {
    const templates = await getResolvedCatalog();
    res.json({ templates, total: templates.length });
  } catch (err) {
    console.error("macro-events catalog failed:", err);
    res.status(500).json({ error: "Failed to load catalog" });
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
