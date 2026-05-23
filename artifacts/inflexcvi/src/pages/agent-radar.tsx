/**
 * /agent-radar — "Live brain" surface for the autonomous agent fleet.
 *
 * Two layers:
 *   1. Top: the original "3-quarter early detection advantage" bar chart
 *      (deck p9) — kept verbatim so existing readers don't lose context.
 *   2. Bottom (NEW): a live SSE-backed activity feed for the 5 specialized
 *      agents + autonomous CVI agent + synthesis agent. KPI strip, agent
 *      filter chips, event-type filter, replay scrubber for the last hour,
 *      and a click-through detail panel.
 *
 * SSE source: /api/agent/events/stream (shared with cvi-dashboard).
 * Replay source: /api/agent/runs/replay?since=<iso>.
 * KPI source: /api/agent/runs/aggregates.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Zap, TrendingUp, Activity, AlertTriangle, CheckCircle2, Clock, Play, Pause } from "lucide-react";
import { useEventStream } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { SourceRow } from "@/components/source-badge";

const API_BASE = "/api";

interface SeriesPoint { quarter: string; ceDetected: number; marketConsensus: number; }

const DEMO_SERIES: SeriesPoint[] = [
  { quarter: "Q1", ceDetected: 0,  marketConsensus: 0 },
  { quarter: "Q2", ceDetected: 5,  marketConsensus: 0 },
  { quarter: "Q3", ceDetected: 18, marketConsensus: 0 },
  { quarter: "Q4", ceDetected: 32, marketConsensus: 4 },
  { quarter: "Q5", ceDetected: 54, marketConsensus: 14 },
  { quarter: "Q6", ceDetected: 78, marketConsensus: 42 },
  { quarter: "Q7", ceDetected: 92, marketConsensus: 76 },
];

// Agent event shape — superset of live SSE + replay event payloads.
interface AgentEvent {
  type: string;
  timestamp?: string;
  phase?: string;
  message?: string;
  capability?: string;
  industry?: string;
  runId?: number;
  agent?: string;
  overallIndex?: number;
  researched?: number;
  skipped?: number;
  tool?: string;
  error?: string;
  [k: string]: unknown;
}

interface AgentAggregate {
  agent: string;
  runs24h: number;
  successRate: number;
  failedCount: number;
  avgDurationMs: number;
  lastErrorAt: string | null;
  lastRunAt: string | null;
}

// Map an event to its agent label. Live SSE events don't always carry
// `agent` so we infer from `tool`/`phase`/`type` where possible. Replay
// events always include `agent`.
function inferAgent(e: AgentEvent): string {
  if (typeof e.agent === "string" && e.agent) return e.agent;
  const tool = String(e.tool ?? "");
  if (tool.startsWith("generate_ontology") || e.type === "ontology_run") return "ontology";
  if (tool === "perplexity_research" || tool === "compute_cvi") return "cvi";
  if (e.type?.startsWith("letta_")) return "letta";
  if (e.type === "consolidation_started" || e.type === "consolidation_complete") return "consolidator";
  if (e.phase === "world_scan_started" || e.phase === "world_scan_complete") return "macro-event";
  if (e.phase === "rotation_started") return "rotation";
  return "cvi";
}

// Three event severities: error, warning, completion-style. Used by the
// type-filter chip row.
function eventSeverity(e: AgentEvent): "error" | "warning" | "completion" | "info" {
  if (e.type === "tool_error" || e.type === "run_failed" || e.error) return "error";
  if (e.type === "scheduler_stopped" || e.type?.includes("skipped")) return "warning";
  if (e.type === "run_completed" || e.type === "tool_result" || e.type === "cvi_updated" || e.type === "decide_complete") return "completion";
  return "info";
}

function severityColor(s: ReturnType<typeof eventSeverity>): string {
  if (s === "error") return "text-red-500 border-red-500/30 bg-red-500/5";
  if (s === "warning") return "text-amber-500 border-amber-500/30 bg-amber-500/5";
  if (s === "completion") return "text-emerald-500 border-emerald-500/30 bg-emerald-500/5";
  return "text-muted-foreground border-border bg-muted/20";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

export default function AgentRadarPage() {
  const [series, setSeries] = useState<SeriesPoint[]>(DEMO_SERIES);
  const [isLive, setIsLive] = useState(false);
  const [agentFilter, setAgentFilter] = useState<string | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | "error" | "warning" | "completion">("all");
  const [aggregates, setAggregates] = useState<AgentAggregate[]>([]);
  const [replayEvents, setReplayEvents] = useState<AgentEvent[]>([]);
  const [replayMode, setReplayMode] = useState(false);
  const [replayCursor, setReplayCursor] = useState(0); // 0..100 percentage
  const [selectedEvent, setSelectedEvent] = useState<AgentEvent | null>(null);

  // Existing chart fetch (unchanged).
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/agent-radar/series`).then(r => r.ok ? r.json() : null).then((d: { series?: SeriesPoint[] } | null) => {
      if (!cancelled && d && Array.isArray(d.series) && d.series.length > 0) {
        setSeries(d.series);
        setIsLive(true);
      }
    }).catch(() => { /* keep demo */ });
    return () => { cancelled = true; };
  }, []);

  // KPI strip: load 24h aggregates on mount + every 60s.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${API_BASE}/agent/runs/aggregates`).then(r => r.ok ? r.json() : null).then((d: { aggregates?: AgentAggregate[] } | null) => {
        if (!cancelled && d?.aggregates) setAggregates(d.aggregates);
      }).catch(() => { /* ignore */ });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Live SSE stream — unchanged from the cvi-dashboard pattern.
  const { events: liveEvents, status } = useEventStream<AgentEvent>(
    `${API_BASE}/agent/events/stream`,
    {
      maxBuffered: 100,
      filter: (evt) => evt.type !== "connected",
    },
  );

  // When entering replay mode, fetch the last 60 min of events.
  useEffect(() => {
    if (!replayMode) return;
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    fetch(`${API_BASE}/agent/runs/replay?since=${encodeURIComponent(since)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { events?: AgentEvent[] } | null) => {
        if (d?.events) {
          setReplayEvents(d.events);
          setReplayCursor(100);
        }
      })
      .catch(() => { /* ignore */ });
  }, [replayMode]);

  // Source events: live OR a sliced window of replay events up to cursor.
  const sourceEvents: AgentEvent[] = useMemo(() => {
    if (replayMode) {
      const sliceCount = Math.max(1, Math.floor((replayCursor / 100) * replayEvents.length));
      // Newest-first ordering for the feed (replay is stored chronologically).
      return [...replayEvents.slice(0, sliceCount)].reverse();
    }
    return liveEvents;
  }, [replayMode, replayEvents, replayCursor, liveEvents]);

  // Filter chain — agent filter then severity filter.
  const filteredEvents = useMemo(() => {
    return sourceEvents.filter(e => {
      if (agentFilter !== "all" && inferAgent(e) !== agentFilter) return false;
      if (severityFilter !== "all" && eventSeverity(e) !== severityFilter) return false;
      return true;
    });
  }, [sourceEvents, agentFilter, severityFilter]);

  // Distinct agents observed across the union of aggregates + events — used
  // to populate the filter chip row (so we never show a chip with zero data).
  const agentChips = useMemo(() => {
    const set = new Set<string>(aggregates.map(a => a.agent));
    for (const e of sourceEvents) set.add(inferAgent(e));
    return Array.from(set).sort();
  }, [aggregates, sourceEvents]);

  const max = Math.max(1, ...series.flatMap(p => [p.ceDetected, p.marketConsensus]));
  const ceInflectionIdx = series.findIndex(p => p.ceDetected >= 10);
  const marketInflectionIdx = series.findIndex(p => p.marketConsensus >= 30);
  const advantageQuarters = ceInflectionIdx >= 0 && marketInflectionIdx >= 0
    ? marketInflectionIdx - ceInflectionIdx
    : null;

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>

      <PageHeader
        eyebrow="Insights & Alerts"
        title="Agent Radar"
        descriptions={{
          default: "Surfacing capability signals before they become market consensus. The blue bars are when CE first detected a signal; the amber bars are when the broader market caught up.",
          pe: "Diligence advantage in quarters, not quotes. By the time a target shows up on a banker's screen, CE was tracking it ~3 quarters earlier.",
          vc: "Front-running the thesis cycle. The blue lead time is your window to underwrite before the deck circulates.",
          f500: "Strategic foresight as KPI. If your strategy team is reading the market-consensus timing, you're already behind cohort.",
          student: "Time-series proof of an early-detection edge. Same data, two series; the gap between them is the entire pitch.",
          professor: "Live measurement of detection lag. Methodology and the underlying signal-detection cron are documented at /methodology.",
        }}
      />

      {!isLive && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 text-xs text-amber-500">
            Showing representative demo data — the live <code>/api/agent-radar/series</code> endpoint isn't yet wired. Real series will replace this automatically once published.
          </CardContent>
        </Card>
      )}

      <SourceRow sources={["internal", "edgar", "perplexity-seeded"]} label="Powered by" />

      {/* Bar chart */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
            <div className="font-serif text-2xl tracking-tight">Detection vs consensus, by quarter</div>
            {advantageQuarters !== null && advantageQuarters > 0 && (
              <Badge className="border border-accent/40 bg-accent/10 text-accent rounded-md px-3 py-1">
                <Zap className="w-3 h-3 mr-1" /> {advantageQuarters}-quarter early-detection advantage
              </Badge>
            )}
          </div>

          <div className="relative">
            <svg viewBox="0 0 700 320" className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
              {[0, 25, 50, 75, 100].map(y => {
                const yPos = 280 - (y / 100) * 250;
                return (
                  <g key={y}>
                    <line x1="40" x2="680" y1={yPos} y2={yPos} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="2 4" />
                    <text x="32" y={yPos + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{y}</text>
                  </g>
                );
              })}

              {series.map((p, i) => {
                const colW = (640 / series.length);
                const xCenter = 40 + i * colW + colW / 2;
                const barW = Math.min(50, colW * 0.35);
                const ceH = (p.ceDetected / max) * 250;
                const mkH = (p.marketConsensus / max) * 250;
                return (
                  <g key={p.quarter}>
                    <rect x={xCenter - barW + 2} y={280 - mkH} width={barW} height={mkH} className="fill-amber-500" opacity={0.85} />
                    <rect x={xCenter - 2} y={280 - ceH} width={barW} height={ceH} className="fill-blue-500" opacity={0.95} />
                    <text x={xCenter} y={300} textAnchor="middle" className="fill-muted-foreground text-[11px] font-mono">{p.quarter}</text>
                  </g>
                );
              })}

              {ceInflectionIdx >= 0 && (() => {
                const colW = (640 / series.length);
                const xCenter = 40 + ceInflectionIdx * colW + colW / 2;
                return (
                  <g>
                    <rect x={xCenter - 50} y={130} width={100} height={22} rx={4} className="fill-blue-500/20 stroke-blue-500/40" />
                    <text x={xCenter} y={145} textAnchor="middle" className="fill-blue-500 text-[10px] font-medium">CE detects signal</text>
                  </g>
                );
              })()}
              {marketInflectionIdx >= 0 && (() => {
                const colW = (640 / series.length);
                const xCenter = 40 + marketInflectionIdx * colW + colW / 2;
                return (
                  <g>
                    <rect x={xCenter - 55} y={60} width={110} height={22} rx={4} className="fill-amber-500/20 stroke-amber-500/40" />
                    <text x={xCenter} y={75} textAnchor="middle" className="fill-amber-500 text-[10px] font-medium">Market consensus</text>
                  </g>
                );
              })()}
            </svg>
          </div>

          <div className="flex items-center justify-end gap-4 mt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-blue-500" /> CE Detection</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-amber-500" /> Market Consensus</span>
          </div>
        </CardContent>
      </Card>

      {/* Below-the-fold reading */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="font-serif text-3xl text-blue-500 tabular-nums">
              {advantageQuarters !== null ? `${advantageQuarters}Q` : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Early-detection lead time over market consensus</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="font-serif text-3xl text-amber-500 tabular-nums">
              {series[series.length - 1]?.ceDetected ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">CE detection peak (latest quarter)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="font-serif text-3xl text-muted-foreground tabular-nums inline-flex items-baseline gap-1">
              <TrendingUp className="w-5 h-5" /> {series.length}Q
            </div>
            <div className="text-xs text-muted-foreground mt-1">Window of historical data shown</div>
          </CardContent>
        </Card>
      </div>

      {/* ====================================================================
          LIVE BRAIN — agent activity feed, KPI strip, replay scrubber.
          ==================================================================== */}
      <div className="pt-4 border-t border-border/40">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="font-serif text-2xl tracking-tight">Live brain</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Real-time activity across the agent fleet. Click any event for full payload.
            </div>
          </div>
          <Badge variant="outline" className={`text-xs ${status === "open" ? "border-emerald-500/40 text-emerald-500" : "border-muted-foreground/40 text-muted-foreground"}`}>
            <Activity className="w-3 h-3 mr-1" /> {status === "open" ? "Live" : status}
          </Badge>
        </div>

        {/* KPI strip — one card per agent, last 24h. */}
        {aggregates.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
            {aggregates.map(a => (
              <Card key={a.agent} className="border-border/50">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground truncate">{a.agent}</span>
                    {a.failedCount > 0 ? (
                      <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                    )}
                  </div>
                  <div className="font-serif text-2xl tabular-nums leading-tight">{a.runs24h}</div>
                  <div className="text-[10px] text-muted-foreground">runs / 24h</div>
                  <div className="mt-2 space-y-0.5 text-[10px] font-mono">
                    <div className="flex justify-between"><span className="text-muted-foreground">success</span><span className={a.successRate >= 90 ? "text-emerald-500" : a.successRate >= 70 ? "text-amber-500" : "text-red-500"}>{a.successRate}%</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">avg dur</span><span>{formatDuration(a.avgDurationMs)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">last err</span><span className={a.lastErrorAt ? "text-red-500" : "text-emerald-500"}>{formatRelative(a.lastErrorAt)}</span></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mr-1">agent:</span>
          <button
            type="button"
            onClick={() => setAgentFilter("all")}
            className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${agentFilter === "all" ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
          >all</button>
          {agentChips.map(a => (
            <button
              key={a}
              type="button"
              onClick={() => setAgentFilter(a)}
              className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${agentFilter === a ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
            >{a}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mr-1">show:</span>
          {(["all", "error", "warning", "completion"] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverityFilter(s)}
              className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${severityFilter === s ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
            >{s}</button>
          ))}
        </div>

        {/* Replay controls */}
        <Card className="mb-3 border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                size="sm"
                variant={replayMode ? "default" : "outline"}
                onClick={() => setReplayMode(prev => !prev)}
                className="h-7 text-xs"
              >
                {replayMode ? <><Pause className="w-3 h-3 mr-1" /> Stop replay</> : <><Play className="w-3 h-3 mr-1" /> Replay last hour</>}
              </Button>
              {replayMode && (
                <>
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  <div className="flex-1 min-w-[200px]">
                    <Slider
                      value={[replayCursor]}
                      onValueChange={(v) => setReplayCursor(v[0] ?? 0)}
                      min={0}
                      max={100}
                      step={1}
                    />
                  </div>
                  <span className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">
                    {Math.floor((replayCursor / 100) * replayEvents.length)}/{replayEvents.length} events
                  </span>
                </>
              )}
              {!replayMode && (
                <span className="text-[11px] text-muted-foreground">Live stream ({liveEvents.length} buffered)</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Event list */}
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[420px] overflow-y-auto divide-y divide-border/40">
              {filteredEvents.length === 0 ? (
                <div className="p-6 text-center text-xs italic text-muted-foreground">
                  No events match current filters. Waiting for live activity…
                </div>
              ) : filteredEvents.map((e, i) => {
                const sev = eventSeverity(e);
                const agent = inferAgent(e);
                return (
                  <button
                    key={`${e.timestamp ?? "x"}-${i}`}
                    type="button"
                    onClick={() => setSelectedEvent(e)}
                    className="w-full text-left px-3 py-2 hover:bg-muted/40 transition-colors flex items-start gap-3"
                  >
                    <span className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border ${severityColor(sev)}`}>
                      {sev}
                    </span>
                    <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-muted-foreground w-20 truncate pt-0.5">
                      {agent}
                    </span>
                    <span className="shrink-0 text-[10px] font-mono text-foreground w-32 truncate pt-0.5">
                      {e.type}
                    </span>
                    <span className="flex-1 text-[11px] text-muted-foreground truncate pt-0.5">
                      {e.message ?? e.error ?? e.tool ?? e.phase ?? (e.capability ? `${e.capability}${e.industry ? ` / ${e.industry}` : ""}` : "")}
                    </span>
                    <span className="shrink-0 text-[10px] font-mono text-muted-foreground/70 pt-0.5">
                      {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Event detail dialog */}
      <Dialog open={selectedEvent !== null} onOpenChange={(open) => { if (!open) setSelectedEvent(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{selectedEvent?.type ?? "event"}</DialogTitle>
            <DialogDescription className="text-[11px]">
              Agent: <span className="font-mono">{selectedEvent ? inferAgent(selectedEvent) : ""}</span>
              {selectedEvent?.timestamp && (
                <> · {new Date(selectedEvent.timestamp).toLocaleString()}</>
              )}
              {selectedEvent?.runId !== undefined && (
                <> · run #<span className="font-mono">{selectedEvent.runId}</span></>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-3">
              {selectedEvent.message && (
                <div className="text-sm">{selectedEvent.message}</div>
              )}
              {selectedEvent.error && (
                <div className="text-sm text-red-500 bg-red-500/5 border border-red-500/30 rounded p-2">
                  {selectedEvent.error}
                </div>
              )}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Payload</div>
                <pre className="text-[10px] font-mono bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(selectedEvent, null, 2)}
                </pre>
              </div>
              {selectedEvent.runId !== undefined && (
                <div className="text-[11px] text-muted-foreground italic">
                  Downstream insights produced by this run are tracked in <code>agent_proposals</code> and <code>insights</code> tables — query <code>/api/agent/history?limit=1</code> with this run id for the full join.
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
