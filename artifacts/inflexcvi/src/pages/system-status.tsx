import { useServiceHealth, type ServiceStatus } from "@/hooks/use-service-health";

const STATUS_LABELS: Record<ServiceStatus, string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
  not_configured: "Not configured",
  initializing: "Initializing",
};

const STATUS_TONES: Record<ServiceStatus, string> = {
  ok: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  degraded: "text-amber-700 dark:text-amber-400 border-amber-500/40 bg-amber-500/10",
  down: "text-destructive border-destructive/40 bg-destructive/10",
  not_configured: "text-muted-foreground border-border/60 bg-muted/40",
  // initializing = process started <90s ago and a boot-sensitive probe
  // hasn't finished its async warm-up yet (Letta registration, Mem0 pool,
  // Anthropic SDK import). Distinct from "down" so deploys don't flash red.
  initializing: "text-sky-600 dark:text-sky-400 border-sky-500/40 bg-sky-500/10",
};

const SERVICE_LABELS: Record<string, string> = {
  mem0: "Mem0 Cloud",
  letta: "Letta Cloud",
  agent_store: "Letta-backed shared store",
  agent_registry: "Agent registry (aggregate)",
  agent_cvi_autonomous: "CVI Autonomous Agent",
  agent_macro_event: "Macro Event Agent",
  agent_disruption: "Disruption Agent",
  agent_peer_coop: "Peer Co-op Agent",
  agent_stack_optimizer: "Stack Optimizer Agent",
  agent_ontology: "Ontology Agent",
  agent_synthesis: "Synthesis Agent (Letta state)",
  agent_enrichment: "Enrichment Agent (LangGraph)",
  synthesis_agent: "Synthesis brief (latest publish)",
  temporal_shifts: "Temporal-shift detector",
  langchain: "LangChain runtime",
  langgraph: "LangGraph runtime",
  langsmith: "LangSmith tracing",
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  perplexity: "Perplexity",
  foundry: "Palantir Foundry",
  stripe: "Stripe",
  clerk: "Clerk",
  demo_readiness: "Demo dataset",
};

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  mem0: "Long-term agent memory — Mem0 Cloud at api.mem0.ai (durable observations, validated patterns; per-agent agent_id namespacing).",
  letta: "Stateful agent memory blocks — Letta Cloud at api.letta.com (persona / current_focus / industry_priors blocks + archival recall for all 7 agents).",
  agent_store: "Shared agent store — Letta Cloud-backed adapter exposing NS.* namespaces for cross-agent digests + per-agent prior blocks.",
  agent_registry: "Aggregate registration count for the 7 AGENT_REGISTRY agents in Letta Cloud (per-agent rows below show each individually).",
  agent_cvi_autonomous: "Senior capability-economics reasoner — runs every 30 min, picks targets via memory recall, updates CVI scores. LangGraph state machine in services/agent/graph.ts.",
  agent_macro_event: "Watches Fed/regulatory/earnings macro signals every 30 min, publishes impact deltas to NS.macroEvents() for downstream agents. Haiku 4.5 + LangChain createAgent.",
  agent_disruption: "Scans capability graph for new signal events every 60 min, classifies by quadrant pressure, publishes disruption scores. Haiku 4.5 + LangChain createAgent.",
  agent_peer_coop: "Cohort benchmark aggregator — every 6h rebuilds percentile distributions and publishes peer benchmarks. Haiku 4.5 + LangChain createAgent.",
  agent_stack_optimizer: "Daily recommender — reads disruption + peer-coop digests + Neo4j blockers + Mem0 patterns, produces investment-priority recommendations. Haiku 4.5 + LangChain createAgent.",
  agent_ontology: "Entity-extraction agent — runs every 4h after others publish, writes :Entity nodes to Neo4j. Haiku 4.5 + LangChain createAgent.",
  agent_synthesis: "Daily cross-agent intelligence layer (Letta state) — reads all 5 digests + correlations + patterns + shifts to compose a strategic brief. Sonnet 4.6 + LangChain createAgent.",
  agent_enrichment: "Per-capability enrichment ReAct agent — runs hourly (and on-demand via /api/enrichment/run) to fill capability_alpha / quadrants / detail. LangGraph state machine in services/enrichment/graph.ts.",
  synthesis_agent: "Whether the latest daily synthesis brief was published — separate signal from the Synthesis Agent's Letta registration state above.",
  temporal_shifts: "6-hour temporal-shift detector — accelerating / reversing capability relationships derived from 30-day memory_relation_snapshots.",
  langchain: "@langchain/anthropic SDK — direct Claude calls used by all 7 specialized agents (createAgent + ChatAnthropic). Probe verifies the module loads with the expected exports.",
  langgraph: "@langchain/langgraph runtime — state-machine framework used by the CVI Autonomous Agent and the Enrichment Agent (StateGraph + checkpoint-postgres for run state).",
  langsmith: "Trace shipping to smith.langchain.com — auto-instruments every LangChain / LangGraph call when LANGCHAIN_TRACING_V2=true. Probe checks the project exists in the configured workspace.",
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
                      <div className="font-serif">
                        {SERVICE_LABELS[s.service] ?? s.service}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground-soft mt-0.5">
                        {s.service}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
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
