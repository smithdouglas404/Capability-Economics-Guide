import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Lightbulb, AlertTriangle, TrendingUp, Shield, Trophy,
  FileText, Brain, Loader2, Sparkles, ArrowRight, ExternalLink,
  CircleDot, ChevronRight, BookOpen, Award, Target, Zap,
  RefreshCw, Filter
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
  Cell, Treemap
} from "recharts";

const API_BASE = "/api";

function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(url);
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error("API error:", e);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { data, loading, refetch: fetch_ };
}

type DataSource = {
  id: number;
  title: string;
  url: string | null;
  publisher: string | null;
  sourceType: string;
};

type ThresholdItem = {
  id: number;
  capabilityId: number;
  capabilityName: string;
  capabilitySlug: string;
  industryId: number;
  benchmarkScore: number;
  greenMin: number;
  yellowMin: number;
  redMax: number;
  description: string | null;
  sourceIds: number[] | null;
  status: "green" | "yellow" | "red";
};

type InsightItem = {
  id: number;
  capabilityId: number | null;
  industryId: number | null;
  insightType: string;
  title: string;
  content: string;
  severity: string;
  recommendation: string | null;
  generatedAt: string;
};

type LeaderboardEntry = {
  id: number;
  industryId: number;
  industryName: string;
  companyName: string;
  overallMaturity: number;
  topCapability: string;
  topCapabilityScore: number;
  weakestCapability: string;
  weakestCapabilityScore: number;
  investmentLevel: string;
  trend: string;
  rank: number;
  sourceIds: number[] | null;
};

type WhitePaper = {
  id: number;
  industryId: number;
  industryName: string;
  title: string;
  author: string;
  organization: string;
  abstract: string;
  category: string;
  url: string | null;
  publishedYear: number;
  relevanceScore: number;
  tags: string;
  sourceIds: number[] | null;
};

type OntologyRel = {
  id: number;
  sourceName: string;
  targetName: string;
  relationshipType: string;
  strength: string;
  description: string;
};

type OntologyAdapter = {
  id: number;
  adapterName: string;
  adapterDescription: string;
  capabilityFocusAreas: string;
  maturityModel: string;
  keyDifferentiators: string;
};

type Industry = {
  id: number;
  slug: string;
  name: string;
};

const sourceCache = new Map<number, DataSource>();
let pendingIds = new Set<number>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let batchListeners: Array<() => void> = [];

function scheduleBatch() {
  if (batchTimer) return;
  batchTimer = setTimeout(async () => {
    batchTimer = null;
    const ids = [...pendingIds];
    pendingIds = new Set();
    if (ids.length === 0) return;

    const missing = ids.filter(id => !sourceCache.has(id));
    if (missing.length > 0) {
      try {
        const resp = await fetch(`${API_BASE}/data-sources?ids=${missing.join(",")}`);
        const data: DataSource[] = await resp.json();
        for (const s of data) sourceCache.set(s.id, s);
      } catch {}
    }
    const cbs = batchListeners;
    batchListeners = [];
    cbs.forEach(cb => cb());
  }, 50);
}

function useDataSources(sourceIds: number[] | null | undefined): DataSource[] {
  const [sources, setSources] = useState<DataSource[]>([]);
  const key = sourceIds?.join(",") ?? "";

  useEffect(() => {
    if (!sourceIds || sourceIds.length === 0) return;
    const ids = [...new Set(sourceIds)].slice(0, 5);

    const allCached = ids.every(id => sourceCache.has(id));
    if (allCached) {
      setSources(ids.map(id => sourceCache.get(id)!));
      return;
    }

    for (const id of ids) pendingIds.add(id);
    const listener = () => {
      setSources(ids.map(id => sourceCache.get(id)!).filter(Boolean));
    };
    batchListeners.push(listener);
    scheduleBatch();
  }, [key]);

  return sources;
}

