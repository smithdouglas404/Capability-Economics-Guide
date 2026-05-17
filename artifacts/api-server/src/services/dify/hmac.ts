import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 helpers for the Dify→inflexcvi callback gateway.
 *
 * Mirrors the agent-tool callback pattern (`INFLEXCVI_AGENT_TOOL_KEY`) but
 * gated on a separate secret (`DIFY_CALLBACK_KEY`) so revoking one channel
 * doesn't take the other down. Dify Workflow HTTP Request nodes sign every
 * request by computing `HMAC-SHA256(raw-body, DIFY_CALLBACK_KEY)` and
 * sending the hex digest in `X-Dify-Callback-Signature`.
 *
 * Generate the secret once: `openssl rand -hex 32`. Set the same value as
 * an env var on the inflexcvi api-server AND as a workflow-scoped variable
 * inside Dify so Workflow nodes can read it via `{{secrets.DIFY_CALLBACK_KEY}}`.
 */

const DIFY_CALLBACK_SIGNATURE_HEADER = "x-dify-callback-signature";

function getCallbackKey(): string | null {
  const k = process.env.DIFY_CALLBACK_KEY;
  return k && k.length > 0 ? k : null;
}

export function isDifyCallbackConfigured(): boolean {
  return getCallbackKey() !== null;
}

export function signDifyCallbackBody(rawBody: string): string {
  const key = getCallbackKey();
  if (!key) throw new Error("DIFY_CALLBACK_KEY not configured");
  return createHmac("sha256", key).update(rawBody).digest("hex");
}

/**
 * Verify the signature header on an incoming Dify callback. Returns true
 * only when the header is present, the configured key is set, and the
 * digest matches (constant-time compare). Logs nothing — the caller logs
 * the failure with full request context.
 */
export function verifyDifyCallbackSignature(
  rawBody: string,
  headerValue: string | undefined,
): boolean {
  const key = getCallbackKey();
  if (!key || !headerValue) return false;
  const expected = createHmac("sha256", key).update(rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(headerValue.trim(), "hex");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}

export { DIFY_CALLBACK_SIGNATURE_HEADER };
