import { Router } from "express";
import { db } from "@workspace/db";
import { kycVerificationsTable, KYC_LEVELS_BY_TIER } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  sendEmailOtp,
  verifyEmailOtp,
  createIdVerificationSession,
  getSessionResult,
  screenAml,
  isDiditConfigured,
} from "../services/didit";

const router = Router();

// ── Check KYC status ──

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
      res.json({
        verified: false,
        status: null,
        kycLevel: null,
        steps: null,
        configured: isDiditConfigured(),
        levels: KYC_LEVELS_BY_TIER,
      });
      return;
    }

    res.json({
      verified: latest.status === "approved",
      status: latest.status,
      kycLevel: latest.kycLevel,
      tierSlug: latest.tierSlug,
      steps: {
        email: latest.emailVerified,
        identity: latest.idStatus,
        liveness: latest.livenessStatus,
        aml: latest.amlStatus,
      },
      firstName: latest.firstName,
      lastName: latest.lastName,
      completedAt: latest.completedAt,
      idVerificationUrl: latest.status === "pending" && latest.idStatus === "Pending" ? latest.idVerificationUrl : null,
      configured: isDiditConfigured(),
      levels: KYC_LEVELS_BY_TIER,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Start KYC for a tier ──

router.post("/kyc/start", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const { tierSlug, email } = req.body as { tierSlug: string; email?: string };
    if (!tierSlug || !(tierSlug in KYC_LEVELS_BY_TIER)) {
      res.status(400).json({ error: "Valid tierSlug required", validTiers: Object.keys(KYC_LEVELS_BY_TIER) });
      return;
    }

    if (!isDiditConfigured()) {
      res.status(503).json({ error: "KYC service not configured. Set DIDIT_API_KEY." });
      return;
    }

    const kycLevel = KYC_LEVELS_BY_TIER[tierSlug];

    // Check if user already has approved verification at this level or higher
    const levelRank: Record<string, number> = { email: 0, identity: 1, biometric: 2, full: 3 };
    const requiredRank = levelRank[kycLevel];

    const approved = await db.select().from(kycVerificationsTable)
      .where(and(eq(kycVerificationsTable.userId, userId), eq(kycVerificationsTable.status, "approved")))
      .orderBy(desc(kycVerificationsTable.createdAt));

    const sufficient = approved.find((v) => (levelRank[v.kycLevel] ?? -1) >= requiredRank);
    if (sufficient) {
      res.json({ alreadyVerified: true, status: "approved", kycLevel: sufficient.kycLevel });
      return;
    }

    // Check for pending verification at this level
    const [pending] = await db.select().from(kycVerificationsTable)
      .where(and(
        eq(kycVerificationsTable.userId, userId),
        eq(kycVerificationsTable.status, "pending"),
        eq(kycVerificationsTable.kycLevel, kycLevel),
      ))
      .orderBy(desc(kycVerificationsTable.createdAt))
      .limit(1);

    if (pending) {
      res.json({
        status: "pending",
        kycLevel,
        verificationId: pending.id,
        steps: {
          email: pending.emailVerified,
          identity: pending.idStatus,
          liveness: pending.livenessStatus,
          aml: pending.amlStatus,
        },
        idVerificationUrl: pending.idVerificationUrl,
      });
      return;
    }

    // Create new verification record
    const [record] = await db.insert(kycVerificationsTable).values({
      userId,
      userEmail: email,
      kycLevel,
      tierSlug,
      status: "pending",
    }).returning();

    res.json({
      status: "pending",
      kycLevel,
      verificationId: record.id,
      nextStep: "email",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Step 1: Send email OTP ──

router.post("/kyc/:id/email/send", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const id = Number(req.params.id);
    const [record] = await db.select().from(kycVerificationsTable)
      .where(and(eq(kycVerificationsTable.id, id), eq(kycVerificationsTable.userId, userId)))
      .limit(1);

    if (!record) { res.status(404).json({ error: "Verification not found" }); return; }
    if (record.status !== "pending") { res.status(400).json({ error: "Verification already completed" }); return; }

    const email = req.body.email ?? record.userEmail;
    if (!email) { res.status(400).json({ error: "Email required" }); return; }

    const result = await sendEmailOtp(email);

    await db.update(kycVerificationsTable).set({
      userEmail: email,
      emailRequestId: result.request_id,
      updatedAt: new Date(),
    }).where(eq(kycVerificationsTable.id, id));

    res.json({ sent: true, requestId: result.request_id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Step 1b: Verify email OTP ──

router.post("/kyc/:id/email/verify", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const id = Number(req.params.id);
    const { email, code } = req.body as { email: string; code: string };
    if (!email || !code) { res.status(400).json({ error: "Email and code required" }); return; }

    const [record] = await db.select().from(kycVerificationsTable)
      .where(and(eq(kycVerificationsTable.id, id), eq(kycVerificationsTable.userId, userId)))
      .limit(1);

    if (!record) { res.status(404).json({ error: "Verification not found" }); return; }

    const result = await verifyEmailOtp(email, code);
    const verified = result.status === "Verified";

    await db.update(kycVerificationsTable).set({
      emailVerified: verified ? "verified" : "failed",
      updatedAt: new Date(),
    }).where(eq(kycVerificationsTable.id, id));

    if (!verified) {
      res.json({ verified: false, message: "Invalid code. Try again." });
      return;
    }

    // If email-only level (discovery), approve immediately
    if (record.kycLevel === "email") {
      await db.update(kycVerificationsTable).set({
        status: "approved",
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(kycVerificationsTable.id, id));

      res.json({ verified: true, status: "approved", nextStep: null });
      return;
    }

    res.json({ verified: true, nextStep: "identity" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Step 2: Start ID verification session ──

router.post("/kyc/:id/identity/start", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const id = Number(req.params.id);
    const [record] = await db.select().from(kycVerificationsTable)
      .where(and(eq(kycVerificationsTable.id, id), eq(kycVerificationsTable.userId, userId)))
      .limit(1);

    if (!record) { res.status(404).json({ error: "Verification not found" }); return; }
    if (record.emailVerified !== "verified") { res.status(400).json({ error: "Complete email verification first" }); return; }
    if (!["identity", "biometric", "full"].includes(record.kycLevel)) {
      res.status(400).json({ error: "ID verification not required for this KYC level" });
      return;
    }

    // Reuse existing session if pending
    if (record.idSessionToken && record.idStatus === "Pending") {
      res.json({ verificationUrl: record.idVerificationUrl, sessionToken: record.idSessionToken });
      return;
    }

    const workflowId = process.env.DIDIT_WORKFLOW_ID;
    if (!workflowId) { res.status(503).json({ error: "DIDIT_WORKFLOW_ID not set" }); return; }

    const session = await createIdVerificationSession(workflowId);

    await db.update(kycVerificationsTable).set({
      idSessionToken: session.session_token,
      idRequestId: session.request_id,
      idVerificationUrl: session.verification_url,
      idStatus: "Pending",
      updatedAt: new Date(),
    }).where(eq(kycVerificationsTable.id, id));

    res.json({
      verificationUrl: session.verification_url,
      sessionToken: session.session_token,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Step 2b: Check ID verification result (poll) ──

router.post("/kyc/:id/identity/check", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const id = Number(req.params.id);
    const [record] = await db.select().from(kycVerificationsTable)
      .where(and(eq(kycVerificationsTable.id, id), eq(kycVerificationsTable.userId, userId)))
      .limit(1);

    if (!record?.idSessionToken) { res.status(400).json({ error: "No ID verification session" }); return; }

    const result = await getSessionResult(record.idSessionToken);

    if (result.status === "Pending") {
      res.json({ status: "Pending" });
      return;
    }

    const userData = result.user_data;
    await db.update(kycVerificationsTable).set({
      idStatus: result.status,
      firstName: userData?.first_name ?? null,
      lastName: userData?.last_name ?? null,
      dateOfBirth: userData?.date_of_birth ?? null,
      documentType: userData?.document_type ?? null,
      documentNumber: userData?.document_number ?? null,
      nationality: userData?.nationality ?? null,
      idWorkflowResults: result.workflow_results ?? null,
      updatedAt: new Date(),
    }).where(eq(kycVerificationsTable.id, id));

    if (result.status === "Declined") {
      await db.update(kycVerificationsTable).set({
        status: "declined",
        declineReasons: ["ID verification declined by Didit"],
        completedAt: new Date(),
      }).where(eq(kycVerificationsTable.id, id));

      res.json({ status: "declined" });
      return;
    }

    // ID approved — determine next step
    if (record.kycLevel === "identity") {
      await db.update(kycVerificationsTable).set({
        status: "approved",
        completedAt: new Date(),
      }).where(eq(kycVerificationsTable.id, id));
      res.json({ status: "approved", nextStep: null });
    } else {
      res.json({ status: "Approved", nextStep: "liveness" });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Step 3: Liveness check (image uploaded from frontend) ──

router.post("/kyc/:id/liveness", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const id = Number(req.params.id);
    const [record] = await db.select().from(kycVerificationsTable)
      .where(and(eq(kycVerificationsTable.id, id), eq(kycVerificationsTable.userId, userId)))
      .limit(1);

    if (!record) { res.status(404).json({ error: "Verification not found" }); return; }
    if (record.idStatus !== "Approved") { res.status(400).json({ error: "Complete ID verification first" }); return; }
    if (!["biometric", "full"].includes(record.kycLevel)) {
      res.status(400).json({ error: "Liveness check not required for this KYC level" });
      return;
    }

    // Liveness is done through the Didit session flow (the session workflow includes liveness)
    // If the session workflow includes liveness, the result is already in workflow_results
    // For standalone liveness, the frontend would need to capture and upload a selfie image

    // Check if liveness was already captured in the ID session workflow
    const wfResults = record.idWorkflowResults as Record<string, any> | null;
    if (wfResults?.passive_liveness) {
      const liveness = wfResults.passive_liveness;
      const livenessApproved = liveness.status === "Approved";

      await db.update(kycVerificationsTable).set({
        livenessStatus: liveness.status,
        livenessScore: liveness.score,
        updatedAt: new Date(),
      }).where(eq(kycVerificationsTable.id, id));

      if (!livenessApproved) {
        await db.update(kycVerificationsTable).set({
          status: "declined",
          declineReasons: ["Liveness check failed"],
          completedAt: new Date(),
        }).where(eq(kycVerificationsTable.id, id));
        res.json({ status: "declined", reason: "Liveness check failed" });
        return;
      }

      if (record.kycLevel === "biometric") {
        await db.update(kycVerificationsTable).set({ status: "approved", completedAt: new Date() }).where(eq(kycVerificationsTable.id, id));
        res.json({ status: "approved", nextStep: null });
      } else {
        res.json({ status: "liveness_passed", nextStep: "aml" });
      }
      return;
    }

    // If liveness wasn't part of the workflow, mark as needing standalone check
    res.status(400).json({
      error: "Liveness data not found in session workflow. Configure your Didit workflow to include passive liveness, or upload a selfie image.",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Step 4: AML screening (platform tier only) ──

router.post("/kyc/:id/aml", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const id = Number(req.params.id);
    const [record] = await db.select().from(kycVerificationsTable)
      .where(and(eq(kycVerificationsTable.id, id), eq(kycVerificationsTable.userId, userId)))
      .limit(1);

    if (!record) { res.status(404).json({ error: "Verification not found" }); return; }
    if (record.kycLevel !== "full") { res.status(400).json({ error: "AML screening only required for platform tier" }); return; }
    if (record.idStatus !== "Approved") { res.status(400).json({ error: "Complete ID verification first" }); return; }
    if (!record.firstName || !record.lastName) { res.status(400).json({ error: "Identity data required for AML" }); return; }

    const result = await screenAml({
      fullName: `${record.firstName} ${record.lastName}`,
      dateOfBirth: record.dateOfBirth ?? undefined,
      nationality: record.nationality ?? undefined,
      documentNumber: record.documentNumber ?? undefined,
    });

    await db.update(kycVerificationsTable).set({
      amlStatus: result.aml.status,
      amlScore: result.aml.score,
      amlHits: result.aml.total_hits,
      amlDetails: result.aml.hits.map((h) => ({ type: h.type, name: h.name, matchScore: h.match_score })),
      amlRequestId: result.request_id,
      updatedAt: new Date(),
    }).where(eq(kycVerificationsTable.id, id));

    if (result.aml.status === "Hit") {
      await db.update(kycVerificationsTable).set({
        status: "declined",
        declineReasons: [`AML screening returned ${result.aml.total_hits} hit(s)`],
        completedAt: new Date(),
      }).where(eq(kycVerificationsTable.id, id));

      res.json({ status: "declined", amlStatus: "Hit", hits: result.aml.total_hits });
      return;
    }

    // AML clear — all steps passed, approve
    await db.update(kycVerificationsTable).set({
      status: "approved",
      completedAt: new Date(),
    }).where(eq(kycVerificationsTable.id, id));

    res.json({ status: "approved", amlStatus: "Clear" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Didit webhook — async ID verification results ──

router.post("/kyc/webhook", async (req, res) => {
  try {
    const { session_token, status, user_data, workflow_results } = req.body as {
      session_token?: string;
      status?: string;
      user_data?: { first_name?: string; last_name?: string; date_of_birth?: string; document_type?: string; document_number?: string; nationality?: string };
      workflow_results?: Record<string, unknown>;
    };

    if (!session_token) { res.status(400).json({ error: "session_token required" }); return; }

    const [record] = await db.select().from(kycVerificationsTable)
      .where(eq(kycVerificationsTable.idSessionToken, session_token))
      .limit(1);

    if (!record) {
      console.warn(`[kyc webhook] unknown session_token: ${session_token}`);
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

    // If declined, mark the whole verification as declined
    if (idStatus === "Declined") {
      await db.update(kycVerificationsTable).set({
        status: "declined",
        declineReasons: ["ID verification declined"],
        completedAt: new Date(),
      }).where(eq(kycVerificationsTable.id, record.id));
    }
    // If identity-level only, approve
    else if (record.kycLevel === "identity") {
      await db.update(kycVerificationsTable).set({
        status: "approved",
        completedAt: new Date(),
      }).where(eq(kycVerificationsTable.id, record.id));
    }
    // Otherwise user needs to continue with liveness/AML steps

    console.log(`[kyc webhook] user ${record.userId} ID verification: ${idStatus}`);
    res.json({ received: true, idStatus });
  } catch (err) {
    console.error("[kyc webhook] error:", err);
    res.status(500).json({ error: "handler_error" });
  }
});

// ── Admin: list all verifications ──

router.get("/kyc/all", requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(kycVerificationsTable)
      .orderBy(desc(kycVerificationsTable.createdAt))
      .limit(200);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
