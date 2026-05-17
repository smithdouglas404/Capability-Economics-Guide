/**
 * Dify → inflexcvi callback gateway.
 *
 * Dify Workflows + Chatflows write back to the inflexcvi system of record
 * through these HMAC-gated endpoints. Every endpoint:
 *   1. Requires `X-Dify-Callback-Signature: <hex>` over the raw body.
 *   2. Is idempotent on `clientRequestId` (returns cached response if seen).
 *   3. Logs to `dify_callback_log` regardless of success/failure.
 *
 * Mounted in `app.ts` BEFORE `express.json()` so the raw body is available
 * for HMAC verification — same shape as the Stripe webhook router.
 */

import express, { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  difyCallbackLog,
  tierRecommendationsTable,
  kycAppealsTable,
  paymentRecoveryLog,
  researchArtifactsTable,
  marketplaceListingsTable,
  workbenchBoardsTable,
  workbenchCardsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  verifyDifyCallbackSignature,
  isDifyCallbackConfigured,
  DIFY_CALLBACK_SIGNATURE_HEADER,
} from "../services/dify/hmac";

const router: IRouter = Router();

// All callback bodies are raw JSON (Buffer in). We parse manually after HMAC
// verification so the verifier sees the exact bytes Dify signed.
const rawJson = express.raw({ type: "application/json", limit: "2mb" });

interface CallbackBase {
  clientRequestId: string;
  difyWorkflowId?: string;
  difyRunId?: string;
}

type Handler = (body: unknown, ctx: CallbackHandlerContext) => Promise<unknown>;

interface CallbackHandlerContext {
  clientRequestId: string;
  difyWorkflowId: string | null;
  difyRunId: string | null;
}

function makeHandler(endpoint: string, handler: Handler) {
  return async (req: Request, res: Response) => {
    const start = Date.now();
    let parsed: unknown = null;
    let clientRequestId = "";
    let difyWorkflowId: string | null = null;
    let difyRunId: string | null = null;

    if (!isDifyCallbackConfigured()) {
      res.status(503).json({
        error: "DIFY_CALLBACK_KEY not configured on api-server — Dify callbacks disabled",
      });
      return;
    }

    // Raw body verify
    const raw = req.body instanceof Buffer ? req.body : null;
    if (!raw) {
      res.status(400).json({ error: "raw body required (Content-Type: application/json)" });
      return;
    }
    const sig = req.header(DIFY_CALLBACK_SIGNATURE_HEADER);
    if (!verifyDifyCallbackSignature(raw.toString("utf8"), sig)) {
      logger.warn({ endpoint, sigPresent: !!sig }, "[dify-callback] HMAC verify failed");
      res.status(401).json({ error: "invalid or missing X-Dify-Callback-Signature" });
      return;
    }

    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(400).json({ error: "invalid JSON body" });
      return;
    }

    const base = parsed as Partial<CallbackBase> | null;
    clientRequestId = String(base?.clientRequestId ?? "").trim();
    if (!clientRequestId) {
      res.status(400).json({ error: "clientRequestId is required (used for idempotency)" });
      return;
    }
    difyWorkflowId = base?.difyWorkflowId ? String(base.difyWorkflowId) : null;
    difyRunId = base?.difyRunId ? String(base.difyRunId) : null;

    // Idempotency check
    const [existing] = await db
      .select()
      .from(difyCallbackLog)
      .where(eq(difyCallbackLog.clientRequestId, clientRequestId))
      .limit(1);
    if (existing) {
      res.json({
        ok: true,
        idempotent: true,
        cachedResponse: existing.responsePayload,
      });
      return;
    }

    try {
      const response = await handler(parsed, { clientRequestId, difyWorkflowId, difyRunId });
      const latency = Date.now() - start;
      await db.insert(difyCallbackLog).values({
        endpoint,
        clientRequestId,
        difyWorkflowId,
        difyRunId,
        status: "succeeded",
        latencyMs: latency,
        requestPayload: parsed as never,
        responsePayload: response as never,
      });
      res.json({ ok: true, ...((response as Record<string, unknown>) ?? {}) });
    } catch (err) {
      const latency = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, endpoint, clientRequestId }, "[dify-callback] handler failed");
      try {
        await db.insert(difyCallbackLog).values({
          endpoint,
          clientRequestId,
          difyWorkflowId,
          difyRunId,
          status: "failed",
          latencyMs: latency,
          error: errMsg,
          requestPayload: parsed as never,
        });
      } catch (logErr) {
        logger.error({ logErr }, "[dify-callback] failed to write callback log");
      }
      res.status(500).json({ error: errMsg });
    }
  };
}

