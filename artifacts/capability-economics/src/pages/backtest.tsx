import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  ArrowLeft, BarChart3, CheckCircle2, XCircle, MinusCircle,
  PlayCircle, RefreshCw, Calendar, ExternalLink, ChevronDown, ChevronRight,
} from "lucide-react";

const API_BASE = "/api";

type Direction = "positive" | "negative" | "neutral";

interface CapResult {
  capabilityId: number | null;
  capabilityName: string;
  industryName: string;
  baseline: number | null;
  predicted: number | null;
  predictedDelta: number;
  predictedDirection: Direction;
  expectedDirection: Direction;
  rationale: string | null;
  match: boolean;
  excluded: "not_found" | "below_epsilon" | null;
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
}

interface BacktestSummary {
  events: EventResult[];
  aggregateMatched: number;
  aggregateScored: number;
  aggregateAccuracy: number;
  ranAt: string;
  notes: { timeAnchorCaveat: string };
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
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {pct}% ({accuracy === 1 ? scored : `${Math.round(accuracy * scored)}/${scored}`})
    </span>
  );
}

export default function BacktestPage() {
  const [catalog, setCatalog] = useState<CatalogEvent[] | null>(null);
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

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
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
    runHarness();
  }, [loadCatalog, runHarness]);

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
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6" /> CEI Backtesting Harness
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Replays curated historical events against the current CEI baseline and reports
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Aggregate directional accuracy
              </p>
              <p className="text-4xl font-bold">
                {summary && summary.aggregateScored > 0
                  ? `${Math.round(summary.aggregateAccuracy * 100)}%`
                  : running
                    ? "…"
                    : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {summary
                  ? `${summary.aggregateMatched} of ${summary.aggregateScored} cap-level predictions matched ground truth`
                  : "Run the harness to compute"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Events replayed</p>
              <p className="text-4xl font-bold">{summary?.events.length ?? catalog?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">curated, Perplexity-cited</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Capabilities scored</p>
              <p className="text-4xl font-bold">{summary?.aggregateScored ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">|Δ| ≥ 0.5 threshold to count</p>
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
              </tr>
            </thead>
            <tbody>
              {(summary?.events ?? []).length === 0 && !running && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted-foreground text-sm">
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
                    </tr>
                    {isOpen && (
                      <tr key={`${evt.eventId}-detail`} className="bg-muted/10">
                        <td colSpan={8} className="p-4">
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
                                <th className="text-right py-1.5 font-medium">Δ</th>
                                <th className="text-center py-1.5 font-medium">Predicted</th>
                                <th className="text-center py-1.5 font-medium">Expected</th>
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
                                    </td>
                                    <td className="py-1.5 text-center">{dirIcon(c.predictedDirection)}</td>
                                    <td className="py-1.5 text-center">{dirIcon(c.expectedDirection)}</td>
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
                                      <td colSpan={8} className="py-1 pl-4 text-xs text-muted-foreground italic">
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
            <em> actual </em> CEI engine twice in dry-run mode (no DB writes): once with no event
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
