/**
 * Upstream service health probes.
 *
 * Each probe returns one of:
 *   - "ok"             — fully operational
 *   - "degraded"       — reachable but failing (rate-limited, partial errors)
 *   - "down"           — unreachable / auth failed / quota exhausted
 *   - "not_configured" — credentials missing; we treat this as "feature off"
 *                        rather than an outage so the banner does not nag
 *                        operators about services they intentionally skipped.
 *
 * Results are cached in-memory for `CACHE_TTL_MS`. The first call after expiry
 * returns the stale value AND kicks off a background refresh, so the request
 * is never blocked on a slow upstream. (60s cache per task spec.)
 */

import { isMem0Available, mem0Ping } from "../agent/memory";
import { lettaPing } from "../agent/letta";
import { FOUNDRY } from "../foundry/config";
import { db } from "@workspace/db";
import { organizationsTable, capabilitiesTable, cviComponentsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export type ServiceStatus = "ok" | "degraded" | "down" | "not_configured";

export interface ServiceHealth {
  service: string;
  status: ServiceStatus;
  latencyMs: number | null;
  lastError: string | null;
  checkedAt: string; // ISO
}

export interface ServicesHealthResponse {
  overall: ServiceStatus;
  services: ServiceHealth[];
  generatedAt: string;
}

const CACHE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 15_000;

interface CacheEntry {
  result: ServiceHealth;
  expiresAt: number;
  refreshing: boolean;
}

const cache = new Map<string, CacheEntry>();

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, latencyMs: Date.now() - start };
}

