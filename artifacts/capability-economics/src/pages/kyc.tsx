import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, ShieldCheck, AlertTriangle, ExternalLink, Loader2, Mail, IdCard, ScanFace, Search, ArrowRight } from "lucide-react";

import { MobileNotice } from "@/components/mobile";
type Step = "email" | "identity" | "liveness" | "aml" | "done" | "declined";

type KycStatus = {
  verified: boolean;
  status: string | null;
  kycLevel: string | null;
  highestApprovedLevel: string | null;
  tierSlug?: string;
  steps: {
    email: string | null;
    identity: string | null;
    liveness: string | null;
    aml: string | null;
  } | null;
  firstName?: string | null;
  lastName?: string | null;
  completedAt?: string | null;
  idVerificationUrl?: string | null;
  configured: boolean;
  levels: Record<string, string>;
};

// Mirrors KYC_LEVELS_BY_TIER in lib/db/src/schema/kyc.ts — used as fallback when
// the user isn't signed in yet so we can still show the right step list.
const FALLBACK_LEVELS: Record<string, string> = {
  discovery: "email",
  briefing: "identity",
  console: "biometric",
  ledger: "biometric", // legacy alias
  workbench: "biometric", // legacy alias
  platform: "full",
};

const STEP_LABELS: Record<Step, string> = {
  email: "Email verification",
  identity: "ID document",
  liveness: "Selfie liveness",
  aml: "Sanctions / PEP screening",
  done: "Verified",
  declined: "Declined",
};

const STEP_ICONS: Record<Exclude<Step, "done" | "declined">, typeof Mail> = {
  email: Mail,
  identity: IdCard,
  liveness: ScanFace,
  aml: Search,
};

function StepRow({ step, state, current }: { step: Exclude<Step, "done" | "declined">; state: "pending" | "active" | "done" | "failed" | "skipped"; current: boolean }) {
  const Icon = STEP_ICONS[step];
  const color =
    state === "done" ? "text-green-600" :
    state === "failed" ? "text-red-600" :
    state === "active" ? "text-primary" :
    state === "skipped" ? "text-muted-foreground/40" :
    "text-muted-foreground";
  return (
    <div className={`flex items-center gap-3 py-2 ${current ? "" : "opacity-80"}`}>
      <div className={`shrink-0 ${color}`}>
        {state === "done" ? <CheckCircle2 className="w-5 h-5" /> :
         state === "failed" ? <AlertTriangle className="w-5 h-5" /> :
         state === "active" ? <Loader2 className="w-5 h-5 animate-spin" /> :
         <Circle className="w-5 h-5" />}
      </div>
      <Icon className={`w-4 h-4 ${color}`} />
      <div className="flex-1 text-sm">{STEP_LABELS[step]}</div>
      {state === "skipped" && <span className="text-xs text-muted-foreground">not required</span>}
    </div>
  );
}

function tierRequiredSteps(level: string): Exclude<Step, "done" | "declined">[] {
  if (level === "email") return ["email"];
  if (level === "identity") return ["email", "identity"];
  if (level === "biometric") return ["email", "identity", "liveness"];
  if (level === "full") return ["email", "identity", "liveness", "aml"];
  return ["email"];
}

