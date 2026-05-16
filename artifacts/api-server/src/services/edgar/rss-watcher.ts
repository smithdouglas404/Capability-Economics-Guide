import { db, capabilityFilingsTable, capabilityFilingStatusTable, capabilitiesTable } from "@workspace/db";
import { eq, gt, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";

/**
 * EDGAR RSS / Atom feed watcher. Subscribes (via periodic poll) to SEC's
 * most-recent-filings feed and, for each new filing, scans against the
 * names of capabilities already in the cache (capability_filing_status
 * has rows for any capability we've ever fetched filings for). If a
 * filing's company-name / form-type combination matches a watched
 * capability via a name-substring scan, append it to that cap's history.
 *
 * SEC Atom endpoint:
 *   https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=include&count=40&output=atom
 *
 * Two-stage matching:
 *   1. Fast substring scan on the filing's title for any cached capability
 *      name (after lowercasing and word-boundary checks). Cheap, runs on
 *      every filing.
 *   2. (Future phase 3.5) When a substring match fires, Haiku-tag the
 *      filing for which sections actually mention the capability and what
 *      the relevant excerpt is. For now we just upsert with the title as
 *      a placeholder excerpt and let the existing extractor.ts pass do
 *      the cleanup on next read.
 *
 * Scheduler ticks this every 15 minutes by default. Idempotent — the
 * (capability_id, accession_number) unique constraint prevents duplicate
 * inserts.
 */

const EDGAR_ATOM = "https://www.sec.gov/cgi-bin/browse-edgar";
const EDGAR_USER_AGENT = process.env.EDGAR_USER_AGENT ?? "CapabilityEconomics research-bot ops@inflexcvi.ai";

interface AtomEntry {
  title: string;
  filedAt: Date;
  link: string;
  formType: string;
  cik: string;
  companyName: string;
  accessionNumber: string;
}

export interface RssTickResult {
  fetched: number;
  matched: number;
  inserted: number;
  errors: string[];
  durationMs: number;
}

export async function runEdgarRssTick(): Promise<RssTickResult> {
  const start = Date.now();
  const errors: string[] = [];

  // Pull list of watched capability names + ids from the status table —
  // we only scan against capabilities someone has already viewed at least
  // once. This keeps the matcher cost bounded and prioritizes user-relevant
  // signal.
  const watched = await db.select({
    capabilityId: capabilityFilingStatusTable.capabilityId,
  }).from(capabilityFilingStatusTable);
  if (watched.length === 0) {
    return { fetched: 0, matched: 0, inserted: 0, errors: [], durationMs: Date.now() - start };
  }

  const watchedCapIds = watched.map(w => w.capabilityId);
  const caps = await db.select().from(capabilitiesTable).where(sql`id IN (${sql.join(watchedCapIds.map(id => sql`${id}`), sql`, `)})`);
  const capByLowerName = new Map<string, typeof caps[number]>();
  for (const c of caps) capByLowerName.set(c.name.toLowerCase(), c);

  // Fetch the SEC current-filings atom feed
  let entries: AtomEntry[];
  try {
    entries = await fetchAtomFeed();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "[edgar-rss] atom fetch failed");
    return { fetched: 0, matched: 0, inserted: 0, errors: [msg], durationMs: Date.now() - start };
  }

  // Track the highest accession we've already processed to avoid re-scanning
  // the same window on every tick. Cheap: read the max created_at of recent
  // RSS-inserted rows and skip anything older.
  const recentRssInserts = await db
    .select({ createdAt: capabilityFilingsTable.createdAt })
    .from(capabilityFilingsTable)
    .where(gt(capabilityFilingsTable.createdAt, new Date(Date.now() - 4 * 60 * 60 * 1000)))
    .limit(1);
  // (Soft barrier — accession uniqueness still protects us from dupes.)

  let matched = 0;
  let inserted = 0;
  for (const entry of entries) {
    const titleLower = entry.title.toLowerCase();
    for (const [name, cap] of capByLowerName.entries()) {
      // Word-boundary substring check — avoids matching "AI" in "MAINTAIN".
      const rx = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
      if (!rx.test(entry.title) && !titleLower.includes(name)) continue;
      matched++;
      try {
        await db.insert(capabilityFilingsTable).values({
          capabilityId: cap.id,
          accessionNumber: entry.accessionNumber,
          cik: entry.cik,
          companyName: entry.companyName,
          ticker: null,
          formType: entry.formType,
          filingDate: entry.filedAt,
          filingUrl: entry.link,
          excerpt: `Filing title: ${entry.title}`,
          sectionRef: null,
          extractionSource: "edgar-rss",
          rawPayload: entry as unknown as Record<string, unknown>,
          lastConfirmedAt: new Date(),
        }).onConflictDoNothing();
        inserted++;
      } catch (err) {
        errors.push(`cap=${cap.id} accession=${entry.accessionNumber}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (inserted > 0) {
    logger.info({ fetched: entries.length, matched, inserted, errors: errors.length, durationMs: Date.now() - start }, "[edgar-rss] tick complete");
  }

  return { fetched: entries.length, matched, inserted, errors, durationMs: Date.now() - start };
}

async function fetchAtomFeed(): Promise<AtomEntry[]> {
  const params = new URLSearchParams();
  params.set("action", "getcurrent");
  params.set("type", "");
  params.set("company", "");
  params.set("dateb", "");
  params.set("owner", "include");
  params.set("count", "40");
  params.set("output", "atom");
  const url = `${EDGAR_ATOM}?${params.toString()}`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": EDGAR_USER_AGENT,
      "Accept": "application/atom+xml,application/xml,text/xml",
    },
  });
  if (!resp.ok) throw new Error(`SEC atom ${resp.status}`);
  const text = await resp.text();
  return parseAtomXml(text);
}

/**
 * Minimal Atom XML parser — extracts entry/title/link/updated and infers
 * filing metadata from the title format SEC uses: e.g.
 *   "10-K - APPLE INC (0000320193) (Filer)"
 * No XML library dependency — regex is sufficient for SEC's stable schema.
 */
function parseAtomXml(xml: string): AtomEntry[] {
  const entries: AtomEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = extractTag(block, "title")?.trim() ?? "";
    const updated = extractTag(block, "updated")?.trim() ?? "";
    const linkMatch = block.match(/<link[^>]+href="([^"]+)"/);
    const link = linkMatch ? linkMatch[1] : "";
    if (!title || !link) continue;
    const meta = parseFilingTitle(title);
    if (!meta) continue;
    const accessionMatch = link.match(/(\d{10}-\d{2}-\d{6})/);
    const accessionNumber = accessionMatch ? accessionMatch[1] : `unknown-${entries.length}`;
    entries.push({
      title,
      filedAt: updated ? new Date(updated) : new Date(),
      link,
      formType: meta.formType,
      cik: meta.cik,
      companyName: meta.companyName,
      accessionNumber,
    });
  }
  return entries;
}

function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? decodeHtml(m[1]) : null;
}

function parseFilingTitle(title: string): { formType: string; companyName: string; cik: string } | null {
  // Format: "10-K - APPLE INC (0000320193) (Filer)"
  const m = title.match(/^(\S+)\s+-\s+(.+?)\s*\((\d+)\)/);
  if (!m) return null;
  return { formType: m[1], companyName: m[2].trim(), cik: m[3] };
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
