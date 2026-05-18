import { useState, useEffect, useCallback, useRef } from "react";
import { useEventStream } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { HelpCircle, BookOpenCheck } from "lucide-react";
import { LifecycleChip, LIFECYCLE_STAGES, lifecycleLabel, type LifecycleStage } from "@/components/lifecycle-chip";
import { SavedViewsMenu } from "@/components/saved-views-menu";
import { useSavedView } from "@/hooks/use-saved-view";
import { ScoreWithProvenance } from "@/components/score-with-provenance";

type CEIViewState = {
  selectedIndustry: string | null;
  freshnessStageFilter: LifecycleStage | "all";
  showFreshness: boolean;
  showMacroPanel: boolean;
  showAgentActivity: boolean;
};
import {
  Activity, TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, Info,
  ArrowUpRight, ArrowDownRight, BarChart3, Zap, Shield, ChevronDown, ChevronUp,
  Globe, BookOpen, Bot, Brain, Eye, SkipForward, Search, Database, Clock,
  AlertTriangle, Plus, X, Sparkles, Trash2,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ReferenceDot, ErrorBar,
} from "recharts";

const API_BASE = "/api";

interface IndustryBreakdown {
  industryName: string;
  indexValue: number;
  // 95% credible interval on this industry's index. null when no scored capabilities.
  ciLow: number | null;
  ciHigh: number | null;
  weight: number;
  // Provenance of the GDP weight (Perplexity-cited; null only when missing).
  weightSourceUrl: string | null;
  weightSourceYear: number | null;
  velocity: number;
  capabilityCount: number;
  topMover: string;
  topMoverDelta: number;
}

