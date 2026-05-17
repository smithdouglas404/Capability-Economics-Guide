import { Router } from "express";
import { db } from "@workspace/db";
import { kycVerificationsTable, KYC_LEVELS_BY_TIER } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { runKycFailureCounselor } from "../services/dify/workflows";
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

    const all = await db.select().from(kycVerificationsTable)
      .where(eq(kycVerificationsTable.userId, userId))
      .orderBy(desc(kycVerificationsTable.createdAt));

    const latest = all[0] ?? null;

    // Compute highest approved KYC level across ALL records, so a newer
    // pending or declined attempt does not dead-end a user who has already
    // satisfied a sufficient level via an older approved verification.
    const levelRank: Record<string, number> = { email: 0, identity: 1, biometric: 2, full: 3 };
    let highestApprovedLevel: string | null = null;
    let highestRank = -1;
    for (const v of all) {
      if (v.status !== "approved") continue;
      const r = levelRank[v.kycLevel] ?? -1;
      if (r > highestRank) { highestRank = r; highestApprovedLevel = v.kycLevel; }
    }

    if (!latest) {
      res.json({
        verified: false,
        status: null,
        kycLevel: null,
        steps: null,
        highestApprovedLevel: null,
        configured: isDiditConfigured(),
        levels: KYC_LEVELS_BY_TIER,
      });
      return;
    }

    res.json({
      verified: highestApprovedLevel !== null,
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
      // Highest approved level across all attempts — preflight should use this,
      // not `kycLevel`/`status` (which only reflect the most recent attempt).
      highestApprovedLevel,
      configured: isDiditConfigured(),
      levels: KYC_LEVELS_BY_TIER,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── KYC Failure Counselor (Dify-backed) ──
//
// The frontend shows a "Talk to the counselor" CTA on any declined-KYC screen.
// This route proxies to the kyc-failure-counselor Dify chatflow. The
// counselor captures a structured appeal — it does NOT override the decline.
// Disabled by default; flip DIFY_KYC_FAILURE_COUNSELOR_ENABLED=1 to turn on.
router.post("/kyc/:verificationId/counselor", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  const verificationId = req.params.verificationId;
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) { res.status(400).json({ error: "query required" }); return; }

  const [verification] = await db
    .select()
    .from(kycVerificationsTable)
    .where(and(eq(kycVerificationsTable.id, Number(verificationId)), eq(kycVerificationsTable.userId, userId)))
    .limit(1);
  if (!verification) { res.status(404).json({ error: "Verification not found" }); return; }
  if (verification.status !== "declined") {
    res.status(409).json({ error: `Counselor only available for declined verifications (current: ${verification.status})` });
    return;
  }

  const declineReason = (verification.declineReasons ?? [])[0] ?? "unspecified";
  const result = await runKycFailureCounselor({
    verificationId: String(verification.id),
    declineReason,
    kycLevel: verification.kycLevel ?? undefined,
    query,
    conversationId: typeof req.body?.conversationId === "string" ? req.body.conversationId : undefined,
  });
  if (!result) { res.status(503).json({ error: "KYC counselor unavailable" }); return; }
  res.json(result);
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

// NOTE: The Didit webhook (/kyc/webhook) lives in routes/kyc-webhook.ts so that it can
// read the raw request body for HMAC-SHA256 signature verification. It is mounted in
// app.ts BEFORE the global express.json() middleware.

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
