import { pgTable, serial, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Unified audit chain — every blockchain-anchored event flows through this
 * one table. Domain-specific anchoring (admin key rotations, KYC verifications,
 * marketplace purchases, security incidents) writes a row here. Anchoring
 * happens async via services/blockchain-audit.ts; until the receipt comes
 * back the row is `pending`.
 *
 * Why a single table instead of per-domain columns:
 *   - One feed for the audit-explorer admin UI (/admin/audit-chain)
 *   - Cross-event verification (sequence numbers are monotonic per Hedera
 *     topic, so the explorer can show ordering proof)
 *   - Domain tables stay clean — they don't need anchor-receipt columns
 *
 * Sensitive data NEVER goes in `contextSnapshot`. It holds non-sensitive
 * identifiers + a `contextHash` that lets verifiers prove later that a
 * specific payload existed at this timestamp without revealing the payload.
 */
export const auditChainEventsTable = pgTable("audit_chain_events", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(), // e.g. "admin_key_rotated", "kyc_verified", "marketplace_purchase"
  relatedEntity: text("related_entity"), // e.g. "system_secrets:1", "kyc_verifications:123"
  // Sha256 of the canonical payload — proves "I saw this exact data at this time"
  // without storing the data itself on chain.
  contextHash: text("context_hash").notNull(),
  // Non-sensitive metadata that's safe to publish + display in the UI.
  contextSnapshot: jsonb("context_snapshot").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
  // Anchor receipt — populated after Hedera SDK call returns.
  anchorProvider: text("anchor_provider"),         // "hedera_hcs" | "polygon_evm"
  anchorTopicOrContractId: text("anchor_topic_or_contract_id"),
  anchorSequenceNumber: integer("anchor_sequence_number"),
  anchorTxId: text("anchor_tx_id"),
  anchorConsensusTimestamp: text("anchor_consensus_timestamp"),
  // Status lifecycle: pending → anchored | failed | skipped
  // skipped = chain not configured, row created for audit history only
  anchorStatus: text("anchor_status").notNull().default("pending"),
  anchorError: text("anchor_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  anchoredAt: timestamp("anchored_at"),
});

export type AuditChainEvent = typeof auditChainEventsTable.$inferSelect;
export type NewAuditChainEvent = typeof auditChainEventsTable.$inferInsert;
