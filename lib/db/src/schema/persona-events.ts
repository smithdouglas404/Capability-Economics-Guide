import { pgTable, serial, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Append-only stream of user-action events related to persona signal:
 *   - "first_set"               — user picked a persona for the first time
 *   - "switched"                — user changed personas
 *   - "applied_from_org_invite" — org default persona auto-applied at invite-accept
 *   - "feature_used"            — user hit a persona-relevant route while a persona was active
 *
 * Distinct from admin_audit_log which captures admin actions only. Used by the
 * admin "Personas" tab to compute per-persona signup, switch, and feature funnels.
 */
export const personaEventsTable = pgTable(
  "persona_events",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    eventType: text("event_type").notNull(),
    personaSlug: text("persona_slug").notNull(),
    priorPersonaSlug: text("prior_persona_slug"),
    feature: text("feature"),
    context: jsonb("context"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("persona_events_user_idx").on(table.userId),
    index("persona_events_type_created_idx").on(table.eventType, table.createdAt),
    index("persona_events_persona_created_idx").on(table.personaSlug, table.createdAt),
  ],
);

export type PersonaEvent = typeof personaEventsTable.$inferSelect;
export type InsertPersonaEvent = typeof personaEventsTable.$inferInsert;

export type PersonaEventType =
  | "first_set"
  | "switched"
  | "applied_from_org_invite"
  | "feature_used";
