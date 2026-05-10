import { useState, useEffect, useCallback, useRef, useId } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Brain, Eye, Lightbulb, GitBranch, Clock, ChevronRight,
  Zap, Activity, Database, Wifi, WifiOff, RefreshCw, AlertTriangle, Sparkles, HelpCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const API_BASE = "/api";

interface MemoryItem {
  id: string | number;
  type: string;
  content: string;
  metadata: Record<string, unknown>;
  relevanceScore: number;
  accessCount: number;
  createdAt: string;
  source: "mem0" | "local";
}

interface AgentStatusData {
  scheduler: { active: boolean; isRunning: boolean; intervalMinutes: number; lastRunAt: string | null };
  latestRun: {
    id: number;
    status: string;
    memoriesRecalled: number;
    memoriesStored: number;
    capabilitiesResearched: number;
    perplexityCalls: number;
    ceiBeforeIndex: number | null;
    ceiAfterIndex: number | null;
    completedAt: string | null;
  } | null;
  memory: { totalMemories: number; byType: Record<string, number>; mem0Connected: boolean };
}

interface ToolsData {
  integrations: {
    mem0: { connected: boolean };
    perplexity: { connected: boolean };
    letta: { connected: boolean };
  };
}

const typeConfig: Record<string, { icon: typeof Brain; colorClass: string; bgClass: string; borderClass: string; label: string }> = {
  pattern:          { icon: GitBranch, colorClass: "text-primary",            bgClass: "bg-primary/5",        borderClass: "border-primary/20",        label: "Pattern" },
  observation:      { icon: Eye,       colorClass: "text-foreground",         bgClass: "bg-muted/50",         borderClass: "border-border",            label: "Observation" },
  insight:          { icon: Lightbulb, colorClass: "text-accent-foreground",  bgClass: "bg-accent/20",        borderClass: "border-accent/30",         label: "Insight" },
  decision_context: { icon: Zap,       colorClass: "text-muted-foreground",   bgClass: "bg-muted/30",         borderClass: "border-border",            label: "Decision" },
};

function getTypeConfig(type: string) {
  return typeConfig[type] ?? typeConfig.observation;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const HISTORY_KEY = "agent_stat_history_v1";
const MAX_HISTORY = 10;

function loadHistory(): Record<string, number[]> {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}"); } catch { return {}; }
}
function saveHistory(h: Record<string, number[]>) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch { /* ignore */ }
}
function pushHistory(h: Record<string, number[]>, key: string, val: number): number[] {
  const arr = [...(h[key] ?? []), val].slice(-MAX_HISTORY);
  h[key] = arr;
  return arr;
}

