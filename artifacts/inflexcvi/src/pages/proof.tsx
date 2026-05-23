import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Minus,
  CheckCircle2,
  XCircle,
  Loader2,
  Activity,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
  accuracy: number;
}

interface BacktestSummary {
  events: EventResult[];
  aggregateMatched: number;
  aggregateScored: number;
  aggregateAccuracy: number;
  ranAt: string;
}

function DirIcon({ d }: { d: Direction }) {
  if (d === "positive") return <ArrowUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (d === "negative") return <ArrowDown className="w-3.5 h-3.5 text-rose-500" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

export default function ProofPage() {
  const [data, setData] = useState<BacktestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/proof/backtest`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: BacktestSummary) => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load proof"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl space-y-8">
      <div>
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="w-3.5 h-3.5" />
          Home
        </Link>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">Proof gallery</Badge>
        </div>
        <h1 className="font-serif text-4xl tracking-tight">Did the model see it coming?</h1>
        <p className="text-base text-muted-foreground mt-3 max-w-3xl leading-relaxed">
          We replay historical shocks — COVID, ChatGPT's launch, SVB's collapse, the 2025 tariffs — through
          the same CVI engine that runs the live index. For each event we record what the engine
          predicts vs. what actually happened. Read on for the methodology and the numbers.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          Running backtest harness…
        </div>
      )}

      {err && (
        <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-4 py-3 text-sm font-mono">
          {err}
        </div>
      )}

      {data && data.events.length === 0 && (
        <Card className="rounded-none border-amber-500/40 bg-amber-500/[0.04]">
          <CardContent className="p-6 space-y-3">
            <h2 className="font-serif text-lg">Proof gallery is warming up</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The backtest harness ran successfully but no historical events were available to replay. Once the
              autonomous agent seeds the historical events table, this page will populate with per-event scorecards
              showing how the model would have called each disruption.
            </p>
            <p className="text-xs font-mono text-muted-foreground">
              First scheduled harness run: within 24 hours of platform boot. Manual run available via <code className="px-1.5 py-0.5 bg-muted">/backtest</code>.
            </p>
          </CardContent>
        </Card>
      )}

      {data && data.events.length > 0 && (
        <>
          <Card className="rounded-none border-border/60">
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Events replayed</div>
                  <div className="font-mono text-3xl tabular-nums mt-1">{data.events.length}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Capabilities scored</div>
                  <div className="font-mono text-3xl tabular-nums mt-1">{data.aggregateScored}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Directional matches</div>
                  <div className="font-mono text-3xl tabular-nums mt-1">{data.aggregateMatched}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Aggregate accuracy</div>
                  <div className={`font-mono text-3xl tabular-nums mt-1 ${data.aggregateAccuracy >= 0.7 ? "text-emerald-500" : data.aggregateAccuracy >= 0.5 ? "text-amber-500" : "text-rose-500"}`}>
                    {(data.aggregateAccuracy * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
                <strong>What this measures:</strong> directional accuracy of the engine's response to each event — did the
                CVI move in the same direction the historical record says it should have? Per-capability score history is
                not retained, so the baseline is "the engine's current state without the event" and the predicted is
                "the engine's current state with the event injected." This is a test of model propagation, not historical
                reconstruction. Run timestamp: {new Date(data.ranAt).toLocaleString()}.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {data.events.map(ev => (
              <Card key={ev.eventId} className="rounded-none border-border/60">
                <CardContent className="p-5 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
                      {ev.eventType}
                    </Badge>
                    <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${ev.sentimentDirection === "negative" ? "bg-rose-500/15 text-rose-500 border-rose-500/40" : ev.sentimentDirection === "positive" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/40" : "bg-muted text-muted-foreground border-border/60"}`}>
                      severity {ev.severity.toFixed(1)}
                    </Badge>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {new Date(ev.eventDate).toLocaleDateString()}
                    </span>
                  </div>
                  <h2 className="font-serif text-2xl tracking-tight">{ev.title}</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">{ev.description}</p>

                  <div className="flex items-center gap-4 pt-2 border-t border-border/40">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Accuracy</div>
                      <div className={`font-mono text-2xl tabular-nums ${ev.accuracy >= 0.7 ? "text-emerald-500" : ev.accuracy >= 0.5 ? "text-amber-500" : ev.accuracy < 0 ? "text-muted-foreground" : "text-rose-500"}`}>
                        {ev.accuracy < 0 ? "—" : `${(ev.accuracy * 100).toFixed(0)}%`}
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Matched / scored</div>
                      <div className="font-mono text-lg tabular-nums">{ev.matched} / {ev.scored}</div>
                    </div>
                    {ev.notFound > 0 && (
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Not in catalog</div>
                        <div className="font-mono text-lg tabular-nums">{ev.notFound}</div>
                      </div>
                    )}
                  </div>

                  {ev.capResults.length > 0 && (
                    <div className="border-t border-border/40 pt-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                        Capability responses
                      </div>
                      <div className="space-y-1.5">
                        {ev.capResults.slice(0, 6).map((c, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {c.match ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              ) : c.excluded ? (
                                <Minus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                              )}
                              <span className="truncate">
                                {c.capabilityId ? (
                                  <Link href={`/capability/${c.capabilityId}`} className="hover:underline">{c.capabilityName}</Link>
                                ) : c.capabilityName}
                              </span>
                              <span className="text-[10px] font-mono text-muted-foreground shrink-0">({c.industryName})</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 font-mono text-xs">
                              <span className="inline-flex items-center gap-0.5">
                                <DirIcon d={c.expectedDirection} />
                                <span className="text-muted-foreground">expected</span>
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span className="inline-flex items-center gap-0.5">
                                <DirIcon d={c.predictedDirection} />
                                <span className="tabular-nums">{c.predictedDelta > 0 ? "+" : ""}{c.predictedDelta.toFixed(1)}</span>
                              </span>
                            </div>
                          </div>
                        ))}
                        {ev.capResults.length > 6 && (
                          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground pt-1">
                            +{ev.capResults.length - 6} more capabilities
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {ev.citations.length > 0 && (
                    <div className="border-t border-border/40 pt-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
                        Sources
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {ev.citations.slice(0, 3).map((c, idx) => (
                          <a key={idx} href={c} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline truncate max-w-[260px]">
                            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{new URL(c).hostname.replace(/^www\./, "")}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="rounded-none border-border/60">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-serif text-xl tracking-tight">Methodology</h3>
              </div>
              <ol className="list-decimal list-outside ml-5 space-y-2 text-sm leading-relaxed text-muted-foreground">
                <li>For each historical event, the harness invokes <code className="font-mono text-xs bg-muted px-1">computeCVI()</code> twice: once with no event injected (baseline) and once with the event injected as an extra active <code className="font-mono text-xs bg-muted px-1">macro_event</code>.</li>
                <li>The predicted delta per capability is the engine-output score difference — not a hand-derived sign. It flows through the real Bayesian posterior, parent/child rollup, velocity smoothing, and economic multiplier code paths.</li>
                <li>Expected directions are stored separately and allowed to disagree with the event's overall sentiment. COVID is globally negative but positive for telehealth; the EU AI Act is a cost burden but positive for AI-governance tooling. A naive engine misses these — the harness surfaces those gaps.</li>
                <li>Replay runs in dry-run mode (<code className="font-mono text-xs bg-muted px-1">persist: false</code>); the live CVI and snapshots are untouched.</li>
              </ol>
              <p className="text-sm text-muted-foreground italic">
                What this proves: the engine's directional response under shock is consistent with the recorded historical record on a curated event set.
                What it does not prove: that the engine forecasts magnitude with calibration, or that out-of-sample events not yet in the catalog will land the same way.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
