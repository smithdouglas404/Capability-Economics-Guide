const DIDIT_BASE_URL = "https://verification.didit.me";

function getApiKey(): string {
  const key = process.env.DIDIT_API_KEY;
  if (!key) throw new Error("DIDIT_API_KEY not set");
  return key;
}

export function isDiditConfigured(): boolean {
  return !!process.env.DIDIT_API_KEY;
}

function headers(contentType = "application/json"): Record<string, string> {
  return { "x-api-key": getApiKey(), "Content-Type": contentType };
}

// ── Email OTP ──

export async function sendEmailOtp(email: string): Promise<{ request_id: string }> {
  const resp = await fetch(`${DIDIT_BASE_URL}/v3/email/send/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Didit email OTP send failed: HTTP ${resp.status}`);
  return resp.json() as Promise<{ request_id: string }>;
}

export async function verifyEmailOtp(email: string, code: string): Promise<{ status: string }> {
  const resp = await fetch(`${DIDIT_BASE_URL}/v3/email/check/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email, code }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Didit email OTP verify failed: HTTP ${resp.status}`);
  return resp.json() as Promise<{ status: string }>;
}

// ── ID Document Verification (via session flow) ──

export interface DiditSessionResponse {
  request_id: string;
  verification_url: string;
  session_token: string;
}

export async function createIdVerificationSession(workflowId: string): Promise<DiditSessionResponse> {
  const resp = await fetch(`${DIDIT_BASE_URL}/v3/session/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ workflow_id: workflowId, save_api_request: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Didit session creation failed: HTTP ${resp.status} — ${body}`);
  }
  return resp.json() as Promise<DiditSessionResponse>;
}

export interface DiditSessionResult {
  request_id: string;
  session_token: string;
  status: "Approved" | "Declined" | "Pending";
  user_data?: {
    first_name?: string;
    last_name?: string;
    date_of_birth?: string;
    document_type?: string;
    document_number?: string;
    nationality?: string;
  };
  workflow_results?: Record<string, unknown>;
}

export async function getSessionResult(sessionToken: string): Promise<DiditSessionResult> {
  const resp = await fetch(`${DIDIT_BASE_URL}/v3/session/${sessionToken}`, {
    method: "GET",
    headers: { "x-api-key": getApiKey() },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Didit session retrieval failed: HTTP ${resp.status}`);
  return resp.json() as Promise<DiditSessionResult>;
}

// ── Passive Liveness ──

export interface DiditLivenessResult {
  request_id: string;
  passive_liveness: {
    status: "Approved" | "Declined";
    score: number;
    method: string;
  };
}

export async function checkPassiveLiveness(imageBuffer: Buffer, filename: string): Promise<DiditLivenessResult> {
  const formData = new FormData();
  formData.append("user_image", new Blob([imageBuffer]), filename);

  const resp = await fetch(`${DIDIT_BASE_URL}/v3/passive-liveness/`, {
    method: "POST",
    headers: { "x-api-key": getApiKey() },
    body: formData,
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new Error(`Didit liveness check failed: HTTP ${resp.status}`);
  return resp.json() as Promise<DiditLivenessResult>;
}

// ── AML Screening ──

export interface DiditAmlResult {
  request_id: string;
  aml: {
    status: "Clear" | "Hit";
    total_hits: number;
    hits: Array<{ type: string; name: string; match_score: number }>;
    score: number;
    entity_type: string;
  };
}

export async function screenAml(params: {
  fullName: string;
  dateOfBirth?: string;
  nationality?: string;
  documentNumber?: string;
}): Promise<DiditAmlResult> {
  const resp = await fetch(`${DIDIT_BASE_URL}/v3/aml/`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      full_name: params.fullName,
      entity_type: "person",
      date_of_birth: params.dateOfBirth,
      nationality: params.nationality,
      document_number: params.documentNumber,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Didit AML screening failed: HTTP ${resp.status}`);
  return resp.json() as Promise<DiditAmlResult>;
}
