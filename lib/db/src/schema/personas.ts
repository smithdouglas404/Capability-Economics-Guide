import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const PERSONA_SLUGS = [
  "pe_vc",
  "researcher",
  "academic",
  "corporate_exec",
  "entrepreneur",
] as const;

export type PersonaSlug = (typeof PERSONA_SLUGS)[number];

export const DEFAULT_PERSONA_SLUG: PersonaSlug = "corporate_exec";

export const userPersonasTable = pgTable("user_personas", {
  userId: text("user_id").primaryKey(),
  activePersonaSlug: text("active_persona_slug").notNull(),
  priorPersonaSlug: text("prior_persona_slug"),
  setAt: timestamp("set_at").defaultNow().notNull(),
});

export type UserPersona = typeof userPersonasTable.$inferSelect;
