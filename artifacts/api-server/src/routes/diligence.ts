import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { logFeatureUsed } from "../services/persona-events";
import {
  companiesTable,
  companyScoresTable,
  companyCapabilityFingerprintTable,
  capabilitiesTable,
  industriesTable,
  ceiComponentsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import {
  buildPdf,
  coverPage,
  sectionHeading,
  body,
  hbarChart,
  kvTable,
  applyPageNumbers,
} from "../services/pdf";
import { getCompanyDetail, findSimilarCompanies } from "../services/companies";
import { generateThesisMemo } from "../services/alpha/thesis";

const router: IRouter = Router();

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

router.post("/diligence/generate", async (req: Request, res: Response) => {
  void logFeatureUsed({ userId: getAuth(req)?.userId, feature: "/diligence/generate" });
  try {
    const companyId = parseInt(String(req.body?.companyId ?? ""), 10);
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const includeSecLink = req.body?.includeSecLink === true;

    const detail = await getCompanyDetail(companyId);
    if (!detail) {
      res.status(404).json({ error: "company not found" });
      return;
    }
    const { company, scores, fingerprint } = detail;

    const [industry] = await db
      .select()
      .from(industriesTable)
      .where(eq(industriesTable.id, company.industryId))
      .limit(1);
    const industryName = industry?.name ?? "—";

    const capIds = fingerprint.map((f) => f.cap.id);
    const ceiRows = capIds.length
      ? await db
          .select()
          .from(ceiComponentsTable)
          .where(
            and(
              eq(ceiComponentsTable.industryId, company.industryId),
              inArray(ceiComponentsTable.capabilityId, capIds),
            ),
          )
      : [];
    const ceiByCap = new Map(ceiRows.map((r) => [r.capabilityId, r]));

    const gapRows = fingerprint.map((f) => {
      const benchmark = ceiByCap.get(f.cap.id)?.consensusScore ?? null;
      const companyValue = (f.fp.weight ?? 0) * 100;
      const gap = (benchmark ?? 0) - companyValue;
      return {
        label: f.cap.name,
        value: companyValue,
        sub: benchmark != null ? `Industry: ${benchmark.toFixed(0)}` : "Industry: —",
        gap,
      };
    }).sort((a, b) => b.gap - a.gap);

    let similar: Array<{ name: string; industry: string; composite: number | null }> = [];
    try {
      const sims = await findSimilarCompanies(companyId, { limit: 5 });
      if (sims.length) {
        const simIds = sims.map((s) => s.company.id);
        const simScores = await db
          .select()
          .from(companyScoresTable)
          .where(inArray(companyScoresTable.companyId, simIds));
        const scoreByCo = new Map(simScores.map((s) => [s.companyId, s]));
        similar = sims.map((s) => ({
          name: s.company.name,
          industry: industryName,
          composite: scoreByCo.get(s.company.id)?.composite ?? null,
        }));
      }
    } catch {
      similar = [];
    }
    if (similar.length === 0) {
      const fallback = await db
        .select({ co: companiesTable, sc: companyScoresTable })
        .from(companiesTable)
        .leftJoin(companyScoresTable, eq(companyScoresTable.companyId, companiesTable.id))
        .where(
          and(
            eq(companiesTable.industryId, company.industryId),
            sql`${companiesTable.id} <> ${companyId}`,
          ),
        )
        .orderBy(desc(companyScoresTable.composite))
        .limit(5);
      similar = fallback.map((r) => ({
        name: r.co.name,
        industry: industryName,
        composite: r.sc?.composite ?? null,
      }));
    }

    const topCap = [...fingerprint].sort((a, b) => (b.fp.weight ?? 0) - (a.fp.weight ?? 0))[0];
    let thesisText: string | null = null;
    if (topCap) {
      try {
        const memo = await generateThesisMemo(topCap.cap.id);
        thesisText = stripMarkdown(memo.memoMarkdown);
      } catch {
        thesisText = null;
      }
    }

    let secFilings: Array<{ title: string; date: string; period: string }> = [];
    if (includeSecLink && company.publicTicker) {
      try {
        const proto = req.protocol;
        const host = req.get("host") ?? "localhost";
        const url = `${proto}://${host}/api/sec/search?q=${encodeURIComponent(company.publicTicker)}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (r.ok) {
          const data = (await r.json()) as { results?: Array<{ entityName: string; fileDate: string; period: string }> };
          secFilings = (data.results ?? []).slice(0, 3).map((f) => ({
            title: f.entityName,
            date: f.fileDate || "—",
            period: f.period || "—",
          }));
        }
      } catch {
        secFilings = [];
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const composite = scores?.composite ?? null;
    const moat = scores?.moatScore ?? null;
    const aiDis = scores?.aiDisruptability ?? null;
    const coverage = scores?.capabilityCoverage ?? null;
    const ceiWeighted = scores?.ceiWeighted ?? null;
    const forecast = scores?.forecastedValue ?? null;

    const moatLabel = moat == null ? "unknown moat" : moat >= 65 ? "robust moat" : moat >= 45 ? "moderate moat" : "thin moat";
    const aiLabel = aiDis == null ? "unknown AI exposure" : aiDis >= 60 ? "elevated AI disruptability" : aiDis >= 40 ? "moderate AI exposure" : "limited AI exposure";
    const covLabel = coverage == null ? "no coverage data" : coverage >= 70 ? "deep coverage of industry-relevant capabilities" : coverage >= 40 ? "partial coverage of industry-relevant capabilities" : "thin coverage relative to industry leaders";

    const summary =
      `${company.name} scores ${fmt(composite, 0)}/100 composite, with a ${moatLabel} (${fmt(moat, 0)}) and ${aiLabel} (${fmt(aiDis, 0)}). ` +
      `Coverage of ${fingerprint.length} industry-relevant capabilities translates to ${covLabel}. ` +
      `CEI-weighted score of ${fmt(ceiWeighted, 0)} reflects how the firm's fingerprint maps onto the consensus value of ${industryName}. ` +
      `Forecasted value (${fmt(forecast, 0)}) extrapolates one-year velocity onto current positioning. ` +
      `${moat != null && composite != null && moat > composite ? "Moat outruns composite, suggesting durable cash flows priced below their defensibility." : "Composite is the binding metric — entry timing and dilution risk dominate the next 12 months."}`;

    const pdf = await buildPdf(async (doc) => {
      coverPage(doc, {
        title: company.name,
        subtitle: "Capability Diligence Pack",
        meta: [
          { label: "Industry", value: industryName },
          { label: "Country", value: company.country ?? "—" },
          { label: "Ticker", value: company.publicTicker ?? "private" },
          { label: "Generated", value: today },
        ],
      });

      sectionHeading(doc, "Executive Summary");
      body(doc, summary);

      doc.moveDown(0.8);
      sectionHeading(doc, "Score Snapshot");
      kvTable(doc, [
        { k: "Composite", v: fmt(composite, 1) },
        { k: "Moat", v: fmt(moat, 1) },
        { k: "AI disruptability", v: fmt(aiDis, 1) },
        { k: "Capability coverage", v: fmt(coverage, 1) },
        { k: "CEI weighted", v: fmt(ceiWeighted, 1) },
        { k: "Forecasted value", v: fmt(forecast, 1) },
      ]);

      doc.addPage();
      sectionHeading(doc, "Capability Gaps vs Industry Leaders");
      if (gapRows.length === 0) {
        body(doc, "No capability fingerprint on file for this company.");
      } else {
        body(doc, "Bars show this company's weighted exposure (×100) for each tagged capability; the sub-label shows the industry consensus score for the same capability. Sorted by largest gap first.");
        doc.moveDown(0.4);
        hbarChart(doc, { rows: gapRows.slice(0, 12), max: 100 });
      }

      doc.addPage();
      sectionHeading(doc, "M&A Twin Candidates");
      if (similar.length === 0) {
        body(doc, "No comparable companies found in the same industry.");
      } else {
        body(doc, "Top 5 companies in the same industry ranked by capability-vector similarity (or composite when fingerprints are sparse).");
        doc.moveDown(0.4);
        kvTable(
          doc,
          similar.map((s) => ({
            k: s.name,
            v: `${s.industry} · composite ${fmt(s.composite, 1)}`,
          })),
        );
      }

      doc.addPage();
      sectionHeading(doc, "Investment Thesis");
      if (thesisText && topCap) {
        body(doc, `Strongest capability: ${topCap.cap.name} (weight ${(topCap.fp.weight ?? 0).toFixed(2)})`);
        doc.moveDown(0.4);
        body(doc, thesisText);
      } else {
        body(
          doc,
          "Thesis generation unavailable — see /thesis page for live memo (requires OPENROUTER_API_KEY and an enriched capability).",
        );
      }

      if (includeSecLink) {
        doc.addPage();
        sectionHeading(doc, "SEC Filings Reference");
        if (!company.publicTicker) {
          body(doc, "No public ticker on file — SEC filings unavailable for private companies.");
        } else if (secFilings.length === 0) {
          body(doc, `No recent filings found for ticker ${company.publicTicker}.`);
        } else {
          body(doc, `Most recent filings for ${company.publicTicker}:`);
          doc.moveDown(0.4);
          kvTable(
            doc,
            secFilings.map((f) => ({
              k: f.title,
              v: `Filed ${f.date} · period ${f.period}`,
            })),
          );
        }
      }

      applyPageNumbers(doc, company.name);
    });

    const filename = `diligence-${company.slug}-${today}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "diligence generation failed" });
  }
});

export default router;
