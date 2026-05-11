import express, { Router, type IRouter } from "express";
import { db, kycVerificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyWebhookSignature } from "../services/didit";

const router: IRouter = Router();

// Didit webhook signs the raw request body with HMAC-SHA256, so this route
// must be mounted BEFORE the global express.json() middleware.
router.post("/kyc/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["x-signature"] as string | undefined;
  const rawBody = req.body as Buffer;

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[kyc webhook] signature verification failed");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let payload: {
    session_token?: string;
    status?: string;
    user_data?: { first_name?: string; last_name?: string; date_of_birth?: string; document_type?: string; document_number?: string; nationality?: string };
    workflow_results?: Record<string, unknown>;
  };
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const { session_token, status, user_data, workflow_results } = payload;
  if (!session_token) { res.status(400).json({ error: "session_token required" }); return; }

  try {
    const [record] = await db.select().from(kycVerificationsTable)
      .where(eq(kycVerificationsTable.idSessionToken, session_token))
      .limit(1);

    if (!record) {
      console.warn(`[kyc webhook] unknown session_token`);
      res.status(404).json({ error: "Unknown session" });
      return;
    }

    if (record.idStatus !== "Pending") {
      res.json({ received: true, already: record.idStatus });
      return;
    }

    const idStatus = status === "Approved" ? "Approved" : "Declined";

    await db.update(kycVerificationsTable).set({
      idStatus,
      firstName: user_data?.first_name ?? null,
      lastName: user_data?.last_name ?? null,
      dateOfBirth: user_data?.date_of_birth ?? null,
      documentType: user_data?.document_type ?? null,
      documentNumber: user_data?.document_number ?? null,
      nationality: user_data?.nationality ?? null,
      idWorkflowResults: workflow_results ?? null,
      updatedAt: new Date(),
    }).where(eq(kycVerificationsTable.id, record.id));

    if (idStatus === "Declined") {
      await db.update(kycVerificationsTable).set({
        status: "declined",
        declineReasons: ["ID verification declined"],
        completedAt: new Date(),
      }).where(eq(kycVerificationsTable.id, record.id));
    } else if (record.kycLevel === "identity") {
      await db.update(kycVerificationsTable).set({
        status: "approved",
        completedAt: new Date(),
      }).where(eq(kycVerificationsTable.id, record.id));
    }

    // Anchor the KYC outcome on Hedera (compliance audit trail). Only
    // non-sensitive metadata is published; identity fields (name, document
    // number, etc.) are hashed and the hash anchors the proof-of-event.
    try {
      const { anchorEvent, canonicalHash } = await import("../services/blockchain-audit");
      const sensitivePayload = {
        userId: record.userId,
        kycLevel: record.kycLevel,
        idStatus,
        documentNumberPresent: !!user_data?.document_number,
        nationality: user_data?.nationality ?? null,
      };
      void anchorEvent("kyc_verification", {
        contextHash: canonicalHash(sensitivePayload),
        contextSnapshot: {
          // Publish only the outcome + level — no PII. Anyone with read
          // access to the topic can verify "user X passed identity on
          // 2026-05-11" without learning their document number.
          kycLevel: record.kycLevel,
          outcome: idStatus === "Declined" ? "declined" : (record.kycLevel === "identity" ? "approved" : "in_progress"),
          userIdHash: canonicalHash({ userId: record.userId }),
        },
        relatedEntity: `kyc_verifications:${record.id}`,
      });
    } catch (err) {
      console.error("[kyc webhook] anchor failed (non-fatal):", err);
    }

    console.log(`[kyc webhook] user ${record.userId} ID verification: ${idStatus}`);
    res.json({ received: true, idStatus });
  } catch (err) {
    console.error("[kyc webhook] error:", err);
    res.status(500).json({ error: "handler_error" });
  }
});

export default router;
