/**
 * /exports — point-in-time CSV / Parquet snapshots of canned CE datasets.
 *
 * Tier policy:
 *   - CSV: Briefing tier or higher (any paid tier; export is part of the
 *          baseline subscriber benefit).
 *   - Parquet: Platform tier only (priced into the Data License tier).
 *
 * Every download is recorded in admin_audit_log (action data.export.{csv|parquet})
 * with the snapshotId so we can reconstruct who pulled what and when.
 */

import { Router, type IRouter } from "express";
import { requireTier } from "../middlewares/requireTier";
import { requireTierOrCredits } from "../middlewares/requireTierOrCredits";
import { logAdminAction } from "../services/audit-log";
import { buildCsvExport, buildParquetExport, listDatasets, DATASETS, type DatasetId } from "../services/exports";
import { generateText, sonnet } from "../services/workflows/models";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/exports/datasets", (_req, res) => {
  res.json({ datasets: listDatasets() });
});

function isDatasetId(s: string): s is DatasetId {
  return Object.prototype.hasOwnProperty.call(DATASETS, s);
}

router.get("/exports/:dataset.csv", requireTierOrCredits("briefing", "RESEARCH_QUERY"), async (req, res) => {
  const id = String(req.params.dataset);
  if (!isDatasetId(id)) { res.status(404).json({ error: "Unknown dataset" }); return; }
  try {
    const out = await buildCsvExport(id);
    void logAdminAction(req, {
      action: "data.export.csv",
      targetType: "export.dataset",
      targetId: id,
      details: { snapshotId: out.snapshotId, rowCount: out.rowCount, format: "csv" },
    });
    res.setHeader("Content-Type", out.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.setHeader("X-Snapshot-Id", out.snapshotId);
    res.send(out.body);
  } catch (err) {
    logger.error({ err, dataset: id }, "[exports] csv build failed");
    res.status(500).json({ error: "Export failed" });
  }
});

router.get("/exports/:dataset.parquet", requireTier("platform"), async (req, res) => {
  const id = String(req.params.dataset);
  if (!isDatasetId(id)) { res.status(404).json({ error: "Unknown dataset" }); return; }
  try {
    const out = await buildParquetExport(id);
    void logAdminAction(req, {
      action: "data.export.parquet",
      targetType: "export.dataset",
      targetId: id,
      details: { snapshotId: out.snapshotId, rowCount: out.rowCount, format: "parquet" },
    });
    res.setHeader("Content-Type", out.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.setHeader("X-Snapshot-Id", out.snapshotId);
    res.send(out.body);
  } catch (err) {
    logger.error({ err, dataset: id }, "[exports] parquet build failed");
    res.status(500).json({ error: "Export failed" });
  }
});

/**
 * POST /exports/narrative — persona-aware lead paragraph for the Move-3
 * client-side export menu (components/export-menu.tsx). Frontend builds
 * the Markdown / CSV locally; when the user picks "with AI narrative",
 * the menu calls here for the 2-4-sentence opener prepended to the doc.
 * No tier gate — this is a UX convenience, costs an LLM call per click.
 */
const NARRATIVE_PERSONA_VOICE: Record<string, string> = {
  pe: "You write IC-memo lead paragraphs. Cite numbers when given. Lead with the deal implication (gap-to-leader, cost-to-close, multiple sensitivity). End with the highest-risk caveat.",
  vc: "You write thesis-memo lead paragraphs. Lead with the wedge — where value is migrating and which capability node has the open seat. End with the one founder-question this data raises.",
  f500: "You write board-grade strategic summaries. Lead with the peer gap or competitive position; end with the recommended action (build / buy / partner) the data supports.",
  student: "You write pedagogical openers. Define one key term inline, then explain what the data shows in plain language. End with one question the student should ask themselves about the numbers.",
  professor: "You write academic abstracts. Lead with the method behind the data, then state what the data shows. End with a sentence flagging the appropriate caveat for citation.",
};
const NARRATIVE_VOICE_DEFAULT = "Write a tight 3-sentence lead paragraph: what the data shows, the most interesting pattern, the most important caveat.";

router.post("/exports/narrative", async (req, res) => {
  try {
    const body = req.body as { pageTitle?: string; summary?: string; persona?: string | null; dataSample?: unknown };
    const pageTitle = typeof body.pageTitle === "string" ? body.pageTitle : "Capability Economics export";
    const summary = typeof body.summary === "string" ? body.summary : "";
    const personaKey = typeof body.persona === "string" ? body.persona : null;
    const voice = (personaKey && NARRATIVE_PERSONA_VOICE[personaKey]) || NARRATIVE_VOICE_DEFAULT;

    let sample = "";
    try {
      const sampleJson = JSON.stringify(body.dataSample ?? null);
      sample = sampleJson.length > 8000 ? sampleJson.slice(0, 8000) + "…" : sampleJson;
    } catch {
      sample = "";
    }

    const prompt = `Page: ${pageTitle}
What the user is exporting: ${summary}

Data sample (up to 25 rows of the export):
${sample}

Write a 2-4 sentence lead paragraph for the export above. Plain prose, no headings, no bullets, no preamble. Ground every claim in the data sample — if a number isn't in the sample, don't invent one.`;

    const { text } = await generateText({
      model: sonnet,
      system: voice,
      prompt,
      temperature: 0.4,
      maxTokens: 350,
    });

    res.json({ narrative: text.trim() });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[exports/narrative] failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "narrative-generation-failed" });
  }
});

export default router;
