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
import { lettaPing, getRegisteredAgents } from "../agent/letta";
import { storePing } from "../agent/store";
import { AGENT_REGISTRY, type AgentRegistryEntry } from "../agent/agent-registry";
import { FOUNDRY } from "../foundry/config";
import { db } from "@workspace/db";
import { organizationsTable, capabilitiesTable, cviComponentsTable, enrichmentRunsTable } from "@workspace/db";
import { sql, desc } from "drizzle-orm";

export type ServiceStatus = "ok" | "degraded" | "down" | "not_configured" | "initializing";

/**
 * When the api-server process started. Used by the boot-grace window in
 * runProbe() to suppress false-alarm `down` / `not_configured` results for
 * probes that depend on async init (Letta agent registration via doInit(),
 * Mem0 client pool warm-up, Anthropic SDK dynamic import). Probes hit
 * during this window report `initializing` instead, so the systems page
 * doesn't flash "Mem0 DOWN" for the first minute after every deploy.
 */
const BOOT_TIME_MS = Date.now();
const BOOT_GRACE_WINDOW_MS = 90_000;

/**
 * Services where a `down` / `not_configured` result during the boot grace
 * window is almost certainly init-still-running, not a real outage. After
 * the window closes, real failures surface normally.
 */
const BOOT_SENSITIVE_SERVICES = new Set<string>([
  "mem0", "letta", "agent_store", "agent_registry",
  "agent_cvi_autonomous", "agent_macro_event", "agent_disruption",
  "agent_peer_coop", "agent_stack_optimizer", "agent_ontology",
  "agent_synthesis", "agent_enrichment",
  "synthesis_agent", "temporal_shifts",
  "anthropic", "langsmith",
]);

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
// 2026-05-19: bumped Mem0 from 2000→3500ms. Cross-internet RTT from
// Railway US-East → api.mem0.ai routinely sits in the 200–3000ms band
// under normal load (local sample: 653ms, prod sample under contention:
// 2120ms). The 2000ms cap was triggering false-alarm "degraded" status
// during the service-page banner cycle while the service itself was
// healthy. 3500ms still catches genuine slowness without paging on jitter.
const MEM0_LATENCY_WARN_MS = 3500;
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
            // Sonar rejects max_tokens < ~50 with HTTP 400 (validation error).
            // 50 keeps the probe cheap (~$0.0002/call) while staying inside
            // the model's allowed range. Was 1 → false-alarmed "Perplexity → 400"
            // every health check even though the actual enrichment calls work.
            max_tokens: 50,
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
    // Use the async token resolver so the probe exercises the same path the
    // actual sync uses (system_secrets → env → OAuth mint). Reading
    // FOUNDRY.token directly was an env-var-only check that bypassed the
    // OAuth fallback added in 4549a0a.
    const { getFoundryToken } = await import("../foundry/auth");
    const resolved = await getFoundryToken();
    if (!resolved) {
      return { status: "not_configured", latencyMs: null, lastError: "No Foundry token available (system_secrets row empty, no env var, OAuth mint did not succeed). Check FOUNDRY_BASE_URL + FOUNDRY_CLIENT_ID + FOUNDRY_CLIENT_SECRET." };
    }
    token = resolved;
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

// Forward-path probe for the LangMem-equivalent shared store. Cheap
// DB ping via storePing(). Same latency-threshold treatment as the
// mem0/letta probes — degraded above 2000ms.
const probeAgentStore: Probe = async () => {
  try {
    const { latencyMs } = await timed(() => withTimeout(storePing(), PROBE_TIMEOUT_MS, "agent-store"));
    if (latencyMs > 2000) {
      return { status: "degraded", latencyMs, lastError: `High latency: ${latencyMs}ms` };
    }
    return { status: "ok", latencyMs, lastError: null };
  } catch (err) {
    const msg = describeError(err);
    return { status: "down", latencyMs: null, lastError: msg.slice(0, 240) };
  }
};

/**
 * Synthesis-agent freshness probe. The agent runs daily and publishes a brief
 * to NS.sharedKnowledge("synthesis_brief"). We treat a brief written within
 * the last 25h as fresh; 25–49h is degraded (one missed run); older than 49h
 * is down (cron is stuck or the agent is failing). Status "not_configured"
 * surfaces when no brief has ever been written — the agent runs on a 5min
 * stagger after boot, so this only persists on a fresh deploy for ~5min.
 */