export default function KycPage() {
  const [location, setLocation] = useLocation();
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const tierSlug = params.get("tierSlug") ?? "discovery";
  const returnTo = params.get("returnTo") ?? "/membership";

  const [status, setStatus] = useState<KycStatus | null>(null);
  const [verificationId, setVerificationId] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [identityUrl, setIdentityUrl] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("email");
  const pollRef = useRef<number | null>(null);

  const requiredLevel = status?.levels?.[tierSlug] ?? FALLBACK_LEVELS[tierSlug] ?? "email";
  const requiredSteps = useMemo(() => tierRequiredSteps(requiredLevel), [requiredLevel]);

  // ── Initial status fetch ──
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/kyc/status");
        if (r.status === 401) { setErr("Please sign in to verify your identity."); return; }
        const data: KycStatus = await r.json();
        setStatus(data);
        // "Done" only if the user's highest approved KYC level meets THIS tier's
        // required level — not just "any approved KYC". Otherwise a user with
        // email-only approval visiting /kyc?tierSlug=workbench would land on
        // "done" while the server-side gate still blocks checkout (dead-end loop).
        const rank: Record<string, number> = { email: 0, identity: 1, biometric: 2, full: 3 };
        const tierRequiredLevel = data.levels?.[tierSlug] ?? FALLBACK_LEVELS[tierSlug] ?? "email";
        const requiredRank = rank[tierRequiredLevel] ?? 0;
        const userRank = data.highestApprovedLevel ? (rank[data.highestApprovedLevel] ?? -1) : -1;
        if (userRank >= requiredRank) {
          setStep("done");
        } else if (data.status === "declined" && data.tierSlug === tierSlug) {
          // Only show declined state if the most recent attempt was for THIS tier
          setStep("declined");
        }
      } catch (e) {
        setErr(`Could not load verification status: ${(e as Error).message}`);
      }
    })();
  }, [tierSlug]);

  async function startVerification(): Promise<number | null> {
    // Wait for status fetch — `status === null` means we haven't loaded yet.
    // Only treat `configured: false` (loaded but disabled) as an error.
    if (status === null) { setErr("Loading verification status…"); return null; }
    if (!status.configured) { setErr("Identity verification service is not configured. Contact support."); return null; }
    setBusy(true); setErr(null); setInfo(null);
    try {
      const r = await fetch("/api/kyc/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierSlug, email: email || undefined }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || "Failed to start verification"); return null; }
      if (data.alreadyVerified) {
        setStep("done");
        return null;
      }
      setVerificationId(data.verificationId);
      // If pending and ID URL exists, jump to identity step
      if (data.idVerificationUrl) {
        setIdentityUrl(data.idVerificationUrl);
        setStep("identity");
      } else {
        setStep("email");
      }
      return data.verificationId ?? null;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally { setBusy(false); }
  }

  async function sendOtp() {
    if (!email) { setErr("Email is required"); return; }
    let id = verificationId;
    if (!id) {
      id = await startVerification();
      if (!id) return; // startVerification already surfaced its own error
    }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/kyc/${id}/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || "Failed to send code"); return; }
      setInfo(`Verification code sent to ${email}. Check your inbox.`);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function verifyOtp() {
    if (!verificationId) { setErr("No active verification"); return; }
    if (!otp) { setErr("Enter the 6-digit code"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/kyc/${verificationId}/email/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otp }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || "Code verification failed"); return; }
      if (!data.verified) { setErr(data.message || "Invalid code"); return; }
      // Success — advance
      if (data.status === "approved") { setStep("done"); return; }
      setStep("identity");
      await startIdentity();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function startIdentity() {
    if (!verificationId) { setErr("No active verification"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/kyc/${verificationId}/identity/start`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || "Could not start ID verification"); return; }
      setIdentityUrl(data.verificationUrl);
      setInfo("Open the verification link in a new tab. We'll wait for the result.");
      startPolling();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  function startPolling() {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      if (!verificationId) return;
      try {
        const r = await fetch(`/api/kyc/${verificationId}/identity/check`, { method: "POST" });
        const data = await r.json();
        if (!r.ok) return;
        if (data.status === "Pending") return;
        if (data.status === "declined") {
          setStep("declined"); stopPolling(); return;
        }
        if (data.status === "approved") {
          setStep("done"); stopPolling(); return;
        }
        if (data.nextStep === "liveness") {
          // Liveness embedded in Didit workflow — call /liveness which reads workflow_results
          const lv = await fetch(`/api/kyc/${verificationId}/liveness`, { method: "POST" });
          const ld = await lv.json();
          if (!lv.ok) { setErr(ld.error || "Liveness check failed"); stopPolling(); return; }
          if (ld.status === "declined") { setStep("declined"); stopPolling(); return; }
          if (ld.status === "approved") { setStep("done"); stopPolling(); return; }
          if (ld.nextStep === "aml") {
            setStep("aml");
            const am = await fetch(`/api/kyc/${verificationId}/aml`, { method: "POST" });
            const ad = await am.json();
            if (!am.ok) { setErr(ad.error || "AML screening failed"); stopPolling(); return; }
            if (ad.status === "approved") setStep("done");
            else setStep("declined");
            stopPolling();
          }
        }
      } catch {/* keep polling */}
    }, 4000);
  }

  function stopPolling() {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => () => stopPolling(), []);

  // Auto-start identity polling if we already have an ID URL on load
  useEffect(() => {
    if (step === "identity" && identityUrl && verificationId) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, identityUrl, verificationId]);

  function stepState(s: Exclude<Step, "done" | "declined">): "pending" | "active" | "done" | "failed" | "skipped" {
    if (!requiredSteps.includes(s)) return "skipped";
    const order: Exclude<Step, "done" | "declined">[] = ["email", "identity", "liveness", "aml"];
    const idx = order.indexOf(s);
    const curIdx = order.indexOf(step as Exclude<Step, "done" | "declined">);
    if (step === "done") return "done";
    if (step === "declined" && s === "identity" && status?.steps?.identity === "Declined") return "failed";
    if (s === step) return "active";
    if (idx < curIdx) return "done";
    return "pending";
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <MobileNotice />
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <ShieldCheck className="w-4 h-4" />
          Identity verification for <Badge variant="outline" className="capitalize">{tierSlug}</Badge>
        </div>
        <h1 className="text-3xl font-serif tracking-tight mb-2">Verify your identity</h1>
        <p className="text-muted-foreground">
          To activate the {tierSlug} tier we run identity checks via Didit. Your data is encrypted in transit and only stored to satisfy KYC/AML obligations.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Verification steps for this tier</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(["email", "identity", "liveness", "aml"] as const).map((s) => (
            <StepRow key={s} step={s} state={stepState(s)} current={s === step} />
          ))}
        </CardContent>
      </Card>

      {step === "done" && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="p-6 flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Identity verified</h3>
              <p className="text-sm text-muted-foreground mb-4">You're cleared to activate the {tierSlug} tier.</p>
              <Button onClick={() => setLocation(returnTo)} data-testid="button-kyc-continue">
                Continue to checkout <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "declined" && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Verification declined</h3>
              <p className="text-sm text-muted-foreground mb-3">
                We couldn't verify your identity. Contact <a className="underline" href="mailto:support@capabilityeconomics.com">support@capabilityeconomics.com</a> if you think this is in error.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {step !== "done" && step !== "declined" && (
        <Card>
          <CardContent className="p-6 space-y-4">
            {step === "email" && (
              <>
                <h3 className="font-semibold">Step 1 — Email verification</h3>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Your email</label>
                  <Input
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    data-testid="input-kyc-email"
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={sendOtp} disabled={busy || !email} data-testid="button-kyc-send-otp">
                    {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Mail className="w-4 h-4 mr-1" />}
                    Send code
                  </Button>
                </div>
                {info && (
                  <div className="space-y-2 pt-2 border-t">
                    <label className="text-xs text-muted-foreground">6-digit code from your email</label>
                    <Input
                      placeholder="123456"
                      inputMode="numeric"
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                      data-testid="input-kyc-otp"
                    />
                    <Button onClick={verifyOtp} disabled={busy || otp.length !== 6} data-testid="button-kyc-verify-otp">
                      {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                      Verify code
                    </Button>
                  </div>
                )}
              </>
            )}

            {step === "identity" && (
              <>
                <h3 className="font-semibold">Step 2 — ID document</h3>
                <p className="text-sm text-muted-foreground">
                  Open the secure Didit verification flow to upload your government-issued ID. We'll detect when you're done.
                </p>
                {identityUrl ? (
                  <div className="flex gap-2">
                    <Button asChild data-testid="button-kyc-open-didit">
                      <a href={identityUrl} target="_blank" rel="noopener noreferrer">
                        Open verification <ExternalLink className="w-4 h-4 ml-1" />
                      </a>
                    </Button>
                    <Button variant="outline" onClick={startIdentity} disabled={busy}>
                      Restart
                    </Button>
                  </div>
                ) : (
                  <Button onClick={startIdentity} disabled={busy}>
                    {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <IdCard className="w-4 h-4 mr-1" />}
                    Start ID verification
                  </Button>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Waiting for Didit to confirm — this usually takes under 2 minutes.
                </div>
              </>
            )}

            {step === "aml" && (
              <>
                <h3 className="font-semibold">Step 4 — AML / sanctions screening</h3>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Running screening against global sanctions and PEP lists…
                </div>
              </>
            )}

            {!verificationId && step === "email" && status && (
              <Button variant="ghost" size="sm" onClick={startVerification} disabled={busy} className="text-xs">
                {busy ? "Initializing…" : "Initialize verification"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {err && (
        <div className="mt-4 p-3 rounded border border-red-500/30 bg-red-500/5 text-sm text-red-700 dark:text-red-400" data-testid="text-kyc-error">
          {err}
        </div>
      )}

      {!status?.configured && status !== null && (
        <div className="mt-4 p-3 rounded border border-amber-500/30 bg-amber-500/5 text-sm text-amber-700 dark:text-amber-400">
          KYC service is not configured. Set <code>DIDIT_API_KEY</code> and <code>DIDIT_WORKFLOW_ID</code> in environment.
        </div>
      )}
    </div>
  );
}
