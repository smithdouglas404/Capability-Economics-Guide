import { logger } from "../../lib/logger";

/**
 * SEC EDGAR fetcher — rate-limited, User-Agent-required HTTP client for the
 * SEC full-text search and submissions endpoints. EDGAR rate limit is
 * 10 requests/sec per IP; we throttle to 8/sec to stay safely below.
 *
 * SEC requires a User-Agent header identifying who's making the request.
 * Set EDGAR_USER_AGENT env var to "ProductName admin-email@example.com"
 * or accept the default (which still satisfies SEC's requirement but is
 * less informative).
 *
 * Endpoints:
 *   Full-text search: https://efts.sec.gov/LATEST/search-index?q=<keywords>&forms=10-K
 *   Submissions API:  https://data.sec.gov/submissions/CIK<10-digit-padded>.json
 *   Filing archive:   https://www.sec.gov/Archives/edgar/data/<cik>/<accession-no-dashes>/<filename>
 */

const EDGAR_BASE = "https://efts.sec.gov/LATEST/search-index";
const EDGAR_USER_AGENT = process.env.EDGAR_USER_AGENT ?? "CapabilityEconomics research-bot ops@capabilityeconomics.com";
const MIN_REQUEST_INTERVAL_MS = 130; // ~7.7 req/sec, comfortably under 10/sec ceiling

let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const wait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export interface EdgarSearchHit {
  accessionNumber: string;
  cik: string;
  companyName: string;
  ticker: string | null;
  formType: string;
  filingDate: string; // ISO yyyy-mm-dd
  filingUrl: string;
  highlightExcerpt: string | null;
  rawHit: Record<string, unknown>;
}

export interface EdgarSearchOptions {
  /** Comma-separated form types: "10-K", "10-K,10-Q,8-K", etc. Defaults to broad set. */
  forms?: string;
  /** Date range: { from: "2023-01-01", to: "2026-12-31" } */
  from?: string;
  to?: string;
  /** Max hits to return. Default 20. */
  limit?: number;
}

/**
 * Full-text search for filings matching a keyword (typically a capability
 * name or a closely-related phrase). Returns up to `limit` hits sorted by
 * EDGAR's default relevance ranking.
 *
 * Note: EDGAR's full-text search index lags filings by ~1-2 hours and
 * covers filings from 2001 forward. Pre-2001 filings exist in EDGAR but
 * aren't indexed for FTS.
 */
export async function searchEdgar(keyword: string, opts: EdgarSearchOptions = {}): Promise<EdgarSearchHit[]> {
  const forms = opts.forms ?? "10-K,10-Q,8-K,DEF 14A";
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));

  const params = new URLSearchParams();
  params.set("q", `"${keyword}"`); // exact-phrase match — looser unquoted search returns too much noise
  params.set("forms", forms);
  if (opts.from) params.set("dateRange", "custom"), params.set("startdt", opts.from);
  if (opts.to) params.set("enddt", opts.to);

  const url = `${EDGAR_BASE}?${params.toString()}`;
  await throttle();
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        "User-Agent": EDGAR_USER_AGENT,
        "Accept": "application/json",
      },
    });
  } catch (err) {
    logger.warn({ err, keyword }, "[edgar] search fetch failed");
    return [];
  }
  if (!resp.ok) {
    logger.warn({ status: resp.status, keyword }, "[edgar] search returned non-200");
    return [];
  }

  let json: { hits?: { hits?: Array<Record<string, unknown>> } };
  try {
    json = await resp.json() as { hits?: { hits?: Array<Record<string, unknown>> } };
  } catch (err) {
    logger.warn({ err, keyword }, "[edgar] search JSON parse failed");
    return [];
  }

  const hits = json.hits?.hits ?? [];
  return hits.slice(0, limit).map(parseHit).filter((h): h is EdgarSearchHit => h !== null);
}

function parseHit(rawHit: Record<string, unknown>): EdgarSearchHit | null {
  const source = (rawHit._source ?? {}) as Record<string, unknown>;
  const adsh = String(source.adsh ?? "");
  const ciks = Array.isArray(source.ciks) ? source.ciks : [];
  const cik = ciks.length > 0 ? String(ciks[0]) : "";
  const displayNames = Array.isArray(source.display_names) ? source.display_names : [];
  const companyName = displayNames.length > 0 ? String(displayNames[0]) : "Unknown filer";
  // Ticker often embedded in display_names like "APPLE INC  (AAPL)  (CIK 0000320193)"
  const tickerMatch = companyName.match(/\(([A-Z]{1,5})\)/);
  const ticker = tickerMatch ? tickerMatch[1] : null;
  const formType = String(source.form ?? "Unknown");
  const filingDate = String(source.file_date ?? source.filed ?? "");

  if (!adsh || !cik || !filingDate) return null;

  const accessionNoDashes = adsh.replace(/-/g, "");
  const cikPadded = cik.padStart(10, "0").replace(/^0+/, ""); // EDGAR archive expects un-padded cik in URL
  const filingUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikPadded}&type=&dateb=&owner=include&count=40&search_text=`;
  // Direct filing index URL is more useful but requires the primary doc name. Fall back to browse view.
  const directIndex = `https://www.sec.gov/Archives/edgar/data/${cikPadded}/${accessionNoDashes}/`;

  // EDGAR sometimes returns highlights[].text snippets matching the query.
  const highlights = ((rawHit.highlight ?? {}) as Record<string, unknown>).text;
  let highlightExcerpt: string | null = null;
  if (Array.isArray(highlights) && highlights.length > 0) {
    highlightExcerpt = String(highlights[0]).replace(/<\/?em>/g, "").slice(0, 500);
  }

  return {
    accessionNumber: adsh,
    cik: cikPadded,
    companyName: companyName.replace(/\s*\(CIK.*\)\s*$/, "").trim(),
    ticker,
    formType,
    filingDate,
    filingUrl: directIndex,
    highlightExcerpt,
    rawHit,
  };
}
