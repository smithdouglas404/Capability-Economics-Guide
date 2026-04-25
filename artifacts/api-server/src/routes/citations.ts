import { Router, type IRouter } from "express";
import { db, sourceTriangulationsTable, dataSourcesTable, capabilitiesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

function sanitizeKey(input: string): string {
  return input.replace(/[^a-zA-Z0-9]+/g, "").slice(0, 40) || "ref";
}

function extractYear(value: string | null | undefined): string {
  if (!value) return "n.d.";
  const m = value.match(/(19|20)\d{2}/);
  return m ? m[0] : "n.d.";
}

router.get("/citations/export", async (req, res) => {
  const capabilityId = Number(req.query.capabilityId);
  const format = String(req.query.format ?? "bibtex").toLowerCase();
  if (!Number.isFinite(capabilityId)) { res.status(400).json({ error: "capabilityId required" }); return; }
  if (format !== "bibtex" && format !== "ris") { res.status(400).json({ error: "format must be bibtex or ris" }); return; }

  const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capabilityId));
  if (!cap) { res.status(404).json({ error: "Capability not found" }); return; }

  const triangulations = await db
    .select()
    .from(sourceTriangulationsTable)
    .where(eq(sourceTriangulationsTable.capabilityId, capabilityId));

  const urls = new Set<string>();
  for (const t of triangulations) {
    if (Array.isArray(t.citations)) {
      for (const c of t.citations) if (typeof c === "string" && c.trim()) urls.add(c.trim());
    }
  }

  let sources: typeof dataSourcesTable.$inferSelect[] = [];
  if (urls.size > 0) {
    sources = await db
      .select()
      .from(dataSourcesTable)
      .where(inArray(dataSourcesTable.url, Array.from(urls)));
  }

  const known = new Map(sources.map(s => [s.url ?? "", s]));
  const entries: Array<{ title: string; url: string; publisher: string | null; year: string }> = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const s = known.get(url);
    entries.push({
      title: s?.title ?? url,
      url,
      publisher: s?.publisher ?? null,
      year: extractYear(s?.publishedDate),
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const capSlug = (cap.slug || `cap-${cap.id}`).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const ext = format === "bibtex" ? "bib" : "ris";
  const filename = `citations-${capSlug}-${today}.${ext}`;

  let body = "";
  if (format === "bibtex") {
    body = entries
      .map((e, idx) => {
        const key = `${sanitizeKey(e.publisher ?? e.title)}${idx + 1}`;
        const author = e.publisher ?? "Unknown";
        const safeTitle = e.title.replace(/[{}]/g, "");
        return `@article{${key},\n  title={${safeTitle}},\n  author={${author}},\n  url={${e.url}},\n  year={${e.year}}\n}`;
      })
      .join("\n\n");
    res.setHeader("Content-Type", "application/x-bibtex; charset=utf-8");
  } else {
    body = entries
      .map((e) => {
        const lines = [
          "TY  - JOUR",
          `TI  - ${e.title}`,
          `UR  - ${e.url}`,
          `PY  - ${e.year}`,
        ];
        if (e.publisher) lines.push(`PB  - ${e.publisher}`);
        lines.push("ER  - ");
        return lines.join("\n");
      })
      .join("\n\n");
    res.setHeader("Content-Type", "application/x-research-info-systems; charset=utf-8");
  }

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body || "");
});

export default router;
