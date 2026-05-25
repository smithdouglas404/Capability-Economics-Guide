import { pgTable, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Content-hash cache for Perplexity responses. Keyed by SHA-256 of
 * `{ model, messages }` (the only inputs that affect the response).
 *
 * Why this exists — the 4-perspective triangulation prompts are
 * deterministic; the same 4 prompts re-fired every rotation cycle prior to
 * this cache. With Perplexity 401-ing each call also burned a paid
 * Gemini-2.5-Flash :online fallback. Caching at the wrapper layer cuts
 * both Perplexity AND Gemini-fallback spend for repeat queries.
 *
 * TTL is enforced at read time via `expires_at > NOW()`; a background
 * sweep can DELETE expired rows but isn't required for correctness.
 */
export const perplexityCacheTable = pgTable(
  "perplexity_cache",
  {
    key: text("key").primaryKey(),
    model: text("model").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    hitCount: integer("hit_count").notNull().default(0),
    lastHitAt: timestamp("last_hit_at"),
  },
  (t) => ({
    expiresAtIdx: index("perplexity_cache_expires_at_idx").on(t.expiresAt),
  }),
);

export type PerplexityCacheRow = typeof perplexityCacheTable.$inferSelect;
export type InsertPerplexityCacheRow = typeof perplexityCacheTable.$inferInsert;