/**
 * Walks the `err.cause` chain so probe errors carry the actual reason.
 * Node's `fetch` flattens DNS/TCP failures into the useless top-level
 * message "fetch failed" and stashes the real cause (ENOTFOUND,
 * ECONNREFUSED, certificate errors, etc.) one level deeper. We render
 * them as `outer → inner → …` so logs show the full story without
 * needing a debugger.
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [err.message];
  let cause: unknown = (err as Error & { cause?: unknown }).cause;
  while (cause instanceof Error && parts.length < 4) {
    parts.push(cause.message);
    cause = (cause as Error & { cause?: unknown }).cause;
  }
  return parts.filter((p) => p && p.length > 0).join(" → ");
}

type Probe = () => Promise<Omit<ServiceHealth, "service" | "checkedAt">>;

// ── Latency thresholds ───────────────────────────────────────────────────
// A service that responds in 5+ seconds is technically reachable but is
// degrading the agent's 30-min cycle (and pushing user-facing requests
// past the perceptible-latency budget). Flag these as `degraded` so
// operators see "ok but slow" before "down". Tighter on Mem0 since it's
// hit per-recall; looser on Letta since it only sees end-of-cycle traffic.
const MEM0_LATENCY_WARN_MS = 2000;
const LETTA_LATENCY_WARN_MS = 5000;

// ── Per-service probes ────────────────────────────────────────────────────

const probeMem0: Probe = async () => {
  if (!isMem0Available()) {
    return { status: "not_configured", latencyMs: null, lastError: "MEM0_BASE_URL or MEM0_API_KEY not set" };
  }
  try {
    const { latencyMs } = await timed(() => withTimeout(mem0Ping(), PROBE_TIMEOUT_MS, "mem0"));
    if (latencyMs > MEM0_LATENCY_WARN_MS) {
      return {
        status: "degraded",
        latencyMs,
        lastError: `High latency: ${latencyMs}ms (threshold ${MEM0_LATENCY_WARN_MS}ms)`,
      };
    }
    return { status: "ok", latencyMs, lastError: null };
  } catch (err) {
    const msg = describeError(err);
    // Quota / 429 → degraded (still reachable, just rate-limited).
    if (/\b429\b|quota|rate.?limit/i.test(msg)) {
      return { status: "degraded", latencyMs: null, lastError: msg.slice(0, 240) };
    }
    return { status: "down", latencyMs: null, lastError: msg.slice(0, 240) };
  }
};

const probeLetta: Probe = async () => {
  const { value, latencyMs } = await timed(() => withTimeout(lettaPing(), PROBE_TIMEOUT_MS, "letta"));
  if (!value.configured) {
    return { status: "not_configured", latencyMs: null, lastError: "LETTA_API_KEY and LETTA_BASE_URL not set" };
  }
  if (value.ok) {
    if (latencyMs > LETTA_LATENCY_WARN_MS) {
      return {
        status: "degraded",
        latencyMs,
        lastError: `High latency: ${latencyMs}ms (threshold ${LETTA_LATENCY_WARN_MS}ms)`,
      };
    }
    return { status: "ok", latencyMs, lastError: null };
  }
  const err = value.error ?? "unknown";
  // Auth failures (401/403) → down; transient 5xx / network → degraded.
  if (/\b401\b|\b403\b|unauthor/i.test(err)) {
    return { status: "down", latencyMs, lastError: err.slice(0, 240) };
  }
  return { status: "degraded", latencyMs, lastError: err.slice(0, 240) };
};

const probeOpenRouter: Probe = async () => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { status: "not_configured", latencyMs: null, lastError: "OPENROUTER_API_KEY not set" };
  try {
    const { value, latencyMs } = await timed(() =>
      withTimeout(
        fetch("https://openrouter.ai/api/v1/auth/key", {
          headers: { Authorization: `Bearer ${key}` },
        }),
        PROBE_TIMEOUT_MS,
        "openrouter",
      ),
    );
    if (value.ok) {
      const body = (await value.json().catch(() => ({}))) as {
        data?: { limit_remaining?: number | null; usage?: number };
      };
      const remaining = body?.data?.limit_remaining;
      if (typeof remaining === "number" && remaining <= 0) {
        return { status: "down", latencyMs, lastError: "OpenRouter credit balance exhausted" };
      }
      // Warn early so ops can top up before a demo. Threshold of $10 leaves
      // enough headroom for a full agent run + a dozen CXO perspectives.
      if (typeof remaining === "number" && remaining < 10) {
        return {
          status: "degraded",
          latencyMs,
          lastError: `OpenRouter credit balance low: $${remaining.toFixed(2)} (top up at openrouter.ai/credits)`,
        };
      }
      return { status: "ok", latencyMs, lastError: null };
    }
    return {
      status: value.status === 401 || value.status === 403 ? "down" : "degraded",
      latencyMs,
      lastError: `OpenRouter /auth/key → ${value.status}`,
    };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
};

const probeAnthropic: Probe = async () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      status: "not_configured",
      latencyMs: null,
      lastError: "ANTHROPIC_API_KEY not set",
    };
  }
  try {
    const { latencyMs } = await timed(async () => {
      const mod = await import("@workspace/integrations-anthropic-ai");
      if (!mod.anthropic) throw new Error("anthropic client missing from integration module");
      return null;
    });
    return { status: "ok", latencyMs, lastError: null };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
};

const probePerplexity: Probe = async () => {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return { status: "not_configured", latencyMs: null, lastError: "PERPLEXITY_API_KEY not set" };
  // Perplexity has no cheap healthcheck endpoint. Issue a 1-token completion;
  // 401/403 → down, 429 → degraded, other 2xx → ok.
  try {
    const { value, latencyMs } = await timed(() =>
      withTimeout(
        fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        }),
        PROBE_TIMEOUT_MS,
        "perplexity",
      ),
    );
    if (value.ok) return { status: "ok", latencyMs, lastError: null };
    if (value.status === 429) {
      return { status: "degraded", latencyMs, lastError: "Perplexity rate-limited (429)" };
    }
    if (value.status === 401 || value.status === 403) {
      return { status: "down", latencyMs, lastError: `Perplexity auth failed (${value.status})` };
    }
    return { status: "degraded", latencyMs, lastError: `Perplexity → ${value.status}` };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
};

const probeFoundry: Probe = async () => {
  let baseUrl: string;
  let token: string;
  try {
    baseUrl = FOUNDRY.baseUrl;
    token = FOUNDRY.token;
  } catch (err) {
    return { status: "not_configured", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
  try {
    // Hit a cheap authed endpoint. Foundry's user/me path varies by stack
    // version (some instances expose /api/v2/admin/me, others 404 on
    // /users/me) — what matters for liveness is that the token is accepted
    // (anything that isn't 401/403/5xx means Foundry is reachable + auth
    // wasn't rejected).
    const { value, latencyMs } = await timed(() =>
      withTimeout(
        fetch(`${baseUrl}/api/v2/admin/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        PROBE_TIMEOUT_MS,
        "foundry",
      ),
    );
    if (value.status === 401 || value.status === 403) {
      return { status: "down", latencyMs, lastError: `Foundry auth failed (${value.status}) — token expired or revoked` };
    }
    if (value.status >= 500) {
      return { status: "degraded", latencyMs, lastError: `Foundry /admin/me → ${value.status}` };
    }
    // 2xx, 3xx, 404, etc. — service is up and authenticating us.
    return { status: "ok", latencyMs, lastError: null };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
};

const probeStripe: Probe = async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { status: "not_configured", latencyMs: null, lastError: "STRIPE_SECRET_KEY not set" };
  try {
    const { default: Stripe } = await import("stripe");
    const client = new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
    const { latencyMs } = await timed(() =>
      withTimeout(client.balance.retrieve() as Promise<unknown>, PROBE_TIMEOUT_MS, "stripe"),
    );
    return { status: "ok", latencyMs, lastError: null };
  } catch (err) {
    const msg = describeError(err);
    if (/\b401\b|invalid.*api.*key|authentication/i.test(msg)) {
      return { status: "down", latencyMs: null, lastError: msg.slice(0, 240) };
    }
    return { status: "degraded", latencyMs: null, lastError: msg.slice(0, 240) };
  }
};

const probeClerk: Probe = async () => {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) return { status: "not_configured", latencyMs: null, lastError: "CLERK_SECRET_KEY not set" };
  try {
    const { value, latencyMs } = await timed(() =>
      withTimeout(
        fetch("https://api.clerk.com/v1/jwks", {
          headers: { Authorization: `Bearer ${key}` },
        }),
        PROBE_TIMEOUT_MS,
        "clerk",
      ),
    );
    if (value.ok) return { status: "ok", latencyMs, lastError: null };
    if (value.status === 401 || value.status === 403) {
      return { status: "down", latencyMs, lastError: `Clerk auth failed (${value.status})` };
    }
    return { status: "degraded", latencyMs, lastError: `Clerk /v1/jwks → ${value.status}` };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
};

/**
 * Demo-readiness probe. Reports `degraded` when the platform is technically
 * up but a VC walkthrough would land on empty screens. Three signals checked:
 *  - at least 1 organization in organizationsTable (scorecard data)
 *  - at least 10 capabilities in capabilitiesTable (otherwise the catalog is bare)
 *  - at least 1 cvi_components row (otherwise the index is uninitialised)
 *
 * Cheap query — three count() rolled into one round-trip.
 */