export default function AgentMemoryShowcase() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatusData | null>(null);
  const [tools, setTools] = useState<ToolsData | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statHistory, setStatHistory] = useState<Record<string, number[]>>(loadHistory);
  const lastRunIdRef = useRef<number | null>(null);
  const prefersReducedMotion = useReducedMotion();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [memRes, statusRes, toolsRes] = await Promise.all([
        fetch(`${API_BASE}/agent/memories?limit=50`),
        fetch(`${API_BASE}/agent/status`),
        fetch(`${API_BASE}/agent/tools`),
      ]);
      let anySuccess = false;
      if (memRes.ok) { setMemories(await memRes.json()); anySuccess = true; }
      if (statusRes.ok) { setAgentStatus(await statusRes.json()); anySuccess = true; }
      if (toolsRes.ok) { setTools(await toolsRes.json()); anySuccess = true; }
      if (!anySuccess) setError(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!agentStatus) return;
    const run = agentStatus.latestRun;
    if (!run) return;
    if (lastRunIdRef.current === run.id) return;
    lastRunIdRef.current = run.id;
    setStatHistory(prev => {
      const h = { ...prev };
      pushHistory(h, "totalMemories", agentStatus.memory.totalMemories);
      pushHistory(h, "recalled", run.memoriesRecalled);
      pushHistory(h, "stored", run.memoriesStored);
      pushHistory(h, "perplexity", run.perplexityCalls);
      if (run.ceiAfterIndex != null) pushHistory(h, "ceiAfter", run.ceiAfterIndex);
      saveHistory(h);
      return h;
    });
  }, [agentStatus]);

  const filtered = selectedType ? memories.filter(m => m.type === selectedType) : memories;
  const typeCounts = memories.reduce<Record<string, number>>((acc, m) => {
    acc[m.type] = (acc[m.type] ?? 0) + 1;
    return acc;
  }, {});

  const mem0Connected = tools?.integrations?.mem0?.connected ?? agentStatus?.memory?.mem0Connected ?? false;
  const perplexityConnected = tools?.integrations?.perplexity?.connected ?? false;
  const lettaConnected = tools?.integrations?.letta?.connected ?? false;

  return (
    <section className="py-24 bg-muted/10 border-t border-border/40" aria-label="Autonomous agent institutional memory">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="max-w-5xl mx-auto"
        >
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
            <div>
              <div className="inline-flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Autonomous Agent Memory</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-serif tracking-tight mb-2 text-foreground">
                Institutional Intelligence
              </h2>
              <p className="text-foreground/60 font-serif italic text-base max-w-lg">
                The CEI agent builds persistent memory across research cycles — learning patterns, recording observations, and evolving its decision-making over time.
              </p>
            </div>

            {/* Integration status */}
            <div className="flex items-center gap-2 flex-wrap">
              <IntegrationPill label="Mem0 Cloud" connected={mem0Connected} />
              <IntegrationPill label="Perplexity" connected={perplexityConnected} />
              <IntegrationPill label="Letta" connected={lettaConnected} />
            </div>
          </div>

          {/* Error state */}
          {error && memories.length === 0 && (
            <div className="flex flex-col items-center py-12 text-center">
              <AlertTriangle className="w-8 h-8 text-muted-foreground mb-3" aria-hidden="true" />
              <p className="text-sm text-muted-foreground mb-4">Unable to load agent memory data.</p>
              <button
                onClick={fetchData}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-input bg-background rounded-sm hover:bg-accent transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                Retry
              </button>
            </div>
          )}

          {/* Stat cards — only when agent has run */}
          {!loading && !error && agentStatus?.latestRun && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
              <StatCard
                label="Total Memories"
                value={agentStatus.memory.totalMemories}
                icon={Database}
                colorClass="text-primary"
                history={statHistory.totalMemories}
                tooltip="All knowledge retained by the agent across every research cycle. Grows over time as the agent learns new patterns and records observations."
              />
              <StatCard
                label="Context Retrieved"
                value={agentStatus.latestRun.memoriesRecalled}
                icon={Brain}
                colorClass="text-muted-foreground"
                history={statHistory.recalled}
                tooltip="Relevant memories the agent pulled from its knowledge store at the start of this run. Higher recall means the agent had richer context to guide its research."
              />
              <StatCard
                label="Stored Last Run"
                value={agentStatus.latestRun.memoriesStored}
                icon={Sparkles}
                colorClass="text-primary"
                history={statHistory.stored}
                tooltip="New learnings written to memory after this run — patterns detected, observations recorded, and decision context saved for future research cycles."
              />
              <StatCard
                label="Perplexity Calls"
                value={agentStatus.latestRun.perplexityCalls}
                icon={Activity}
                colorClass="text-foreground"
                history={statHistory.perplexity}
                tooltip="Real-time web research queries made during this run. Each call grounds the agent's analysis in live market data and current industry benchmarks."
              />
              <StatCard
                label="CEI Impact"
                value={
                  agentStatus.latestRun.ceiBeforeIndex != null && agentStatus.latestRun.ceiAfterIndex != null
                    ? `${agentStatus.latestRun.ceiBeforeIndex}→${agentStatus.latestRun.ceiAfterIndex}`
                    : "—"
                }
                icon={Zap}
                colorClass="text-primary"
                history={statHistory.ceiAfter}
                tooltip="Capability Economics Index before and after this run. Shows how the agent's research shifted the overall assessment — a rising number means improving competitive positioning."
              />
            </div>
          )}

          {/* Main memory card */}
          {!error && (
            <Card className="rounded-none">
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="font-serif text-lg flex items-center gap-2">
                      <Brain className="w-5 h-5 text-primary" aria-hidden="true" />
                      Agent Memory Store
                    </CardTitle>
                    <CardDescription>
                      {loading ? "Loading memories…" : `${memories.length} memories accumulated across research cycles`}
                    </CardDescription>
                  </div>

                  {/* Filter chips */}
                  {!loading && memories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <FilterChip
                        label="All"
                        count={memories.length}
                        active={selectedType === null}
                        onClick={() => setSelectedType(null)}
                      />
                      {Object.entries(typeCounts).map(([type, count]) => (
                        <FilterChip
                          key={type}
                          label={getTypeConfig(type).label}
                          count={count}
                          active={selectedType === type}
                          onClick={() => setSelectedType(selectedType === type ? null : type)}
                          colorClass={getTypeConfig(type).colorClass}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <motion.div
                      animate={prefersReducedMotion ? {} : { rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      aria-hidden="true"
                    >
                      <Brain className="w-6 h-6 text-primary/40" />
                    </motion.div>
                    <span className="sr-only">Loading agent memory data</span>
                  </div>
                ) : (
                  <>
                    {/* Table header */}
                    <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-4 px-6 py-2.5 border-t border-b bg-muted/30 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      <div className="w-24">Type</div>
                      <div>Memory Content</div>
                      <div className="w-16 text-center hidden md:block">Source</div>
                      <div className="w-16 text-right hidden md:block">Age</div>
                    </div>

                    {/* Memory rows */}
                    <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
                      <AnimatePresence mode="popLayout">
                        {filtered.length === 0 ? (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="py-12 text-center text-muted-foreground"
                          >
                            <Brain className="w-7 h-7 mx-auto mb-3 opacity-30" aria-hidden="true" />
                            <p className="text-sm">No memories yet. Trigger an agent run from the CEI Dashboard to start building institutional intelligence.</p>
                          </motion.div>
                        ) : (
                          filtered.map((memory, i) => (
                            <MemoryRow
                              key={memory.id}
                              memory={memory}
                              index={i}
                              expanded={expandedId === memory.id}
                              onToggle={() => setExpandedId(expandedId === memory.id ? null : memory.id)}
                            />
                          ))
                        )}
                      </AnimatePresence>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Footer meta */}
          {!loading && !error && agentStatus?.latestRun?.completedAt && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                Last cycle: {timeAgo(agentStatus.latestRun.completedAt)}
              </div>
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" aria-hidden="true" />
                {agentStatus.scheduler.active
                  ? `Auto-runs every ${agentStatus.scheduler.intervalMinutes}min`
                  : "Scheduler paused"}
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}

function IntegrationPill({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] font-semibold uppercase tracking-wider border ${
      connected
        ? "border-primary/30 bg-primary/10 text-primary"
        : "border-border bg-background text-muted-foreground"
    }`}>
      {connected
        ? <Wifi className="w-3 h-3" aria-hidden="true" />
        : <WifiOff className="w-3 h-3" aria-hidden="true" />}
      {label}
    </div>
  );
}

function Sparkline({ data, trend }: { data: number[]; trend: "up" | "down" | "flat" }) {
  // Unique gradient ID per Sparkline instance — multiple SVGs on the same page
  // sharing a `defs` id cause browsers to reference the first match, which
  // breaks rendering when colors diverge.
  const gradientId = useId();
  if (data.length < 2) return null;
  const W = 64, H = 20;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 2) - 1}`
  ).join(" ");
  const strokeColor = trend === "up" ? "hsl(var(--primary))" : trend === "down" ? "hsl(0 72% 51%)" : "hsl(var(--muted-foreground))";
  const fillId = `sf-${gradientId}`;
  const lastX = W;
  const lastY = H - ((data[data.length - 1]! - min) / range) * (H - 2) - 1;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`${pts} ${lastX},${H} 0,${H}`}
        fill={`url(#${fillId})`}
        stroke="none"
      />
      <polyline
        points={pts}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r="2" fill={strokeColor} />
    </svg>
  );
}

function StatCard({ label, value, icon: Icon, colorClass, history, tooltip }: {
  label: string;
  value: string | number;
  icon: typeof Brain;
  colorClass: string;
  history?: number[];
  tooltip?: string;
}) {
  const [showTip, setShowTip] = useState(false);
  const data = history ?? [];
  const trend: "up" | "down" | "flat" =
    data.length >= 2
      ? data[data.length - 1] > data[0] ? "up"
      : data[data.length - 1] < data[0] ? "down"
      : "flat"
    : "flat";

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      onFocus={() => setShowTip(true)}
      onBlur={() => setShowTip(false)}
    >
      <Card className="rounded-none">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Icon className={`w-3.5 h-3.5 ${colorClass}`} aria-hidden="true" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
            </div>
            {tooltip && (
              <HelpCircle className="w-3 h-3 text-muted-foreground/50 shrink-0" aria-hidden="true" />
            )}
          </div>
          <div className="text-2xl font-mono font-bold text-foreground">{value}</div>
          {data.length >= 2 && (
            <div className="mt-2">
              <Sparkline data={data} trend={trend} />
            </div>
          )}
        </CardContent>
      </Card>
      {showTip && tooltip && (
        <div
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-56 rounded-sm border border-border bg-popover px-3 py-2 shadow-md text-[11px] text-popover-foreground leading-relaxed pointer-events-none"
        >
          <div className="font-semibold text-foreground mb-0.5">{label}</div>
          {tooltip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, count, active, onClick, colorClass }: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  colorClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium border transition-colors ${
        active
          ? "border-primary/30 bg-primary/5 text-primary"
          : "border-border bg-background text-muted-foreground hover:border-primary/20 hover:text-foreground"
      }`}
    >
      <span className={active ? "" : colorClass}>{label}</span>
      <span className="text-[10px] font-mono text-muted-foreground">{count}</span>
    </button>
  );
}

function MemoryRow({ memory, index, expanded, onToggle }: {
  memory: MemoryItem;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cfg = getTypeConfig(memory.type);
  const Icon = cfg.icon;
  const detailsId = `memory-details-${memory.id}`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: index * 0.02, duration: 0.2 }}
      layout
    >
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="w-full grid grid-cols-[auto_1fr_auto_auto] gap-x-4 px-6 py-3 text-left hover:bg-muted/30 transition-colors group"
      >
        <div className="w-24">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border ${cfg.bgClass} ${cfg.colorClass} ${cfg.borderClass}`}>
            <Icon className="w-3 h-3" aria-hidden="true" />
            {cfg.label}
          </span>
        </div>
        <div className="min-w-0">
          <p className={`text-sm text-foreground ${expanded ? "" : "line-clamp-1"}`}>
            {memory.content}
          </p>
        </div>
        <div className="w-16 text-center hidden md:flex items-center justify-center">
          {memory.source === "mem0" ? (
            <span className="text-[10px] text-primary font-semibold">cloud</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">local</span>
          )}
        </div>
        <div className="w-16 text-right hidden md:flex items-center justify-end gap-1">
          <span className="text-[11px] text-muted-foreground font-mono">{timeAgo(memory.createdAt)}</span>
          <ChevronRight
            className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform ${expanded ? "rotate-90" : ""} group-hover:text-muted-foreground`}
            aria-hidden="true"
          />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            id={detailsId}
            role="region"
            aria-label={`Details for ${cfg.label} memory`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-4 ml-24">
              <div className="bg-muted/40 border border-border rounded-sm p-3">
                <p className="text-sm text-foreground leading-relaxed mb-3">{memory.content}</p>
                {Object.keys(memory.metadata).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {Object.entries(memory.metadata)
                      .filter(([k]) => !["mem0Id", "source"].includes(k))
                      .map(([key, value]) => (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] bg-background text-muted-foreground border border-border font-mono"
                        >
                          <span className="text-muted-foreground/60">{key}:</span>
                          <span className="text-foreground">
                            {typeof value === "number"
                              ? Number.isInteger(value) ? value : value.toFixed(2)
                              : String(value)}
                          </span>
                        </span>
                      ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
                  <span>Source: {memory.source === "mem0" ? "Mem0 Cloud" : "Local DB"}</span>
                  <span>Relevance: {memory.relevanceScore.toFixed(2)}</span>
                  <span>Accessed: {memory.accessCount}×</span>
                  <span>{new Date(memory.createdAt).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
