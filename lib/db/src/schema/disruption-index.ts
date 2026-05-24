/**
 * Capability Disruption Index — forward-looking "how disruptable is this
 * capability" scoring. Sibling to CVI (current value) and DVX (current
 * disruption signal); this layer predicts which capabilities are next.
 *
 * Five tables make up the DI surface:
 *
 *   disruption_enabling_tech       — catalog of techs that obviate asset friction
 *                                    (smartphone+GPS, LLM, distributed compute, etc.)
 *
 *   disruption_playbook_archetypes — the 8 reference disruption patterns we
 *                                    match against (Uber, Airbnb, Google,
 *                                    Amazon, Stripe, OpenAI/ChatGPT, Tesla,
 *                                    Netflix). Each is a 6-dimensional
 *                                    sub-score profile.
 *
 *   capability_disruption_index    — per-capability DI row: 6 sub-scores +
 *                                    composite + narrative + top playbook +
 *                                    top enabling techs + cited evidence.
 *
 *   disruption_playbook_matches    — many-to-many similarity scores from
 *                                    each capability to every archetype
 *                                    (cosine on the sub-score vectors).
 *                                    Lets the lab show "78% Uber, 41% Airbnb"
 *                                    instead of a single best-match label.
 *
 *   disruption_lab_scenarios       — saved user explorations from the
 *                                    interactive /disruption-lab. Lets an
 *                                    entrepreneur fork / share / revisit
 *                                    a "what if I attack X with Y stack"
 *                                    hypothesis.
 *
 * Scoring + agent live in services/disruption-index.ts and services/
 * disruption-vector-agent.ts. Public read endpoints under /api/disruption-
 * index/*; admin recompute endpoints under /api/admin/disruption-index/*.
 */
import { pgTable, serial, integer, real, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { capabilitiesTable } from "./capabilities";

// ─── enabling-tech catalog ────────────────────────────────────────────────
//
// Each row is a technology that, when mature, lets a disruptor obviate the
// asset/labor friction of an incumbent capability. Maturity year is the
// "crossed the chasm" inflection — e.g., smartphones in 2008, LLMs in 2022.
// The scoring service weights an enabling tech's contribution to a
// capability's DI by how recently that tech matured (recently-mature techs
// haven't fully reshaped industries yet, so they predict more disruption).
export const disruptionEnablingTechTable = pgTable(
  "disruption_enabling_tech",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    category: text("category").notNull(), // mobile | llm | distributed_compute | blockchain | iot | ambient_sensing | payment | identity | marketplace | sensor | etc.
    description: text("description").notNull(),
    /** Year the tech crossed the adoption chasm. Used as a maturity multiplier. */
    maturityYear: integer("maturity_year").notNull(),
    /** Canonical examples of disruptors that rode this tech. */
    exampleDisruptors: jsonb("example_disruptors").$type<string[]>().notNull().default([]),
    /** Free-form citation URLs. */
    citations: jsonb("citations").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("disruption_enabling_tech_category_idx").on(t.category),
  ],
);

// ─── playbook archetypes ──────────────────────────────────────────────────
//
// The 8 reference patterns. Each archetype's `subscoreProfile` is its
// canonical fingerprint — high values on the forces the archetype actually
// leveraged. The scoring service computes cosine similarity between a
// capability's sub-score vector and every archetype's profile to find the
// best-fit playbook.
//
// Sub-score keys (each 0-100):
//   assetFriction          — incumbent asset/regulatory lock
//   jtbdAbstractability    — how cleanly the job-to-be-done separates
//   enablingTechStrength   — how strong the available enabling tech is
//   trustReplaceability    — software trust replacing regulatory trust
//   latentSupplyMultiplier — supply expansion factor
//   marginAsymmetry        — incumbent vs disruptor P&L gap
export type DisruptionSubscoreProfile = {
  assetFriction: number;
  jtbdAbstractability: number;
  enablingTechStrength: number;
  trustReplaceability: number;
  latentSupplyMultiplier: number;
  marginAsymmetry: number;
};

