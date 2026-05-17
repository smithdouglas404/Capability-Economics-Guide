import { useServiceHealth, type ServiceStatus } from "@/hooks/use-service-health";

const STATUS_LABELS: Record<ServiceStatus, string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
  not_configured: "Not configured",
};

const STATUS_TONES: Record<ServiceStatus, string> = {
  ok: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  degraded: "text-amber-700 dark:text-amber-400 border-amber-500/40 bg-amber-500/10",
  down: "text-destructive border-destructive/40 bg-destructive/10",
  not_configured: "text-muted-foreground border-border/60 bg-muted/40",
};

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  mem0: "Long-term agent memory — Mem0 Cloud at api.mem0.ai (durable observations, validated patterns; per-agent agent_id namespacing).",
  letta: "Stateful agent memory blocks — Letta Cloud at api.letta.com (persona / current_focus / industry_priors blocks + archival recall for all 7 agents).",
  agent_store: "Shared agent store — Letta Cloud-backed adapter exposing NS.* namespaces for cross-agent digests + per-agent prior blocks.",
  agent_registry: "Registration state of the 7 platform agents in Letta Cloud (each agent + its attached archive + tool_rules + sleeptime).",
  synthesis_agent: "Daily cross-agent strategic brief — reads all 5 specialized-agent digests + Neo4j correlations + Mem0 patterns + temporal shifts.",
  temporal_shifts: "6-hour temporal-shift detector — accelerating / reversing capability relationships derived from 30-day memory_relation_snapshots.",
  openrouter: "LLM routing for the autonomous agent and enrichment runners.",
  anthropic: "Direct Claude access for reasoning-heavy assessment + VCR.",
  perplexity: "Cited web search for triangulation and signal enrichment.",
  foundry: "Palantir Foundry sync — capability dataset reads + writes.",
  stripe: "Subscription billing, invoices, marketplace payouts.",
  clerk: "Authentication, sessions, organization membership.",
  demo_readiness: "Internal smoke test — confirms the demo dataset (industries, capabilities, CVI scores) is loaded and queryable.",
};

function fmtLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

export default function SystemStatus() {
  const { data, isLoading, error, refetch, isFetching } = useServiceHealth();

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="font-serif text-3xl tracking-tight">System Status</h1>
        <button
          type="button"
          onClick={() => refetch()}
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          data-testid="status-refresh"
          disabled={isFetching}
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-8 max-w-2xl">
        Live status of every upstream service the platform depends on. Cached
        for 60 seconds. <em>Not configured</em> means credentials are
        intentionally absent — that service's features are off but nothing is
        broken.
      </p>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && (
        <div className="border border-destructive/40 bg-destructive/10 text-destructive p-4 text-sm font-mono">
          Could not reach status endpoint: {(error as Error).message}
        </div>
      )}

      {data && (
        <>
          <div
            className={`mb-6 px-4 py-3 border ${STATUS_TONES[data.overall]} flex items-center justify-between`}
            data-testid="status-overall"
          >
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-70">Overall</div>
              <div className="font-serif text-xl">{STATUS_LABELS[data.overall]}</div>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70 text-right">
              Generated<br />{fmtTime(data.generatedAt)}
            </div>
          </div>

          <div className="border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="px-4 py-2">Service</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Latency</th>
                  <th className="px-4 py-2">Checked</th>
                </tr>
              </thead>
              <tbody>
                {data.services.map((s) => (
                  <tr
                    key={s.service}
                    className="border-t border-border/40 align-top"
                    data-testid={`status-row-${s.service}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-serif capitalize">{s.service}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {SERVICE_DESCRIPTIONS[s.service] ?? ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 border font-mono text-[10px] uppercase tracking-[0.16em] ${STATUS_TONES[s.status]}`}
                      >
                        {STATUS_LABELS[s.status]}
                      </span>
                      {s.lastError && (
                        <div
                          className="mt-2 text-xs font-mono text-muted-foreground break-words max-w-md"
                          data-testid={`status-error-${s.service}`}
                        >
                          {s.lastError}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{fmtLatency(s.latencyMs)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {fmtTime(s.checkedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
