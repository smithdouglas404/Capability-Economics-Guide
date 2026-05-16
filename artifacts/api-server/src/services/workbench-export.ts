/**
 * Render a workbench board to a marketplace-quality PDF.
 *
 * The output is a clean A4 document: cover, executive summary, one section
 * per non-empty lane, one subsection per card showing the capability
 * metadata + every persisted Claude insight. Used by the
 * "Export to marketplace" flow — the resulting PDF becomes the report file
 * the seller lists for sale.
 */
import PDFDocument from "pdfkit";
import { db } from "@workspace/db";
import {
  workbenchBoardsTable,
  workbenchCardsTable,
  workbenchCardInsightsTable,
  capabilitiesTable,
  cviComponentsTable,
  industriesTable,
} from "@workspace/db";
import { eq, inArray, asc } from "drizzle-orm";
import { deriveLifecycleStage } from "./lifecycle";

const LANE_ORDER = ["scan", "frame", "ideate", "validate", "launch"] as const;
const LANE_LABEL: Record<string, string> = {
  scan: "Scan — What we observed",
  frame: "Frame — Problems and markets",
  ideate: "Ideate — Concepts and theses",
  validate: "Validate — Evidence and pilots",
  launch: "Launch — Committed initiatives",
};

const KIND_LABEL: Record<string, string> = {
  generate_applications: "Unexpected applications",
  find_analogues: "Cross-industry analogues",
  critique_idea: "Critique",
  what_to_invent: "What to invent",
  lifecycle_outlook: "Lifecycle outlook",
};

export interface ExportArgs {
  boardId: number;
  /** Override board name on the cover. */
  title?: string;
  /** Author name printed on the cover. */
  authorName: string;
  /** Free-form executive summary the seller writes for the marketplace page. */
  executiveSummary?: string;
}

