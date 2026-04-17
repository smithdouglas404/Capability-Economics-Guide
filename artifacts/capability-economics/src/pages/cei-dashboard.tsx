import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity, TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, Info,
  ArrowUpRight, ArrowDownRight, BarChart3, Zap, Shield, ChevronDown, ChevronUp,
  Globe, BookOpen, Bot, Brain, Eye, SkipForward, Search, Database, Clock,
  AlertTriangle, Plus, X, Sparkles, Trash2,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";

const API_BASE = "/api";

interface IndustryBreakdown {
  industryName: string;
  indexValue: number;
  weight: number;
  velocity: number;
  capabilityCount: number;
  topMover: string;
  topMoverDelta: number;
}

interface CEIData {
  overallIndex: number;
  industryBreakdowns: Record<string, IndustryBreakdown>;
  marketSentiment: number;
  volatility: number;
  methodology: string;
  timestamp: string;
}

interface CEIHistory {
  overallIndex: number;
  timestamp: string;
}

interface FreshnessSummary {
  total: number;
  refreshedLast24h: number;
  refreshedLast7d: number;
  stale7dPlus: number;
  neverRefreshed: number;
}
interface FreshnessItem {
  capabilityId: number;
  capability: string;
  industry: string;
  industryId: number;
  lastTriangulatedAt: string | null;
  ageHours: number | null;
  sourceCount: number;
  consensusScore: number | null;
  confidence: number | null;
  velocity: number | null;
}
interface FreshnessResponse {
  summary: FreshnessSummary;
  formula: { marketSentiment: string; consensusScore: string; velocity: string };
  capabilities: FreshnessItem[];
}

interface MacroEvent {
  id: number;
  eventType: string;
  severity: number;
  title: string;
  description: string;
  affectedIndustryIds: number[];
  affectedCapabilityIds: number[] | null;
  sentimentDirection: "positive" | "negative" | "neutral";
  startedAt: string;
  decayDays: number;
  source: string;
  citations: string[] | null;
}
interface CatalogTemplate {
  key: string;
  title: string;
  description: string;
  eventType: "war" | "regulation" | "tech_shift" | "economic" | "disaster" | "other";
  severity: number;
  sentimentDirection: "positive" | "negative" | "neutral";
  decayDays: number;
  rationale: string;
  citations?: string[];
  affectedIndustryIds: number[];
  affectedCapabilityIds: number[];
  affectedIndustryNames: string[];
  affectedCapabilityNames: string[];
  unresolvedSlugs: string[];
}
interface CatalogResponse { templates: CatalogTemplate[]; total: number; }
interface CapabilityListItem { id: number; name: string; slug: string; industryId: number; }
interface MacroShock {
  sentimentShock: number;
  volatilityBoost: number;
  contributingEvents: Array<{ id: number; title: string; severity: number; decayFactor: number; direction: string }>;
}
interface MacroEventsResponse {
  active: MacroEvent[];
  shock: MacroShock;
  summary: { total: number; avgSeverity: number; sentimentShock: number; volatilityBoost: number };
}
interface IndustryListItem { id: number; name: string; slug: string; }

interface AgentStatus {
  scheduler: {
    active: boolean;
    isRunning: boolean;
    intervalMinutes: number;
    lastRunAt: string | null;
  };
  latestRun: {
    id: number;
    status: string;
    trigger: string;
    industriesEvaluated: number;
    capabilitiesResearched: number;
    capabilitiesSkipped: number;
    perplexityCalls: number;
    memoriesRecalled: number;
    memoriesStored: number;
    ceiBeforeIndex: number | null;
    ceiAfterIndex: number | null;
    startedAt: string;
    completedAt: string | null;
    errorMessage: string | null;
  } | null;
  memory: {
    totalMemories: number;
    byType: Record<string, number>;
  };
  connectedClients: number;
}

interface AgentSSEEvent {
  type: string;
  timestamp: string;
  phase?: string;
  message?: string;
  capability?: string;
  industry?: string;
  runId?: number;
  overallIndex?: number;
  researched?: number;
  skipped?: number;
}

function useAgentEvents() {
  const [events, setEvents] = useState<AgentSSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/agent/events`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AgentSSEEvent;
        if (event.type === "connected") {
          setConnected(true);
          return;
        }
        setEvents(prev => [event, ...prev].slice(0, 50));
      } catch {}
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  return { events, connected };
}

function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const hasDataRef = useRef(false);
  const refetch = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true);
    try {
      const res = await fetch(url);
      const json = await res.json();
      setData(json);
      hasDataRef.current = true;
    } catch (e) {
      console.error("API error:", e);
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, refetch };
}

function IndexTicker({ value, label, trend, size = "lg" }: {
  value: number | string;
  label: string;
  trend?: "up" | "down" | "neutral";
  size?: "lg" | "sm";
}) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-slate-400";

  return (
    <div className="text-center">
      <div className={`font-mono font-bold tracking-tight ${size === "lg" ? "text-6xl md:text-7xl" : "text-2xl"} text-white`}>
        {typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : value}
      </div>
      <div className="flex items-center justify-center gap-1.5 mt-1">
        {trend && <TrendIcon className={`w-4 h-4 ${trendColor}`} />}
        <span className="text-sm text-slate-400 uppercase tracking-wider">{label}</span>
      </div>
    </div>
  );
}

function SentimentGauge({ value }: { value: number }) {
  const angle = ((value - 50) / 50) * 90;
  const color = value > 55 ? "#10b981" : value < 45 ? "#ef4444" : "#f59e0b";
  const label = value > 55 ? "Bullish" : value < 45 ? "Bearish" : "Neutral";

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" className="w-48 h-28">
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeGrad)" strokeWidth="12" strokeLinecap="round" opacity="0.3" />
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeGrad)" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * 251.2} 251.2`}
        />
        <line
          x1="100" y1="100"
          x2={100 + 60 * Math.cos((180 + angle + 90) * Math.PI / 180)}
          y2={100 + 60 * Math.sin((180 + angle + 90) * Math.PI / 180)}
          stroke={color} strokeWidth="3" strokeLinecap="round"
        />
        <circle cx="100" cy="100" r="6" fill={color} />
        <text x="100" y="85" textAnchor="middle" fill="white" fontSize="20" fontWeight="bold" fontFamily="monospace">
          {value.toFixed(1)}
        </text>
      </svg>
      <span className="text-xs uppercase tracking-wider mt-1" style={{ color }}>{label}</span>
    </div>
  );
}

function MiniSparkline({ data, height = 40 }: { data: number[]; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 120;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });

  const trend = data[data.length - 1] >= data[0];
  const color = trend ? "#10b981" : "#ef4444";

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }}>
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={points[points.length - 1].split(",")[0]} cy={points[points.length - 1].split(",")[1]} r="3" fill={color} />
    </svg>
  );
}

