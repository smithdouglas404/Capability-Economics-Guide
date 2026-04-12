import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/sec/search", async (req, res) => {
  const q = (req.query.q as string)?.trim();
  if (!q || q.length < 2) {
    res.json({ results: [] });
    return;
  }

  try {
    const encoded = encodeURIComponent(`"${q}"`);
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encoded}&forms=10-K&dateRange=custom&startdt=2022-01-01&hits.hits._source=entity_name,file_date,period_of_report,ciks,biz_location`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "CapabilityEconomics research@capabilityeconomics.ai" },
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      res.json({ results: [] });
      return;
    }

    const data = await resp.json() as {
      hits?: {
        hits?: Array<{
          _source: {
            entity_name?: string;
            file_date?: string;
            period_of_report?: string;
            ciks?: string[];
            biz_location?: string;
          };
        }>;
      };
    };

    const hits = data?.hits?.hits ?? [];

    const seen = new Set<string>();
    const results: Array<{
      entityName: string;
      cik: string;
      fileDate: string;
      period: string;
      location: string;
    }> = [];

    for (const hit of hits) {
      const src = hit._source;
      const name = (src.entity_name ?? "").trim();
      if (!name || seen.has(name.toUpperCase())) continue;
      seen.add(name.toUpperCase());
      results.push({
        entityName: name,
        cik: src.ciks?.[0] ?? "",
        fileDate: src.file_date ?? "",
        period: src.period_of_report ?? "",
        location: src.biz_location ?? "",
      });
      if (results.length >= 8) break;
    }

    res.json({ results });
  } catch (err) {
    console.error("SEC search error:", err);
    res.json({ results: [] });
  }
});

export default router;
