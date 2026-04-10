import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity, TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, Info,
  ArrowUpRight, ArrowDownRight, BarChart3, Zap, Shield, ChevronDown, ChevronUp,
  Globe, BookOpen
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

function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(async () => {
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

export default function CEIDashboard() {
  const { data: cei, loading: loadingCei, refetch: refetchCei } = useApi<CEIData>(`${API_BASE}/cei/current`);
  const { data: history } = useApi<CEIHistory[]>(`${API_BASE}/cei/history?limit=30`);
  const [refreshing, setRefreshing] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${API_BASE}/cei/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      await refetchCei();
    } catch (e) {
      console.error("Refresh failed:", e);
    } finally {
      setRefreshing(false);
    }
  };

  if (loadingCei) {
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
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
                className="border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                {refreshing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                Recalculate
              </Button>
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