// ── seed-board ──────────────────────────────────────────────────────────
// Body: {
//   clientRequestId, clerkUserId, clerkOrgId?, boardName,
//   cards: [{ capabilityId, lane?, notes? }], difyRunId?
// }
// Effect: creates a workbench board + cards for the new user. Replaces the
// static `runIdeation("lifecycle_outlook")` call in routes/onboarding.ts:150
// when DIFY_ONBOARDING_ENABLED=1. Each card requires a real capabilityId —
// the chatflow should resolve capability ids before calling back (the
// existing /api/onboarding/state endpoint exposes a candidate set).
router.post(
  "/dify/callback/seed-board",
  rawJson,
  makeHandler("/api/dify/callback/seed-board", async (raw) => {
    const body = raw as {
      clerkUserId?: string;
      clerkOrgId?: string;
      boardName?: string;
      description?: string;
      cards?: Array<{ capabilityId?: number; lane?: string; notes?: string }>;
    };
    if (!body.clerkUserId || !body.boardName) {
      throw new Error("clerkUserId and boardName are required");
    }
    const [board] = await db
      .insert(workbenchBoardsTable)
      .values({
        clerkUserId: body.clerkUserId,
        clerkOrgId: body.clerkOrgId ?? null,
        name: body.boardName,
        description: body.description ?? null,
      })
      .returning();
    const cardRows = (body.cards ?? [])
      .filter((c) => typeof c.capabilityId === "number")
      .map((c, idx) => ({
        boardId: board.id,
        capabilityId: c.capabilityId as number,
        lane: c.lane ?? "scan",
        position: idx,
        notes: c.notes ?? null,
        createdBy: body.clerkUserId as string,
      }));
    if (cardRows.length > 0) {
      await db.insert(workbenchCardsTable).values(cardRows);
    }
    return { boardId: board.id, cardCount: cardRows.length };
  }),
);

// ── recommend-tier ──────────────────────────────────────────────────────
// Body: { clientRequestId, userId, recommendedTier, rationale, signals, difyRunId? }
router.post(
  "/dify/callback/recommend-tier",
  rawJson,
  makeHandler("/api/dify/callback/recommend-tier", async (raw, ctx) => {
    const body = raw as {
      userId?: string;
      recommendedTier?: string;
      rationale?: string;
      signals?: Record<string, unknown>;
    };
    if (!body.userId || !body.recommendedTier) {
      throw new Error("userId and recommendedTier are required");
    }
    const [row] = await db
      .insert(tierRecommendationsTable)
      .values({
        userId: body.userId,
        recommendedTier: body.recommendedTier,
        rationale: body.rationale ?? null,
        signals: (body.signals ?? null) as never,
        difyRunId: ctx.difyRunId,
      })
      .returning();
    return { recommendationId: row.id };
  }),
);

// ── moderation-verdict ──────────────────────────────────────────────────
// Body: { clientRequestId, listingId, verdict, riskFlags, confidence, rationale, difyRunId? }
router.post(
  "/dify/callback/moderation-verdict",
  rawJson,
  makeHandler("/api/dify/callback/moderation-verdict", async (raw, ctx) => {
    const body = raw as {
      listingId?: number;
      verdict?: "auto_approve" | "send_to_moderator" | "auto_reject";
      riskFlags?: string[];
      confidence?: number;
      rationale?: string;
    };
    if (!body.listingId || !body.verdict) {
      throw new Error("listingId and verdict are required");
    }
    const moderationHints = {
      verdict: body.verdict,
      riskFlags: body.riskFlags ?? [],
      confidence: typeof body.confidence === "number" ? body.confidence : null,
      rationale: body.rationale ?? null,
      difyRunId: ctx.difyRunId,
      decidedAt: new Date().toISOString(),
    };
    await db
      .update(marketplaceListingsTable)
      .set({ moderationHints: moderationHints as never })
      .where(eq(marketplaceListingsTable.id, body.listingId));
    return { listingId: body.listingId, applied: true };
  }),
);

