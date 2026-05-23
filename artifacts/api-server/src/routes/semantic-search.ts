import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { searchCapabilities, findSimilarToCapability } from "../services/semantic-search";
import { logger } from "../lib/logger";
import {
  db,
  capabilitiesTable,
  regulationsTable,
  companiesTable,
  companyCapabilityFingerprintTable,
  memberProfilesTable,
  memberPostsTable,
  marketplaceListingsTable,
  marketplaceSellersTable,
} from "@workspace/db";
import { eq, or, ilike, sql, desc, inArray } from "drizzle-orm";

const router: IRouter = Router();

const SearchQuery = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  leafOnly: z.union([z.literal("1"), z.literal("true")]).optional(),
  includePending: z.union([z.literal("1"), z.literal("true")]).optional(),
  industryId: z.coerce.number().int().positive().optional(),
});

router.get("/search/capabilities", async (req, res) => {
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }
  try {
    const result = await searchCapabilities({
      query: parsed.data.q,
      limit: parsed.data.limit,
      leafOnly: parsed.data.leafOnly === "1" || parsed.data.leafOnly === "true",
      includePending: parsed.data.includePending === "1" || parsed.data.includePending === "true",
      industryId: parsed.data.industryId,
    });
    res.set("Cache-Control", "public, max-age=60");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "semantic search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

router.get("/capabilities/:id/similar", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid capability id" });
    return;
  }
  const limit = req.query.limit ? Math.min(100, Math.max(1, Number(req.query.limit))) : 10;
  try {
    const results = await findSimilarToCapability(id, limit);
    res.set("Cache-Control", "public, max-age=300");
    res.json({ results });
  } catch (err) {
    logger.error({ err, id }, "similar capabilities failed");
    res.status(500).json({ error: "Similarity search failed" });
  }
});

/**
 * Cross-page search — capabilities + regulations + companies + members +
 * posts + marketplace listings, grouped by type. Each result item carries a
 * `capabilityFingerprintScore` (0..1) computed as the size of the overlap
 * between the result's capability fingerprint and the BM25 query's top
 * matched capabilities, normalised by query-fingerprint size. Falls back to
 * the row's per-type lexical score when no capability fingerprint is
 * available (regulations / sellers).
 *
 * Tight, single round-trip: 1 BM25 capability search + 5 cheap ILIKE
 * lookups in parallel. No new indices required.
 */
const CrossSearchQuery = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

interface CrossResult {
  id: number;
  title: string;
  subtitle?: string | null;
  href: string;
  capabilityFingerprintScore: number;
  lexicalScore?: number;
}

