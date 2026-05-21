import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  ArrowLeft, BarChart3, CheckCircle2, XCircle, MinusCircle,
  PlayCircle, RefreshCw, Calendar, ExternalLink, ChevronDown, ChevronRight,
} from "lucide-react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ZAxis,
  LineChart, Line, Legend,
} from "recharts";
import { AlertTriangle } from "lucide-react";

const API_BASE = "/api";

type Direction = "positive" | "negative" | "neutral";

interface ForecastDistribution {
  positive: number;
  negative: number;
  neutral: number;
}

interface CapResult {
  capabilityId: number | null;
  capabilityName: string;
  industryName: string;
  baseline: number | null;
  predicted: number | null;
  predictedDelta: number;
  predictedSigma: number | null;
  predictedDirection: Direction;
  expectedDirection: Direction;
  rationale: string | null;
  forecast: ForecastDistribution | null;
  brier: number | null;
  logLoss: number | null;
  match: boolean;
  excluded: "not_found" | "below_epsilon" | null;
}

interface ReliabilityBin {
  binLow: number;
  binHigh: number;
  meanConfidence: number;
  accuracy: number;
  count: number;
}

interface ProbabilisticMetrics {
  count: number;
  brier: number | null;
  logLoss: number | null;
  reliability: ReliabilityBin[];
}

interface EventResult {
  eventId: number;
  title: string;
  eventDate: string;
  eventType: string;
  severity: number;
  sentimentDirection: Direction;
  description: string;
  citations: string[];
  capResults: CapResult[];
  matched: number;
  scored: number;
  notFound: number;
  accuracy: number; // -1 if scored=0
  probabilistic: ProbabilisticMetrics;
}

interface BacktestHistoryPoint {
  id: number;
  ranAt: string;
  methodologyVersion: string;
  eventCount: number;
  aggregateMatched: number;
  aggregateScored: number;
  aggregateAccuracy: number;
  brier: number | null;
  logLoss: number | null;
  probabilisticCount: number;
}

interface BacktestRegression {
  triggered: boolean;
  latestLogLoss: number;
  baselineLogLoss: number;
  delta: number;
  threshold: number;
  windowSize: number;
}

interface BacktestSummary {
  events: EventResult[];
  aggregateMatched: number;
  aggregateScored: number;
  aggregateAccuracy: number;
  probabilistic: ProbabilisticMetrics;
  ranAt: string;
  methodologyVersion?: string;
  notes: { timeAnchorCaveat: string; probabilistic?: string };
  history?: BacktestHistoryPoint[];
  regression?: BacktestRegression | null;
}

interface CatalogEvent {
  id: number;
  eventDate: string;
  title: string;
  eventType: string;
  severity: number;
  sentimentDirection: Direction;
  affectedIndustryNames: string[];
  affectedCapabilities: Array<{ name: string; expectedDirection: Direction; rationale?: string }>;
  description: string;
  citations: string[];
}

