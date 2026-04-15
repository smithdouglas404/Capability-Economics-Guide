import { Router, type IRouter } from "express";

const router: IRouter = Router();

function parseDisplayName(displayName: string): { name: string; ticker: string; cik: string } {
  const cikMatch = displayName.match(/\(CIK\s+(\d+)\)/i);
  const tickerMatch = displayName.match(/\(([A-Z]{1,5})\)\s+\(CIK/);
  const name = displayName.split("(")[0].trim().replace(/\s+/g, " ");
  return {
    name,
    ticker: tickerMatch?.[1] ?? "",
    cik: cikMatch?.[1] ?? "",
  };
}

router.get("/sec/search", async (req, res) => {
  const q = (req.query.q as string)?.trim();
  if (!q || q.length < 2) {
    res.json({ results: [] });
    return;
  }

  try {
    const seen = new Set<string>();
    const results: Array<{
      entityName: string;
      ticker: string;
      cik: string;
      fileDate: string;
      period: string;
      location: string;
    }> = [];

    const qLower = q.toLowerCase();

    const collect = (hits: Array<Record<string, unknown>>) => {
      for (const hit of hits) {
        const src = hit._source as Record<string, unknown>;
        const displayNames = src.display_names as string[] | undefined;
        const ciks = src.ciks as string[] | undefined;
        const fileDate = (src.file_date as string) ?? "";
        const period = (src.period_ending as string) ?? (src.period_of_report as string) ?? "";
        const locations = src.biz_locations as string[] | undefined;
        const location = locations?.[0] ?? (src.biz_location as string) ?? "";

        if (displayNames?.length) {
          const parsed = parseDisplayName(displayNames[0]);
          // Only include if the company name actually contains the search term
          if (!parsed.name.toLowerCase().includes(qLower)) continue;
          const key = (parsed.cik || parsed.name).toUpperCase();
          if (parsed.name && !seen.has(key)) {
            seen.add(key);
            results.push({
              entityName: parsed.name,
              ticker: parsed.ticker,
              cik: (parsed.cik || ciks?.[0]) ?? "",
              fileDate,
              period,
              location,
            });
          }
        } else {
          const entityName = (src.entity_name as string)?.trim();
          if (entityName && entityName.toLowerCase().includes(qLower)) {
            const key = entityName.toUpperCase();
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                entityName,
                ticker: "",
                cik: ciks?.[0] ?? "",
                fileDate,
                period,
                location,
              });
            }
          }
        }

        if (results.length >= 10) break;
      }
    };

    const headers = { "User-Agent": "CapabilityEconomics research@capabilityeconomics.ai" };
    const signal = () => AbortSignal.timeout(8000);

    // 1. Quoted 10-K search
    const withQuotesUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(q)}%22&forms=10-K&dateRange=custom&startdt=2020-01-01`;
    const withQuotesResp = await fetch(withQuotesUrl, { headers, signal: signal() });
    if (withQuotesResp.ok) {
      const data = await withQuotesResp.json() as { hits?: { hits?: Array<Record<string, unknown>> } };
      collect(data?.hits?.hits ?? []);
    }

    // 2. Unquoted 10-K fallback
    if (results.length < 5) {
      const withoutQuotesUrl = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=10-K&dateRange=custom&startdt=2022-01-01`;
      const withoutResp = await fetch(withoutQuotesUrl, { headers, signal: signal() });
      if (withoutResp.ok) {
        const data2 = await withoutResp.json() as { hits?: { hits?: Array<Record<string, unknown>> } };
        const extra = (data2?.hits?.hits ?? []).filter(h => {
          const src = h._source as Record<string, unknown>;
          const names = src.display_names as string[] | undefined;
          const text = names?.[0]?.toLowerCase() ?? (src.entity_name as string ?? "").toLowerCase();
          return text.includes(q.toLowerCase());
        });
        collect(extra);
      }
    }

    // 3. 20-F fallback for foreign private issuers (e.g. Infosys, TCS, SAP, Samsung)
    if (results.length < 5) {
      const form20fUrl = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=20-F&dateRange=custom&startdt=2020-01-01`;
      const form20fResp = await fetch(form20fUrl, { headers, signal: signal() });
      if (form20fResp.ok) {
        const data3 = await form20fResp.json() as { hits?: { hits?: Array<Record<string, unknown>> } };
        collect(data3?.hits?.hits ?? []);
      }
    }

    // 4. EDGAR entity search as final fallback (catches private/unlisted companies registered with SEC)
    if (results.length < 3) {
      const entityUrl = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&dateRange=custom&startdt=2015-01-01`;
      const entityResp = await fetch(entityUrl, { headers, signal: signal() });
      if (entityResp.ok) {
        const data4 = await entityResp.json() as { hits?: { hits?: Array<Record<string, unknown>> } };
        const extra = (data4?.hits?.hits ?? []).filter(h => {
          const src = h._source as Record<string, unknown>;
          const names = src.display_names as string[] | undefined;
          const text = names?.[0]?.toLowerCase() ?? (src.entity_name as string ?? "").toLowerCase();
          return text.includes(q.toLowerCase());
        });
        collect(extra);
      }
    }

    res.json({ results: results.slice(0, 10), allowManual: results.length === 0 });
  } catch (err) {
    console.error("SEC search error:", err);
    res.json({ results: [] });
  }
});

export default router;