// ── kyc-appeal ──────────────────────────────────────────────────────────
// Body: { clientRequestId, verificationId, userId, declineReason, structuredAppeal, difyRunId? }
router.post(
  "/dify/callback/kyc-appeal",
  rawJson,
  makeHandler("/api/dify/callback/kyc-appeal", async (raw, ctx) => {
    const body = raw as {
      verificationId?: number;
      userId?: string;
      declineReason?: string;
      structuredAppeal?: Record<string, unknown>;
    };
    if (!body.verificationId || !body.userId || !body.structuredAppeal) {
      throw new Error("verificationId, userId, and structuredAppeal are required");
    }
    const [row] = await db
      .insert(kycAppealsTable)
      .values({
        verificationId: body.verificationId,
        userId: body.userId,
        declineReason: body.declineReason ?? null,
        structuredAppeal: body.structuredAppeal as never,
        difyRunId: ctx.difyRunId,
      })
      .returning();
    return { appealId: row.id };
  }),
);

// ── payment-recovery-action ─────────────────────────────────────────────
// Body: { clientRequestId, userId, subscriptionId, failureCode, chosenAction, actionDetails, difyRunId? }
router.post(
  "/dify/callback/payment-recovery-action",
  rawJson,
  makeHandler("/api/dify/callback/payment-recovery-action", async (raw, ctx) => {
    const body = raw as {
      userId?: string;
      subscriptionId?: string;
      failureCode?: string;
      chosenAction?: string;
      actionDetails?: Record<string, unknown>;
    };
    if (!body.userId || !body.chosenAction) {
      throw new Error("userId and chosenAction are required");
    }
    const [row] = await db
      .insert(paymentRecoveryLog)
      .values({
        userId: body.userId,
        subscriptionId: body.subscriptionId ?? null,
        failureCode: body.failureCode ?? null,
        chosenAction: body.chosenAction,
        actionDetails: (body.actionDetails ?? null) as never,
        difyRunId: ctx.difyRunId,
      })
      .returning();
    return { recoveryId: row.id };
  }),
);

// ── research-result ─────────────────────────────────────────────────────
// Body: { clientRequestId, capabilityId?, kind, payload, difyRunId? }
router.post(
  "/dify/callback/research-result",
  rawJson,
  makeHandler("/api/dify/callback/research-result", async (raw, ctx) => {
    const body = raw as {
      capabilityId?: number;
      kind?: string;
      payload?: unknown;
    };
    if (!body.kind || body.payload === undefined) {
      throw new Error("kind and payload are required");
    }
    const [row] = await db
      .insert(researchArtifactsTable)
      .values({
        capabilityId: body.capabilityId ?? null,
        kind: body.kind,
        payload: body.payload as never,
        difyRunId: ctx.difyRunId,
      })
      .returning();
    return { artifactId: row.id };
  }),
);

// ── agent-tool-invoke ───────────────────────────────────────────────────
// Body: { clientRequestId, tool, args, difyRunId? }
// Proxies to one of the 5 LangChain agent tools (perplexity_research,
// query_database, compute_cvi, recall_memories, store_memory). Loaded
// lazily to keep this file's import graph small.
router.post(
  "/dify/callback/agent-tool-invoke",
  rawJson,
  makeHandler("/api/dify/callback/agent-tool-invoke", async (raw) => {
    const body = raw as { tool?: string; args?: Record<string, unknown> };
    if (!body.tool) throw new Error("tool is required");
    const { invokeAgentTool } = await import("../services/dify/agent-tool-proxy");
    return await invokeAgentTool(body.tool, body.args ?? {});
  }),
);

export default router;
