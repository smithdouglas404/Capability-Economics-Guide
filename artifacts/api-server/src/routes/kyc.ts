import { Router } from "express";
import { db } from "@workspace/db";
import { kycVerificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  createVerificationSession,
  getSessionResult,
  isDiditConfigured,
  getWorkflowId,
} from "../services/didit";

const router = Router();

// Check KYC status for current user
router.get("/kyc/status", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const [latest] = await db.select().from(kycVerificationsTable)
      .where(eq(kycVerificationsTable.userId, userId))
      .orderBy(desc(kycVerificationsTable.createdAt))
      .limit(1);

    if (!latest) {
      res.json({ verified: false, status: null, configured: isDiditConfigured() });
      return;
    }

    res.json({
      verified: latest.status === "approved",
      status: latest.status,
      firstName: latest.firstName,
      lastName: latest.lastName,
      amlStatus: latest.amlStatus,
      completedAt: latest.completedAt,
      verificationUrl: latest.status === "pending" ? latest.verificationUrl : null,
      configured: isDiditConfigured(),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Start KYC verification — creates a Didit session and returns the verification URL
router.post("/kyc/start", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    if (!isDiditConfigured()) {
      res.status(503).json({ error: "KYC service not configured. DIDIT_API_KEY and DIDIT_WORKFLOW_ID required." });
      return;
    }

    // Check if user already has an approved verification
    const [existing] = await db.select().from(kycVerificationsTable)
      .where(and(eq(kycVerificationsTable.userId, userId), eq(kycVerificationsTable.status, "approved")))
      .limit(1);

    if (existing) {
      res.json({
        alreadyVerified: true,
        status: "approved",
        firstName: existing.firstName,
        lastName: existing.lastName,
      });
      return;
    }

    // Check for pending session — reuse if exists
    const [pending] = await db.select().from(kycVerificationsTable)
      .where(and(eq(kycVerificationsTable.userId, userId), eq(kycVerificationsTable.status, "pending")))
      .orderBy(desc(kycVerificationsTable.createdAt))
      .limit(1);

    if (pending?.verificationUrl) {
      res.json({
        verificationUrl: pending.verificationUrl,
        sessionToken: pending.sessionToken,
        status: "pending",
      });
      return;
    }

    // Create new Didit session
    const userEmail = typeof req.query.email === "string" ? req.query.email : undefined;
    const session = await createVerificationSession();

    const [record] = await db.insert(kycVerificationsTable).values({
      userId,
      userEmail,
      sessionToken: session.session_token,
      requestId: session.request_id,
      verificationUrl: session.verification_url,
      workflowId: getWorkflowId(),
      status: "pending",
    }).returning();

    res.json({
      verificationUrl: session.verification_url,
      sessionToken: session.session_token,
      status: "pending",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Poll for verification result (fallback if webhook doesn't fire)
router.post("/kyc/check", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    if (!isDiditConfigured()) {
      res.status(503).json({ error: "KYC service not configured" });
      return;
    }

    const [record] = await db.select().from(kycVerificationsTable)
      .where(and(eq(kycVerificationsTable.userId, userId), eq(kycVerificationsTable.status, "pending")))
      .orderBy(desc(kycVerificationsTable.createdAt))
      .limit(1);

    if (!record?.sessionToken) {
      res.json({ status: "no_pending_session" });
      return;
    }

    const result = await getSessionResult(record.sessionToken);

    if (result.status === "Pending") {
      res.json({ status: "pending" });
      return;
    }

    const status = result.status === "Approved" ? "approved" : "declined";
    const userData = result.user_data;

    await db.update(kycVerificationsTable).set({
      status,
      firstName: userData?.first_name ?? null,
      lastName: userData?.last_name ?? null,
      dateOfBirth: userData?.date_of_birth ?? null,
      documentType: userData?.document_type ?? null,
      nationality: userData?.nationality ?? null,
      workflowResults: result.workflow_results ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(kycVerificationsTable.id, record.id));

    res.json({
      status,
      firstName: userData?.first_name,
      lastName: userData?.last_name,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Didit webhook — receives async verification results
router.post("/kyc/webhook", async (req, res) => {
  try {
    const { session_token, status, workflow_results, user_data } = req.body as {
      session_token?: string;
      status?: string;
      workflow_results?: Record<string, unknown>;
      user_data?: { first_name?: string; last_name?: string; date_of_birth?: string; document_type?: string; nationality?: string };
    };

    if (!session_token) {
      res.status(400).json({ error: "session_token required" });
      return;
    }

    const [record] = await db.select().from(kycVerificationsTable)
      .where(eq(kycVerificationsTable.sessionToken, session_token))
      .limit(1);

    if (!record) {
      console.warn(`[kyc webhook] unknown session_token: ${session_token}`);
      res.status(404).json({ error: "Unknown session" });
      return;
    }

    // Only update pending records (idempotent)
    if (record.status !== "pending") {
      res.json({ received: true, already: record.status });
      return;
    }

    const kycStatus = status === "Approved" ? "approved" : "declined";

    await db.update(kycVerificationsTable).set({
      status: kycStatus,
      firstName: user_data?.first_name ?? null,
      lastName: user_data?.last_name ?? null,
      dateOfBirth: user_data?.date_of_birth ?? null,
      documentType: user_data?.document_type ?? null,
      nationality: user_data?.nationality ?? null,
      workflowResults: workflow_results ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(kycVerificationsTable.id, record.id));

    console.log(`[kyc webhook] user ${record.userId} verification ${kycStatus}`);
    res.json({ received: true, status: kycStatus });
  } catch (err) {
    console.error("[kyc webhook] error:", err);
    res.status(500).json({ error: "handler_error" });
  }
});

// Admin: list all verifications
router.get("/kyc/all", async (req, res) => {
  try {
    const rows = await db.select().from(kycVerificationsTable)
      .orderBy(desc(kycVerificationsTable.createdAt))
      .limit(100);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