function SourceBadges({ sourceIds }: { sourceIds: number[] | null | undefined }) {
  const sources = useDataSources(sourceIds);
  if (!sources.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {sources.slice(0, 3).map(s => (
        <a
          key={s.id}
          href={s.url || "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-indigo-50 text-indigo-600 text-[10px] font-medium hover:bg-indigo-100 transition-colors border border-indigo-100"
        >
          <ExternalLink className="w-2.5 h-2.5" />
          {s.publisher || s.title}
        </a>
      ))}
      {sources.length > 3 && (
        <span className="text-[10px] text-muted-foreground px-1">+{sources.length - 3} more</span>
      )}
    </div>
  );
}

const statusColors = {
  green: { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300", dot: "bg-emerald-500" },
  yellow: { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-300", dot: "bg-amber-500" },
  red: { bg: "bg-red-100", text: "text-red-700", border: "border-red-300", dot: "bg-red-500" },
};

const severityConfig: Record<string, { bg: string; text: string; icon: React.ElementType; border: string }> = {
  critical: { bg: "bg-red-50", text: "text-red-700", icon: AlertTriangle, border: "border-l-red-500" },
  warning: { bg: "bg-amber-50", text: "text-amber-700", icon: Shield, border: "border-l-amber-500" },
  info: { bg: "bg-blue-50", text: "text-blue-700", icon: Lightbulb, border: "border-l-blue-500" },
};

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

const relTypeColors: Record<string, string> = {
  enables: "#6366f1",
  depends_on: "#f59e0b",
  competes_with: "#ef4444",
  substitutes: "#8b5cf6",
};

export default function Insights() {
  const [activeTab, setActiveTab] = useState<"overview" | "leaderboard" | "ontology" | "papers">("overview");
  const [selectedIndustry, setSelectedIndustry] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [aiInsights, setAiInsights] = useState<Array<{ title: string; content: string; recommendation: string; severity: string }>>([]);

  const industryParam = selectedIndustry ? `?industryId=${selectedIndustry}` : "";
  const { data: industries } = useApi<Industry[]>(`${API_BASE}/industries`);
  const { data: thresholds, loading: loadingThresholds } = useApi<ThresholdItem[]>(`${API_BASE}/thresholds${industryParam}`);
  const { data: insights, loading: loadingInsights } = useApi<InsightItem[]>(`${API_BASE}/insights${industryParam}`);
  const { data: leaderboard } = useApi<LeaderboardEntry[]>(`${API_BASE}/leaderboard${industryParam}`);
  const { data: papers } = useApi<WhitePaper[]>(`${API_BASE}/white-papers${industryParam}`);
  const { data: ontology } = useApi<{ relationships: OntologyRel[]; adapters: OntologyAdapter[] }>(`${API_BASE}/ontology${industryParam}`);

  const redCount = thresholds?.filter(t => t.status === "red").length || 0;
  const yellowCount = thresholds?.filter(t => t.status === "yellow").length || 0;
  const greenCount = thresholds?.filter(t => t.status === "green").length || 0;

  const generateAiInsights = async () => {
    if (!selectedIndustry) return;
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/insights/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industryId: selectedIndustry }),
      });
      const data = await res.json();
      if (data.insights) setAiInsights(data.insights);
    } catch (e) {
      console.error("Failed to generate insights:", e);
    } finally {
      setGenerating(false);
    }
  };

  const tabs = [
    { key: "overview" as const, label: "Insights & Alerts", icon: Lightbulb },
    { key: "leaderboard" as const, label: "Industry Leaderboard", icon: Trophy },
    { key: "ontology" as const, label: "Capability Ontology", icon: Brain },
    { key: "papers" as const, label: "White Papers", icon: BookOpen },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      <section className="bg-muted/10 py-12 border-b border-border/40">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">AI-Powered Advisory</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-serif tracking-tight mb-4 text-foreground">
            Insights & Recommendations
          </h1>
          <p className="text-lg text-foreground/60 font-serif italic max-w-3xl">
            AI-driven analysis of capability maturity, threshold alerts, industry benchmarks, and strategic recommendations.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Filter className="w-4 h-4" />
              <span>Filter by industry:</span>
            </div>
            <Button
              variant={selectedIndustry === null ? "default" : "outline"}
              size="sm"
              className="rounded-sm text-xs"
              onClick={() => setSelectedIndustry(null)}
            >
              All Industries
            </Button>
            {industries?.map(ind => (
              <Button
                key={ind.id}
                variant={selectedIndustry === ind.id ? "default" : "outline"}
                size="sm"
                className="rounded-sm text-xs"
                onClick={() => setSelectedIndustry(ind.id)}
              >
                {ind.name}
              </Button>
            ))}
          </div>

          <div className="flex gap-2 mt-6 border-b -mb-12 pb-0">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 max-w-6xl py-8">
        {activeTab === "overview" && (
          <div className="space-y-8">
            <div className="grid md:grid-cols-4 gap-4">
              <Card className="rounded-none border-l-4 border-l-red-500">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-3xl font-mono font-bold text-red-700">{redCount}</div>
                      <div className="text-sm text-muted-foreground mt-1">Critical (Red)</div>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Capabilities below minimum viable threshold</p>
                </CardContent>
              </Card>
              <Card className="rounded-none border-l-4 border-l-amber-500">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-3xl font-mono font-bold text-amber-700">{yellowCount}</div>
                      <div className="text-sm text-muted-foreground mt-1">At Risk (Yellow)</div>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                      <Shield className="w-5 h-5 text-amber-600" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Capabilities approaching danger zone</p>
                </CardContent>
              </Card>
              <Card className="rounded-none border-l-4 border-l-emerald-500">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-3xl font-mono font-bold text-emerald-700">{greenCount}</div>
                      <div className="text-sm text-muted-foreground mt-1">On Track (Green)</div>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-emerald-600" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Meeting or exceeding industry benchmarks</p>
                </CardContent>
              </Card>
              <Card className="rounded-none border-l-4 border-l-primary">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-3xl font-mono font-bold text-primary">{insights?.length || 0}</div>
                      <div className="text-sm text-muted-foreground mt-1">Active Insights</div>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Lightbulb className="w-5 h-5 text-primary" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Strategic recommendations available</p>
                </CardContent>
              </Card>
            </div>

            {selectedIndustry && (
              <Card className="rounded-none bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
                <CardContent className="py-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Sparkles className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">AI Capability Analysis</h3>
                        <p className="text-sm text-muted-foreground">Generate fresh AI-powered insights for this industry using real-time capability data</p>
                      </div>
                    </div>
                    <Button onClick={generateAiInsights} disabled={generating} className="rounded-sm">
                      {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Brain className="w-4 h-4 mr-2" />}
                      {generating ? "Analyzing..." : "Generate Insights"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {aiInsights.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-xl font-serif text-foreground flex items-center gap-2">
                  <Brain className="w-5 h-5 text-primary" />
                  AI-Generated Analysis
                </h2>
                <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
                  {aiInsights.map((insight, idx) => {
                    const config = severityConfig[insight.severity] || severityConfig.info;
                    const SevIcon = config.icon;
                    return (
                      <motion.div key={idx} variants={item}>
                        <Card className={`rounded-none border-l-4 ${config.border}`}>
                          <CardContent className="py-4">
                            <div className="flex items-start gap-3">
                              <div className={`p-1.5 rounded-md ${config.bg}`}>
                                <SevIcon className={`w-4 h-4 ${config.text}`} />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <h3 className="font-semibold text-foreground text-sm">{insight.title}</h3>
                                  <span className={`px-2 py-0.5 rounded-sm text-xs font-medium ${config.bg} ${config.text}`}>{insight.severity}</span>
                                  <span className="px-2 py-0.5 rounded-sm text-xs font-medium bg-primary/10 text-primary">AI Generated</span>
                                </div>
                                <p className="text-sm text-muted-foreground leading-relaxed">{insight.content}</p>
                                {insight.recommendation && (
                                  <div className="mt-2 flex items-start gap-2 bg-muted/40 rounded-sm p-3">
                                    <Target className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                                    <p className="text-sm text-foreground">{insight.recommendation}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </div>
            )}

            <div className="grid lg:grid-cols-2 gap-8">
              <Card className="rounded-none">
                <CardHeader>
                  <CardTitle className="font-serif text-lg">Capability Health Matrix</CardTitle>
                  <CardDescription>Traffic-light view of all capability maturity levels vs. thresholds</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingThresholds ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                  ) : (
                    <div className="h-[400px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={thresholds?.map(t => ({
                            name: t.capabilityName.length > 16 ? t.capabilityName.substring(0, 14) + "..." : t.capabilityName,
                            score: t.benchmarkScore,
                            greenMin: t.greenMin,
                            yellowMin: t.yellowMin,
                            status: t.status,
                          })) || []}
                          layout="vertical"
                          margin={{ left: 10, right: 20 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground)/0.15)" />
                          <XAxis type="number" domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                          <YAxis type="category" dataKey="name" width={120} tick={{ fill: 'hsl(var(--foreground))', fontSize: 9 }} />
                          <Tooltip
                            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 4, fontSize: 12 }}
                            formatter={(value: number) => [value, "Score"]}
                          />
                          <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                            {thresholds?.map((t, idx) => (
                              <Cell key={idx} fill={t.status === "green" ? "#10b981" : t.status === "yellow" ? "#f59e0b" : "#ef4444"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <h2 className="text-xl font-serif text-foreground flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  Active Alerts
                </h2>
                {loadingInsights ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : (
                  <motion.div variants={container} initial="hidden" animate="show" className="space-y-3 max-h-[430px] overflow-y-auto pr-1">
                    {insights?.map(insight => {
                      const config = severityConfig[insight.severity] || severityConfig.info;
                      const SevIcon = config.icon;
                      return (
                        <motion.div key={insight.id} variants={item}>
                          <Card className={`rounded-none border-l-4 ${config.border}`}>
                            <CardContent className="py-3">
                              <div className="flex items-start gap-2">
                                <SevIcon className={`w-4 h-4 ${config.text} mt-0.5 shrink-0`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-semibold text-foreground truncate">{insight.title}</span>
                                    <span className={`shrink-0 px-1.5 py-0.5 rounded-sm text-xs font-medium ${config.bg} ${config.text}`}>{insight.severity}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground line-clamp-2">{insight.content}</p>
                                  {insight.recommendation && (
                                    <p className="text-xs text-primary mt-1 font-medium flex items-center gap-1">
                                      <ArrowRight className="w-3 h-3" />
                                      {insight.recommendation.length > 100 ? insight.recommendation.substring(0, 97) + "..." : insight.recommendation}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                    {(!insights || insights.length === 0) && (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        No insights available. Select an industry and generate AI insights.
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
            </div>

            {thresholds && thresholds.length > 0 && (
              <Card className="rounded-none">
                <CardHeader>
                  <CardTitle className="font-serif text-lg">Threshold Status Detail</CardTitle>
                  <CardDescription>Every capability scored against its maturity threshold</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {thresholds.map(t => {
                      const colors = statusColors[t.status];
                      return (
                        <div key={t.id} className={`p-3 rounded-sm border ${colors.border}`}>
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${colors.dot} shrink-0`} />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-foreground truncate block">{t.capabilityName}</span>
                              <span className="text-xs text-muted-foreground">Score: {t.benchmarkScore} | Threshold: {t.greenMin}</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded-sm text-xs font-bold uppercase ${colors.bg} ${colors.text}`}>
                              {t.status}
                            </span>
                          </div>
                          {t.description && (
                            <p className="text-[11px] text-muted-foreground mt-1.5 ml-6 italic">{t.description}</p>
                          )}
                          <div className="ml-6">
                            <SourceBadges sourceIds={t.sourceIds} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {activeTab === "leaderboard" && (
          <div className="space-y-8">
            <div className="bg-muted/40 border rounded-sm p-6">
              <h2 className="text-lg font-serif mb-2 text-foreground flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" />
                Industry Capability Leaderboard
              </h2>
              <p className="text-sm text-muted-foreground">
                How leading organizations compare on capability maturity across industries. Use this benchmark to understand where you stand relative to industry leaders and identify the capability investments that separate top performers from the rest.
              </p>
            </div>

            {leaderboard && (() => {
              const byIndustry = leaderboard.reduce((acc, e) => {
                const key = e.industryName;
                if (!acc[key]) acc[key] = [];
                acc[key].push(e);
                return acc;
              }, {} as Record<string, LeaderboardEntry[]>);

              return (
                <div className="space-y-8">
                  {Object.entries(byIndustry).map(([industryName, entries]) => (
                    <Card key={industryName} className="rounded-none">
                      <CardHeader>
                        <CardTitle className="font-serif text-lg">{industryName}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid lg:grid-cols-2 gap-6">
                          <div className="h-[250px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={entries} layout="vertical" margin={{ left: 0, right: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground)/0.15)" />
                                <XAxis type="number" domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                                <YAxis type="category" dataKey="companyName" width={120} tick={{ fill: 'hsl(var(--foreground))', fontSize: 11 }} />
                                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 4, fontSize: 12 }} />
                                <Bar dataKey="overallMaturity" name="Overall Maturity" radius={[0, 4, 4, 0]}>
                                  {entries.map((entry, idx) => (
                                    <Cell key={idx} fill={entry.companyName === "Industry Average" ? "hsl(var(--muted-foreground)/0.3)" : idx === 0 ? "#6366f1" : idx === 1 ? "#8b5cf6" : "#a78bfa"} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>

                          <div className="space-y-3">
                            {entries.map((entry, idx) => (
                              <div key={entry.id} className={`flex items-center gap-4 p-3 rounded-sm border ${entry.companyName === "Industry Average" ? "bg-muted/30" : ""}`}>
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                  idx === 0 ? "bg-amber-100 text-amber-700" : idx === 1 ? "bg-slate-100 text-slate-700" : idx === 2 ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground"
                                }`}>
                                  {entry.companyName === "Industry Average" ? "—" : `#${entry.rank}`}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-foreground">{entry.companyName}</span>
                                    {entry.trend === "improving" && <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
                                  </div>
                                  <div className="flex items-center gap-3 mt-0.5">
                                    <span className="text-xs text-emerald-600">Best: {entry.topCapability} ({entry.topCapabilityScore})</span>
                                    <span className="text-xs text-red-500">Gap: {entry.weakestCapability} ({entry.weakestCapabilityScore})</span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-lg font-mono font-bold text-primary">{entry.overallMaturity}</div>
                                  <div className="text-xs text-muted-foreground">maturity</div>
                                </div>
                              </div>
                            ))}
                            {entries[0]?.sourceIds && (
                              <div className="pt-2 border-t">
                                <SourceBadges sourceIds={entries[0].sourceIds} />
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === "ontology" && (
          <div className="space-y-8">
            <div className="bg-muted/40 border rounded-sm p-6">
              <h2 className="text-lg font-serif mb-2 text-foreground flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                Capability Economics Ontology
              </h2>
              <p className="text-sm text-muted-foreground">
                The ontology maps how capabilities relate to each other — which capabilities enable others, which compete for resources, and which can substitute. Industry adapters customize the base ontology for sector-specific capability dynamics.
              </p>
            </div>

            <div className="flex flex-wrap gap-4 mb-4">
              {Object.entries(relTypeColors).map(([type, color]) => (
                <div key={type} className="flex items-center gap-2 text-sm">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-muted-foreground capitalize">{type.replace("_", " ")}</span>
                </div>
              ))}
            </div>

            {ontology && ontology.relationships.length > 0 && (
              <Card className="rounded-none">
                <CardHeader>
                  <CardTitle className="font-serif text-lg">Capability Relationship Map</CardTitle>
                  <CardDescription>{ontology.relationships.length} relationships mapped across capabilities</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {ontology.relationships.map(rel => (
                      <div key={rel.id} className="flex items-center gap-3 p-3 rounded-sm border hover:border-primary/30 transition-colors">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-sm font-semibold text-foreground truncate">{rel.sourceName}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <div className="w-8 h-0.5" style={{ backgroundColor: relTypeColors[rel.relationshipType] || "#888" }} />
                            <ChevronRight className="w-3 h-3" style={{ color: relTypeColors[rel.relationshipType] || "#888" }} />
                          </div>
                          <span className="text-sm font-semibold text-foreground truncate">{rel.targetName}</span>
                        </div>
                        <span className="px-2 py-0.5 rounded-sm text-xs font-medium capitalize shrink-0" style={{ backgroundColor: `${relTypeColors[rel.relationshipType]}15`, color: relTypeColors[rel.relationshipType] }}>
                          {rel.relationshipType.replace("_", " ")}
                        </span>
                        <span className={`px-2 py-0.5 rounded-sm text-xs text-muted-foreground bg-muted shrink-0`}>
                          {rel.strength}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {ontology && ontology.adapters.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-xl font-serif text-foreground">Industry Ontology Adapters</h2>
                {ontology.adapters.map(adapter => (
                  <Card key={adapter.id} className="rounded-none">
                    <CardHeader>
                      <CardTitle className="font-serif text-lg">{adapter.adapterName}</CardTitle>
                      <CardDescription>{adapter.adapterDescription}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Focus Areas</h4>
                        <div className="flex flex-wrap gap-2">
                          {adapter.capabilityFocusAreas.split("|").map((area, idx) => (
                            <span key={idx} className="px-2.5 py-1 rounded-sm text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                              {area.trim()}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Maturity Levels</h4>
                        <div className="space-y-2">
                          {adapter.maturityModel.split("|").map((level, idx) => {
                            const [label, ...desc] = level.split(" - ");
                            return (
                              <div key={idx} className="flex items-start gap-3">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                  idx === 4 ? "bg-emerald-100 text-emerald-700" :
                                  idx === 3 ? "bg-blue-100 text-blue-700" :
                                  idx === 2 ? "bg-amber-100 text-amber-700" :
                                  idx === 1 ? "bg-orange-100 text-orange-700" :
                                  "bg-red-100 text-red-700"
                                }`}>
                                  {idx + 1}
                                </div>
                                <div>
                                  <span className="text-sm font-semibold text-foreground">{label.trim()}</span>
                                  {desc.length > 0 && <span className="text-sm text-muted-foreground"> — {desc.join(" - ").trim()}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="bg-muted/40 rounded-sm p-4">
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Key Differentiators</h4>
                        <p className="text-sm text-foreground leading-relaxed">{adapter.keyDifferentiators}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "papers" && (
          <div className="space-y-8">
            <div className="bg-muted/40 border rounded-sm p-6">
              <h2 className="text-lg font-serif mb-2 text-foreground flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-primary" />
                Research & White Papers
              </h2>
              <p className="text-sm text-muted-foreground">
                Curated collection of research papers, industry reports, and strategic frameworks relevant to capability economics. Each paper is scored for relevance to your industry context.
              </p>
            </div>

            {papers && (() => {
              const byIndustry = papers.reduce((acc, p) => {
                if (!acc[p.industryName]) acc[p.industryName] = [];
                acc[p.industryName].push(p);
                return acc;
              }, {} as Record<string, WhitePaper[]>);

              return (
                <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
                  {Object.entries(byIndustry).map(([industryName, industryPapers]) => (
                    <div key={industryName}>
                      <h3 className="text-lg font-serif mb-3 text-foreground">{industryName}</h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        {industryPapers.map(paper => (
                          <motion.div key={paper.id} variants={item}>
                            <Card className="rounded-none h-full hover:border-primary/30 transition-colors">
                              <CardContent className="py-5">
                                <div className="flex items-start justify-between mb-2">
                                  <span className="px-2 py-0.5 rounded-sm text-xs font-medium bg-primary/10 text-primary">{paper.category}</span>
                                  <div className="flex items-center gap-1">
                                    <Award className="w-3.5 h-3.5 text-amber-500" />
                                    <span className="text-xs font-mono font-bold text-amber-600">{paper.relevanceScore}</span>
                                  </div>
                                </div>
                                <h4 className="text-sm font-semibold text-foreground mb-1 leading-snug">
                                  {paper.url ? (
                                    <a href={paper.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors inline-flex items-center gap-1">
                                      {paper.title}
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  ) : paper.title}
                                </h4>
                                <p className="text-xs text-muted-foreground mb-2">{paper.author} — {paper.organization} ({paper.publishedYear})</p>
                                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{paper.abstract}</p>
                                {paper.tags && (
                                  <div className="flex flex-wrap gap-1 mt-3">
                                    {paper.tags.split("|").map((tag, idx) => (
                                      <span key={idx} className="px-1.5 py-0.5 rounded-sm text-xs bg-muted text-muted-foreground">{tag.trim()}</span>
                                    ))}
                                  </div>
                                )}
                                <SourceBadges sourceIds={paper.sourceIds} />
                              </CardContent>
                            </Card>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  ))}
                </motion.div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
