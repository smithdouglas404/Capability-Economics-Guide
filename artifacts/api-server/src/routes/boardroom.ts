import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { logFeatureUsed } from "../services/persona-events";
import {
  organizationsTable,
  organizationCapabilitiesTable,
  capabilitiesTable,
  industriesTable,
  ceiComponentsTable,
  capabilityRoleMappingsTable,
  cSuiteRolesTable,
  strategyDecisionsTable,
  roiRecordsTable,
} from "@workspace/db";
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  buildPdf,
  coverPage,
  sectionHeading,
  body,
  hbarChart,
  kvTable,
  applyPageNumbers,
} from "../services/pdf";

const router: IRouter = Router();

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtUsdK(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}M`;
  return `$${n.toFixed(0)}K`;
}

router.post("/boardroom/generate", async (req: Request, res: Response) => {
  void logFeatureUsed({ userId: getAuth(req)?.userId, feature: "/boardroom/generate" });
  try {
    const sessionToken = String(req.body?.sessionToken ?? "").trim();
    const roleSlug = req.body?.roleSlug ? String(req.body.roleSlug).trim() : null;
    if (!sessionToken) {
      res.status(400).json({ error: "sessionToken required" });
      return;
    }

    const [org] = await db
      .select({
        id: organizationsTable.id,
        name: organizationsTable.name,
        size: organizationsTable.size,
        industryId: organizationsTable.industryId,
        industryName: industriesTable.name,
        sessionToken: organizationsTable.sessionToken,
      })
      .from(organizationsTable)
      .innerJoin(industriesTable, eq(industriesTable.id, organizationsTable.industryId))
      .where(eq(organizationsTable.sessionToken, sessionToken));

    if (!org) {
      res.status(404).json({ error: "organization not found for sessionToken" });
      return;
    }

    let roleFilteredCapIds: number[] | null = null;
    let roleLabel = "All capabilities";
    if (roleSlug) {
      const [role] = await db.select().from(cSuiteRolesTable).where(eq(cSuiteRolesTable.slug, roleSlug));
      if (role) {
        roleLabel = `${role.title} — ${role.name}`;
        const mappings = await db
          .select({ capabilityId: capabilityRoleMappingsTable.capabilityId })
          .from(capabilityRoleMappingsTable)
          .where(eq(capabilityRoleMappingsTable.roleId, role.id));
        roleFilteredCapIds = mappings.map((m) => m.capabilityId);
      }
    }

    const allCaps = await db
      .select()
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.industryId, org.industryId));
    const relevantCaps = roleFilteredCapIds
      ? allCaps.filter((c) => roleFilteredCapIds!.includes(c.id))
      : allCaps;

    const allAssessments = await db
      .select({
        capabilityId: organizationCapabilitiesTable.capabilityId,
        capabilityName: capabilitiesTable.name,
        maturityScore: organizationCapabilitiesTable.maturityScore,
        benchmarkScore: capabilitiesTable.benchmarkScore,
        investmentLevel: organizationCapabilitiesTable.investmentLevel,
        strategicImportance: organizationCapabilitiesTable.strategicImportance,
      })
      .from(organizationCapabilitiesTable)
      .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, organizationCapabilitiesTable.capabilityId))
      .where(eq(organizationCapabilitiesTable.organizationId, org.id));
    const assessments = roleFilteredCapIds
      ? allAssessments.filter((a) => roleFilteredCapIds!.includes(a.capabilityId))
      : allAssessments;

    const capIds = assessments.map((a) => a.capabilityId);
    const ceiRows = capIds.length
      ? await db
          .select()
          .from(ceiComponentsTable)
          .where(
            and(
              eq(ceiComponentsTable.industryId, org.industryId),
              inArray(ceiComponentsTable.capabilityId, capIds),
            ),
          )
      : [];
    const ceiByCap = new Map(ceiRows.map((r) => [r.capabilityId, r.consensusScore]));

    const gapRows = assessments.map((a) => {
      const benchmark = ceiByCap.get(a.capabilityId) ?? a.benchmarkScore ?? 0;
      const gap = benchmark - a.maturityScore;
      return {
        label: a.capabilityName,
        value: a.maturityScore,
        sub: `Industry: ${benchmark.toFixed(0)}`,
        gap,
      };
    }).sort((a, b) => b.gap - a.gap);

    const overallAvg = assessments.length
      ? assessments.reduce((s, a) => s + a.maturityScore, 0) / assessments.length
      : 0;
    const industryAvg = assessments.length
      ? assessments.reduce((s, a) => {
          const bm = ceiByCap.get(a.capabilityId) ?? a.benchmarkScore ?? 0;
          return s + bm;
        }, 0) / assessments.length
      : 0;

    const top3Gaps = gapRows.slice(0, 3);
    const top3Strengths = [...gapRows].sort((a, b) => a.gap - b.gap).slice(0, 3);

    const decisionsRaw = await db
      .select({
        decision: strategyDecisionsTable,
        capabilityName: capabilitiesTable.name,
      })
      .from(strategyDecisionsTable)
      .leftJoin(capabilitiesTable, eq(strategyDecisionsTable.capabilityId, capabilitiesTable.id))
      .where(eq(strategyDecisionsTable.sessionToken, sessionToken))
      .orderBy(desc(strategyDecisionsTable.createdAt))
      .limit(8);

    const roiRecords = await db
      .select({
        record: roiRecordsTable,
        capabilityName: capabilitiesTable.name,
      })
      .from(roiRecordsTable)
      .leftJoin(capabilitiesTable, eq(roiRecordsTable.capabilityId, capabilitiesTable.id))
      .where(eq(roiRecordsTable.sessionToken, sessionToken))
      .orderBy(desc(roiRecordsTable.createdAt))
      .limit(20);

    const totalSpend = roiRecords.reduce((s, r) => s + (r.record.spendUsdK ?? 0), 0);
    const totalRevenue = roiRecords.reduce((s, r) => s + (r.record.revenueImpactUsdK ?? 0), 0);
    const avgEfficiency = roiRecords.length
      ? roiRecords.reduce((s, r) => s + (r.record.efficiencyGainPct ?? 0), 0) / roiRecords.length
      : 0;
    const netRoiPct = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend) * 100 : null;

    const today = new Date().toISOString().slice(0, 10);
    const period = today.slice(0, 7);

    const summaryParts: string[] = [];
    summaryParts.push(
      `${org.name} carries an average maturity of ${fmt(overallAvg, 1)} against an industry consensus of ${fmt(industryAvg, 1)} across ${assessments.length} assessed ${assessments.length === 1 ? "capability" : "capabilities"} in ${org.industryName}.`,
    );
    if (top3Gaps.length && top3Gaps[0].gap > 0) {
      const gapNames = top3Gaps.filter((g) => g.gap > 0).map((g) => `${g.label} (-${g.gap.toFixed(0)})`).join(", ");
      summaryParts.push(`The widest gaps versus peers sit in ${gapNames || "—"} — these are the capabilities the board should weight when sequencing the next investment cycle.`);
    }
    if (top3Strengths.length && top3Strengths[0].gap < 0) {
      const strNames = top3Strengths.filter((s) => s.gap < 0).map((s) => `${s.label} (+${Math.abs(s.gap).toFixed(0)})`).join(", ");
      summaryParts.push(`The firm currently outperforms benchmark on ${strNames || "—"}, providing defensible ground to redeploy capital from.`);
    }
    if (netRoiPct != null) {
      summaryParts.push(`Tracked capability spend of ${fmtUsdK(totalSpend)} has produced ${fmtUsdK(totalRevenue)} of attributed revenue impact — a net return of ${netRoiPct.toFixed(0)}% with an average efficiency gain of ${avgEfficiency.toFixed(1)}% across ${roiRecords.length} quarter-records.`);
    } else {
      summaryParts.push(`No ROI ledger entries are on file yet — populate the ROI Tracker to make subsequent boardroom packs investment-quantified.`);
    }
    const summary = summaryParts.join(" ");

    const pdf = await buildPdf(async (doc) => {
      coverPage(doc, {
        title: `Boardroom Pack — ${org.name}`,
        subtitle: "Capability Economics readout",
        meta: [
          { label: "Industry", value: org.industryName },
          { label: "Org size", value: org.size },
          { label: "Role lens", value: roleLabel },
          { label: "Period", value: period },
          { label: "Generated", value: today },
        ],
      });

      sectionHeading(doc, "Executive Summary");
      body(doc, summary);

      doc.addPage();
      sectionHeading(doc, "Capability Gaps vs Industry");
      if (gapRows.length === 0) {
        body(doc, "No assessed capabilities on file. Complete an assessment to populate this view.");
      } else {
        body(doc, "Bars show the organization's current maturity score; the sub-label shows the industry consensus benchmark for the same capability. Sorted by largest gap first.");
        doc.moveDown(0.4);
        hbarChart(doc, { rows: gapRows.slice(0, 14), max: 100 });
      }

      doc.addPage();
      sectionHeading(doc, "Strategy Decisions");
      if (decisionsRaw.length === 0) {
        body(doc, "No strategy decisions recorded yet. Use Strategy → Strategy Decisions to log invest/hold/divest calls and they will surface here.");
      } else {
        body(doc, "Most recent recorded executive decisions, newest first.");
        doc.moveDown(0.4);
        kvTable(
          doc,
          decisionsRaw.map((r) => ({
            k: `${r.decision.decision.toUpperCase()} · ${r.capabilityName ?? "general"}`,
            v: `${r.decision.decidedByRole} ${r.decision.decidedBy} · ${r.decision.investmentUsdK != null ? fmtUsdK(r.decision.investmentUsdK) + " · " : ""}${r.decision.timelineMonths != null ? r.decision.timelineMonths + " mo · " : ""}${r.decision.rationale.slice(0, 90)}`,
          })),
        );
      }

      doc.addPage();
      sectionHeading(doc, "ROI Snapshot");
      if (roiRecords.length === 0) {
        body(doc, "ROI data unavailable — no records logged for this organization. Use the ROI Tracker to record quarterly spend, revenue impact, and efficiency gains per capability.");
      } else {
        kvTable(doc, [
          { k: "Tracked spend (lifetime)", v: fmtUsdK(totalSpend) },
          { k: "Attributed revenue impact", v: fmtUsdK(totalRevenue) },
          { k: "Net ROI", v: netRoiPct != null ? `${netRoiPct.toFixed(0)}%` : "—" },
          { k: "Avg efficiency gain", v: `${avgEfficiency.toFixed(1)}%` },
          { k: "Quarter records on file", v: String(roiRecords.length) },
        ]);
        doc.moveDown(0.4);
        body(doc, "Recent quarter-level entries:");
        doc.moveDown(0.2);
        kvTable(
          doc,
          roiRecords.slice(0, 10).map((r) => ({
            k: `${r.record.quarter} · ${r.capabilityName ?? "—"}`,
            v: `Spend ${fmtUsdK(r.record.spendUsdK)} · Revenue ${fmtUsdK(r.record.revenueImpactUsdK)} · Δmaturity ${r.record.maturityBefore != null && r.record.maturityAfter != null ? `${r.record.maturityBefore.toFixed(0)} → ${r.record.maturityAfter.toFixed(0)}` : "—"}`,
          })),
        );
      }

      applyPageNumbers(doc, `${org.name} · Boardroom Pack`);
    });

    const safeName = org.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "org";
    const filename = `boardroom-${safeName}-${today}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "boardroom generation failed" });
  }
});

export default router;