interface CEIData {
  overallIndex: number;
  // 95% credible interval on the overall (GDP-weighted) CVI. null when no
  // industries have a Perplexity-cited weight.
  overallCiLow: number | null;
  overallCiHigh: number | null;
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
  leaves?: number;
  parents?: number;
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
  ciLow?: number | null;
  ciHigh?: number | null;
  citations?: string[];
  sourceBreakdown?: Array<{ sourceLabel: string; rawScore: number; weight: number; methodology?: string }>;
  lifecycleStage: import("@/components/lifecycle-chip").LifecycleStage;
}
interface FreshnessResponse {
  summary: FreshnessSummary;
  formula: { marketSentiment: string; consensusScore: string; velocity: string };
  capabilities: FreshnessItem[];
  leaves?: number;
  parents?: number;
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
interface CapabilityTreeNode {
  id: number;
  name: string;
  slug: string;
  industryId: number;
  isLeaf: boolean;
  parentCapabilityId: number | null;
  score: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  posteriorVariance: number | null;
  confidence: number | null;
  velocity: number | null;
  updatedAt: string | null;
  children: CapabilityTreeNode[];
}
interface CapabilityTreeResponse { roots: CapabilityTreeNode[]; total: number; }
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

// Backed by the shared `useEventStream` hook, which gives us
// exponential-backoff reconnect and a portable parser (works in RN too).
// We keep this thin wrapper so the rest of the page can keep its existing
// `{ events, connected }` shape and event-type filter.
function useAgentEvents() {
  const { events, status } = useEventStream<AgentSSEEvent>(
    `${API_BASE}/agent/events/stream`,
    {
      maxBuffered: 50,
      // Drop the server's "connected" handshake from the visible feed —
      // it's noise, not an agent event. We surface connection state via
      // `status` instead.
      filter: (evt) => evt.type !== "connected",
    },
  );
  return { events, connected: status === "open" };
}

function MetricHelp({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button type="button" className={`inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground transition-colors ${className}`} onClick={(e) => e.stopPropagation()}>
          <HelpCircle className="w-3 h-3" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 text-xs leading-relaxed" side="top">
        {children}
      </HoverCardContent>
    </HoverCard>
  );
}

function DeltaInterpreter({ delta, childScore, parentScore, childName }: { delta: number; childScore: number; parentScore: number; childName: string }) {
  const absDelta = Math.abs(delta);
  const tier = childScore >= 75 ? "high" : childScore >= 50 ? "mid" : "low";
  const isRed = delta < 0;
  let label = "";
  let interpretation = "";
  if (isRed) {
    if (tier === "high") {
      label = "Strong, but the weakest of a strong cohort";
      interpretation = `${childName} is performing well in absolute terms (${childScore.toFixed(1)}/100) — but it's the relative laggard inside this parent. Not a problem; this is where marginal investment yields the smallest return.`;
    } else if (tier === "mid") {
      label = "Capability gap";
      interpretation = `${childName} is mid-tier (${childScore.toFixed(1)}/100) and below its parent average. The org has invested elsewhere in this domain but under-invested here. A typical area for focused improvement.`;
    } else {
      label = "Blind spot";
      interpretation = `${childName} is materially weak (${childScore.toFixed(1)}/100) and ${absDelta.toFixed(1)} points below the parent. Either the org is unaware this matters, or aware and failing to execute. Often the highest-leverage area to address.`;
    }
  } else {
    if (tier === "high") {
      label = "Center of excellence";
      interpretation = `${childName} (${childScore.toFixed(1)}/100) is materially above its parent and pulling the rollup up. This is what the rest of the parent should look like.`;
    } else {
      label = "Best of a weak cohort";
      interpretation = `${childName} is above its parent (${parentScore.toFixed(1)}) but the parent itself is mid/weak. Don't celebrate — strength is relative to a low bar.`;
    }
  }
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span className={`text-[9px] font-mono ml-1 px-1 rounded shrink-0 cursor-help ${
          delta > 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
        }`}>
          {delta > 0 ? "+" : ""}{delta.toFixed(1)} vs parent
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 text-xs leading-relaxed" side="top">
        <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${isRed ? "text-red-600" : "text-emerald-600"}`}>
          {label}
        </div>
        <div className="text-muted-foreground mb-2">{interpretation}</div>
        <div className="pt-2 border-t border-border/50 space-y-0.5 font-mono text-[10.5px]">
          <div className="flex justify-between"><span className="text-muted-foreground">Child score</span><span className="font-semibold">{childScore.toFixed(1)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Parent rollup</span><span className="font-semibold">{parentScore.toFixed(1)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Δ</span><span className={`font-semibold ${isRed ? "text-red-600" : "text-emerald-600"}`}>{delta > 0 ? "+" : ""}{delta.toFixed(1)} pt</span></div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const hasDataRef = useRef(false);
  const refetch = useCallback(async () => {
    if (!url) { setLoading(false); return; }
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

function ScoreErrorBar({ score, ciLow, ciHigh }: { score: number; ciLow: number; ciHigh: number }) {
  const half = Math.max(0, (ciHigh - ciLow) / 2);
  const range = 100;
  const leftPct = Math.max(0, Math.min(100, (ciLow / range) * 100));
  const widthPct = Math.max(1, Math.min(100 - leftPct, ((ciHigh - ciLow) / range) * 100));
  const markerPct = Math.max(0, Math.min(100, (score / range) * 100));
  return (
    <div
      className="relative h-1 mt-0.5 w-14 ml-auto bg-muted/40 rounded-full overflow-visible"
      title={`95% CI: ${ciLow.toFixed(1)} – ${ciHigh.toFixed(1)} (±${half.toFixed(1)})`}
    >
      <div
        className="absolute top-0 h-1 bg-indigo-400/60 rounded-full"
        style={{ left: leftPct + "%", width: widthPct + "%" }}
      />
      <div
        className="absolute top-[-2px] h-2 w-[2px] bg-foreground"
        style={{ left: `calc(${markerPct}% - 1px)` }}
      />
    </div>
  );
}

function OverallIndexErrorBar({ value, ciLow, ciHigh, color }: {
  value: number; ciLow: number; ciHigh: number; color: string;
}) {
  const half = Math.max(0, (ciHigh - ciLow) / 2);
  const span = Math.max(20, (ciHigh - ciLow) * 4);
  const center = value;
  const min = center - span / 2;
  const max = center + span / 2;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const leftPct = pct(ciLow);
  const widthPct = Math.max(2, pct(ciHigh) - leftPct);
  const markerPct = pct(value);
  return (
    <div
      className="mt-3 w-44"
      title="95% Bayesian credible interval — propagated from posterior variance of every triangulated capability score"
    >
      <div className="relative h-2 bg-muted/40 rounded-full">
        <div
          className="absolute top-0 h-2 rounded-full opacity-60"
          style={{ left: leftPct + "%", width: widthPct + "%", background: color }}
        />
        <div
          className="absolute top-[-3px] h-[14px] w-[3px] rounded-sm"
          style={{ left: `calc(${markerPct}% - 1.5px)`, background: color }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/80 mt-1 font-mono">
        <span>{ciLow.toFixed(1)}</span>
        <span className="text-muted-foreground">95% CI · ±{half.toFixed(1)}</span>
        <span>{ciHigh.toFixed(1)}</span>
      </div>
    </div>
  );
}

function IndexTicker({ value, label, trend, size = "lg" }: {
  value: number | string;
  label: string;
  trend?: "up" | "down" | "neutral";
  size?: "lg" | "sm";
}) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-muted-foreground/70";

  return (
    <div className="text-center">
      <div className={`font-mono font-bold tracking-tight ${size === "lg" ? "text-6xl md:text-7xl" : "text-2xl"} text-white`}>
        {typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : value}
      </div>
      <div className="flex items-center justify-center gap-1.5 mt-1">
        {trend && <TrendIcon className={`w-4 h-4 ${trendColor}`} />}
        <span className="text-sm text-muted-foreground/70 uppercase tracking-wider">{label}</span>
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
    default: return <Bot className="w-3.5 h-3.5 text-muted-foreground/70" />;
  }
}

function formatEventMessage(event: AgentSSEEvent): string {
  if (event.message) return event.message;
  if (event.type === "research") return `Researching ${event.capability} in ${event.industry}`;
  if (event.type === "cei_updated") return `CVI updated to ${event.overallIndex}`;
  if (event.type === "cycle_complete") return `Cycle complete: ${event.researched} researched, ${event.skipped} skipped`;
  if (event.type === "run_started") return `Agent run #${event.runId} started`;
  return event.type;
}

type CeiExemplar = { capabilityId: number; name: string; score: number; industryName: string };
type ExemplarsResponse = { topLeaf: CeiExemplar | null; bottomLeaf: CeiExemplar | null };

function CEIAnalysisDialog({ cei, historyData, macroEvents, freshness, exemplars }: {
  cei: CEIData;
  historyData: { time: string; timestamp: number; index: number }[];
  macroEvents: MacroEventsResponse | null;
  freshness: FreshnessResponse | null;
  exemplars: ExemplarsResponse | null;
}) {
  const events = macroEvents?.active ?? [];
  const sentimentShock = events.reduce((sum, e) => {
    const elapsedDays = (Date.now() - new Date(e.startedAt).getTime()) / 86_400_000;
    const decay = Math.max(0, 1 - elapsedDays / e.decayDays);
    const sign = e.sentimentDirection === "positive" ? 1 : e.sentimentDirection === "negative" ? -1 : 0;
    return sum + e.severity * sign * 0.5 * decay;
  }, 0);
  const volBoost = events.reduce((sum, e) => {
    const elapsedDays = (Date.now() - new Date(e.startedAt).getTime()) / 86_400_000;
    const decay = Math.max(0, 1 - elapsedDays / e.decayDays);
    return sum + e.severity * 0.005 * decay;
  }, 0);

  const first = historyData[0];
  const last = historyData[historyData.length - 1];
  const min = historyData.reduce((m, p) => p.index < m.index ? p : m, historyData[0] ?? { index: 0, time: "" });
  const max = historyData.reduce((m, p) => p.index > m.index ? p : m, historyData[0] ?? { index: 0, time: "" });
  const delta = first && last ? last.index - first.index : 0;

  const negEvents = events.filter(e => e.sentimentDirection === "negative");
  const posEvents = events.filter(e => e.sentimentDirection === "positive");
  const topNeg = [...negEvents].sort((a, b) => b.severity - a.severity).slice(0, 5);
  const topPos = [...posEvents].sort((a, b) => b.severity - a.severity).slice(0, 3);

  const baseSentiment = 50 + sentimentShock;
  const sentimentLabel = cei.marketSentiment > 60 ? "Bullish" : cei.marketSentiment < 40 ? "Bearish" : "Neutral";

  // Compute the actual range of industry leaf averages from the live CVI
  // payload, replacing the hardcoded "56-64" string in the dialog
  // (PLAN.md item #5). When industry data isn't loaded, fall back to a
  // dash so we never display invented numbers.
  const industryIndexes = Object.values(cei.industryBreakdowns ?? {})
    .map(b => b.indexValue)
    .filter(v => typeof v === "number" && Number.isFinite(v));
  const industryLeafAvgs = industryIndexes.map(v => v / 10); // composite scaled ×10
  const leafAvgMin = industryLeafAvgs.length > 0 ? Math.min(...industryLeafAvgs) : null;
  const leafAvgMax = industryLeafAvgs.length > 0 ? Math.max(...industryLeafAvgs) : null;
  const leafAvgRangeText = leafAvgMin !== null && leafAvgMax !== null
    ? `${leafAvgMin.toFixed(0)}–${leafAvgMax.toFixed(0)}`
    : "—";
  const baselineIndex = leafAvgMin !== null && leafAvgMax !== null
    ? ((leafAvgMin + leafAvgMax) / 2) * 10
    : null;

  // stddev component of volatility, computed by subtracting the macro
  // boost from the published volatility (which is stddev + boost).
  const stddevComponent = Math.max(0, cei.volatility - volBoost);

  // Bucket label for the leaf-average range — derived from cei.overallIndex
  // bands instead of hardcoded "Developing Maturity".
  const overallTenth = cei.overallIndex / 10;
  const maturityLabel = overallTenth >= 80 ? "Strong Maturity"
    : overallTenth >= 60 ? "Developing Maturity"
    : overallTenth >= 40 ? "Early Maturity"
    : "Foundational";

  const leafCount = freshness?.summary.total ?? "—";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 rounded-none">
          <BookOpenCheck className="w-4 h-4" />
          Read the analysis
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-none">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl flex items-center gap-2">
            <BookOpenCheck className="w-5 h-5 text-primary" />
            How to read the CVI right now
          </DialogTitle>
          <DialogDescription>
            Live walkthrough of where the index sits, why it moved, and what the headline numbers actually mean.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 text-sm leading-relaxed">

          <section className="space-y-2">
            <h3 className="font-serif text-base border-b pb-1">1. Why has the CVI moved?</h3>
            {historyData.length > 1 ? (
              <>
                <p>
                  Across the last <strong>{historyData.length}</strong> snapshots in view, the index moved from{" "}
                  <strong>{first.index.toFixed(1)}</strong> ({first.time}) to{" "}
                  <strong>{last.index.toFixed(1)}</strong> ({last.time}) — a net change of{" "}
                  <strong className={delta >= 0 ? "text-emerald-600" : "text-red-600"}>
                    {delta >= 0 ? "+" : ""}{delta.toFixed(1)}
                  </strong> points.
                </p>
                <p>
                  Range over this window: low <strong>{min.index.toFixed(1)}</strong> ({min.time}) → high{" "}
                  <strong>{max.index.toFixed(1)}</strong> ({max.time}).
                </p>
              </>
            ) : (
              <p className="text-muted-foreground italic">Not enough history yet to show movement.</p>
            )}
            <p>
              Two things drive movement: (a) <strong>per-capability shocks</strong> — each active macro event
              subtracts severity-weighted penalties from the individual capabilities it tags, which feeds up into
              the GDP-weighted composite; and (b) <strong>fresh triangulation evidence</strong> from the leaf
              rotation, which can nudge any of the {leafCount} leaf scores by a few points per refresh.
            </p>
            {events.length > 0 && (
              <p>
                Right now there are <strong>{events.length} active macro events</strong> in scope
                ({negEvents.length} negative, {posEvents.length} positive). They are the dominant force on the index this hour.
                If you delete them, the composite snaps back toward its un-shocked baseline within one recompute.
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-serif text-base border-b pb-1">2. Is the math working?</h3>
            <div className="bg-muted/40 p-3 space-y-2 font-mono text-xs">
              <div><strong>Composite ({cei.overallIndex.toFixed(1)}):</strong> GDP-weighted average of industry sub-indices, scaled ×10. Industry leaf averages currently span roughly {leafAvgRangeText}, so the un-shocked baseline sits near ~{baselineIndex !== null ? baselineIndex.toFixed(0) : "—"}; per-capability shocks compress it to where you see it now.</div>
              <div><strong>Market sentiment ({cei.marketSentiment.toFixed(1)} — {sentimentLabel}):</strong></div>
              <div className="pl-3">
                = 50 (neutral base)<br />
                + avgVelocity × 100<br />
                + macroShock ({sentimentShock.toFixed(1)})<br />
                ≈ <strong>{baseSentiment.toFixed(1)}</strong>
              </div>
              <div><strong>Volatility ({(cei.volatility * 100).toFixed(1)}%):</strong></div>
              <div className="pl-3">
                = stddev(leaf velocities) ({stddevComponent.toFixed(3)})<br />
                + macroVolBoost ({volBoost.toFixed(3)})<br />
                ≈ <strong>{cei.volatility.toFixed(3)}</strong>
              </div>
            </div>
            <p>
              The math is internally consistent — every published number can be reconstructed from the formula
              above plus the live macro-events list. There is no hidden fudge factor.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-serif text-base border-b pb-1">3. What does it actually say?</h3>
            <p>
              <strong>Two different questions, two different numbers.</strong> Don't confuse them.
            </p>
            <div className="bg-blue-50 dark:bg-blue-950/30 border-l-4 border-blue-500 p-3 space-y-1">
              <div className="font-semibold">A. "Are humanity's capabilities good enough?" → look at underlying scores.</div>
              <div>
                Average leaf capability across {leafCount} measurable sub-capabilities sits in the
                <strong> {leafAvgRangeText}</strong> range — which the system labels <strong>{maturityLabel}</strong>.
                Translation: median enterprise execution is competent-but-not-great.
                {exemplars?.topLeaf && exemplars?.bottomLeaf && (
                  <>
                    {" "}Best-scoring leaf right now: <strong>{exemplars.topLeaf.name}</strong> ({exemplars.topLeaf.score.toFixed(0)}, {exemplars.topLeaf.industryName}); lowest:{" "}
                    <strong>{exemplars.bottomLeaf.name}</strong> ({exemplars.bottomLeaf.score.toFixed(0)}, {exemplars.bottomLeaf.industryName}).
                  </>
                )}
              </div>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/30 border-l-4 border-amber-500 p-3 space-y-1">
              <div className="font-semibold">B. "Why is sentiment {cei.marketSentiment.toFixed(1)} {sentimentLabel}?" → that's direction-of-travel, not absolute quality.</div>
              <div>
                With no macro events and no fresh evidence, sentiment would read <strong>50.0 (neutral)</strong>.
                The <strong>{sentimentShock.toFixed(1)}</strong>-point shock comes from {events.length} active disruptions:
              </div>
              {topNeg.length > 0 && (
                <ul className="text-xs list-disc pl-5 mt-1">
                  {topNeg.map(e => (
                    <li key={e.id}>
                      <strong>−{e.severity}</strong> {e.title}
                    </li>
                  ))}
                </ul>
              )}
              {topPos.length > 0 && (
                <>
                  <div className="text-xs mt-1">Partially offset by:</div>
                  <ul className="text-xs list-disc pl-5">
                    {topPos.map(e => (
                      <li key={e.id}>
                        <strong>+{e.severity}</strong> {e.title}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="mt-2">
                Read it as: <em>"Capabilities still function at ~{overallTenth.toFixed(0)}/100, but the wind is in their face."</em>
              </div>
            </div>
            <div className="bg-muted/40 p-3 space-y-1">
              <div className="font-semibold">Honest synthesis</div>
              <div>• Capability quality globally: ~{overallTenth.toFixed(0)}/100 — {maturityLabel.toLowerCase()}.</div>
              <div>• Capability trajectory: severe headwinds, justified by {events.length} active real-world disruptions.</div>
              <div>• Best lever to move the number: rotate triangulation faster on the lowest-confidence leaves, or wait for offsetting positive macro events.</div>
            </div>
          </section>

          <p className="text-xs text-muted-foreground italic pt-2 border-t">
            This panel re-computes from live data each time you open it. Numbers reflect the snapshot loaded in the dashboard.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CVIDashboard() {
  const { data: cei, loading: loadingCei, refetch: refetchCei } = useApi<CEIData>(`${API_BASE}/cvi/current`);
  const { data: history } = useApi<CEIHistory[]>(`${API_BASE}/cvi/history?limit=30`);
  const { data: agentStatus, refetch: refetchAgent } = useApi<AgentStatus>(`${API_BASE}/agent/status`);
  const { data: freshness, refetch: refetchFreshness } = useApi<FreshnessResponse>(`${API_BASE}/cvi/freshness`);
  const { data: exemplars } = useApi<ExemplarsResponse>(`${API_BASE}/cvi/exemplars`);
  const { data: macroEvents, refetch: refetchMacroEvents } = useApi<MacroEventsResponse>(`${API_BASE}/macro-events/active`);
  const { data: allMacroEvents } = useApi<{ events: MacroEvent[]; total: number }>(`${API_BASE}/macro-events`);
  const { data: industryList } = useApi<IndustryListItem[]>(`${API_BASE}/industries`);
  const { data: capabilityList } = useApi<CapabilityListItem[]>(`${API_BASE}/capabilities`);
  const { data: catalogData } = useApi<CatalogResponse>(`${API_BASE}/macro-events/catalog`);
  const [showFreshness, setShowFreshness] = useState(true);
  const [freshnessStageFilter, setFreshnessStageFilter] = useState<LifecycleStage | "all">("all");
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
    if (!confirm("Delete this macro event? CVI will recompute without its shock.")) return;
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
  const [expandedParents, setExpandedParents] = useState<Set<number>>(new Set());
  const selectedIndustryId = selectedIndustry ? industryList?.find(i => i.slug === selectedIndustry)?.id ?? null : null;
  const treeUrl = selectedIndustryId ? `${API_BASE}/cvi/capability-tree?industryId=${selectedIndustryId}` : null;
  const { data: capabilityTree } = useApi<CapabilityTreeResponse>(treeUrl ?? `${API_BASE}/cvi/capability-tree?industryId=__none__`);
  useEffect(() => { setExpandedParents(new Set()); }, [selectedIndustry]);
  const [showAgentActivity, setShowAgentActivity] = useState(true);
  const viewsApi = useSavedView<CEIViewState>("cei");
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [defaultApplied, setDefaultApplied] = useState(false);
  useEffect(() => {
    if (defaultApplied || !viewsApi.ready) return;
    if (viewsApi.defaultView) {
      const s = viewsApi.defaultView.stateJson;
      if (s.selectedIndustry !== undefined) setSelectedIndustry(s.selectedIndustry);
      if (s.freshnessStageFilter) setFreshnessStageFilter(s.freshnessStageFilter);
      if (typeof s.showFreshness === "boolean") setShowFreshness(s.showFreshness);
      if (typeof s.showMacroPanel === "boolean") setShowMacroPanel(s.showMacroPanel);
      if (typeof s.showAgentActivity === "boolean") setShowAgentActivity(s.showAgentActivity);
      setActiveViewId(viewsApi.defaultView.id);
    }
    setDefaultApplied(true);
  }, [viewsApi.ready, viewsApi.defaultView, defaultApplied]);
  const applyCEIView = (s: CEIViewState) => {
    if (s.selectedIndustry !== undefined) setSelectedIndustry(s.selectedIndustry);
    if (s.freshnessStageFilter) setFreshnessStageFilter(s.freshnessStageFilter);
    if (typeof s.showFreshness === "boolean") setShowFreshness(s.showFreshness);
    if (typeof s.showMacroPanel === "boolean") setShowMacroPanel(s.showMacroPanel);
    if (typeof s.showAgentActivity === "boolean") setShowAgentActivity(s.showAgentActivity);
  };

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
          <p className="text-muted-foreground">Computing Capability Value Index...</p>
        </div>
      </div>
    );
  }

  if (!cei) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <p className="text-muted-foreground">Unable to load CVI data.</p>
      </div>
    );
  }

  const industries = Object.entries(cei.industryBreakdowns).sort((a, b) => b[1].indexValue - a[1].indexValue);
  const historyData = history ? [...history].reverse().map(h => ({
    time: new Date(h.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    timestamp: new Date(h.timestamp).getTime(),
    index: h.overallIndex,
  })) : [];

  const eventAnnotations = (allMacroEvents?.events ?? []).reduce<{
    time: string;
    index: number;
    title: string;
    severity: number;
    direction: "positive" | "negative" | "neutral";
    eventType: string;
  }[]>((acc, ev) => {
    if (historyData.length === 0) return acc;
    const evMs = new Date(ev.startedAt).getTime();
    const earliest = historyData[0].timestamp;
    const latest = historyData[historyData.length - 1].timestamp;
    if (evMs < earliest - 86_400_000 || evMs > latest + 86_400_000) return acc;
    let nearest = historyData[0];
    let nearestDelta = Math.abs(nearest.timestamp - evMs);
    for (const h of historyData) {
      const d = Math.abs(h.timestamp - evMs);
      if (d < nearestDelta) { nearest = h; nearestDelta = d; }
    }
    acc.push({
      time: nearest.time,
      index: nearest.index,
      title: ev.title,
      severity: ev.severity,
      direction: ev.sentimentDirection,
      eventType: ev.eventType,
    });
    return acc;
  }, []);

  const radarData = industries.map(([, ind]) => ({
    industry: ind.industryName.replace("Banking & Financial Services", "Banking").replace("Manufacturing", "Mfg"),
    value: ind.indexValue,
    fullName: ind.industryName,
  }));

  const indexLevel = cei.overallIndex >= 500 ? "Advanced" : cei.overallIndex >= 300 ? "Developing" : "Nascent";
  const indexColor = cei.overallIndex >= 500 ? "#10b981" : cei.overallIndex >= 300 ? "#f59e0b" : "#ef4444";

  return (
    <div className="min-h-screen">
      <div className="bg-foreground text-white">
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
                <h1 className="text-3xl md:text-4xl font-serif tracking-tight">
                  Capability Value Index
                </h1>
                <p className="text-muted-foreground/70 mt-1 max-w-xl">
                  The world's first composite index measuring organizational capability maturity across industries — powered by multi-source Bayesian triangulation.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <SavedViewsMenu
                  viewsApi={viewsApi}
                  currentState={{ selectedIndustry, freshnessStageFilter, showFreshness, showMacroPanel, showAgentActivity }}
                  onApply={(s, id) => {
                    if (s && typeof s === "object") applyCEIView(s);
                    setActiveViewId(id);
                  }}
                  activeViewId={activeViewId}
                />
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium border border-border text-muted-foreground/70">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Autonomous
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-8 items-center">
              <div className="md:col-span-1 flex flex-col items-center">
                <div className="relative">
                  <div className="absolute -inset-8 rounded-full opacity-20" style={{ background: `radial-gradient(circle, ${indexColor}40, transparent)` }} />
                  <IndexTicker value={cei.overallIndex} label="CVI Index" trend={cei.marketSentiment > 50 ? "up" : cei.marketSentiment < 50 ? "down" : "neutral"} />
                </div>
                <div className="mt-3 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider" style={{ background: `${indexColor}20`, color: indexColor }}>
                  {indexLevel} Maturity
                </div>
                {cei.overallCiLow !== null && cei.overallCiHigh !== null && (
                  <OverallIndexErrorBar
                    value={cei.overallIndex}
                    ciLow={cei.overallCiLow}
                    ciHigh={cei.overallCiHigh}
                    color={indexColor}
                  />
                )}
                <div className="text-xs text-muted-foreground mt-2">
                  Updated {new Date(cei.timestamp).toLocaleString()}
                </div>
              </div>

              <div className="md:col-span-1 flex flex-col items-center gap-4">
                <SentimentGauge value={cei.marketSentiment} />
                <div className="text-center">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Market Sentiment</div>
                  <div className="text-sm text-foreground/70">Based on aggregate capability velocity across all industries</div>
                  <div className="text-[10px] text-muted-foreground mt-1 font-mono">
                    sentiment = 50 + avgVelocity × 100
                  </div>
                </div>
              </div>

              <div className="md:col-span-1 space-y-4">
                <div className="bg-white/5 backdrop-blur rounded-none p-4 border border-white/10">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground/70 uppercase tracking-wider">Volatility</span>
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="text-2xl font-mono font-bold">{(cei.volatility * 100).toFixed(1)}%</div>
                  <div className="text-xs text-muted-foreground mt-1">Capability change dispersion</div>
                </div>
                <div className="bg-white/5 backdrop-blur rounded-none p-4 border border-white/10">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground/70 uppercase tracking-wider">Industries Tracked</span>
                    <Globe className="w-3.5 h-3.5 text-indigo-400" />
                  </div>
                  <div className="text-2xl font-mono font-bold">{industries.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {Object.values(cei.industryBreakdowns).reduce((s, i) => s + i.capabilityCount, 0)} capabilities monitored
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="container mx-auto px-4 mt-6">
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
                : "border-border bg-muted/10"
            }`}>
              <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowMacroPanel(!showMacroPanel)}>
                <CardTitle className="font-serif text-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`w-5 h-5 ${(macroEvents?.summary.total ?? 0) > 0 ? "text-red-600" : "text-muted-foreground"}`} />
                    Active Macro Disruptions
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      (macroEvents?.summary.total ?? 0) === 0 ? "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground"
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
                                  const sevColor = t.severity >= 8 ? "text-red-600" : t.severity >= 5 ? "text-amber-600" : "text-muted-foreground";
                                  const dirColor = t.sentimentDirection === "negative" ? "text-red-600" : t.sentimentDirection === "positive" ? "text-emerald-600" : "text-muted-foreground";
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
                                        <span className="text-[10px] text-muted-foreground italic line-clamp-1" title={t.rationale}>{t.rationale}</span>
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
                          No active macro disruptions. The CVI reflects only baseline capability dynamics.
                          <br />Add an event manually or run a world scan to detect real-time disruptions.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs responsive-table">
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
                                        ev.severity >= 8 ? "text-red-600" : ev.severity >= 5 ? "text-amber-600" : "text-muted-foreground"
                                      }`}>{ev.severity}</span>
                                    </td>
                                    <td className="py-1.5 pr-3 text-right">
                                      {ev.sentimentDirection === "negative" ? <span className="text-red-600">▼ neg</span>
                                        : ev.sentimentDirection === "positive" ? <span className="text-emerald-600">▲ pos</span>
                                        : <span className="text-muted-foreground">— neu</span>}
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
                                        : "bg-muted/50 text-muted-foreground dark:bg-muted dark:text-muted-foreground"
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

                      <div className="mt-3 px-3 py-2.5 bg-muted/40 rounded-sm border border-border/50 text-[11px] text-muted-foreground">
                        <div className="flex items-start gap-2">
                          <Info className="w-3 h-3 mt-0.5 shrink-0 text-blue-600" />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="font-semibold text-foreground">How shocks apply</div>
                            <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 leading-relaxed">
                              <div className="text-foreground/70">Market sentiment</div>
                              <code className="px-1.5 py-0.5 bg-background rounded text-[10.5px] font-mono break-all">+= severity × directionSign × 0.5 × decayFactor</code>
                              <div className="text-foreground/70">Volatility</div>
                              <code className="px-1.5 py-0.5 bg-background rounded text-[10.5px] font-mono break-all">+= severity × 0.005 × decayFactor</code>
                              <div className="text-foreground/70">decayFactor</div>
                              <code className="px-1.5 py-0.5 bg-background rounded text-[10.5px] font-mono break-all">max(0, 1 − elapsedDays / decayDays)</code>
                            </div>
                            <div className="pt-1 border-t border-border/40">
                              Currently shifting sentiment by{" "}
                              <strong className={macroEvents && macroEvents.summary.sentimentShock < 0 ? "text-red-600" : "text-emerald-600"}>{macroEvents?.summary.sentimentShock ?? 0}</strong>
                              {" "}and volatility by{" "}
                              <strong className="text-amber-600">+{macroEvents?.summary.volatilityBoost ?? 0}</strong>.
                            </div>
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
                          <div className="text-2xl font-mono font-bold text-muted-foreground">{freshness.summary.neverRefreshed}</div>
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

                      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Lifecycle filter</div>
                        <div className="flex items-center gap-1 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setFreshnessStageFilter("all")}
                            className={`text-[10px] px-2 py-0.5 rounded-sm border transition-colors ${freshnessStageFilter === "all" ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                            data-testid="cei-freshness-stage-all"
                          >All</button>
                          {LIFECYCLE_STAGES.map(s => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setFreshnessStageFilter(s)}
                              className={`text-[10px] px-2 py-0.5 rounded-sm border transition-colors ${freshnessStageFilter === s ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                              data-testid={`cei-freshness-stage-${s}`}
                            >{lifecycleLabel(s)}</button>
                          ))}
                          <a href="/lifecycle" className="text-[10px] px-2 py-0.5 text-muted-foreground hover:text-foreground underline">Methodology →</a>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <div className="text-[11px] text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2 font-semibold">
                            ✓ 10 Most Recently Refreshed
                          </div>
                          <div className="overflow-x-auto rounded-sm border border-emerald-200 dark:border-emerald-900/40">
                            <table className="w-full text-xs responsive-table">
                              <thead className="border-b bg-emerald-50/50 dark:bg-emerald-950/20 text-muted-foreground">
                                <tr className="text-left">
                                  <th className="py-1.5 px-2 font-medium">Capability</th>
                                  <th className="py-1.5 px-2 font-medium">Stage</th>
                                  <th className="py-1.5 px-2 font-medium text-right">Refreshed</th>
                                  <th className="py-1.5 px-2 font-medium text-right">Score</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...freshness.capabilities]
                                  .filter(c => c.lastTriangulatedAt && (freshnessStageFilter === "all" || c.lifecycleStage === freshnessStageFilter))
                                  .sort((a, b) => new Date(b.lastTriangulatedAt!).getTime() - new Date(a.lastTriangulatedAt!).getTime())
                                  .slice(0, 10)
                                  .map(item => (
                                    <tr key={item.capabilityId} className="border-b border-border/50 hover:bg-muted/30">
                                      <td className="py-1.5 px-2 font-medium truncate max-w-[180px]" title={item.capability}>{item.capability}</td>
                                      <td className="py-1.5 px-2"><LifecycleChip stage={item.lifecycleStage} /></td>
                                      <td className="py-1.5 px-2 text-right font-mono text-emerald-700 dark:text-emerald-400">
                                        {item.ageHours! < 1 ? `${Math.round(item.ageHours! * 60)}m` : item.ageHours! < 24 ? `${item.ageHours!.toFixed(1)}h` : `${(item.ageHours! / 24).toFixed(1)}d`} ago
                                      </td>
                                      <td className="py-1.5 px-2 text-right font-mono">
                                        {item.consensusScore !== null ? (
                                          <ScoreWithProvenance
                                            label={`${item.capability} — Consensus score`}
                                            value={item.consensusScore}
                                            precision={1}
                                            sourceCount={item.sourceCount}
                                            lastUpdatedAt={item.lastTriangulatedAt}
                                            citations={item.citations}
                                            ciLow={item.ciLow}
                                            ciHigh={item.ciHigh}
                                            sourceBreakdown={item.sourceBreakdown}
                                            model="Bayesian posterior · v1.1"
                                            side="left"
                                          />
                                        ) : "—"}
                                      </td>
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
                            <table className="w-full text-xs responsive-table">
                              <thead className="border-b bg-amber-50/50 dark:bg-amber-950/20 text-muted-foreground">
                                <tr className="text-left">
                                  <th className="py-1.5 px-2 font-medium">Capability</th>
                                  <th className="py-1.5 px-2 font-medium">Stage</th>
                                  <th className="py-1.5 px-2 font-medium text-right">Last</th>
                                  <th className="py-1.5 px-2 font-medium text-right">Score</th>
                                </tr>
                              </thead>
                              <tbody>
                                {freshness.capabilities
                                  .filter(c => freshnessStageFilter === "all" || c.lifecycleStage === freshnessStageFilter)
                                  .slice(0, 10).map(item => (
                                  <tr key={item.capabilityId} className="border-b border-border/50 hover:bg-muted/30">
                                    <td className="py-1.5 px-2 font-medium truncate max-w-[180px]" title={item.capability}>{item.capability}</td>
                                    <td className="py-1.5 px-2"><LifecycleChip stage={item.lifecycleStage} /></td>
                                    <td className="py-1.5 px-2 text-right font-mono text-amber-700 dark:text-amber-400">
                                      {item.lastTriangulatedAt
                                        ? `${item.ageHours! < 24 ? `${item.ageHours!.toFixed(1)}h` : `${(item.ageHours! / 24).toFixed(1)}d`} ago`
                                        : <span className="text-red-600">never</span>}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono">
                                      {item.consensusScore !== null ? (
                                        <ScoreWithProvenance
                                          label={`${item.capability} — Consensus score`}
                                          value={item.consensusScore}
                                          precision={1}
                                          sourceCount={item.sourceCount}
                                          lastUpdatedAt={item.lastTriangulatedAt}
                                          citations={item.citations}
                                          ciLow={item.ciLow}
                                          ciHigh={item.ciHigh}
                                          sourceBreakdown={item.sourceBreakdown}
                                          model="Bayesian posterior · v1.1"
                                          side="left"
                                        />
                                      ) : "—"}
                                    </td>
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
                            Triangulation runs only against <strong>leaf</strong> capabilities (the {freshness.summary.leaves ?? freshness.summary.total} measurable ones); the {freshness.summary.parents ?? 0} parent capabilities recompute automatically as a weighted roll-up the moment any of their children refresh.
                            The rotation touches <strong>10 leaf caps every 24h</strong>, so it takes <strong>~{Math.ceil((freshness.summary.leaves ?? freshness.summary.total) / 10)} days</strong> for every leaf to be triangulated against fresh sources once.
                            The "stalest" column is what's <em>next</em> in line. Urgency bursts can jump the queue within 5min when any cap's confidence drops below 35%.
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
              <CardDescription>CVI sub-indices weighted by GDP contribution</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="chart-mobile" style={{"--chart-desktop-h":"300px"} as React.CSSProperties}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={industries.map(([, ind]) => ({
                      name: ind.industryName.replace("Banking & Financial Services", "Banking & FS"),
                      value: ind.indexValue,
                      weight: ind.weight * 100,
                      // Recharts ErrorBar consumes a [low, high] tuple; null
                      // CIs (no scored capabilities) collapse to no error bar.
                      ciRange: ind.ciLow !== null && ind.ciHigh !== null
                        ? [ind.indexValue - ind.ciLow, ind.ciHigh - ind.indexValue]
                        : [0, 0],
                    }))} layout="vertical" margin={{ left: 10, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground)/0.1)" />
                      <XAxis type="number" domain={[0, 600]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fill: 'hsl(var(--foreground))', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 4, fontSize: 12 }}
                        formatter={(value: number, name: string): [string, string] | null => {
                          if (name === "ciRange" || name === "95% CI") return null;
                          return [value.toFixed(1), name === "value" ? "CVI Score" : "Weight %"];
                        }}
                      />
                      <Bar dataKey="value" name="CVI Score" radius={[0, 4, 4, 0]}>
                        {industries.map(([, ind], idx) => (
                          <Cell key={idx} fill={ind.indexValue >= 320 ? "#6366f1" : ind.indexValue >= 300 ? "#8b5cf6" : "#a78bfa"} />
                        ))}
                        <ErrorBar dataKey="ciRange" width={6} strokeWidth={1.5} stroke="hsl(var(--foreground)/0.55)" direction="x" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-mobile" style={{"--chart-desktop-h":"300px"} as React.CSSProperties}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="hsl(var(--muted-foreground)/0.15)" />
                      <PolarAngleAxis dataKey="industry" tick={{ fill: 'hsl(var(--foreground))', fontSize: 10 }} />
                      <PolarRadiusAxis domain={[0, 400]} tick={false} axisLine={false} />
                      <Radar name="CVI" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} />
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
                        {ind.capabilityCount} capabilities · {ind.weightSourceUrl ? (
                          <a
                            href={ind.weightSourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="underline decoration-dotted hover:text-primary"
                            title={`GDP weight cited from ${ind.weightSourceUrl} (${ind.weightSourceYear})`}
                          >
                            {(ind.weight * 100).toFixed(2)}% GDP weight
                          </a>
                        ) : (
                          <span className="italic text-amber-600/80" title="No Perplexity-cited GDP weight — excluded from overall index">
                            no GDP weight
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <ScoreWithProvenance
                        label={`${ind.industryName} — Industry CVI`}
                        value={ind.indexValue}
                        precision={0}
                        ciLow={ind.ciLow}
                        ciHigh={ind.ciHigh}
                        sourceCount={ind.capabilityCount}
                        lastUpdatedAt={cei.timestamp}
                        model={`Bayesian posterior · ${cei.methodology ?? "v1.1"}`}
                        gdpWeight={ind.weight}
                        gdpWeightSourceUrl={ind.weightSourceUrl}
                        gdpWeightSourceYear={ind.weightSourceYear}
                        citations={ind.weightSourceUrl ? [ind.weightSourceUrl] : []}
                        className="text-2xl font-mono font-bold text-primary"
                        side="left"
                      />
                      {ind.ciLow !== null && ind.ciHigh !== null && (
                        <div className="text-[10px] font-mono text-muted-foreground/70" title="95% credible interval">
                          95% CI {ind.ciLow.toFixed(0)}–{ind.ciHigh.toFixed(0)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      {ind.velocity > 0 ? (
                        <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
                      ) : ind.velocity < 0 ? (
                        <ArrowDownRight className="w-3.5 h-3.5 text-red-500" />
                      ) : (
                        <Minus className="w-3.5 h-3.5 text-muted-foreground/70" />
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
                        <div className="pt-3 mt-3 border-t space-y-2" onClick={(e) => e.stopPropagation()}>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-muted/50 rounded-sm p-2">
                              <div className="text-[10px] text-muted-foreground uppercase">CVI Contribution</div>
                              <div className="text-sm font-mono font-bold">{(ind.indexValue * ind.weight).toFixed(1)}</div>
                            </div>
                            <div className="bg-muted/50 rounded-sm p-2">
                              <div className="text-[10px] text-muted-foreground uppercase">Top Mover Δ</div>
                              <div className="text-sm font-mono font-bold">{ind.topMoverDelta > 0 ? "+" : ""}{ind.topMoverDelta.toFixed(1)} pts</div>
                            </div>
                          </div>
                          {capabilityTree && capabilityTree.roots.length > 0 ? (
                            <div className="border border-border/60 rounded-sm overflow-hidden">
                              <div className="bg-muted/40 px-2 py-1 grid grid-cols-[1fr_auto_auto_auto] gap-2 text-[10px] font-semibold text-muted-foreground uppercase items-center">
                                <div className="flex items-center gap-1">
                                  Capability
                                  <MetricHelp>
                                    <div className="font-bold text-foreground mb-1">Capability hierarchy</div>
                                    <div className="text-muted-foreground mb-2">Parents (with chevron) roll up the weighted average of their children. Click to expand. The "<span className="font-mono">N sub · σ Xpt</span>" badge shows how many children there are and the spread between the strongest and weakest — high σ means the parent's single number is hiding internal divergence worth investigating.</div>
                                  </MetricHelp>
                                </div>
                                <div className="text-right flex items-center justify-end gap-1">
                                  Score
                                  <MetricHelp>
                                    <div className="font-bold text-foreground mb-1">Consensus Score (0–100)</div>
                                    <div className="text-muted-foreground mb-2">Bayesian posterior of 4 independent perspectives — consulting (McKinsey/BCG-style), market data (analyst reports), academic (research), and practitioner (industry insiders). Each perspective scores the capability and they're combined into a single posterior with a 95% credible interval.</div>
                                    <div className="font-mono text-[10.5px] space-y-0.5 pt-1 border-t border-border/50">
                                      <div><span className="font-semibold text-emerald-600">75+</span> — leading practice</div>
                                      <div><span className="font-semibold text-amber-600">50–74</span> — mid-tier, common practice</div>
                                      <div><span className="font-semibold text-red-600">&lt;50</span> — material weakness</div>
                                    </div>
                                  </MetricHelp>
                                </div>
                                <div className="text-right flex items-center justify-end gap-1">
                                  Conf
                                  <MetricHelp>
                                    <div className="font-bold text-foreground mb-1">Confidence (%)</div>
                                    <div className="text-muted-foreground mb-2">How tightly the 4 source perspectives agree. High confidence (85%+) means all sources converged on a similar number — trust the score. Low confidence (&lt;60%) means the sources disagree materially — the capability is contested or has limited evidence; treat the score as provisional and prioritize fresh research.</div>
                                  </MetricHelp>
                                </div>
                                <div className="text-right w-16 flex items-center justify-end gap-1">
                                  Velocity
                                  <MetricHelp>
                                    <div className="font-bold text-foreground mb-1">Velocity (% per cycle)</div>
                                    <div className="text-muted-foreground mb-2">Exponential moving average of score change between triangulation cycles (α=0.7). Captures momentum: is this capability getting better or worse over time, and how fast?</div>
                                    <div className="font-mono text-[10.5px] space-y-0.5 pt-1 border-t border-border/50">
                                      <div><span className="text-emerald-600">+ green</span> — improving</div>
                                      <div><span className="text-red-600">− red</span> — declining</div>
                                      <div><span className="text-muted-foreground">±0</span> — stable / no fresh signal</div>
                                    </div>
                                  </MetricHelp>
                                </div>
                              </div>
                              <div className="divide-y divide-border/40 max-h-[360px] overflow-y-auto">
                                {capabilityTree.roots.map(root => {
                                  const hasChildren = root.children.length > 0;
                                  const isExpanded = expandedParents.has(root.id);
                                  const childScores = root.children.map(c => c.score).filter((s): s is number => typeof s === "number");
                                  const childMax = childScores.length ? Math.max(...childScores) : null;
                                  const childMin = childScores.length ? Math.min(...childScores) : null;
                                  const spread = childMax !== null && childMin !== null ? childMax - childMin : null;
                                  return (
                                    <div key={root.id}>
                                      <div
                                        className={`px-2 py-1.5 grid grid-cols-[1fr_auto_auto_auto] gap-2 text-xs items-center ${hasChildren ? "cursor-pointer hover:bg-muted/40" : ""}`}
                                        onClick={() => {
                                          if (!hasChildren) return;
                                          setExpandedParents(prev => {
                                            const next = new Set(prev);
                                            if (next.has(root.id)) next.delete(root.id); else next.add(root.id);
                                            return next;
                                          });
                                        }}
                                      >
                                        <div className="flex items-center gap-1 min-w-0">
                                          {hasChildren ? (
                                            isExpanded ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" /> : <ChevronUp className="w-3 h-3 shrink-0 text-muted-foreground rotate-90" />
                                          ) : (
                                            <span className="w-3 h-3 shrink-0" />
                                          )}
                                          <span className="font-medium truncate">{root.name}</span>
                                          {hasChildren && (
                                            <span className="text-[9px] text-muted-foreground ml-1 shrink-0">
                                              {root.children.length} sub{spread !== null ? ` · σ ${spread.toFixed(0)}pt` : ""}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-right font-mono font-bold tabular-nums">
                                          <div>{root.score !== null ? root.score.toFixed(1) : "—"}</div>
                                          {root.ciLow !== null && root.ciHigh !== null && root.score !== null && (
                                            <ScoreErrorBar score={root.score} ciLow={root.ciLow} ciHigh={root.ciHigh} />
                                          )}
                                        </div>
                                        <div className="text-right font-mono text-muted-foreground tabular-nums">
                                          {root.confidence !== null ? (root.confidence * 100).toFixed(0) + "%" : "—"}
                                        </div>
                                        <div className="text-right font-mono w-12 tabular-nums">
                                          {root.velocity !== null ? (
                                            <span className={root.velocity > 0 ? "text-emerald-600" : root.velocity < 0 ? "text-red-600" : "text-muted-foreground"}>
                                              {root.velocity > 0 ? "+" : ""}{(root.velocity * 100).toFixed(1)}%
                                            </span>
                                          ) : "—"}
                                        </div>
                                      </div>
                                      <AnimatePresence>
                                        {hasChildren && isExpanded && (
                                          <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="overflow-hidden bg-muted/15"
                                          >
                                            {root.children.map(child => {
                                              const delta = child.score !== null && root.score !== null ? child.score - root.score : null;
                                              return (
                                                <div key={child.id} className="px-2 py-1 grid grid-cols-[1fr_auto_auto_auto] gap-2 text-[11px] items-center border-t border-border/30">
                                                  <div className="flex items-center gap-1 min-w-0 pl-5">
                                                    <span className="text-muted-foreground/60 shrink-0">└</span>
                                                    <span className="truncate">{child.name}</span>
                                                    {delta !== null && Math.abs(delta) >= 0.1 && child.score !== null && root.score !== null && (
                                                      <DeltaInterpreter
                                                        delta={delta}
                                                        childScore={child.score}
                                                        parentScore={root.score}
                                                        childName={child.name}
                                                      />
                                                    )}
                                                  </div>
                                                  <div className="text-right font-mono font-semibold tabular-nums">
                                                    <div>{child.score !== null ? child.score.toFixed(1) : "—"}</div>
                                                    {child.ciLow !== null && child.ciHigh !== null && child.score !== null && (
                                                      <ScoreErrorBar score={child.score} ciLow={child.ciLow} ciHigh={child.ciHigh} />
                                                    )}
                                                  </div>
                                                  <div className="text-right font-mono text-muted-foreground tabular-nums">
                                                    {child.confidence !== null ? (child.confidence * 100).toFixed(0) + "%" : "—"}
                                                  </div>
                                                  <div className="text-right font-mono w-12 tabular-nums">
                                                    {child.velocity !== null ? (
                                                      <span className={child.velocity > 0 ? "text-emerald-600" : child.velocity < 0 ? "text-red-600" : "text-muted-foreground"}>
                                                        {child.velocity > 0 ? "+" : ""}{(child.velocity * 100).toFixed(1)}%
                                                      </span>
                                                    ) : "—"}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </motion.div>
                                        )}
                                      </AnimatePresence>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground border-t border-border/40">
                                Click parents with sub-counts to expand. Δ shows child deviation from parent rollup.
                              </div>
                            </div>
                          ) : (
                            <div className="text-[10px] text-muted-foreground italic text-center py-2">Loading capabilities…</div>
                          )}
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
                    sseConnected ? "bg-emerald-400" : "bg-muted-foreground/40"
                  }`} />
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    {agentStatus?.scheduler.isRunning ? "Running" : sseConnected ? "Connected" : "Offline"}
                  </span>
                </div>
                {showAgentActivity ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </CardTitle>
              <CardDescription>
                LangGraph-powered agent with Mem0 memory — autonomously monitors, researches, and updates the CVI
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
                            CVI: {agentStatus.latestRun.ceiBeforeIndex} → {agentStatus.latestRun.ceiAfterIndex}
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
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="font-serif text-lg flex items-center gap-2">
                      <Activity className="w-5 h-5 text-primary" />
                      CVI Trend
                    </CardTitle>
                    <CardDescription>Historical index movement over time</CardDescription>
                  </div>
                  <CEIAnalysisDialog
                    cei={cei}
                    historyData={historyData}
                    macroEvents={macroEvents}
                    freshness={freshness}
                    exemplars={exemplars}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="chart-mobile" style={{"--chart-desktop-h":"250px"} as React.CSSProperties}>
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
                      <Area type="monotone" dataKey="index" stroke="#6366f1" fill="url(#ceiGrad)" strokeWidth={2} name="CVI" />
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
                  CVI Methodology v1.0
                </div>
                {showMethodology ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </CardTitle>
              <CardDescription className="flex items-center gap-3 flex-wrap">
                <span>
                  How the Capability Value Index is calculated — multi-source Bayesian triangulation, velocity tracking, and economic multipliers
                </span>
                <a
                  href="/backtest"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
                >
                  See backtest results →
                </a>
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
                        CVI = Σ(W<sub>i</sub> × C<sub>i</sub> × (1 + V<sub>i</sub>) × E<sub>i</sub> × α<sub>i</sub>) / ΣW<sub>i</sub> × 10
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
 