function AgentEventIcon({ type }: { type: string }) {
  switch (type) {
    case "phase": return <Eye className="w-3.5 h-3.5 text-indigo-400" />;
    case "research": return <Search className="w-3.5 h-3.5 text-amber-400" />;
    case "cei_updated": return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
    case "cycle_complete": return <Activity className="w-3.5 h-3.5 text-green-400" />;
    case "error": return <Info className="w-3.5 h-3.5 text-red-400" />;
    default: return <Bot className="w-3.5 h-3.5 text-slate-400" />;
  }
}

function formatEventMessage(event: AgentSSEEvent): string {
  if (event.message) return event.message;
  if (event.type === "research") return `Researching ${event.capability} in ${event.industry}`;
  if (event.type === "cei_updated") return `CEI updated to ${event.overallIndex}`;
  if (event.type === "cycle_complete") return `Cycle complete: ${event.researched} researched, ${event.skipped} skipped`;
  if (event.type === "run_started") return `Agent run #${event.runId} started`;
  return event.type;
}

export default function CEIDashboard() {
  const { data: cei, loading: loadingCei, refetch: refetchCei } = useApi<CEIData>(`${API_BASE}/cei/current`);
  const { data: history } = useApi<CEIHistory[]>(`${API_BASE}/cei/history?limit=30`);
  const { data: agentStatus, refetch: refetchAgent } = useApi<AgentStatus>(`${API_BASE}/agent/status`);
  const { data: freshness, refetch: refetchFreshness } = useApi<FreshnessResponse>(`${API_BASE}/cei/freshness`);
  const { data: macroEvents, refetch: refetchMacroEvents } = useApi<MacroEventsResponse>(`${API_BASE}/macro-events/active`);
  const { data: industryList } = useApi<IndustryListItem[]>(`${API_BASE}/industries`);
  const { data: capabilityList } = useApi<CapabilityListItem[]>(`${API_BASE}/capabilities`);
  const { data: catalogData } = useApi<CatalogResponse>(`${API_BASE}/macro-events/catalog`);
  const [showFreshness, setShowFreshness] = useState(true);
  const [showMacroPanel, setShowMacroPanel] = useState(true);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [eventForm, setEventForm] = useState({
    eventType: "war" as "war" | "regulation" | "tech_shift" | "economic" | "disaster" | "other",
    severity: 7,
    title: "",
    description: "",
    sentimentDirection: "negative" as "positive" | "negative" | "neutral",
    decayDays: 14,
    affectedIndustryIds: [] as number[],
    affectedCapabilityIds: [] as number[],
    source: "admin" as string,
  });
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem("ce_admin_key") || "");
  const [submittingEvent, setSubmittingEvent] = useState(false);
  const [scanningWorld, setScanningWorld] = useState(false);

  const submitEvent = useCallback(async () => {
    if (!eventForm.title.trim()) { alert("Title required"); return; }
    setSubmittingEvent(true);
    try {
      const res = await fetch(`${API_BASE}/macro-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
        body: JSON.stringify(eventForm),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }
      setShowAddEvent(false);
      setEventForm({ ...eventForm, title: "", description: "", affectedIndustryIds: [], affectedCapabilityIds: [], source: "admin" });
      await Promise.all([refetchMacroEvents(), refetchCei()]);
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmittingEvent(false);
    }
  }, [eventForm, adminKey, refetchMacroEvents, refetchCei]);

  const deleteEvent = useCallback(async (id: number) => {
    if (!confirm("Delete this macro event? CEI will recompute without its shock.")) return;
    try {
      const res = await fetch(`${API_BASE}/macro-events/${id}`, {
        method: "DELETE",
        headers: { "X-Admin-Key": adminKey },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }
      await Promise.all([refetchMacroEvents(), refetchCei()]);
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [adminKey, refetchMacroEvents, refetchCei]);

  const triggerWorldScan = useCallback(async () => {
    setScanningWorld(true);
    try {
      const res = await fetch(`${API_BASE}/macro-events/scan-now`, {
        method: "POST",
        headers: { "X-Admin-Key": adminKey },
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }
      const data = await res.json();
      await Promise.all([refetchMacroEvents(), refetchCei()]);
      alert(`World scan complete: ${data.totalInserted} events ingested across ${data.perIndustry.length} industries.`);
    } catch (err) {
      alert(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScanningWorld(false);
    }
  }, [adminKey, refetchMacroEvents, refetchCei]);
  const { events: agentEvents, connected: sseConnected } = useAgentEvents();
  const [showMethodology, setShowMethodology] = useState(false);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [showAgentActivity, setShowAgentActivity] = useState(true);

  useEffect(() => {
    const cycleEvent = agentEvents.find(e => e.type === "cei_updated" || e.type === "cycle_complete");
    if (cycleEvent) {
      refetchCei();
      refetchAgent();
    }
  }, [agentEvents, refetchCei, refetchAgent]);

  if (loadingCei && !cei) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Computing Capability Economics Index...</p>
        </div>
      </div>
    );
  }

  if (!cei) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <p className="text-muted-foreground">Unable to load CEI data.</p>
      </div>
    );
  }

  const industries = Object.entries(cei.industryBreakdowns).sort((a, b) => b[1].indexValue - a[1].indexValue);
  const historyData = history ? [...history].reverse().map(h => ({
    time: new Date(h.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    index: h.overallIndex,
  })) : [];

  const radarData = industries.map(([, ind]) => ({
    industry: ind.industryName.replace("Banking & Financial Services", "Banking").replace("Manufacturing", "Mfg"),
    value: ind.indexValue,
    fullName: ind.industryName,
  }));

  const indexLevel = cei.overallIndex >= 500 ? "Advanced" : cei.overallIndex >= 300 ? "Developing" : "Nascent";
  const indexColor = cei.overallIndex >= 500 ? "#10b981" : cei.overallIndex >= 300 ? "#f59e0b" : "#ef4444";

  return (
    <div className="min-h-screen">
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white">
        <div className="container mx-auto px-4 py-12 md:py-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex items-center justify-between mb-8">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-5 h-5 text-indigo-400" />
                  <span className="text-xs uppercase tracking-widest text-indigo-400 font-medium">Live Index</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <h1 className="text-3xl md:text-4xl font-serif font-bold tracking-tight">
                  Capability Economics Index
                </h1>
                <p className="text-slate-400 mt-1 max-w-xl">
                  The world's first composite index measuring organizational capability maturity across industries — powered by multi-source Bayesian triangulation.
                </p>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium border border-slate-600 text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Autonomous
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-8 items-center">
              <div className="md:col-span-1 flex flex-col items-center">
                <div className="relative">
                  <div className="absolute -inset-8 rounded-full opacity-20" style={{ background: `radial-gradient(circle, ${indexColor}40, transparent)` }} />
                  <IndexTicker value={cei.overallIndex} label="CEI Index" trend={cei.marketSentiment > 50 ? "up" : cei.marketSentiment < 50 ? "down" : "neutral"} />
                </div>
                <div className="mt-3 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider" style={{ background: `${indexColor}20`, color: indexColor }}>
                  {indexLevel} Maturity
                </div>
                <div className="text-xs text-slate-500 mt-2">
                  Updated {new Date(cei.timestamp).toLocaleString()}
                </div>
              </div>

              <div className="md:col-span-1 flex flex-col items-center gap-4">
                <SentimentGauge value={cei.marketSentiment} />
                <div className="text-center">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Market Sentiment</div>
                  <div className="text-sm text-slate-300">Based on aggregate capability velocity across all industries</div>
                  <div className="text-[10px] text-slate-500 mt-1 font-mono">
                    sentiment = 50 + avgVelocity × 100
                  </div>
                </div>
              </div>

              <div className="md:col-span-1 space-y-4">
                <div className="bg-white/5 backdrop-blur rounded-lg p-4 border border-white/10">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wider">Volatility</span>
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="text-2xl font-mono font-bold">{(cei.volatility * 100).toFixed(1)}%</div>
                  <div className="text-xs text-slate-500 mt-1">Capability change dispersion</div>
                </div>
                <div className="bg-white/5 backdrop-blur rounded-lg p-4 border border-white/10">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wider">Industries Tracked</span>
                    <Globe className="w-3.5 h-3.5 text-indigo-400" />
                  </div>
                  <div className="text-2xl font-mono font-bold">{industries.length}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {Object.values(cei.industryBreakdowns).reduce((s, i) => s + i.capabilityCount, 0)} capabilities monitored
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="container mx-auto px-4 -mt-6">
        {/* Macro Disruptions Panel */}
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="mb-4"
          >
            <Card className={`rounded-none border-2 ${
              (macroEvents?.summary.total ?? 0) > 0
                ? "border-red-400 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/10"
                : "border-slate-300 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/10"
            }`}>
              <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowMacroPanel(!showMacroPanel)}>
                <CardTitle className="font-serif text-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`w-5 h-5 ${(macroEvents?.summary.total ?? 0) > 0 ? "text-red-600" : "text-slate-500"}`} />
                    Active Macro Disruptions
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      (macroEvents?.summary.total ?? 0) === 0 ? "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      : (macroEvents?.summary.avgSeverity ?? 0) >= 7 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                    }`}>
                      {macroEvents?.summary.total ?? 0} active
                    </span>
                    {macroEvents && macroEvents.summary.sentimentShock !== 0 && (
                      <span className={`text-xs font-mono ${macroEvents.summary.sentimentShock < 0 ? "text-red-600" : "text-emerald-600"}`}>
                        sentiment shock: {macroEvents.summary.sentimentShock > 0 ? "+" : ""}{macroEvents.summary.sentimentShock}
                      </span>
                    )}
                  </div>
                  {showMacroPanel ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </CardTitle>
                <CardDescription>
                  Real-world events (war, regulation, paradigm shifts) that perturb market sentiment & volatility. Each event decays linearly over its window.
                </CardDescription>
              </CardHeader>
              <AnimatePresence>
                {showMacroPanel && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <input
                          type="password"
                          placeholder="Admin key (saved locally)"
                          value={adminKey}
                          onChange={(e) => { setAdminKey(e.target.value); localStorage.setItem("ce_admin_key", e.target.value); }}
                          className="px-2 py-1 text-xs border border-border rounded-sm bg-background w-48"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowAddEvent(!showAddEvent)}
                          className="rounded-none text-xs h-7"
                        >
                          {showAddEvent ? <><X className="w-3 h-3 mr-1" /> Cancel</> : <><Plus className="w-3 h-3 mr-1" /> Add Event</>}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowCatalog(!showCatalog)}
                          className="rounded-none text-xs h-7"
                        >
                          {showCatalog ? <><X className="w-3 h-3 mr-1" /> Hide Catalog</> : <><BookOpen className="w-3 h-3 mr-1" /> Browse Catalog ({catalogData?.total ?? 0})</>}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={triggerWorldScan}
                          disabled={scanningWorld}
                          className="rounded-none text-xs h-7"
                        >
                          {scanningWorld ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                          {scanningWorld ? "Scanning..." : "Run World Scan Now"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => refetchMacroEvents()}
                          className="rounded-none text-xs h-7"
                        >
                          <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                        </Button>
                      </div>

                      <AnimatePresence>
                        {showCatalog && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden mb-4"
                          >
                            <div className="p-3 border border-border rounded-sm bg-muted/20">
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-semibold flex items-center gap-1.5">
                                  <BookOpen className="w-3.5 h-3.5 text-primary" />
                                  Curated Disruption Catalog
                                  <span className="text-muted-foreground font-normal">— pre-populated severity, decay, and capability links. Click "Use" to load into the form, then adjust before saving.</span>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1">
                                {catalogData?.templates.map(t => {
                                  const sevColor = t.severity >= 8 ? "text-red-600" : t.severity >= 5 ? "text-amber-600" : "text-slate-600";
                                  const dirColor = t.sentimentDirection === "negative" ? "text-red-600" : t.sentimentDirection === "positive" ? "text-emerald-600" : "text-slate-500";
                                  return (
                                    <div key={t.key} className="p-2 border border-border bg-background rounded-sm flex flex-col gap-1.5 hover:border-primary/60 transition">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                          <div className="text-xs font-semibold leading-tight">{t.title}</div>
                                          <div className="text-[10px] text-muted-foreground capitalize mt-0.5">{t.eventType.replace("_", " ")}</div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                          <span className={`font-mono font-bold text-xs ${sevColor}`}>{t.severity}</span>
                                          <span className={`text-[10px] ${dirColor}`}>
                                            {t.sentimentDirection === "negative" ? "▼" : t.sentimentDirection === "positive" ? "▲" : "—"}
                                          </span>
                                          <span className="text-[10px] text-muted-foreground font-mono">{t.decayDays}d</span>
                                        </div>
                                      </div>
                                      <div className="text-[10px] text-muted-foreground line-clamp-2">{t.description}</div>
                                      {t.affectedIndustryNames.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                          {t.affectedIndustryNames.map(n => (
                                            <span key={n} className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 rounded">{n.split(" ")[0]}</span>
                                          ))}
                                        </div>
                                      )}
                                      {t.affectedCapabilityNames.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                          {t.affectedCapabilityNames.slice(0, 6).map(n => (
                                            <span key={n} className="text-[9px] px-1 py-0.5 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 rounded">{n}</span>
                                          ))}
                                          {t.affectedCapabilityNames.length > 6 && (
                                            <span className="text-[9px] text-muted-foreground">+{t.affectedCapabilityNames.length - 6}</span>
                                          )}
                                        </div>
                                      )}
                                      <div className="flex items-center justify-between pt-1 border-t border-border/40">
                                        <span className="text-[9px] text-muted-foreground italic line-clamp-1" title={t.rationale}>{t.rationale}</span>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="rounded-none text-[10px] h-5 px-1.5 ml-1 shrink-0"
                                          onClick={() => {
                                            setEventForm({
                                              eventType: t.eventType,
                                              severity: t.severity,
                                              title: t.title,
                                              description: t.description,
                                              sentimentDirection: t.sentimentDirection,
                                              decayDays: t.decayDays,
                                              affectedIndustryIds: t.affectedIndustryIds,
                                              affectedCapabilityIds: t.affectedCapabilityIds,
                                              source: "catalog",
                                            });
                                            setShowAddEvent(true);
                                            setShowCatalog(false);
                                          }}
                                        >
                                          Use →
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                                {(!catalogData || catalogData.templates.length === 0) && (
                                  <div className="col-span-2 text-center py-4 text-xs text-muted-foreground">Loading catalog…</div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <AnimatePresence>
                        {showAddEvent && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden mb-4"
                          >
                            <div className="p-3 border border-border rounded-sm bg-muted/20 space-y-2">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <label className="text-xs">
                                  <span className="text-muted-foreground block mb-1">Type</span>
                                  <select
                                    value={eventForm.eventType}
                                    onChange={(e) => setEventForm({ ...eventForm, eventType: e.target.value as typeof eventForm.eventType })}
                                    className="w-full px-2 py-1 text-xs border border-border rounded-sm bg-background"
                                  >
                                    <option value="war">War / Conflict</option>
                                    <option value="regulation">Regulation</option>
                                    <option value="tech_shift">Tech Paradigm Shift</option>
                                    <option value="economic">Economic</option>
                                    <option value="disaster">Disaster</option>
                                    <option value="other">Other</option>
                                  </select>
                                </label>
                                <label className="text-xs">
                                  <span className="text-muted-foreground block mb-1">Severity (0-10): <strong>{eventForm.severity}</strong></span>
                                  <input
                                    type="range"
                                    min="0"
                                    max="10"
                                    step="1"
                                    value={eventForm.severity}
                                    onChange={(e) => setEventForm({ ...eventForm, severity: Number(e.target.value) })}
                                    className="w-full"
                                  />
                                </label>
                                <label className="text-xs">
                                  <span className="text-muted-foreground block mb-1">Direction</span>
                                  <select
                                    value={eventForm.sentimentDirection}
                                    onChange={(e) => setEventForm({ ...eventForm, sentimentDirection: e.target.value as typeof eventForm.sentimentDirection })}
                                    className="w-full px-2 py-1 text-xs border border-border rounded-sm bg-background"
                                  >
                                    <option value="negative">Negative</option>
                                    <option value="positive">Positive</option>
                                    <option value="neutral">Neutral</option>
                                  </select>
                                </label>
                                <label className="text-xs">
                                  <span className="text-muted-foreground block mb-1">Decay days: <strong>{eventForm.decayDays}</strong></span>
                                  <input
                                    type="range"
                                    min="1"
                                    max="90"
                                    step="1"
                                    value={eventForm.decayDays}
                                    onChange={(e) => setEventForm({ ...eventForm, decayDays: Number(e.target.value) })}
                                    className="w-full"
                                  />
                                </label>
                              </div>
                              <label className="text-xs block">
                                <span className="text-muted-foreground block mb-1">Title</span>
                                <input
                                  type="text"
                                  value={eventForm.title}
                                  onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                                  placeholder="e.g. EU AI Act enforcement begins"
                                  className="w-full px-2 py-1 text-xs border border-border rounded-sm bg-background"
                                />
                              </label>
                              <label className="text-xs block">
                                <span className="text-muted-foreground block mb-1">Description</span>
                                <textarea
                                  value={eventForm.description}
                                  onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                                  placeholder="What happened, why it matters for capabilities"
                                  rows={2}
                                  className="w-full px-2 py-1 text-xs border border-border rounded-sm bg-background"
                                />
                              </label>
                              <div>
                                <span className="text-muted-foreground text-xs block mb-1">Affected industries (none = global)</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {industryList?.map(ind => {
                                    const selected = eventForm.affectedIndustryIds.includes(ind.id);
                                    return (
                                      <button
                                        key={ind.id}
                                        onClick={() => setEventForm({
                                          ...eventForm,
                                          affectedIndustryIds: selected
                                            ? eventForm.affectedIndustryIds.filter(id => id !== ind.id)
                                            : [...eventForm.affectedIndustryIds, ind.id],
                                        })}
                                        className={`px-2 py-0.5 text-[10px] rounded-sm border transition ${
                                          selected
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-background border-border hover:bg-muted"
                                        }`}
                                      >
                                        {ind.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              {(() => {
                                const filteredCaps = (capabilityList ?? []).filter(c =>
                                  eventForm.affectedIndustryIds.length === 0 ||
                                  eventForm.affectedIndustryIds.includes(c.industryId) ||
                                  eventForm.affectedCapabilityIds.includes(c.id)
                                );
                                return (
                                  <div>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-muted-foreground text-xs">
                                        Affected capabilities ({eventForm.affectedCapabilityIds.length} selected{eventForm.affectedIndustryIds.length > 0 ? `, filtered to ${eventForm.affectedIndustryIds.length} industr${eventForm.affectedIndustryIds.length === 1 ? "y" : "ies"}` : ", all"})
                                      </span>
                                      {eventForm.affectedCapabilityIds.length > 0 && (
                                        <button
                                          onClick={() => setEventForm({ ...eventForm, affectedCapabilityIds: [] })}
                                          className="text-[10px] text-muted-foreground hover:text-red-600"
                                        >Clear</button>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto p-1 border border-border/50 rounded-sm bg-background/40">
                                      {filteredCaps.length === 0 && (
                                        <span className="text-[10px] text-muted-foreground italic px-1">No capabilities available for selected industries.</span>
                                      )}
                                      {filteredCaps.map(c => {
                                        const selected = eventForm.affectedCapabilityIds.includes(c.id);
                                        return (
                                          <button
                                            key={c.id}
                                            onClick={() => setEventForm({
                                              ...eventForm,
                                              affectedCapabilityIds: selected
                                                ? eventForm.affectedCapabilityIds.filter(id => id !== c.id)
                                                : [...eventForm.affectedCapabilityIds, c.id],
                                            })}
                                            className={`px-1.5 py-0.5 text-[10px] rounded-sm border transition ${
                                              selected
                                                ? "bg-violet-600 text-white border-violet-600"
                                                : "bg-background border-border hover:bg-muted"
                                            }`}
                                          >
                                            {c.name}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}
                              <div className="flex justify-end gap-2 pt-1">
                                <Button size="sm" variant="ghost" onClick={() => setShowAddEvent(false)} className="rounded-none text-xs h-7">Cancel</Button>
                                <Button size="sm" onClick={submitEvent} disabled={submittingEvent || !eventForm.title.trim()} className="rounded-none text-xs h-7">
                                  {submittingEvent ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                                  Add Event
                                </Button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {macroEvents && macroEvents.active.length === 0 ? (
                        <div className="text-center py-6 text-xs text-muted-foreground border border-dashed border-border rounded-sm">
                          No active macro disruptions. The CEI reflects only baseline capability dynamics.
                          <br />Add an event manually or run a world scan to detect real-time disruptions.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="border-b text-muted-foreground">
                              <tr className="text-left">
                                <th className="py-1.5 pr-3 font-medium">Title</th>
                                <th className="py-1.5 pr-3 font-medium">Type</th>
                                <th className="py-1.5 pr-3 font-medium text-right">Severity</th>
                                <th className="py-1.5 pr-3 font-medium text-right">Direction</th>
                                <th className="py-1.5 pr-3 font-medium text-right">Decay Left</th>
                                <th className="py-1.5 pr-3 font-medium">Industries</th>
                                <th className="py-1.5 pr-3 font-medium">Linked Capabilities</th>
                                <th className="py-1.5 pr-3 font-medium">Source</th>
                                <th className="py-1.5 pr-3 font-medium text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {macroEvents?.active.map(ev => {
                                const elapsedDays = (Date.now() - new Date(ev.startedAt).getTime()) / (1000 * 60 * 60 * 24);
                                const remainingDays = Math.max(0, ev.decayDays - elapsedDays);
                                const decayPct = (remainingDays / ev.decayDays) * 100;
                                const affectedNames = ev.affectedIndustryIds.length === 0
                                  ? "Global"
                                  : ev.affectedIndustryIds.map(id => industryList?.find(i => i.id === id)?.name?.split(" ")[0] ?? `#${id}`).join(", ");
                                return (
                                  <tr key={ev.id} className="border-b border-border/50 hover:bg-muted/30">
                                    <td className="py-1.5 pr-3 font-medium" title={ev.description}>{ev.title}</td>
                                    <td className="py-1.5 pr-3 text-muted-foreground capitalize">{ev.eventType.replace("_", " ")}</td>
                                    <td className="py-1.5 pr-3 text-right">
                                      <span className={`font-mono font-bold ${
                                        ev.severity >= 8 ? "text-red-600" : ev.severity >= 5 ? "text-amber-600" : "text-slate-600"
                                      }`}>{ev.severity}</span>
                                    </td>
                                    <td className="py-1.5 pr-3 text-right">
                                      {ev.sentimentDirection === "negative" ? <span className="text-red-600">▼ neg</span>
                                        : ev.sentimentDirection === "positive" ? <span className="text-emerald-600">▲ pos</span>
                                        : <span className="text-slate-500">— neu</span>}
                                    </td>
                                    <td className="py-1.5 pr-3 text-right font-mono">
                                      <div className="flex items-center justify-end gap-1.5">
                                        <span>{remainingDays.toFixed(1)}d</span>
                                        <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                                          <div className="h-full bg-amber-500" style={{ width: `${decayPct}%` }} />
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-1.5 pr-3 text-muted-foreground text-[10px]">{affectedNames}</td>
                                    <td className="py-1.5 pr-3">
                                      {ev.affectedCapabilityIds && ev.affectedCapabilityIds.length > 0 ? (
                                        <div className="flex flex-wrap gap-0.5 max-w-[260px]">
                                          {ev.affectedCapabilityIds.slice(0, 4).map(cid => {
                                            const cap = capabilityList?.find(c => c.id === cid);
                                            return (
                                              <span key={cid} className="text-[9px] px-1 py-0.5 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 rounded" title={cap?.name ?? `#${cid}`}>
                                                {cap?.name ?? `#${cid}`}
                                              </span>
                                            );
                                          })}
                                          {ev.affectedCapabilityIds.length > 4 && (
                                            <span className="text-[9px] text-muted-foreground" title={ev.affectedCapabilityIds.slice(4).map(cid => capabilityList?.find(c => c.id === cid)?.name ?? `#${cid}`).join(", ")}>
                                              +{ev.affectedCapabilityIds.length - 4}
                                            </span>
                                          )}
                                        </div>
                                      ) : (
                                        <span className="text-[10px] text-muted-foreground italic">industry-wide</span>
                                      )}
                                    </td>
                                    <td className="py-1.5 pr-3">
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                        ev.source === "world_scan" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                        : ev.source === "catalog" ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                      }`}>
                                        {ev.source === "world_scan" ? "🌐 scan" : ev.source === "catalog" ? "📚 catalog" : "👤 admin"}
                                      </span>
                                    </td>
                                    <td className="py-1.5 pr-3 text-right">
                                      <button
                                        onClick={() => deleteEvent(ev.id)}
                                        className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-sm text-red-600 transition"
                                        title="Delete event"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="mt-3 px-3 py-2 bg-muted/40 rounded-sm border border-border/50 text-[11px] text-muted-foreground">
                        <div className="flex items-start gap-2">
                          <Info className="w-3 h-3 mt-0.5 shrink-0 text-blue-600" />
                          <div>
                            <span className="font-semibold text-foreground">How shocks apply:</span> each active event contributes
                            <code className="mx-1 px-1 bg-background rounded">severity × directionSign × 0.5 × decayFactor</code> to <strong>market sentiment</strong>,
                            and <code className="mx-1 px-1 bg-background rounded">severity × 0.005 × decayFactor</code> to <strong>volatility</strong>.
                            decayFactor = max(0, 1 - elapsedDays / decayDays). Currently shifting sentiment by
                            <strong className={macroEvents && macroEvents.summary.sentimentShock < 0 ? "text-red-600" : "text-emerald-600"}> {macroEvents?.summary.sentimentShock ?? 0}</strong>
                            and volatility by <strong className="text-amber-600">+{macroEvents?.summary.volatilityBoost ?? 0}</strong>.
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          </motion.div>

          {freshness && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mb-4"
          >
            <Card className="rounded-none border-2 border-amber-300 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/10">
              <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowFreshness(!showFreshness)}>
                <CardTitle className="font-serif text-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-amber-600" />
                    Data Freshness & Methodology
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      freshness.summary.refreshedLast24h >= 5 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : freshness.summary.refreshedLast7d >= 10 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                    }`}>
                      {freshness.summary.refreshedLast24h >= 5 ? "Fresh" : freshness.summary.refreshedLast7d >= 10 ? "Aging" : "Stale"}
                    </span>
                  </div>
                  {showFreshness ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </CardTitle>
                <CardDescription>Audit trail — when each capability was last triangulated against live sources, and what the headline numbers actually mean</CardDescription>
              </CardHeader>
              <AnimatePresence>
                {showFreshness && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        <div className="bg-background rounded-sm p-3 border">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Refreshed &lt; 24h</div>
                          <div className="text-2xl font-mono font-bold text-emerald-600">{freshness.summary.refreshedLast24h}</div>
                          <div className="text-[10px] text-muted-foreground">of {freshness.summary.total} caps</div>
                        </div>
                        <div className="bg-background rounded-sm p-3 border">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Refreshed &lt; 7d</div>
                          <div className="text-2xl font-mono font-bold text-amber-600">{freshness.summary.refreshedLast7d}</div>
                          <div className="text-[10px] text-muted-foreground">of {freshness.summary.total} caps</div>
                        </div>
                        <div className="bg-background rounded-sm p-3 border">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Stale ≥ 7d</div>
                          <div className="text-2xl font-mono font-bold text-red-600">{freshness.summary.stale7dPlus}</div>
                          <div className="text-[10px] text-muted-foreground">includes never-refreshed</div>
                        </div>
                        <div className="bg-background rounded-sm p-3 border">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Never Refreshed</div>
                          <div className="text-2xl font-mono font-bold text-slate-600">{freshness.summary.neverRefreshed}</div>
                          <div className="text-[10px] text-muted-foreground">no triangulation yet</div>
                        </div>
                      </div>

                      <div className="bg-background rounded-sm p-3 border mb-4">
                        <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <Info className="w-3 h-3" /> What the numbers mean
                        </div>
                        <div className="space-y-1.5 text-xs font-mono text-foreground">
                          <div><span className="text-amber-700 dark:text-amber-400">Market Sentiment:</span> {freshness.formula.marketSentiment}</div>
                          <div><span className="text-amber-700 dark:text-amber-400">Consensus Score:</span> {freshness.formula.consensusScore}</div>
                          <div><span className="text-amber-700 dark:text-amber-400">Velocity:</span> {freshness.formula.velocity}</div>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <div className="text-[11px] text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2 font-semibold">
                            ✓ 10 Most Recently Refreshed
                          </div>
                          <div className="overflow-x-auto rounded-sm border border-emerald-200 dark:border-emerald-900/40">
                            <table className="w-full text-xs">
                              <thead className="border-b bg-emerald-50/50 dark:bg-emerald-950/20 text-muted-foreground">
                                <tr className="text-left">
                                  <th className="py-1.5 px-2 font-medium">Capability</th>
                                  <th className="py-1.5 px-2 font-medium text-right">Refreshed</th>
                                  <th className="py-1.5 px-2 font-medium text-right">Score</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...freshness.capabilities]
                                  .filter(c => c.lastTriangulatedAt)
                                  .sort((a, b) => new Date(b.lastTriangulatedAt!).getTime() - new Date(a.lastTriangulatedAt!).getTime())
                                  .slice(0, 10)
                                  .map(item => (
                                    <tr key={item.capabilityId} className="border-b border-border/50 hover:bg-muted/30">
                                      <td className="py-1.5 px-2 font-medium truncate max-w-[180px]" title={item.capability}>{item.capability}</td>
                                      <td className="py-1.5 px-2 text-right font-mono text-emerald-700 dark:text-emerald-400">
                                        {item.ageHours! < 1 ? `${Math.round(item.ageHours! * 60)}m` : item.ageHours! < 24 ? `${item.ageHours!.toFixed(1)}h` : `${(item.ageHours! / 24).toFixed(1)}d`} ago
                                      </td>
                                      <td className="py-1.5 px-2 text-right font-mono">{item.consensusScore?.toFixed(1) ?? "—"}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-2 font-semibold">
                            ⏳ 10 Stalest — Next in Rotation Queue
                          </div>
                          <div className="overflow-x-auto rounded-sm border border-amber-200 dark:border-amber-900/40">
                            <table className="w-full text-xs">
                              <thead className="border-b bg-amber-50/50 dark:bg-amber-950/20 text-muted-foreground">
                                <tr className="text-left">
                                  <th className="py-1.5 px-2 font-medium">Capability</th>
                                  <th className="py-1.5 px-2 font-medium text-right">Last</th>
                                  <th className="py-1.5 px-2 font-medium text-right">Score</th>
                                </tr>
                              </thead>
                              <tbody>
                                {freshness.capabilities.slice(0, 10).map(item => (
                                  <tr key={item.capabilityId} className="border-b border-border/50 hover:bg-muted/30">
                                    <td className="py-1.5 px-2 font-medium truncate max-w-[180px]" title={item.capability}>{item.capability}</td>
                                    <td className="py-1.5 px-2 text-right font-mono text-amber-700 dark:text-amber-400">
                                      {item.lastTriangulatedAt
                                        ? `${item.ageHours! < 24 ? `${item.ageHours!.toFixed(1)}h` : `${(item.ageHours! / 24).toFixed(1)}d`} ago`
                                        : <span className="text-red-600">never</span>}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono">{item.consensusScore?.toFixed(1) ?? "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 px-3 py-2 bg-muted/40 rounded-sm border border-border/50 text-[11px] text-muted-foreground">
                        <div className="flex items-start gap-2">
                          <Info className="w-3 h-3 mt-0.5 shrink-0 text-amber-600" />
                          <div>
                            <span className="font-semibold text-foreground">Why are some caps {Math.round(((freshness.capabilities[0]?.ageHours ?? 0) / 24) * 10) / 10}d old?</span>{" "}
                            The rotation refreshes <strong>10 caps every 24h</strong>. With <strong>{freshness.summary.total} caps total</strong>, it takes
                            ~{Math.ceil(freshness.summary.total / 10)} days for every capability to be touched once. The "stalest" column is what's
                            <em> next</em> in line — they'll be refreshed in the upcoming rotations. Urgency bursts can jump the queue within 5min when confidence drops below 35%.
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-end text-[11px] text-muted-foreground">
                        <button
                          onClick={() => refetchFreshness()}
                          className="flex items-center gap-1 px-2 py-1 hover:text-foreground hover:bg-muted/50 rounded-sm transition"
                        >
                          <RefreshCw className="w-3 h-3" /> Refresh
                        </button>
                      </div>
                    </CardContent>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          </motion.div>
          )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="rounded-none shadow-lg border-2">
            <CardHeader className="pb-2">
              <CardTitle className="font-serif text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-primary" />
                Industry Breakdown
              </CardTitle>
              <CardDescription>CEI sub-indices weighted by GDP contribution</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={industries.map(([, ind]) => ({
                      name: ind.industryName.replace("Banking & Financial Services", "Banking & FS"),
                      value: ind.indexValue,
                      weight: ind.weight * 100,
                    }))} layout="vertical" margin={{ left: 10, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground)/0.1)" />
                      <XAxis type="number" domain={[0, 500]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fill: 'hsl(var(--foreground))', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 4, fontSize: 12 }}
                        formatter={(value: number, name: string) => [value.toFixed(1), name === "value" ? "CEI Score" : "Weight %"]}
                      />
                      <Bar dataKey="value" name="CEI Score" radius={[0, 4, 4, 0]}>
                        {industries.map(([, ind], idx) => (
                          <Cell key={idx} fill={ind.indexValue >= 320 ? "#6366f1" : ind.indexValue >= 300 ? "#8b5cf6" : "#a78bfa"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="hsl(var(--muted-foreground)/0.15)" />
                      <PolarAngleAxis dataKey="industry" tick={{ fill: 'hsl(var(--foreground))', fontSize: 10 }} />
                      <PolarRadiusAxis domain={[0, 400]} tick={false} axisLine={false} />
                      <Radar name="CEI" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {industries.map(([slug, ind], idx) => (
            <motion.div
              key={slug}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + idx * 0.05 }}
            >
              <Card
                className={`rounded-none cursor-pointer transition-all hover:border-primary/40 hover:shadow-md ${selectedIndustry === slug ? "border-primary ring-1 ring-primary/30" : ""}`}
                onClick={() => setSelectedIndustry(selectedIndustry === slug ? null : slug)}
              >
                <CardContent className="py-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{ind.industryName}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {ind.capabilityCount} capabilities · {(ind.weight * 100).toFixed(0)}% GDP weight
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-mono font-bold text-primary">{ind.indexValue.toFixed(0)}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      {ind.velocity > 0 ? (
                        <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
                      ) : ind.velocity < 0 ? (
                        <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />
                      ) : (
                        <Minus className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      <span className={ind.velocity > 0 ? "text-emerald-600" : ind.velocity < 0 ? "text-red-600" : "text-muted-foreground"}>
                        {ind.velocity > 0 ? "+" : ""}{(ind.velocity * 100).toFixed(1)}% velocity
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Top mover: <span className="font-medium text-foreground">{ind.topMover}</span>
                    </div>
                  </div>

                  <AnimatePresence>
                    {selectedIndustry === slug && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <div className="pt-3 mt-3 border-t space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-muted/50 rounded-sm p-2">
                              <div className="text-[10px] text-muted-foreground uppercase">CEI Contribution</div>
                              <div className="text-sm font-mono font-bold">{(ind.indexValue * ind.weight).toFixed(1)}</div>
                            </div>
                            <div className="bg-muted/50 rounded-sm p-2">
                              <div className="text-[10px] text-muted-foreground uppercase">Top Mover Δ</div>
                              <div className="text-sm font-mono font-bold">{ind.topMoverDelta > 0 ? "+" : ""}{ind.topMoverDelta.toFixed(1)} pts</div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-6"
        >
          <Card className="rounded-none border-2 border-indigo-200 dark:border-indigo-900/50">
            <CardHeader
              className="cursor-pointer pb-2"
              onClick={() => setShowAgentActivity(!showAgentActivity)}
            >
              <CardTitle className="font-serif text-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="w-5 h-5 text-indigo-500" />
                  Autonomous Agent
                  <span className={`w-2 h-2 rounded-full ${
                    agentStatus?.scheduler.isRunning ? "bg-amber-400 animate-pulse" :
                    sseConnected ? "bg-emerald-400" : "bg-slate-400"
                  }`} />
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    {agentStatus?.scheduler.isRunning ? "Running" : sseConnected ? "Connected" : "Offline"}
                  </span>
                </div>
                {showAgentActivity ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </CardTitle>
              <CardDescription>
                LangGraph-powered agent with Mem0 memory — autonomously monitors, researches, and updates the CEI
              </CardDescription>
            </CardHeader>
            <AnimatePresence>
              {showAgentActivity && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <CardContent>
                    <div className="grid md:grid-cols-4 gap-3 mb-4">
                      <div className="bg-muted/30 rounded-sm p-3 border border-border">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Clock className="w-3.5 h-3.5 text-primary" />
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Mode</span>
                        </div>
                        <div className="text-sm font-mono font-bold">
                          {agentStatus?.scheduler.active ? "Autonomous" : "Off"}
                        </div>
                      </div>
                      <div className="bg-muted/30 rounded-sm p-3 border border-border">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Search className="w-3.5 h-3.5 text-primary" />
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Researched</span>
                        </div>
                        <div className="text-sm font-mono font-bold">
                          {agentStatus?.latestRun?.capabilitiesResearched ?? 0} caps
                        </div>
                      </div>
                      <div className="bg-muted/30 rounded-sm p-3 border border-border">
                        <div className="flex items-center gap-1.5 mb-1">
                          <SkipForward className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Skipped</span>
                        </div>
                        <div className="text-sm font-mono font-bold">
                          {agentStatus?.latestRun?.capabilitiesSkipped ?? 0} caps
                        </div>
                      </div>
                      <div className="bg-muted/30 rounded-sm p-3 border border-border">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Brain className="w-3.5 h-3.5 text-primary" />
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Memories</span>
                        </div>
                        <div className="text-sm font-mono font-bold">
                          {agentStatus?.memory.totalMemories ?? 0}
                        </div>
                      </div>
                    </div>

                    {agentStatus?.latestRun && (
                      <div className="bg-muted/30 rounded-sm p-3 border mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs font-bold uppercase tracking-wider">Last Run</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium border ${
                              agentStatus.latestRun.status === "completed" ? "bg-primary/10 text-primary border-primary/20" :
                              agentStatus.latestRun.status === "running" ? "bg-muted text-foreground border-border" :
                              "bg-muted text-muted-foreground border-border"
                            }`}>
                              {agentStatus.latestRun.status}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(agentStatus.latestRun.startedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
                          <div>
                            <div className="text-lg font-mono font-bold text-foreground">{agentStatus.latestRun.industriesEvaluated}</div>
                            <div className="text-[10px] text-muted-foreground">Industries</div>
                          </div>
                          <div>
                            <div className="text-lg font-mono font-bold text-primary">{agentStatus.latestRun.capabilitiesResearched}</div>
                            <div className="text-[10px] text-muted-foreground">Researched</div>
                          </div>
                          <div>
                            <div className="text-lg font-mono font-bold text-foreground">{agentStatus.latestRun.capabilitiesSkipped}</div>
                            <div className="text-[10px] text-muted-foreground">Skipped</div>
                          </div>
                          <div>
                            <div className="text-lg font-mono font-bold text-foreground">{agentStatus.latestRun.perplexityCalls}</div>
                            <div className="text-[10px] text-muted-foreground">API Calls</div>
                          </div>
                          <div>
                            <div className="text-lg font-mono font-bold text-foreground">{agentStatus.latestRun.memoriesRecalled}</div>
                            <div className="text-[10px] text-muted-foreground">Recalled</div>
                          </div>
                          <div>
                            <div className="text-lg font-mono font-bold text-foreground">{agentStatus.latestRun.memoriesStored}</div>
                            <div className="text-[10px] text-muted-foreground">Stored</div>
                          </div>
                        </div>
                        {agentStatus.latestRun.ceiBeforeIndex != null && agentStatus.latestRun.ceiAfterIndex != null && (
                          <div className="mt-2 text-xs text-center text-muted-foreground">
                            CEI: {agentStatus.latestRun.ceiBeforeIndex} → {agentStatus.latestRun.ceiAfterIndex}
                            {" "}
                            <span className={
                              agentStatus.latestRun.ceiAfterIndex > agentStatus.latestRun.ceiBeforeIndex ? "text-primary" :
                              agentStatus.latestRun.ceiAfterIndex < agentStatus.latestRun.ceiBeforeIndex ? "text-muted-foreground" : ""
                            }>
                              ({agentStatus.latestRun.ceiAfterIndex >= agentStatus.latestRun.ceiBeforeIndex ? "+" : ""}
                              {(agentStatus.latestRun.ceiAfterIndex - agentStatus.latestRun.ceiBeforeIndex).toFixed(1)})
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {agentEvents.length > 0 && (
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Live Activity Feed</div>
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                          {agentEvents.slice(0, 15).map((event, i) => (
                            <motion.div
                              key={`${event.timestamp}-${i}`}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="flex items-start gap-2 text-xs py-1.5 px-2 rounded-sm bg-muted/20 hover:bg-muted/40 transition-colors"
                            >
                              <AgentEventIcon type={event.type} />
                              <span className="text-foreground flex-1">{formatEventMessage(event)}</span>
                              <span className="text-muted-foreground shrink-0">
                                {new Date(event.timestamp).toLocaleTimeString()}
                              </span>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )}

                    {agentEvents.length === 0 && !agentStatus?.latestRun && (
                      <div className="text-center py-6 text-muted-foreground">
                        <Bot className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">Agent is monitoring. The first research cycle will begin automatically.</p>
                      </div>
                    )}
                  </CardContent>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </motion.div>

        {historyData.length > 1 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-6"
          >
            <Card className="rounded-none">
              <CardHeader>
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <Activity className="w-5 h-5 text-primary" />
                  CEI Trend
                </CardTitle>
                <CardDescription>Historical index movement over time</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={historyData}>
                      <defs>
                        <linearGradient id="ceiGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground)/0.1)" />
                      <XAxis dataKey="time" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <YAxis domain={["auto", "auto"]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 4, fontSize: 12 }} />
                      <Area type="monotone" dataKey="index" stroke="#6366f1" fill="url(#ceiGrad)" strokeWidth={2} name="CEI" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-6 mb-12"
        >
          <Card className="rounded-none">
            <CardHeader
              className="cursor-pointer"
              onClick={() => setShowMethodology(!showMethodology)}
            >
              <CardTitle className="font-serif text-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-primary" />
                  CEI Methodology v1.0
                </div>
                {showMethodology ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </CardTitle>
              <CardDescription>
                How the Capability Economics Index is calculated — multi-source Bayesian triangulation, velocity tracking, and economic multipliers
              </CardDescription>
            </CardHeader>
            <AnimatePresence>
              {showMethodology && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <CardContent>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                      <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-sm p-4 border border-indigo-100 dark:border-indigo-900">
                        <div className="flex items-center gap-2 mb-2">
                          <Shield className="w-4 h-4 text-indigo-600" />
                          <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">Consensus Score</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Each capability is scored by 4 independent perspectives (consulting, market data, academic, practitioner) using Bayesian inference to produce a posterior distribution with 95% credible intervals.
                        </p>
                      </div>
                      <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-sm p-4 border border-emerald-100 dark:border-emerald-900">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="w-4 h-4 text-emerald-600" />
                          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">Velocity</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Exponential Moving Average (α=0.7) of score changes captures whether capabilities are improving or declining. Range: -50% to +50%.
                        </p>
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-950/30 rounded-sm p-4 border border-amber-100 dark:border-amber-900">
                        <div className="flex items-center gap-2 mb-2">
                          <Zap className="w-4 h-4 text-amber-600" />
                          <span className="text-xs font-bold uppercase tracking-wider text-amber-600">Economic Multiplier</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Derived from the capability dependency network. Highly-connected capabilities (many upstream/downstream dependencies) receive multipliers up to 2.0×, reflecting outsized economic impact.
                        </p>
                      </div>
                      <div className="bg-purple-50 dark:bg-purple-950/30 rounded-sm p-4 border border-purple-100 dark:border-purple-900">
                        <div className="flex items-center gap-2 mb-2">
                          <Globe className="w-4 h-4 text-purple-600" />
                          <span className="text-xs font-bold uppercase tracking-wider text-purple-600">GDP Weighting</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Industries weighted by global GDP contribution: Banking 22%, Manufacturing 20%, Healthcare 18%, Technology 18%, Retail 12%, Insurance 10%.
                        </p>
                      </div>
                    </div>

                    <div className="bg-muted/30 rounded-sm p-4 border font-mono text-sm">
                      <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wider font-sans font-bold">Formula</div>
                      <div className="text-foreground">
                        CEI = Σ(W<sub>i</sub> × C<sub>i</sub> × (1 + V<sub>i</sub>) × E<sub>i</sub> × α<sub>i</sub>) / ΣW<sub>i</sub> × 10
                      </div>
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs text-muted-foreground font-sans">
                        <div><strong>W<sub>i</sub></strong> = GDP weight</div>
                        <div><strong>C<sub>i</sub></strong> = Consensus (0-100)</div>
                        <div><strong>V<sub>i</sub></strong> = Velocity (EMA)</div>
                        <div><strong>E<sub>i</sub></strong> = Econ multiplier</div>
                        <div><strong>α<sub>i</sub></strong> = Confidence</div>
                      </div>
                    </div>

                    <div className="mt-4 p-3 bg-indigo-50 dark:bg-indigo-950/20 rounded-sm border border-indigo-100 dark:border-indigo-900">
                      <div className="flex items-center gap-2">
                        <Info className="w-4 h-4 text-indigo-600 shrink-0" />
                        <p className="text-xs text-muted-foreground">
                          <strong>Scale interpretation:</strong> 0-200 = Nascent (early-stage digital), 200-400 = Developing (partial adoption), 400-600 = Advancing (systematic maturity), 600-800 = Leading (industry-defining), 800-1000 = Transformative (next-generation).
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
 