const SYNTHESIS_FRESH_THRESHOLD_MS = 25 * 60 * 60 * 1000;
const SYNTHESIS_STALE_THRESHOLD_MS = 49 * 60 * 60 * 1000;

const probeSynthesisAgent: Probe = async () => {
  try {
    const { ensureSharedStoreReady, getSharedStore, NS } = await import("../agent/store");
    await ensureSharedStoreReady();
    const items = await withTimeout(
      getSharedStore().search(NS.sharedKnowledge("synthesis_brief"), { limit: 1 }),
      PROBE_TIMEOUT_MS,
      "synthesis-agent",
    );
    if (items.length === 0) {
      return { status: "not_configured", latencyMs: null, lastError: "No synthesis brief has been published yet (agent runs 5 min after boot)" };
    }
    const generatedAt = (items[0]!.value as { generatedAt?: string }).generatedAt;
    if (!generatedAt) {
      return { status: "degraded", latencyMs: null, lastError: "Synthesis brief exists but is missing a generatedAt timestamp" };
    }
    const age = Date.now() - new Date(generatedAt).getTime();
    if (age <= SYNTHESIS_FRESH_THRESHOLD_MS) {
      return { status: "ok", latencyMs: null, lastError: null };
    }
    if (age <= SYNTHESIS_STALE_THRESHOLD_MS) {
      return { status: "degraded", latencyMs: null, lastError: `Synthesis brief is ${Math.round(age / 3600000)}h old — expected daily refresh` };
    }
    return { status: "down", latencyMs: null, lastError: `Synthesis brief is ${Math.round(age / 3600000)}h old — daily cron may be stuck` };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
};

/**
 * Temporal-shift cache freshness probe. The 6h scheduled cron writes to
 * NS.sharedKnowledge("temporal_shifts"). Fresh ≤ 7h (one missed tick),
 * degraded ≤ 14h, down beyond that.
 */
const TEMPORAL_FRESH_THRESHOLD_MS = 7 * 60 * 60 * 1000;
const TEMPORAL_STALE_THRESHOLD_MS = 14 * 60 * 60 * 1000;

const probeTemporalShifts: Probe = async () => {
  try {
    const { ensureSharedStoreReady, getSharedStore, NS } = await import("../agent/store");
    await ensureSharedStoreReady();
    const items = await withTimeout(
      getSharedStore().search(NS.sharedKnowledge("temporal_shifts"), { limit: 1 }),
      PROBE_TIMEOUT_MS,
      "temporal-shifts",
    );
    if (items.length === 0) {
      return { status: "not_configured", latencyMs: null, lastError: "No temporal-shift report cached yet (cron runs 2 min after boot)" };
    }
    const cachedAt = (items[0]!.value as { cachedAt?: string }).cachedAt;
    if (!cachedAt) {
      return { status: "degraded", latencyMs: null, lastError: "Temporal-shift cache entry missing cachedAt timestamp" };
    }
    const age = Date.now() - new Date(cachedAt).getTime();
    if (age <= TEMPORAL_FRESH_THRESHOLD_MS) {
      return { status: "ok", latencyMs: null, lastError: null };
    }
    if (age <= TEMPORAL_STALE_THRESHOLD_MS) {
      return { status: "degraded", latencyMs: null, lastError: `Temporal-shift cache is ${Math.round(age / 3600000)}h old — expected 6h refresh` };
    }
    return { status: "down", latencyMs: null, lastError: `Temporal-shift cache is ${Math.round(age / 3600000)}h old — 6h cron may be stuck` };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
};

/**
 * Confirms that all 7 AGENT_REGISTRY agents are registered in Letta Cloud
 * with their own agent_id + archive. This is the probe operators check
 * after deploying the multi-agent registration refactor — if it reports
 * "ok" with count=7/7, the Letta dashboard should now show all 7 agents,
 * each with its own attached archive + sleeptime config.
 */
const probeAgentRegistry: Probe = async () => {
  try {
    const registered = getRegisteredAgents();
    const total = AGENT_REGISTRY.length;
    const withArchive = registered.filter((r) => r.archiveId).length;
    if (registered.length === 0) {
      // Letta init may not have run yet, or it failed silently.
      return {
        status: "not_configured",
        latencyMs: null,
        lastError: "No agents registered yet — Letta init may still be in progress or LETTA_API_KEY may be unset",
      };
    }
    if (registered.length < total) {
      return {
        status: "degraded",
        latencyMs: null,
        lastError: `Only ${registered.length}/${total} agents registered (${withArchive} with archive). Check api-server logs for [Letta] registerLettaAgent warnings.`,
      };
    }
    if (withArchive < total) {
      return {
        status: "degraded",
        latencyMs: null,
        lastError: `${total}/${total} agents registered but only ${withArchive}/${total} have an attached archive. Archival memory will be partial.`,
      };
    }
    return { status: "ok", latencyMs: null, lastError: null };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
};

/**
 * Per-agent probe builder — surfaces each of the 7 AGENT_REGISTRY agents
 * individually instead of just an aggregate count. Reports:
 *   - not_configured if not registered in Letta Cloud yet (init still running
 *     or LETTA_API_KEY unset)
 *   - degraded if registered without an attached archive (archival memory partial)
 *   - ok if both agent_id and archive_id are present
 */
function makeAgentProbe(entry: AgentRegistryEntry): Probe {
  return async () => {
    const registered = getRegisteredAgents();
    const found = registered.find((r) => r.shortName === entry.shortName);
    if (!found) {
      return {
        status: "not_configured",
        latencyMs: null,
        lastError: "Not registered in Letta Cloud (init may still be running or LETTA_API_KEY unset)",
      };
    }
    if (!found.archiveId) {
      return {
        status: "degraded",
        latencyMs: null,
        lastError: `Registered (agent_id=${found.agentId.slice(0, 8)}…) but archive not attached — archival memory partial`,
      };
    }
    return { status: "ok", latencyMs: null, lastError: null };
  };
}

/**
 * The enrichment agent lives in its own LangGraph (services/enrichment/graph.ts)
 * and writes to enrichment_runs instead of the Letta registry. Probe the most
 * recent run row for status + recency.
 */
const probeAgentEnrichment: Probe = async () => {
  try {
    const [latest] = await db
      .select({
        id: enrichmentRunsTable.id,
        status: enrichmentRunsTable.status,
        startedAt: enrichmentRunsTable.startedAt,
        completedAt: enrichmentRunsTable.completedAt,
      })
      .from(enrichmentRunsTable)
      .orderBy(desc(enrichmentRunsTable.id))
      .limit(1);
    if (!latest) {
      return { status: "not_configured", latencyMs: null, lastError: "No enrichment runs recorded yet" };
    }
    if (latest.status === "running") {
      const runFor = Date.now() - new Date(latest.startedAt).getTime();
      if (runFor > 30 * 60 * 1000) {
        return { status: "degraded", latencyMs: null, lastError: `Run #${latest.id} has been running for ${Math.round(runFor / 60000)}m — may be stuck` };
      }
      return { status: "ok", latencyMs: null, lastError: `Run #${latest.id} in progress` };
    }
    if (latest.status === "failed" || latest.status === "interrupted") {
      return { status: "degraded", latencyMs: null, lastError: `Last run #${latest.id} ${latest.status}` };
    }
    if (latest.completedAt) {
      const ageHours = (Date.now() - new Date(latest.completedAt).getTime()) / 3600000;
      if (ageHours > 7 * 24) {
        return { status: "degraded", latencyMs: null, lastError: `Last successful run was ${Math.round(ageHours / 24)}d ago` };
      }
    }
    return { status: "ok", latencyMs: null, lastError: null };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
};

/**
 * Framework probes — the LLM-agent stack itself. Don't catch runtime
 * failures (those show up in per-agent probes above) but do catch broken
 * installs / missing exports that would otherwise crash agents at first
 * tool call.
 */
const probeLangChain: Probe = async () => {
  try {
    const mod = await import("@langchain/anthropic");
    if (!mod.ChatAnthropic) {
      return { status: "down", latencyMs: null, lastError: "@langchain/anthropic loaded but ChatAnthropic export missing" };
    }
    return { status: "ok", latencyMs: null, lastError: null };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: `@langchain/anthropic import failed: ${describeError(err).slice(0, 160)}` };
  }
};

const probeLangGraph: Probe = async () => {
  try {
    const mod = await import("@langchain/langgraph");
    if (!mod.StateGraph) {
      return { status: "down", latencyMs: null, lastError: "@langchain/langgraph loaded but StateGraph export missing" };
    }
    return { status: "ok", latencyMs: null, lastError: null };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: `@langchain/langgraph import failed: ${describeError(err).slice(0, 160)}` };
  }
};

const probeLangSmith: Probe = async () => {
  const tracing = process.env.LANGCHAIN_TRACING_V2;
  const key = process.env.LANGCHAIN_API_KEY;
  const project = process.env.LANGCHAIN_PROJECT ?? "inflexcvi";
  if (tracing !== "true" || !key) {
    return {
      status: "not_configured",
      latencyMs: null,
      lastError: "LANGCHAIN_TRACING_V2=true and LANGCHAIN_API_KEY required — trace shipping disabled",
    };
  }
  try {
    const { value, latencyMs } = await timed(() =>
      withTimeout(
        fetch(`https://api.smith.langchain.com/api/v1/sessions?name=${encodeURIComponent(project)}`, {
          headers: { "X-API-Key": key },
        }),
        PROBE_TIMEOUT_MS,
        "langsmith",
      ),
    );
    if (!value.ok) return { status: "down", latencyMs, lastError: `LangSmith API → ${value.status}` };
    const sessions = (await value.json().catch(() => [])) as Array<{ name?: string }>;
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return { status: "degraded", latencyMs, lastError: `Project "${project}" not found in workspace — no traces will land` };
    }
    return { status: "ok", latencyMs, lastError: null };
  } catch (err) {
    return { status: "down", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
};

// Per-agent probe registration: one entry per AGENT_REGISTRY row + the
// enrichment agent. Keys are normalised to `agent_<short>` so the JSON
// shape stays stable.
const perAgentProbes: Record<string, Probe> = Object.fromEntries(
  AGENT_REGISTRY.map((entry) => {
    const key = "agent_" + entry.shortName.replace(/-agent$/, "").replace(/-/g, "_");
    return [key, makeAgentProbe(entry)] as const;
  }),
);

const PROBES: Record<string, Probe> = {
  mem0: probeMem0,
  letta: probeLetta,
  agent_store: probeAgentStore,
  agent_registry: probeAgentRegistry,
  ...perAgentProbes,
  agent_enrichment: probeAgentEnrichment,
  synthesis_agent: probeSynthesisAgent,
  temporal_shifts: probeTemporalShifts,
  langchain: probeLangChain,
  langgraph: probeLangGraph,
  langsmith: probeLangSmith,
  openrouter: probeOpenRouter,
  anthropic: probeAnthropic,
  perplexity: probePerplexity,
  foundry: probeFoundry,
  stripe: probeStripe,
  clerk: probeClerk,
  demo_readiness: probeDemoReadiness,
};

function applyBootGrace(service: string, partial: { status: ServiceStatus; latencyMs: number | null; lastError: string | null }): { status: ServiceStatus; latencyMs: number | null; lastError: string | null } {
  if (partial.status === "ok" || partial.status === "degraded") return partial;
  if (!BOOT_SENSITIVE_SERVICES.has(service)) return partial;
  const sinceBootMs = Date.now() - BOOT_TIME_MS;
  if (sinceBootMs >= BOOT_GRACE_WINDOW_MS) return partial;
  return {
    status: "initializing",
    latencyMs: null,
    lastError: `Initializing — ${Math.round(sinceBootMs / 1000)}s since process start, grace window ${BOOT_GRACE_WINDOW_MS / 1000}s. Real result: "${partial.lastError ?? partial.status}".`,
  };
}

async function runProbe(service: string, probe: Probe): Promise<ServiceHealth> {
  let partial: { status: ServiceStatus; latencyMs: number | null; lastError: string | null };
  try {
    partial = await probe();
  } catch (err) {
    partial = { status: "down", latencyMs: null, lastError: describeError(err).slice(0, 240) };
  }
  return { service, checkedAt: new Date().toISOString(), ...applyBootGrace(service, partial) };
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
  // not_configured and initializing don't count against overall health.
  // not_configured = operator opted out. initializing = process is still
  // warming up; real state isn't known yet. Neither warrants a DOWN banner.
  const live = services.filter((s) => s.status !== "not_configured" && s.status !== "initializing");
  if (live.some((s) => s.status === "down")) return "down";
  if (live.some((s) => s.status === "degraded")) return "degraded";
  // If every live probe is OK but at least one is still initializing,
  // surface that — the page says "initializing" rather than a misleading OK.
  if (services.some((s) => s.status === "initializing")) return "initializing";
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