const probeDemoReadiness: Probe = async () => {
  const start = Date.now();
  try {
    const [orgs] = await db.select({ c: sql<number>`count(*)::int` }).from(organizationsTable);
    const [caps] = await db.select({ c: sql<number>`count(*)::int` }).from(capabilitiesTable);
    const [comps] = await db.select({ c: sql<number>`count(*)::int` }).from(cviComponentsTable);
    const latencyMs = Date.now() - start;
    const issues: string[] = [];
    if ((orgs?.c ?? 0) === 0) issues.push("organizations table is empty — run `pnpm tsx scripts/src/seed-organizations.ts`");
    if ((caps?.c ?? 0) < 10) issues.push(`only ${caps?.c ?? 0} capabilities — catalog will look sparse`);
    if ((comps?.c ?? 0) === 0) issues.push("cvi_components table is empty — run enrichment");
    if (issues.length === 0) return { status: "ok", latencyMs, lastError: null };
    return { status: "degraded", latencyMs, lastError: issues.join("; ") };
  } catch (err) {
    return { status: "down", latencyMs: Date.now() - start, lastError: describeError(err).slice(0, 240) };
  }
};

const PROBES: Record<string, Probe> = {
  mem0: probeMem0,
  letta: probeLetta,
  openrouter: probeOpenRouter,
  anthropic: probeAnthropic,
  perplexity: probePerplexity,
  foundry: probeFoundry,
  stripe: probeStripe,
  clerk: probeClerk,
  demo_readiness: probeDemoReadiness,
};

async function runProbe(service: string, probe: Probe): Promise<ServiceHealth> {
  try {
    const partial = await probe();
    return { service, checkedAt: new Date().toISOString(), ...partial };
  } catch (err) {
    return {
      service,
      checkedAt: new Date().toISOString(),
      status: "down",
      latencyMs: null,
      lastError: describeError(err).slice(0, 240),
    };
  }
}

function refreshInBackground(service: string, probe: Probe): void {
  const entry = cache.get(service);
  if (entry?.refreshing) return;
  if (entry) entry.refreshing = true;
  void runProbe(service, probe).then((result) => {
    cache.set(service, { result, expiresAt: Date.now() + CACHE_TTL_MS, refreshing: false });
  });
}

async function getServiceHealth(service: string, probe: Probe): Promise<ServiceHealth> {
  const now = Date.now();
  const entry = cache.get(service);
  if (entry && entry.expiresAt > now) return entry.result;
  if (entry) {
    // Stale — return immediately and refresh in background so callers never block.
    refreshInBackground(service, probe);
    return entry.result;
  }
  // Cold cache: must run synchronously this once.
  const result = await runProbe(service, probe);
  cache.set(service, { result, expiresAt: Date.now() + CACHE_TTL_MS, refreshing: false });
  return result;
}

function rollupOverall(services: ServiceHealth[]): ServiceStatus {
  // not_configured doesn't count against overall health — operator opted out.
  const live = services.filter((s) => s.status !== "not_configured");
  if (live.some((s) => s.status === "down")) return "down";
  if (live.some((s) => s.status === "degraded")) return "degraded";
  return "ok";
}

export async function getAllServiceHealth(): Promise<ServicesHealthResponse> {
  const entries = Object.entries(PROBES);
  const services = await Promise.all(entries.map(([name, probe]) => getServiceHealth(name, probe)));
  return {
    overall: rollupOverall(services),
    services,
    generatedAt: new Date().toISOString(),
  };
}
