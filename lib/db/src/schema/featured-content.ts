import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Scheduled content placements. Each row says "show this content in this slot
 * between these times". The public lookup endpoint filters by slotKey AND
 * (startsAt is null or <= now) AND (endsAt is null or > now), ordered by
 * priority desc, created desc. First match wins.
 *
 * `contentType` is polymorphic so future content types (educational articles,
 * marketplace listings) can use the same scheduling primitive. V1 only
 * populates "case_study".
 *
 * Slots we've defined:
 *   - "homepage_hero"          — Hero CTA + label on the landing page
 *   - "homepage_case_card"     — The dark nav-card on the landing page
 * Add more as the UI needs them; the slot is just a string key.
 */
export const featuredContentSlotsTable = pgTable(
  "featured_content_slots",
  {
    id: serial("id").primaryKey(),
    slotKey: text("slot_key").notNull(),
    contentType: text("content_type").notNull(), // "case_study" | "educational_content" | ...
    contentId: integer("content_id").notNull(),
    startsAt: timestamp("starts_at"),             // null = active immediately
    endsAt: timestamp("ends_at"),                 // null = runs indefinitely
    priority: integer("priority").notNull().default(0),
    note: text("note"),                           // optional admin label ("Q4 campaign")
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("featured_content_slot_idx").on(table.slotKey),
    index("featured_content_window_idx").on(table.slotKey, table.startsAt, table.endsAt),
  ],
);

export type FeaturedContentSlot = typeof featuredContentSlotsTable.$inferSelect;
