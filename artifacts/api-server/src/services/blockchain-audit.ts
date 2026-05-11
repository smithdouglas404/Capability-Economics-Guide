/**
 * Unified blockchain audit anchoring — Hedera Consensus Service (HCS).
 *
 * Domain code calls `anchorEvent(eventType, contextSnapshot, contextHash,
 * relatedEntity)`. This module:
 *   1. Inserts a row into `audit_chain_events` with status=pending
 *   2. Submits the hash + minimal snapshot to the configured Hedera topic
 *   3. Updates the row with the receipt (sequenceNumber, txId, consensusTs)
 *      or marks it failed/skipped.
 *
 * Setup:
 *   HEDERA_OPERATOR_ID    — 0.0.xxx (testnet account)
 *   HEDERA_OPERATOR_KEY   — DER-encoded private key
 *   HEDERA_AUDIT_TOPIC_ID — 0.0.xxx (create once via init-hedera-topic script)
 *   HEDERA_NETWORK        — "testnet" (default) | "mainnet"
 *
 * Graceful: when env is missing, row is still written with status=skipped
 * — Postgres remains the authoritative audit log. Anchor receipts are
 * additive proof.
 *
 * Swap to Polygon later: only this file changes; the unified table +
 * audit-chain UI work against any chain.
 */
import { createHash } from "node:crypto";
import { db, auditChainEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface AnchorContext {
  /** Sha256 hex of the canonical payload — what the chain proves existed. */
  contextHash?: string;
  /** Non-sensitive metadata safe to publish. */
  contextSnapshot?: Record<string, string | number | boolean | null>;
  /** Optional pointer back to a domain row, e.g. "system_secrets:1". */
  relatedEntity?: string;
}

export function isHederaConfigured(): boolean {
  return !!(
    process.env.HEDERA_OPERATOR_ID
    && process.env.HEDERA_OPERATOR_KEY
    && process.env.HEDERA_AUDIT_TOPIC_ID
  );
}

export function blockchainAuditStatus(): {
  configured: boolean;
  provider: string;
  network: string;
  topicId: string | null;
} {
  return {
    configured: isHederaConfigured(),
    provider: "hedera_hcs",
    network: process.env.HEDERA_NETWORK ?? "testnet",
    topicId: process.env.HEDERA_AUDIT_TOPIC_ID ?? null,
  };
}

/**
 * Build the canonical hash for a payload. Always use this so verifiers can
 * reproduce the hash from the contextSnapshot you publish.
 */
export function canonicalHash(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload, Object.keys(payload as object).sort()))
    .digest("hex");
}

/**
 * Anchor one event. Returns the audit_chain_events row id. Always writes
 * the row even if chain anchoring is unconfigured or fails (status reflects
 * that). Never throws — callers can fire-and-forget.
 */
export async function anchorEvent(
  eventType: string,
  ctx: AnchorContext = {},
): Promise<number | null> {
  const contextSnapshot = ctx.contextSnapshot ?? {};
  const contextHash = ctx.contextHash ?? canonicalHash(contextSnapshot);
  try {
    const [row] = await db.insert(auditChainEventsTable).values({
      eventType,
      relatedEntity: ctx.relatedEntity ?? null,
      contextHash,
      contextSnapshot,
      anchorStatus: "pending",
    }).returning();

    // Submit asynchronously so callers don't block on Hedera latency
    // (1-3 seconds per message in testnet). We capture the receipt by
    // updating the row by id.
    void submitToChain(row.id, eventType, contextHash, contextSnapshot);
    return row.id;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), eventType }, "[blockchain-audit] insert failed");
    return null;
  }
}

async function submitToChain(
  rowId: number,
  eventType: string,
  contextHash: string,
  contextSnapshot: Record<string, unknown>,
): Promise<void> {
  if (!isHederaConfigured()) {
    await db.update(auditChainEventsTable)
      .set({ anchorStatus: "skipped", anchoredAt: new Date(), anchorError: "Hedera not configured" })
      .where(eq(auditChainEventsTable.id, rowId));
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk = await import("@hashgraph/sdk") as any;
    const { Client, AccountId, PrivateKey, TopicId, TopicMessageSubmitTransaction } = sdk;
    const network = (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase();
    const client = (network === "mainnet")
      ? Client.forMainnet()
      : Client.forTestnet();
    client.setOperator(
      AccountId.fromString(process.env.HEDERA_OPERATOR_ID!),
      PrivateKey.fromString(process.env.HEDERA_OPERATOR_KEY!),
    );
    const topicId = TopicId.fromString(process.env.HEDERA_AUDIT_TOPIC_ID!);
    const message = JSON.stringify({
      v: 1,
      eventType,
      contextHash,
      contextSnapshot,
      submittedAt: new Date().toISOString(),
    });
    const tx = await new TopicMessageSubmitTransaction({ topicId, message }).execute(client);
    const receipt = await tx.getReceipt(client);
    const record = await tx.getRecord(client);
    await db.update(auditChainEventsTable).set({
      anchorProvider: "hedera_hcs",
      anchorTopicOrContractId: process.env.HEDERA_AUDIT_TOPIC_ID!,
      anchorSequenceNumber: receipt.topicSequenceNumber ? Number(receipt.topicSequenceNumber) : null,
      anchorTxId: tx.transactionId.toString(),
      anchorConsensusTimestamp: record.consensusTimestamp?.toString() ?? null,
      anchorStatus: "anchored",
      anchoredAt: new Date(),
    }).where(eq(auditChainEventsTable.id, rowId));
    logger.info(
      { rowId, eventType, sequenceNumber: receipt.topicSequenceNumber },
      "[blockchain-audit] event anchored",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, rowId, eventType }, "[blockchain-audit] anchor submission failed");
    await db.update(auditChainEventsTable)
      .set({ anchorStatus: "failed", anchorError: message.slice(0, 480), anchoredAt: new Date() })
      .where(eq(auditChainEventsTable.id, rowId))
      .catch(() => { /* swallow secondary failure */ });
  }
}

/**
 * Build a HashScan explorer URL for a given anchor receipt. Used by the
 * audit-chain UI for "Verify on HashScan" links.
 */
export function hashScanUrl(topicId: string, sequenceNumber?: number | null, txId?: string | null): string | null {
  const network = (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase();
  const base = network === "mainnet" ? "https://hashscan.io/mainnet" : "https://hashscan.io/testnet";
  if (sequenceNumber != null) return `${base}/topic/${topicId}/message/${sequenceNumber}`;
  if (txId) return `${base}/transaction/${txId}`;
  return `${base}/topic/${topicId}`;
}
