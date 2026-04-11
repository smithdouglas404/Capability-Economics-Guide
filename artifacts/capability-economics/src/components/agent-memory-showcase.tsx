import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Brain, Sparkles, Eye, Lightbulb, GitBranch,
  Clock, ChevronRight, Zap, Activity, Database, Wifi, WifiOff, RefreshCw, AlertTriangle,
} from "lucide-react";

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

const typeConfig: Record<string, { icon: typeof Brain; color: string; bg: string; border: string; label: string }> = {
  pattern: { icon: GitBranch, color: "text-indigo-400", bg: "bg-indigo-950/40", border: "border-indigo-800/40", label: "Pattern" },
  observation: { icon: Eye, color: "text-emerald-400", bg: "bg-emerald-950/40", border: "border-emerald-800/40", label: "Observation" },
  insight: { icon: Lightbulb, color: "text-amber-400", bg: "bg-amber-950/40", border: "border-amber-800/40", label: "Insight" },
  decision_context: { icon: Zap, color: "text-purple-400", bg: "bg-purple-950/40", border: "border-purple-800/40", label: "Decision" },
};

function getTypeConfig(type: string) {
  return typeConfig[type] || typeConfig.observation;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AgentMemoryShowcase() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatusData | null>(null);
  const [tools, setTools] = useState<ToolsData | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
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

  const filtered = selectedType ? memories.filter(m => m.type === selectedType) : memories;
  const typeCounts = memories.reduce<Record<string, number>>((acc, m) => {
    acc[m.type] = (acc[m.type] || 0) + 1;
    return acc;
  }, {});

  const mem0Connected = tools?.integrations?.mem0?.connected ?? agentStatus?.memory?.mem0Connected ?? false;
  const perplexityConnected = tools?.integrations?.perplexity?.connected ?? false;
  const lettaConnected = tools?.integrations?.letta?.connected ?? false;

  if (loading) {
    return (
      <section className="py-24 bg-[#0a0e1a] relative overflow-hidden" aria-label="Agent memory — loading">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto flex items-center justify-center py-20">
            <motion.div
              animate={prefersReducedMotion ? {} : { rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              aria-hidden="true"
            >
              <Brain className="w-8 h-8 text-indigo-400" />
            </motion.div>
            <span className="sr-only">Loading agent memory data</span>
          </div>
        </div>
      </section>
    );
  }

  if (error && memories.length === 0) {
    return (
      <section className="py-24 bg-[#0a0e1a] relative overflow-hidden" aria-label="Agent memory — error">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto text-center py-16">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-4" aria-hidden="true" />
            <h3 className="text-lg font-serif text-white mb-2">Unable to Load Agent Memory</h3>
            <p className="text-gray-400 text-sm mb-6">The agent memory service is temporarily unavailable.</p>
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-300 border border-indigo-600/40 bg-indigo-600/10 rounded-sm hover:bg-indigo-600/20 transition-colors"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Retry
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-24 bg-[#0a0e1a] relative overflow-hidden" aria-label="Autonomous agent institutional memory">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.08)_0%,transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(168,85,247,0.05)_0%,transparent_50%)]" />

      <div className="absolute top-20 left-10 w-1 h-20 bg-gradient-to-b from-indigo-500/30 to-transparent" />
      <div className="absolute top-40 right-16 w-1 h-16 bg-gradient-to-b from-purple-500/20 to-transparent" />
      <div className="absolute bottom-20 left-1/4 w-20 h-[1px] bg-gradient-to-r from-indigo-500/20 to-transparent" />

      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="max-w-5xl mx-auto"
        >
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="relative">
                  <Brain className="w-7 h-7 text-indigo-400" aria-hidden="true" />
                  <motion.div
                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full"
                    animate={prefersReducedMotion ? {} : { scale: [1, 1.3, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    aria-hidden="true"
                  />
                </div>
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-400">
                  Autonomous Agent Memory
                </span>
              </div>
              <h2 className="text-3xl md:text-4xl font-serif text-white mb-2">
                Institutional Intelligence
              </h2>
              <p className="text-gray-400 text-base max-w-lg">
                The CEI agent builds persistent memory across research cycles — learning patterns, recording observations, and evolving its decision-making over time.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <IntegrationPill label="Mem0 Cloud" connected={mem0Connected} />
              <IntegrationPill label="Perplexity" connected={perplexityConnected} />
              <IntegrationPill label="Letta" connected={lettaConnected} />
            </div>
          </div>

          {agentStatus?.latestRun && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8"
            >
              <StatCard label="Total Memories" value={agentStatus.memory.totalMemories} icon={Database} color="text-indigo-400" />
              <StatCard label="Recalled Last Run" value={agentStatus.latestRun.memoriesRecalled} icon={Brain} color="text-purple-400" />
              <StatCard label="Stored Last Run" value={agentStatus.latestRun.memoriesStored} icon={Sparkles} color="text-emerald-400" />
              <StatCard label="Perplexity Calls" value={agentStatus.latestRun.perplexityCalls} icon={Activity} color="text-amber-400" />
              <StatCard
                label="CEI Impact"
                value={
                  agentStatus.latestRun.ceiBeforeIndex != null && agentStatus.latestRun.ceiAfterIndex != null
                    ? `${agentStatus.latestRun.ceiBeforeIndex} → ${agentStatus.latestRun.ceiAfterIndex}`
                    : "—"
                }
                icon={Zap}
                color="text-cyan-400"
              />
            </motion.div>
          )}

          <div className="flex flex-wrap items-center gap-2 mb-6">
            <FilterChip
              label="All"
              count={memories.length}
              active={selectedType === null}
              onClick={() => setSelectedType(null)}
            />
            {Object.entries(typeCounts).map(([type, count]) => {
              const cfg = getTypeConfig(type);
              return (
                <FilterChip
                  key={type}
                  label={cfg.label}
                  count={count}
                  active={selectedType === type}
                  onClick={() => setSelectedType(selectedType === type ? null : type)}
                  colorClass={cfg.color}
                />
              );
            })}
          </div>

          <div className="rounded-sm border border-gray-800/60 bg-[#0d1117] overflow-hidden">
            <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-4 px-4 py-2.5 border-b border-gray-800/60 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-500">
              <div className="w-20">Type</div>
              <div>Memory Content</div>
              <div className="w-16 text-center hidden md:block">Source</div>
              <div className="w-20 text-right hidden md:block">Age</div>
            </div>

            <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-800/40">
              <AnimatePresence mode="popLayout">
                {filtered.length === 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="py-12 text-center text-gray-500"
                  >
                    <Brain className="w-8 h-8 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No memories yet. Trigger an agent run to start building institutional intelligence.</p>
                  </motion.div>
                )}
                {filtered.map((memory, i) => (
                  <MemoryRow
                    key={memory.id}
                    memory={memory}
                    index={i}
                    expanded={expandedId === memory.id}
                    onToggle={() => setExpandedId(expandedId === memory.id ? null : memory.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>

          {agentStatus?.latestRun?.completedAt && (
            <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Last agent cycle: {timeAgo(agentStatus.latestRun.completedAt)}
              </div>
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                {agentStatus.scheduler.active ? `Auto-running every ${agentStatus.scheduler.intervalMinutes}min` : "Scheduler paused"}
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
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${
      connected
        ? "border-emerald-800/50 bg-emerald-950/30 text-emerald-400"
        : "border-gray-700/50 bg-gray-900/30 text-gray-500"
    }`}>
      {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
      {label}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: typeof Brain; color: string }) {
  return (
    <div className="bg-[#0d1117] border border-gray-800/60 rounded-sm p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className="text-xl font-mono font-bold text-white">{value}</div>
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
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium transition-all ${
        active
          ? "bg-indigo-600/20 text-indigo-300 border border-indigo-600/40"
          : "bg-gray-900/50 text-gray-400 border border-gray-800/40 hover:border-gray-700/60 hover:text-gray-300"
      }`}
    >
      <span className={colorClass}>{label}</span>
      <span className={`text-[10px] font-mono ${active ? "text-indigo-400" : "text-gray-600"}`}>{count}</span>
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
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ delay: index * 0.03, duration: 0.2 }}
      layout
    >
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="w-full grid grid-cols-[auto_1fr_auto_auto] gap-x-4 px-4 py-3 text-left hover:bg-gray-800/20 transition-colors group"
      >
        <div className="w-20">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider ${cfg.bg} ${cfg.color} ${cfg.border} border`}>
            <Icon className="w-3 h-3" aria-hidden="true" />
            {cfg.label}
          </span>
        </div>
        <div className="min-w-0">
          <p className={`text-sm text-gray-300 ${expanded ? "" : "line-clamp-1"}`}>
            {memory.content}
          </p>
        </div>
        <div className="w-16 text-center hidden md:flex items-center justify-center">
          {memory.source === "mem0" ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-indigo-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              cloud
            </span>
          ) : (
            <span className="text-[10px] text-gray-600 font-mono">local</span>
          )}
        </div>
        <div className="w-20 text-right hidden md:flex items-center justify-end">
          <span className="text-[11px] text-gray-500 font-mono">{timeAgo(memory.createdAt)}</span>
          <ChevronRight className={`w-3.5 h-3.5 text-gray-600 ml-1 transition-transform ${expanded ? "rotate-90" : ""} group-hover:text-gray-400`} />
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
            <div className="px-4 pb-3 ml-20">
              <div className="bg-gray-900/50 border border-gray-800/40 rounded-sm p-3">
                <p className="text-sm text-gray-300 mb-3 leading-relaxed">{memory.content}</p>
                {Object.keys(memory.metadata).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(memory.metadata)
                      .filter(([k]) => !["mem0Id", "source"].includes(k))
                      .map(([key, value]) => (
                        <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] bg-gray-800/50 text-gray-400 border border-gray-700/30 font-mono">
                          <span className="text-gray-500">{key}:</span>
                          <span className="text-gray-300">{typeof value === "number" ? (Number.isInteger(value) ? value : value.toFixed(2)) : String(value)}</span>
                        </span>
                      ))}
                  </div>
                )}
                <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
                  <span>Source: {memory.source === "mem0" ? "Mem0 Cloud" : "Local DB"}</span>
                  <span>Relevance: {memory.relevanceScore.toFixed(2)}</span>
                  <span>Accessed: {memory.accessCount}x</span>
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
