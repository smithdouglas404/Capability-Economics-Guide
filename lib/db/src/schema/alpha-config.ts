import { pgTable, integer, real, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Single-row config table for /alpha tab parameters.
 *
 * The quadrant multiples (hot=15× annual margin → EV, etc.) and the
 * methodology link used to live as hardcoded constants inside
 * `pages/alpha.tsx`'s TraceabilityDialog. They moved here so they can
 * be (a) updated without a frontend deploy, (b) surfaced to users with
 * a citation, and (c) versioned in one place.
 *
 * Single row enforced by checking `id = 1` on read/write. Seeded once
 * by `scripts/src/seed-alpha-config.ts`; safe to re-run.
 */
export const alphaConfigTable = pgTable("alpha_config", {
  id: integer("id").primaryKey().default(1),
  // Annual-margin → enterprise-value multiples by quadrant.
  quadrantHot: real("quadrant_hot").notNull().default(15),
  quadrantEmerging: real("quadrant_emerging").notNull().default(10),
  quadrantCooling: real("quadrant_cooling").notNull().default(7),
  quadrantTableStakes: real("quadrant_table_stakes").notNull().default(4),
  quadrantDeclining: real("quadrant_declining").notNull().default(1),
  // Public link the frontend renders alongside the multiples so prospects
  // can click through to the methodology section. Defaults to the in-repo
  // /methodology page; can be overridden to a hosted whitepaper later.
  methodologyUrl: text("methodology_url").notNull().default("/methodology#quadrant-multiples"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AlphaConfig = typeof alphaConfigTable.$inferSelect;
export type NewAlphaConfig = typeof alphaConfigTable.$inferInsert;