export const disruptionPlaybookArchetypesTable = pgTable(
  "disruption_playbook_archetypes",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    /** One-line summary: "Marketplace + ratings + dynamic pricing on top of latent supply." */
    summary: text("summary").notNull(),
    /** 6-dimensional sub-score profile — see DisruptionSubscoreProfile above. */
    subscoreProfile: jsonb("subscore_profile").$type<DisruptionSubscoreProfile>().notNull(),
    /** Concrete actions a disruptor following this playbook tends to take. */
    canonicalActions: jsonb("canonical_actions").$type<string[]>().notNull().default([]),
    /** Reference companies that pioneered this playbook. */
    exampleCompanies: jsonb("example_companies").$type<string[]>().notNull().default([]),
    /** Narrative template — `{capability}` and `{industry}` get substituted. */
    narrativeTemplate: text("narrative_template").notNull(),
    /** Citations grounding the archetype. */
    citations: jsonb("citations").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

// ─── per-capability DI row ────────────────────────────────────────────────
//
// One row per capability. Recomputed by disruption-vector-agent on a 6h
// cadence when underlying inputs move (CVI delta, new tagged macro event,
// new company fingerprint). Admin endpoint can force a recompute.
export const capabilityDisruptionIndexTable = pgTable(
  "capability_disruption_index",
  {
    id: serial("id").primaryKey(),
    capabilityId: integer("capability_id").references(() => capabilitiesTable.id, { onDelete: "cascade" }).notNull(),
    // Six sub-scores (0-100).
    assetFriction: real("asset_friction").notNull(),
    jtbdAbstractability: real("jtbd_abstractability").notNull(),
    enablingTechStrength: real("enabling_tech_strength").notNull(),
    trustReplaceability: real("trust_replaceability").notNull(),
    latentSupplyMultiplier: real("latent_supply_multiplier").notNull(),
    marginAsymmetry: real("margin_asymmetry").notNull(),
    /** Weighted composite — see services/disruption-index.ts WEIGHTS. */
    compositeDi: real("composite_di").notNull(),
    /**
     * Per-subscore evidence + citations. Schema:
     *   {
     *     assetFriction: { value, rationale, sources: [{ label, url }] },
     *     jtbdAbstractability: { … },
     *     …
     *   }
     */
    rationale: jsonb("rationale").$type<Record<string, { value: number; rationale: string; sources: Array<{ label: string; url?: string }> }>>(),
    /** 3-paragraph LLM-composed disruption hypothesis. */
    narrative: text("narrative"),
    /** Best-fit playbook archetype id (FK soft — kept loose for backfills). */
    topPlaybookId: integer("top_playbook_id"),
    /** Cosine similarity to the top playbook, 0-1. */
    topPlaybookSimilarity: real("top_playbook_similarity"),
    /** Top-3 enabling techs that most contribute to this cap's DI. */
    topEnablingTechIds: jsonb("top_enabling_tech_ids").$type<number[]>().notNull().default([]),
    /** Candidate disruptor companies (from the `companies` table) matching the playbook. */
    candidateDisruptors: jsonb("candidate_disruptors").$type<Array<{ companyId: number; name: string; reason: string }>>().notNull().default([]),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
    /** disruption-vector-agent run id that produced this row (FK soft). */
    computedByRunId: integer("computed_by_run_id"),
  },
  (t) => [
    uniqueIndex("capability_disruption_index_cap_idx").on(t.capabilityId),
    index("capability_disruption_index_composite_idx").on(t.compositeDi),
    index("capability_disruption_index_playbook_idx").on(t.topPlaybookId),
  ],
);

// ─── per-capability × archetype similarity matrix ─────────────────────────
//
// For each capability, store its cosine similarity to every archetype. The
// lab uses these to render "this looks 78% Uber, 41% Airbnb" instead of a
// single label. Recomputed alongside the DI row above.
export const disruptionPlaybookMatchesTable = pgTable(
  "disruption_playbook_matches",
  {
    id: serial("id").primaryKey(),
    capabilityId: integer("capability_id").references(() => capabilitiesTable.id, { onDelete: "cascade" }).notNull(),
    playbookId: integer("playbook_id").references(() => disruptionPlaybookArchetypesTable.id, { onDelete: "cascade" }).notNull(),
    similarity: real("similarity").notNull(), // 0..1, cosine on sub-score vectors
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("disruption_playbook_matches_cap_play_idx").on(t.capabilityId, t.playbookId),
    index("disruption_playbook_matches_similarity_idx").on(t.similarity),
  ],
);

// ─── lab scenarios (saved user explorations) ──────────────────────────────
//
// Lets a user save "what if I attack [capability] with [these enabling
// techs]" + come back to the result, fork it, share it. Optional name +
// description so a saved scenario is more than a row of ids.
export const disruptionLabScenariosTable = pgTable(
  "disruption_lab_scenarios",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    targetCapabilityId: integer("target_capability_id").references(() => capabilitiesTable.id, { onDelete: "cascade" }).notNull(),
    /** Enabling-tech ids the user applied on top of the capability's baseline. */
    appliedTechIds: jsonb("applied_tech_ids").$type<number[]>().notNull().default([]),
    /**
     * Resolved DI under the alt-stack: same shape as
     * capability_disruption_index but a snapshot of THIS scenario.
     */
    resolvedSubscores: jsonb("resolved_subscores").$type<DisruptionSubscoreProfile>().notNull(),
    resolvedCompositeDi: real("resolved_composite_di").notNull(),
    resolvedTopPlaybookId: integer("resolved_top_playbook_id"),
    /** Pitch text used to create the scenario via /from-pitch (if applicable). */
    pitchSource: text("pitch_source"),
    /** "manual" | "pitch" — how the scenario was created. */
    origin: text("origin").notNull().default("manual"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("disruption_lab_scenarios_user_idx").on(t.userId),
    index("disruption_lab_scenarios_target_idx").on(t.targetCapabilityId),
  ],
);

export type DisruptionEnablingTech = typeof disruptionEnablingTechTable.$inferSelect;
export type DisruptionPlaybookArchetype = typeof disruptionPlaybookArchetypesTable.$inferSelect;
export type CapabilityDisruptionIndex = typeof capabilityDisruptionIndexTable.$inferSelect;
export type DisruptionPlaybookMatch = typeof disruptionPlaybookMatchesTable.$inferSelect;
export type DisruptionLabScenario = typeof disruptionLabScenariosTable.$inferSelect;