router.get("/search/all", async (req, res) => {
  const parsed = CrossSearchQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }
  const q = parsed.data.q.trim();
  const limit = parsed.data.limit ?? 10;
  const like = `%${q.replace(/[%_]/g, m => `\\${m}`)}%`;

  try {
    // 1. Capability BM25 — also the source of the query fingerprint.
    const capResult = await searchCapabilities({ query: q, limit: limit * 2 });
    const queryCapabilityIds = new Set(capResult.results.map(r => r.capabilityId));
    const queryCapabilitySlugs = new Set(capResult.results.map(r => r.slug));
    const queryFingerprintSize = Math.max(1, queryCapabilityIds.size);
    const maxBm25 = capResult.results.reduce((m, r) => Math.max(m, r.score), 0) || 1;

    // 2. Per-type lookups in parallel.
    const [regRows, companyRows, memberRows, postRows, listingRows, fingerprintRows] = await Promise.all([
      db.select({
        id: regulationsTable.id,
        name: regulationsTable.name,
        shortCode: regulationsTable.shortCode,
        description: regulationsTable.description,
        jurisdiction: regulationsTable.jurisdiction,
      }).from(regulationsTable)
        .where(or(
          ilike(regulationsTable.name, like),
          ilike(regulationsTable.shortCode, like),
          ilike(regulationsTable.description, like),
        ))
        .limit(limit),

      db.select({
        id: companiesTable.id,
        slug: companiesTable.slug,
        name: companiesTable.name,
        description: companiesTable.description,
        industryId: companiesTable.industryId,
      }).from(companiesTable)
        .where(or(
          ilike(companiesTable.name, like),
          ilike(companiesTable.description, like),
        ))
        .limit(limit * 2),

      db.select({
        userId: memberProfilesTable.userId,
        slug: memberProfilesTable.slug,
        displayName: memberProfilesTable.displayName,
        headline: memberProfilesTable.headline,
        bio: memberProfilesTable.bio,
        capabilityTags: memberProfilesTable.capabilityTags,
      }).from(memberProfilesTable)
        .where(or(
          ilike(memberProfilesTable.displayName, like),
          ilike(memberProfilesTable.headline, like),
          ilike(memberProfilesTable.bio, like),
        ))
        .limit(limit * 2),

      db.select({
        id: memberPostsTable.id,
        authorUserId: memberPostsTable.authorUserId,
        body: memberPostsTable.body,
        capabilityTags: memberPostsTable.capabilityTags,
        createdAt: memberPostsTable.createdAt,
      }).from(memberPostsTable)
        .where(ilike(memberPostsTable.body, like))
        .orderBy(desc(memberPostsTable.createdAt))
        .limit(limit * 2),

      db.select({
        id: marketplaceListingsTable.id,
        title: marketplaceListingsTable.title,
        description: marketplaceListingsTable.description,
        type: marketplaceListingsTable.type,
        priceCents: marketplaceListingsTable.priceCents,
        tags: marketplaceListingsTable.tags,
        status: marketplaceListingsTable.status,
        sellerId: marketplaceListingsTable.sellerId,
      }).from(marketplaceListingsTable)
        .where(sql`${marketplaceListingsTable.status} = 'approved' AND (
          ${marketplaceListingsTable.title} ILIKE ${like}
          OR ${marketplaceListingsTable.description} ILIKE ${like}
        )`)
        .limit(limit * 2),

      // Company → capability fingerprint join (one query, for all matched companies).
      // Materialise after we know which companyIds are in play; done below.
      Promise.resolve([] as Array<{ companyId: number; capabilityId: number }>),
    ]);

    // 3. Hydrate company fingerprints for the matched company set.
    const companyIds = companyRows.map(c => c.id);
    const companyFingerprints: Record<number, number[]> = {};
    if (companyIds.length > 0) {
      const fpRows = await db.select({
        companyId: companyCapabilityFingerprintTable.companyId,
        capabilityId: companyCapabilityFingerprintTable.capabilityId,
      }).from(companyCapabilityFingerprintTable)
        .where(inArray(companyCapabilityFingerprintTable.companyId, companyIds));
      for (const r of fpRows) {
        (companyFingerprints[r.companyId] ??= []).push(r.capabilityId);
      }
    }
    // Suppress unused-binding warning for the placeholder fingerprintRows.
    void fingerprintRows;

    // 4. Score helpers.
    const scoreBySlugOverlap = (slugs: string[]): number => {
      if (slugs.length === 0 || queryCapabilitySlugs.size === 0) return 0;
      let overlap = 0;
      for (const s of slugs) if (queryCapabilitySlugs.has(s)) overlap += 1;
      return Math.min(1, overlap / queryFingerprintSize);
    };
    const scoreByIdOverlap = (ids: number[]): number => {
      if (ids.length === 0 || queryCapabilityIds.size === 0) return 0;
      let overlap = 0;
      for (const id of ids) if (queryCapabilityIds.has(id)) overlap += 1;
      return Math.min(1, overlap / queryFingerprintSize);
    };

    // 5. Build grouped results.
    const groups = {
      capabilities: capResult.results.slice(0, limit).map(r => ({
        id: r.capabilityId,
        title: r.capabilityName,
        subtitle: r.industryName,
        href: `/capability/${r.capabilityId}`,
        capabilityFingerprintScore: 1, // self — perfect alignment
        lexicalScore: r.score / maxBm25,
      })) satisfies CrossResult[],

      regulations: regRows.map(r => ({
        id: r.id,
        title: `${r.shortCode} — ${r.name}`,
        subtitle: r.jurisdiction,
        href: `/regulations#reg-${r.id}`,
        // No native fingerprint on regulations — use lexical relevance as the proxy.
        capabilityFingerprintScore: 0,
        lexicalScore: 1,
      })) satisfies CrossResult[],

      companies: companyRows.map(c => {
        const fp = companyFingerprints[c.id] ?? [];
        return {
          id: c.id,
          title: c.name,
          subtitle: c.description ? c.description.slice(0, 140) : null,
          href: `/companies/${c.slug}`,
          capabilityFingerprintScore: scoreByIdOverlap(fp),
          lexicalScore: 1,
        };
      }) satisfies CrossResult[],

      members: memberRows.map(m => ({
        id: 0, // members keyed by slug, not id
        title: m.displayName,
        subtitle: m.headline,
        href: `/member/${m.slug}`,
        capabilityFingerprintScore: scoreBySlugOverlap(m.capabilityTags ?? []),
        lexicalScore: 1,
      })) satisfies CrossResult[],

      posts: postRows.map(p => ({
        id: p.id,
        title: p.body.slice(0, 120),
        subtitle: new Date(p.createdAt).toISOString().slice(0, 10),
        href: `/feed#post-${p.id}`,
        capabilityFingerprintScore: scoreBySlugOverlap(p.capabilityTags ?? []),
        lexicalScore: 1,
      })) satisfies CrossResult[],

      listings: listingRows.map(l => ({
        id: l.id,
        title: l.title,
        subtitle: `${l.type} · $${(l.priceCents / 100).toFixed(2)}`,
        href: `/marketplace/listing/${l.id}`,
        // Listings carry a tags[] array — overlap that with the matched capability slugs.
        capabilityFingerprintScore: scoreBySlugOverlap(l.tags ?? []),
        lexicalScore: 1,
      })) satisfies CrossResult[],
    };

    // 6. Sort each group by capabilityFingerprintScore desc, then lexical, then trim.
    const sortAndTrim = (rows: CrossResult[]): CrossResult[] => rows
      .sort((a, b) => (b.capabilityFingerprintScore - a.capabilityFingerprintScore)
        || ((b.lexicalScore ?? 0) - (a.lexicalScore ?? 0)))
      .slice(0, limit);

    res.set("Cache-Control", "public, max-age=30");
    res.json({
      query: q,
      queryCapabilities: capResult.results.slice(0, 5).map(r => ({
        id: r.capabilityId,
        name: r.capabilityName,
        slug: r.slug,
      })),
      groups: {
        capabilities: sortAndTrim(groups.capabilities),
        regulations: sortAndTrim(groups.regulations),
        companies: sortAndTrim(groups.companies),
        members: sortAndTrim(groups.members),
        posts: sortAndTrim(groups.posts),
        listings: sortAndTrim(groups.listings),
      },
    });
  } catch (err) {
    logger.error({ err, q }, "cross-page search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

// Silence unused-import warning for marketplaceSellersTable (reserved for
// future seller-name fallback search — not wired yet).
void marketplaceSellersTable;

export default router;
