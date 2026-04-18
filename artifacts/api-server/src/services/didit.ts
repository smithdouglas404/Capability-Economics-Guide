const DIDIT_BASE_URL = "https://verification.didit.me";

function getApiKey(): string {
  const key = process.env.DIDIT_API_KEY;
  if (!key) throw new Error("DIDIT_API_KEY not set");
  return key;
}

export function isDiditConfigured(): boolean {
  return !!process.env.DIDIT_API_KEY;
}

export function getWorkflowId(): string {
  const id = process.env.DIDIT_WORKFLOW_ID;
  if (!id) throw new Error("DIDIT_WORKFLOW_ID not set");
  return id;
}

export interface DiditSessionResponse {
  request_id: string;
  verification_url: string;
  session_token: string;
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
    nationality?: string;
  };
  workflow_results?: Record<string, unknown>;
}

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

/**
 * Create a new Didit verification session.
 * Returns a verification URL to redirect the user to.
 */
export async function createVerificationSession(): Promise<DiditSessionResponse> {
  const resp = await fetch(`${DIDIT_BASE_URL}/v3/session/`, {
    method: "POST",
    headers: {
      "x-api-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workflow_id: getWorkflowId(),
      save_api_request: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Didit session creation failed: HTTP ${resp.status} — ${body}`);
  }

  return resp.json() as Promise<DiditSessionResponse>;
}

/**
 * Retrieve the results of a verification session.
 */
export async function getSessionResult(sessionToken: string): Promise<DiditSessionResult> {
  const resp = await fetch(`${DIDIT_BASE_URL}/v3/session/${sessionToken}`, {
    method: "GET",
    headers: { "x-api-key": getApiKey() },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Didit session retrieval failed: HTTP ${resp.status} — ${body}`);
  }

  return resp.json() as Promise<DiditSessionResult>;
}

/**
 * Run AML screening against a verified user.
 */
export async function screenAml(params: {
  fullName: string;
  dateOfBirth?: string;
  nationality?: string;
}): Promise<DiditAmlResult> {
  const resp = await fetch(`${DIDIT_BASE_URL}/v3/aml/`, {
    method: "POST",
    headers: {
      "x-api-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      full_name: params.fullName,
      entity_type: "person",
      date_of_birth: params.dateOfBirth,
      nationality: params.nationality,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Didit AML screening failed: HTTP ${resp.status} — ${body}`);
  }

  return resp.json() as Promise<DiditAmlResult>;
}