export async function renderBoardPdf(args: ExportArgs): Promise<{ buffer: Buffer; pageCount: number; cardCount: number }> {
  const [board] = await db.select().from(workbenchBoardsTable).where(eq(workbenchBoardsTable.id, args.boardId));
  if (!board) throw new Error("Board not found");

  const cards = await db.select().from(workbenchCardsTable).where(eq(workbenchCardsTable.boardId, board.id)).orderBy(asc(workbenchCardsTable.lane), asc(workbenchCardsTable.position));
  const capIds = Array.from(new Set(cards.map(c => c.capabilityId)));
  const [caps, comps, industries] = await Promise.all([
    capIds.length > 0 ? db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, capIds)) : Promise.resolve([]),
    capIds.length > 0 ? db.select().from(cviComponentsTable).where(inArray(cviComponentsTable.capabilityId, capIds)) : Promise.resolve([]),
    db.select().from(industriesTable),
  ]);
  const capById = new Map(caps.map(c => [c.id, c]));
  const compById = new Map(comps.map(c => [c.capabilityId, c]));
  const indById = new Map(industries.map(i => [i.id, i]));

  const cardIds = cards.map(c => c.id);
  const insights = cardIds.length > 0
    ? await db.select().from(workbenchCardInsightsTable).where(inArray(workbenchCardInsightsTable.cardId, cardIds))
    : [];
  const insightsByCard = new Map<number, typeof insights>();
  for (const ins of insights) {
    const arr = insightsByCard.get(ins.cardId) ?? [];
    arr.push(ins);
    insightsByCard.set(ins.cardId, arr);
  }

  const title = args.title ?? board.name;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "LETTER", margin: 64, info: { Title: title, Author: args.authorName } });
      const chunks: Buffer[] = [];
      let pageCount = 0;
      doc.on("data", c => chunks.push(c));
      doc.on("pageAdded", () => { pageCount += 1; });
      doc.on("end", () => resolve({ buffer: Buffer.concat(chunks), pageCount: pageCount + 1, cardCount: cards.length }));
      doc.on("error", reject);

      // Cover
      doc.fontSize(11).fillColor("#666666").text("CAPABILITY ECONOMICS WORKBENCH", { align: "left" });
      doc.moveDown(2);
      doc.fontSize(28).fillColor("#0a0a0f").text(title, { align: "left" });
      if (board.description) {
        doc.moveDown(0.5);
        doc.fontSize(13).fillColor("#666666").text(board.description, { align: "left", lineGap: 3 });
      }
      doc.moveDown(2);
      doc.fontSize(10).fillColor("#888888").text(`Authored by ${args.authorName} · exported ${new Date().toLocaleDateString()}`, { align: "left" });
      doc.fontSize(10).fillColor("#888888").text(`${cards.length} capabilities across ${new Set(cards.map(c => c.lane)).size} pipeline stages · ${insights.length} Claude-generated insights`, { align: "left" });

      // Executive summary
      if (args.executiveSummary) {
        doc.addPage();
        doc.fontSize(11).fillColor("#666666").text("EXECUTIVE SUMMARY", { align: "left" });
        doc.moveDown(0.5);
        doc.fontSize(12).fillColor("#1a1a2e").text(args.executiveSummary, { align: "left", lineGap: 4 });
      }

      // Per-lane sections
      for (const lane of LANE_ORDER) {
        const laneCards = cards.filter(c => c.lane === lane);
        if (laneCards.length === 0) continue;
        doc.addPage();
        doc.fontSize(11).fillColor("#4f6ef7").text(LANE_LABEL[lane]?.toUpperCase() ?? lane.toUpperCase(), { align: "left" });
        doc.moveDown(0.5);
        doc.fontSize(20).fillColor("#0a0a0f").text(LANE_LABEL[lane] ?? lane, { align: "left" });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor("#888888").text(`${laneCards.length} ${laneCards.length === 1 ? "capability" : "capabilities"} in this stage`, { align: "left" });

        for (const card of laneCards) {
          const cap = capById.get(card.capabilityId);
          const comp = compById.get(card.capabilityId);
          const ind = cap ? indById.get(cap.industryId) : undefined;
          const lifecycle = cap ? deriveLifecycleStage({
            consensusScore: comp?.consensusScore ?? null,
            velocity: comp?.velocity ?? null,
            benchmarkScore: cap.benchmarkScore,
          }) : null;

          doc.moveDown(1.5);
          doc.fontSize(15).fillColor("#0a0a0f").text(cap?.name ?? `Capability #${card.capabilityId}`, { align: "left" });
          doc.fontSize(10).fillColor("#666666").text(
            `${ind?.name ?? "Unknown industry"} · CEI ${comp?.consensusScore != null ? comp.consensusScore.toFixed(1) : "—"} · Velocity ${comp?.velocity != null ? ((comp.velocity > 0 ? "+" : "") + comp.velocity.toFixed(2)) : "—"} · ${lifecycle ?? "unknown lifecycle"}`,
            { align: "left" },
          );
          if (cap?.description) {
            doc.moveDown(0.4);
            doc.fontSize(11).fillColor("#333333").text(cap.description, { align: "left", lineGap: 3 });
          }
          if (card.notes) {
            doc.moveDown(0.4);
            doc.fontSize(11).fillColor("#1a1a2e").text(`Analyst note: ${card.notes}`, { align: "left", lineGap: 3 });
          }

          const cardInsights = insightsByCard.get(card.id) ?? [];
          for (const ins of cardInsights) {
            doc.moveDown(0.6);
            doc.fontSize(9).fillColor("#4f6ef7").text(`${KIND_LABEL[ins.kind] ?? ins.kind}`.toUpperCase(), { align: "left" });
            if (ins.userPrompt) {
              doc.fontSize(9).fillColor("#888888").text(`Prompt: ${ins.userPrompt}`, { align: "left" });
            }
            doc.moveDown(0.2);
            if (ins.bullets && ins.bullets.length > 0) {
              for (let i = 0; i < ins.bullets.length; i++) {
                doc.fontSize(10).fillColor("#1a1a2e").text(`${i + 1}. ${ins.bullets[i]}`, { align: "left", lineGap: 2 });
              }
            } else if (ins.body) {
              doc.fontSize(10).fillColor("#1a1a2e").text(ins.body, { align: "left", lineGap: 2 });
            }
            doc.fontSize(8).fillColor("#aaaaaa").text(`— ${ins.modelUsed ?? "model"} · ${new Date(ins.generatedAt).toLocaleDateString()}`, { align: "left" });
          }
        }
      }

      // Methodology page
      doc.addPage();
      doc.fontSize(11).fillColor("#666666").text("METHODOLOGY", { align: "left" });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("#1a1a2e").text(
        "This document was assembled in the Capability Economics Workbench. Each capability section carries the live CEI score, velocity, and lifecycle stage from the platform's Bayesian triangulation engine. Claude-generated insights were produced using the platform's ideation prompts (10 unexpected applications, cross-industry analogues, critique, what to invent, lifecycle outlook). Underlying source provenance for any CEI number is available on the live capability detail page; the platform never editorializes a score without a cited source.",
        { align: "left", lineGap: 4 },
      );

      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}