function dirIcon(d: Direction) {
  if (d === "positive") return <span className="text-green-600">▲</span>;
  if (d === "negative") return <span className="text-red-600">▼</span>;
  return <span className="text-muted-foreground">●</span>;
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ReliabilityChart({ bins }: { bins: ReliabilityBin[] }) {
  const data = bins.map((b) => ({
    confidence: Math.round(b.meanConfidence * 1000) / 1000,
    accuracy: Math.round(b.accuracy * 1000) / 1000,
    count: b.count,
    label: `${(b.binLow * 100).toFixed(0)}–${(b.binHigh * 100).toFixed(0)}%`,
  }));
  return (
    <div className="w-full h-72">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 32, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="confidence"
            name="Mean confidence"
            domain={[0, 1]}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            label={{ value: "Forecast confidence (top class)", position: "insideBottom", offset: -16, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="accuracy"
            name="Observed accuracy"
            domain={[0, 1]}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            label={{ value: "Observed accuracy", angle: -90, position: "insideLeft", fontSize: 12 }}
          />
          <ZAxis type="number" dataKey="count" range={[60, 400]} name="Caps in bin" />
          <ReferenceLine
            segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
            stroke="#999"
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            formatter={(value: number | string, name: string) =>
              typeof value === "number" && (name === "Mean confidence" || name === "Observed accuracy")
                ? [`${(value * 100).toFixed(1)}%`, name]
                : [value, name]
            }
          />
          <Scatter data={data} fill="hsl(var(--primary))" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendChart({ history }: { history: BacktestHistoryPoint[] }) {
  // Plot oldest → newest. Tick label is short ISO date; tooltip carries the
  // full timestamp so multiple same-day runs stay distinguishable.
  const data = history.map((h, i) => ({
    idx: i + 1,
    label: new Date(h.ranAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    fullLabel: new Date(h.ranAt).toLocaleString(),
    brier: h.brier,
    logLoss: h.logLoss,
    accuracy: h.aggregateScored > 0 ? h.aggregateAccuracy : null,
    methodology: h.methodologyVersion,
  }));
  return (
    <div className="w-full h-64">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            label={{ value: "Run (oldest → newest)", position: "insideBottom", offset: -12, fontSize: 12 }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            domain={[0, "auto"]}
            label={{ value: "Score (lower is better)", angle: -90, position: "insideLeft", fontSize: 12 }}
          />
          <Tooltip
            formatter={(value: number | string, name: string) =>
              typeof value === "number" ? [value.toFixed(3), name] : [value, name]
            }
            labelFormatter={(_l, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={0.667} stroke="#999" strokeDasharray="4 4" label={{ value: "Brier uniform", position: "right", fontSize: 10, fill: "#999" }} />
          <ReferenceLine y={1.099} stroke="#999" strokeDasharray="4 4" label={{ value: "Log-loss uniform", position: "right", fontSize: 10, fill: "#999" }} />
          <Line type="monotone" dataKey="brier" name="Brier" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          <Line type="monotone" dataKey="logLoss" name="Log-loss" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function AccuracyBadge({ accuracy, scored }: { accuracy: number; scored: number }) {
  if (scored === 0) {
    return <span className="text-xs text-muted-foreground">No predictions scored</span>;
  }
  const pct = Math.round(accuracy * 100);
  const cls =
    pct >= 80
      ? "bg-green-500/10 text-green-700 border-green-500/30"
      : pct >= 50
        ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
        : "bg-red-500/10 text-red-700 border-red-500/30";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-none text-xs font-semibold border ${cls}`}>
      {pct}% ({accuracy === 1 ? scored : `${Math.round(accuracy * scored)}/${scored}`})
    </span>
  );
}

export default function BacktestPage() {
  const [catalog, setCatalog] = useState<CatalogEvent[] | null>(null);
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [history, setHistory] = useState<BacktestHistoryPoint[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/admin/backtest/history?limit=20`, { credentials: "include" });
      if (!r.ok) return;
      const body = await r.json();
      setHistory(body.history ?? []);
    } catch {
      // non-fatal — trend chart simply hides
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/admin/backtest/events`, { credentials: "include" });
      if (r.status === 403 || r.status === 401) {
        setError("Admin access required.");
        return;
      }
      const body = await r.json();
      setCatalog(body.events ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load catalog");
    }
  }, []);

  const runHarness = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/admin/backtest/run`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json();
      if (!r.ok) {
        setError(body.error ?? `Run failed (${r.status})`);
      } else {
        setSummary(body);
        if (Array.isArray(body.history)) setHistory(body.history);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
    loadHistory();
    runHarness();
  }, [loadCatalog, loadHistory, runHarness]);

  const toggle = (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin">
            <a className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
              <ArrowLeft className="w-3 h-3" /> Admin
            </a>
          </Link>
          <h1 className="font-serif text-2xl tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6" /> CVI Backtesting Harness
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Replays curated historical events against the current CVI baseline and reports
            directional accuracy — proof that the index moves the way the model predicts.
          </p>
        </div>
        <Button onClick={runHarness} disabled={running} className="gap-2">
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
          {running ? "Running…" : "Re-run harness"}
        </Button>
      </div>

      {error && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {/* Headline aggregate */}
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Directional accuracy
              </p>
              <p className="text-3xl font-bold">
                {summary && summary.aggregateScored > 0
                  ? `${Math.round(summary.aggregateAccuracy * 100)}%`
                  : running
                    ? "…"
                    : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {summary
                  ? `${summary.aggregateMatched}/${summary.aggregateScored} matched`
                  : "Run to compute"}
              </p>
            </div>
            <div title="Multiclass Brier score across {positive, negative, neutral}. Lower is better. 0 = perfect, 0.667 = uniform 1/3 prior, 2 = certain & wrong.">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Brier score</p>
              <p className="text-3xl font-bold">
                {summary?.probabilistic.brier != null
                  ? summary.probabilistic.brier.toFixed(3)
                  : running ? "…" : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                lower is better · uniform = 0.667
              </p>
            </div>
            <div title="Mean negative log-likelihood of the actual direction under the engine's forecast. Lower is better. ln(3) ≈ 1.099 = uniform 1/3 prior.">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Log-loss</p>
              <p className="text-3xl font-bold">
                {summary?.probabilistic.logLoss != null
                  ? summary.probabilistic.logLoss.toFixed(3)
                  : running ? "…" : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                lower is better · uniform = 1.099
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Events replayed</p>
              <p className="text-3xl font-bold">{summary?.events.length ?? catalog?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">curated, cited</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Caps scored</p>
              <p className="text-3xl font-bold">{summary?.aggregateScored ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {summary?.probabilistic.count ? `${summary.probabilistic.count} probabilistic` : "|Δ| ≥ 0.5"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Last run</p>
              <p className="text-sm font-mono mt-2">
                {summary ? new Date(summary.ranAt).toLocaleString() : "Not yet run"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Regression alert — fires when latest log-loss is meaningfully worse */}
      {summary?.regression?.triggered && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 flex items-start gap-3 text-sm">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800">
                Forecast quality regression detected
              </p>
              <p className="text-amber-800/90 mt-1">
                Latest log-loss <span className="font-mono">{summary.regression.latestLogLoss.toFixed(3)}</span>{" "}
                is <span className="font-mono">+{summary.regression.delta.toFixed(3)}</span> worse than the rolling
                average <span className="font-mono">{summary.regression.baselineLogLoss.toFixed(3)}</span>{" "}
                over the prior {summary.regression.windowSize} run{summary.regression.windowSize === 1 ? "" : "s"}{" "}
                (threshold ±{summary.regression.threshold.toFixed(2)}).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Forecast-quality trend across persisted runs */}
      {history.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Forecast quality over time</CardTitle>
            <p className="text-xs text-muted-foreground">
              Brier and log-loss across the last {history.length} runs (oldest → newest). Both should
              trend down as the engine improves; dashed lines mark the uniform-prior baselines (Brier 0.667,
              log-loss 1.099) — anything above them is worse than guessing.
            </p>
          </CardHeader>
          <CardContent>
            <TrendChart history={history} />
          </CardContent>
        </Card>
      )}

      {/* Reliability / calibration diagram */}
      {summary?.probabilistic.reliability && summary.probabilistic.reliability.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Reliability diagram</CardTitle>
            <p className="text-xs text-muted-foreground">
              Each dot = one confidence bin. X = engine's mean confidence in its top-class
              forecast; Y = how often that top class was actually correct. Perfect calibration
              tracks the dashed y = x diagonal. Dot size = bin sample count.
            </p>
          </CardHeader>
          <CardContent>
            <ReliabilityChart bins={summary.probabilistic.reliability} />
          </CardContent>
        </Card>
      )}

      {/* Per-event breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Per-event results</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left p-3 font-medium w-8"></th>
                <th className="text-left p-3 font-medium">
                  <Calendar className="w-3 h-3 inline mr-1" /> Date
                </th>
                <th className="text-left p-3 font-medium">Event</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-center p-3 font-medium">Severity</th>
                <th className="text-center p-3 font-medium" title="Event's primary direction (what the live macro pipeline tags it as)">Sentiment</th>
                <th className="text-center p-3 font-medium">Caps moved</th>
                <th className="text-right p-3 font-medium">Accuracy</th>
                <th className="text-right p-3 font-medium" title="Mean multiclass Brier across this event's cap forecasts">Brier</th>
                <th className="text-right p-3 font-medium" title="Mean log-loss across this event's cap forecasts">Log-loss</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.events ?? []).length === 0 && !running && (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-muted-foreground text-sm">
                    No results yet. Click "Re-run harness".
                  </td>
                </tr>
              )}
              {summary?.events.map((evt) => {
                const isOpen = expanded.has(evt.eventId);
                return (
                  <>
                    <tr
                      key={evt.eventId}
                      className="border-t border-border hover:bg-muted/20 cursor-pointer"
                      onClick={() => toggle(evt.eventId)}
                    >
                      <td className="p-3">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="p-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
                        {fmtDate(evt.eventDate)}
                      </td>
                      <td className="p-3 font-medium">
                        <div>{evt.title}</div>
                        {(() => {
                          const inds = Array.from(new Set(evt.capResults.map((c) => c.industryName).filter(Boolean)));
                          return inds.length > 0 ? (
                            <div className="text-xs text-muted-foreground font-normal mt-0.5">{inds.join(", ")}</div>
                          ) : null;
                        })()}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground capitalize">
                        {evt.eventType.replace(/_/g, " ")}
                      </td>
                      <td className="p-3 text-center font-mono">{evt.severity}</td>
                      <td className="p-3 text-center text-base">
                        {dirIcon(evt.sentimentDirection)}
                      </td>
                      <td className="p-3 text-center text-xs text-muted-foreground">
                        {evt.scored} scored
                        {evt.notFound > 0 && (
                          <span className="text-amber-600 ml-1">({evt.notFound} not in DB)</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <AccuracyBadge accuracy={evt.accuracy} scored={evt.scored} />
                      </td>
                      <td className="p-3 text-right font-mono text-xs">
                        {evt.probabilistic.brier != null ? evt.probabilistic.brier.toFixed(3) : "—"}
                      </td>
                      <td className="p-3 text-right font-mono text-xs">
                        {evt.probabilistic.logLoss != null ? evt.probabilistic.logLoss.toFixed(3) : "—"}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${evt.eventId}-detail`} className="bg-muted/10">
                        <td colSpan={10} className="p-4">
                          <p className="text-sm text-muted-foreground mb-3 italic">{evt.description}</p>
                          {evt.citations.length > 0 && (
                            <p className="text-xs text-muted-foreground mb-3">
                              Sources:{" "}
                              {evt.citations.map((c, i) => (
                                <span key={c}>
                                  <a
                                    href={c}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline hover:text-foreground inline-flex items-center gap-0.5"
                                  >
                                    [{i + 1}] <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                  {i < evt.citations.length - 1 ? " " : ""}
                                </span>
                              ))}
                            </p>
                          )}
                          <table className="w-full text-xs">
                            <thead className="text-muted-foreground">
                              <tr className="border-b border-border">
                                <th className="text-left py-1.5 font-medium">Capability</th>
                                <th className="text-left py-1.5 font-medium">Industry</th>
                                <th className="text-right py-1.5 font-medium">Baseline (T-1)</th>
                                <th className="text-right py-1.5 font-medium">Predicted (T+1)</th>
                                <th className="text-right py-1.5 font-medium">Δ ± σ</th>
                                <th className="text-center py-1.5 font-medium" title="Forecast distribution: P(positive) / P(negative) / P(neutral)">P(pos / neg / neu)</th>
                                <th className="text-center py-1.5 font-medium">Predicted</th>
                                <th className="text-center py-1.5 font-medium">Expected</th>
                                <th className="text-right py-1.5 font-medium" title="Multiclass Brier score for this cap">Brier</th>
                                <th className="text-right py-1.5 font-medium" title="Negative log-likelihood of expected direction">−ln L</th>
                                <th className="text-center py-1.5 font-medium">Match</th>
                              </tr>
                            </thead>
                            <tbody>
                              {evt.capResults.map((c, i) => (
                                <>
                                  <tr key={i} className="border-b border-border/50">
                                    <td className="py-1.5">{c.capabilityName}</td>
                                    <td className="py-1.5 text-muted-foreground">{c.industryName}</td>
                                    <td className="py-1.5 text-right font-mono">{c.baseline ?? "—"}</td>
                                    <td className="py-1.5 text-right font-mono">{c.predicted ?? "—"}</td>
                                    <td className="py-1.5 text-right font-mono">
                                      {c.predictedDelta > 0 ? "+" : ""}
                                      {c.predictedDelta.toFixed(1)}
                                      {c.predictedSigma != null && (
                                        <span className="text-muted-foreground"> ± {c.predictedSigma.toFixed(1)}</span>
                                      )}
                                    </td>
                                    <td className="py-1.5 text-center font-mono text-xs">
                                      {c.forecast ? (
                                        <span>
                                          <span className="text-green-700">{(c.forecast.positive * 100).toFixed(0)}</span>
                                          <span className="text-muted-foreground"> / </span>
                                          <span className="text-red-700">{(c.forecast.negative * 100).toFixed(0)}</span>
                                          <span className="text-muted-foreground"> / </span>
                                          <span className="text-muted-foreground">{(c.forecast.neutral * 100).toFixed(0)}</span>
                                        </span>
                                      ) : "—"}
                                    </td>
                                    <td className="py-1.5 text-center">{dirIcon(c.predictedDirection)}</td>
                                    <td className="py-1.5 text-center">{dirIcon(c.expectedDirection)}</td>
                                    <td className="py-1.5 text-right font-mono">{c.brier != null ? c.brier.toFixed(2) : "—"}</td>
                                    <td className="py-1.5 text-right font-mono">{c.logLoss != null ? c.logLoss.toFixed(2) : "—"}</td>
                                    <td className="py-1.5 text-center">
                                      {c.excluded === "not_found" ? (
                                        <span className="text-xs text-amber-600" title="Capability not in this DB">
                                          n/a
                                        </span>
                                      ) : c.excluded === "below_epsilon" ? (
                                        <MinusCircle className="w-3.5 h-3.5 text-muted-foreground inline" />
                                      ) : c.match ? (
                                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600 inline" />
                                      ) : (
                                        <XCircle className="w-3.5 h-3.5 text-red-600 inline" />
                                      )}
                                    </td>
                                  </tr>
                                  {c.rationale && (
                                    <tr key={`${i}-rationale`} className="border-b border-border/50">
                                      <td colSpan={11} className="py-1 pl-4 text-sm text-muted-foreground italic">
                                        Analyst note: {c.rationale}
                                      </td>
                                    </tr>
                                  )}
                                </>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="bg-muted/20">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">Method.</strong> For each event the harness runs the
            <em> actual </em> CVI engine twice in dry-run mode (no DB writes): once with no event
            injected (baseline / T-1) and once with the historical event injected as an extra active
            macro_event at peak shock (T+1). The predicted delta is the engine's own per-capability
            score difference — flowing through bayesian triangulation, parent/child rollup, velocity
            smoothing, and economic multipliers. A capability counts as a <em>match</em> when the
            sign of that delta agrees with the analyst's ground-truth verdict (<code>|Δ| ≥ 0.5</code> required).
          </p>
          <p>
            <strong className="text-foreground">Why this is non-trivial.</strong> The event's
            primary <em>sentiment direction</em> (what world-scan tags) and a capability's
            <em> expected direction</em> can disagree by design — many real events are net-negative
            but POSITIVE for a specific capability (telehealth during COVID, AI-governance tooling
            under the EU AI Act, supply-chain visibility under tariffs). A naive engine that infers
            cap direction from event sentiment alone will MISS these cases — and the harness is
            built to surface that gap.
          </p>
          <p>
            <strong className="text-foreground">Probabilistic skill scores.</strong> Beyond
            directional %, the harness reports the <em>multiclass Brier score</em> (Σ(qᵢ−yᵢ)²
            over {"{positive, negative, neutral}"}) and <em>log-loss</em> (−ln q[expected]).
            The forecast distribution per capability is derived from the engine's Gaussian
            posterior on the predicted score (σ floored at 1.0 to avoid spurious overconfidence
            when many high-weight triangulation sources agree). A perfectly uninformed
            uniform-1/3 forecast scores Brier ≈ 0.667 and log-loss ≈ 1.099 — a calibrated
            engine should beat both. The reliability diagram bins forecasts by top-class
            confidence; a well-calibrated engine sits on the y = x diagonal.
          </p>
          {summary?.notes?.timeAnchorCaveat && (
            <p>
              <strong className="text-foreground">Time-anchoring caveat.</strong> {summary.notes.timeAnchorCaveat}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
