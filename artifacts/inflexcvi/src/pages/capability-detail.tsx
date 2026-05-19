import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Minus,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Activity,
  Clock,
  FlagTriangleRight,
  Layers,
  Loader2,
  FileText,
  Users,
  ExternalLink,
  TrendingUp,
  Zap,
  Target,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CapabilityAnnotations } from "@/components/capability-annotations";
import { PersonaDescription } from "@/components/page-header";
import { StreamingBrief } from "@/components/streaming-brief";

const API_BASE = "/api";

interface CapabilityResp {
  id: number;
  name: string;
  slug: string;
  description: string;
  traditionalView: string;
  economicView: string;
  benchmarkScore: number;
  industryId: number;
  reviewStatus: string;
  isLeaf: boolean;
  parentCapabilityId: number | null;
  lifecycleStage: string;
  metrics: Array<{ id: number; name: string; description: string; unit: string; benchmarkValue: number | null }>;
  dependencies: Array<{ id: number; dependsOnId: number; dependsOnName: string; strength: string }>;
  roleMappings: Array<{ roleId: number; roleTitle: string; roleName: string; relevance: number; perspective: string | null }>;
  products: Array<{ id: number; productName: string; companyName: string | null; weight: number }>;
}

interface ExplainResp {
  capabilityId: number;
  capabilityName: string;
  windowDays: number;
  generatedAt: string;
  currentScore: number | null;
  priorScore: number | null;
  delta: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  narrative: string;
  attribution: {
    sourceDriven: Array<{
      id: number;
      sourceLabel: string;
      methodology: string;
      rawScore: number;
      weight: number;
      queriedAt: string;
      direction: "up" | "down" | "neutral";
      contributionPoints: number;
    }>;
    macroEvents: Array<{
      id: number;
      eventType: string;
      severity: number;
      title: string;
      description: string;
      sentimentDirection: string;
      startedAt: string;
      affectedDirectly: boolean;
      viaDependencyCapabilityId: number | null;
      viaDependencyCapabilityName: string | null;
    }>;
  };
  agedOutSources: ExplainResp["attribution"]["sourceDriven"];
}

interface QualityResp {
  capabilityId: number;
  sourceCount: number;
  distinctMethodologies: string[];
  ageDays: number | null;
  consensusScore: number | null;
  confidence: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  ciWidth: number | null;
  flags: string[];
  severity: "critical" | "warning" | "ok";
}

const SEV_TONE = {
  critical: "bg-rose-500/15 text-rose-500 border-rose-500/40",
  warning: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  ok: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
};

const LIFECYCLE_TONE: Record<string, string> = {
  emerging: "bg-violet-500/15 text-violet-500 border-violet-500/40",
  adopted: "bg-sky-500/15 text-sky-500 border-sky-500/40",
  mature: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  decaying: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  obsolete: "bg-rose-500/15 text-rose-500 border-rose-500/40",
};

function DirectionIcon({ direction, className }: { direction: "up" | "down" | "flat" | "unknown" | "neutral"; className?: string }) {
  if (direction === "up") return <ArrowUp className={className ?? "w-4 h-4 text-emerald-500"} />;
  if (direction === "down") return <ArrowDown className={className ?? "w-4 h-4 text-rose-500"} />;
  return <Minus className={className ?? "w-4 h-4 text-muted-foreground"} />;
}

function relativeDays(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.round((now - d) / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export default function CapabilityDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [cap, setCap] = useState<CapabilityResp | null>(null);
  const [explain, setExplain] = useState<ExplainResp | null>(null);
  const [quality, setQuality] = useState<QualityResp | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [explainLoading, setExplainLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) {
      setErr("Invalid capability id");
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const [capR, qR] = await Promise.all([
          fetch(`${API_BASE}/capabilities/${id}`),
          fetch(`${API_BASE}/capabilities/${id}/quality`),
        ]);
        if (!capR.ok) {
          const j = await capR.json().catch(() => ({}));
          throw new Error(j?.error ?? `HTTP ${capR.status}`);
        }
        if (cancelled) return;
        setCap(await capR.json() as CapabilityResp);
        if (qR.ok && !cancelled) setQuality(await qR.json() as QualityResp);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) return;
    let cancelled = false;
    async function loadExplain() {
      setExplainLoading(true);
      try {
        const r = await fetch(`${API_BASE}/capabilities/${id}/explain?windowDays=${windowDays}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (!cancelled) setExplain(await r.json() as ExplainResp);
      } catch {
        if (!cancelled) setExplain(null);
      } finally {
        if (!cancelled) setExplainLoading(false);
      }
    }
    loadExplain();
    return () => {
      cancelled = true;
    };
  }, [id, windowDays]);

  const flagLabels: Record<string, string> = useMemo(() => ({
    stale: "Stale > 90d",
    single_source: "Single source",
    no_consulting_corroboration: "No consulting",
    low_confidence: "Low confidence",
    wide_credible_interval: "Wide CI",
    seed_only: "Seed-only",
    no_evidence: "No evidence",
  }), []);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading capability…
        </div>
      </div>
    );
  }

  if (err || !cap) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <Link href="/explore" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to explore
        </Link>
        <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-4 py-3 text-sm font-mono">
          {err ?? "Capability not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      <div>
        <Link href="/explore" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to explore
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-[0.12em] ${LIFECYCLE_TONE[cap.lifecycleStage] ?? "bg-muted text-muted-foreground border-border/60"}`}>
                {cap.lifecycleStage}
              </Badge>
              {cap.isLeaf ? (
                <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">Leaf</Badge>
              ) : (
                <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">Rollup</Badge>
              )}
              <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">
                {cap.reviewStatus}
              </Badge>
              {quality && (
                <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-[0.12em] ${SEV_TONE[quality.severity]}`}>
                  Quality: {quality.severity}
                </Badge>
              )}
            </div>
            <h1 className="font-serif text-3xl tracking-tight">{cap.name}</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{cap.description}</p>
            <PersonaDescription
              descriptions={{
                default: "The CVI score on the right is a Bayesian posterior — see the source triangulations below for the citations behind it.",
                pe: "Read the score with its confidence interval — if the CI is wide, the audit-the-sources tab below is where you check whether the score will move during diligence. Sub-capabilities show you the exact node where investment can close a gap.",
                vc: "The velocity arrow + 30-day Δ tells you which direction this capability is moving. Companies tab on the right lists who plays here today — your next pitch deck.",
                f500: "Compare your org's score to peers in the Benchmarks tab. If you're below the cohort median, the Recommendations tab gives you the build/buy/partner posture for closing the gap.",
                student: "This is one capability decomposed into sources, sub-capabilities, and dependencies. Click any sub-capability to see how children roll up to the parent posterior.",
                professor: "Single-capability deep dive — useful as a worked example for class. The dependency graph + source citations are exportable; the posterior math is documented at /methodology.",
              }}
              className="mt-3"
            />
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">CVI score</div>
            <div className="font-mono text-4xl tabular-nums">
              {quality?.consensusScore !== null && quality?.consensusScore !== undefined
                ? quality.consensusScore.toFixed(1)
                : cap.benchmarkScore.toFixed(1)}
            </div>
            {quality?.ciLow !== null && quality?.ciHigh !== null && quality?.ciLow !== undefined && quality?.ciHigh !== undefined && (
              <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                CI [{quality.ciLow.toFixed(1)}, {quality.ciHigh.toFixed(1)}]
              </div>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* ─── Score-change explainability ─────────────────────────────────────── */}
      <Card className="rounded-none border-border/60">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-serif text-xl tracking-tight">Why did this move?</h2>
            </div>
            <div className="flex items-center gap-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Window</label>
              <select
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
                className="bg-background border border-border/60 px-2 py-1 text-sm font-mono"
              >
                <option value={7}>7d</option>
                <option value={30}>30d</option>
                <option value={90}>90d</option>
                <option value={180}>180d</option>
                <option value={365}>365d</option>
              </select>
            </div>
          </div>

          {explainLoading && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Computing change attribution…
            </div>
          )}

          {explain && !explainLoading && (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-3">
                  <DirectionIcon direction={explain.direction} className="w-6 h-6" />
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Δ over {explain.windowDays}d</div>
                    <div className="font-mono text-2xl tabular-nums">
                      {explain.delta === null ? "—" : `${explain.delta > 0 ? "+" : ""}${explain.delta.toFixed(1)}`}
                    </div>
                  </div>
                </div>
                {explain.priorScore !== null && (
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Prior</div>
                    <div className="font-mono text-lg tabular-nums">{explain.priorScore.toFixed(1)}</div>
                  </div>
                )}
                {explain.currentScore !== null && (
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Current</div>
                    <div className="font-mono text-lg tabular-nums">{explain.currentScore.toFixed(1)}</div>
                  </div>
                )}
              </div>

              <p className="text-sm leading-relaxed">{explain.narrative}</p>

              {explain.attribution.sourceDriven.length > 0 && (
                <div>
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                    Source attribution ({explain.attribution.sourceDriven.length})
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          <th className="px-3 py-2">Source</th>
                          <th className="px-3 py-2">Methodology</th>
                          <th className="px-3 py-2 text-right">Raw</th>
                          <th className="px-3 py-2 text-right">Weight</th>
                          <th className="px-3 py-2 text-right">Δ</th>
                          <th className="px-3 py-2">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {explain.attribution.sourceDriven.slice(0, 10).map(s => (
                          <tr key={s.id} className="border-t border-border/40">
                            <td className="px-3 py-2 truncate max-w-[220px]" title={s.sourceLabel}>{s.sourceLabel}</td>
                            <td className="px-3 py-2 font-mono text-[11px]">{s.methodology}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{s.rawScore.toFixed(1)}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{s.weight.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              <span className="inline-flex items-center gap-1">
                                <DirectionIcon direction={s.direction} className="w-3 h-3" />
                                {s.contributionPoints > 0 ? "+" : ""}{s.contributionPoints.toFixed(1)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground font-mono text-[11px]">{relativeDays(s.queriedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {explain.attribution.macroEvents.length > 0 && (
                <div>
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                    Macro events ({explain.attribution.macroEvents.length})
                  </h3>
                  <div className="space-y-2">
                    {explain.attribution.macroEvents.map(ev => (
                      <div key={ev.id} className="border border-border/40 p-3">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">
                            {ev.eventType}
                          </Badge>
                          <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-[0.12em] ${ev.sentimentDirection === "negative" ? "bg-rose-500/15 text-rose-500 border-rose-500/40" : "bg-emerald-500/15 text-emerald-500 border-emerald-500/40"}`}>
                            severity {ev.severity.toFixed(1)}
                          </Badge>
                          {!ev.affectedDirectly && ev.viaDependencyCapabilityName && (
                            <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">
                              via {ev.viaDependencyCapabilityName}
                            </Badge>
                          )}
                          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            {relativeDays(ev.startedAt)}
                          </span>
                        </div>
                        <div className="text-sm font-medium">{ev.title}</div>
                        <p className="text-xs text-muted-foreground mt-1">{ev.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {explain.attribution.sourceDriven.length === 0 && explain.attribution.macroEvents.length === 0 && (
                <p className="text-sm text-muted-foreground italic">
                  No new triangulations or macro events in this window — the current score is carried forward from earlier evidence.
                </p>
              )}
            </>
          )}

          {!explain && !explainLoading && (
            <p className="text-sm text-muted-foreground">Explainability unavailable for this capability.</p>
          )}
        </CardContent>
      </Card>

      {/* ─── Source quality panel ───────────────────────────────────────────── */}
      {quality && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <FlagTriangleRight className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-serif text-xl tracking-tight">Source quality</h2>
              <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-[0.12em] ${SEV_TONE[quality.severity]}`}>
                {quality.severity}
              </Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Sources</div>
                <div className="font-mono text-xl tabular-nums">{quality.sourceCount}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Confidence</div>
                <div className="font-mono text-xl tabular-nums">{quality.confidence === null ? "—" : quality.confidence.toFixed(2)}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">CI width</div>
                <div className="font-mono text-xl tabular-nums">{quality.ciWidth === null ? "—" : quality.ciWidth.toFixed(1)}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Age (d)</div>
                <div className="font-mono text-xl tabular-nums">{quality.ageDays === null ? "—" : quality.ageDays.toFixed(0)}</div>
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Methodologies</div>
              <div className="flex flex-wrap gap-1">
                {quality.distinctMethodologies.length === 0 ? (
                  <span className="text-xs text-muted-foreground">none</span>
                ) : (
                  quality.distinctMethodologies.map(m => (
                    <Badge key={m} variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">
                      {m}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            {quality.flags.length > 0 && (
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Quality flags</div>
                <div className="flex flex-wrap gap-1">
                  {quality.flags.map(f => (
                    <Badge key={f} variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em] bg-amber-500/10 text-amber-500 border-amber-500/40">
                      {flagLabels[f] ?? f}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Streaming recommendation (Vercel AI SDK) ────────────────────── */}
      <StreamingBrief
        api={`/api/capabilities/${cap.id}/recommendations/stream`}
        title="Persona-aware recommendation"
        downloadFilename={`ce-recommendation-${cap.id}`}
        triggerLabel="Generate fresh recommendation"
        showContextField
      />

      {/* ─── Dependencies + Products ────────────────────────────────────────── */}
      {(cap.dependencies.length > 0 || cap.products.length > 0) && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-serif text-xl tracking-tight">Structure</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  Depends on ({cap.dependencies.length})
                </div>
                {cap.dependencies.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No upstream dependencies recorded.</p>
                ) : (
                  <ul className="space-y-1">
                    {cap.dependencies.map(d => (
                      <li key={d.id} className="flex items-center justify-between text-sm">
                        <Link href={`/capability/${d.dependsOnId}`} className="hover:underline">
                          {d.dependsOnName}
                        </Link>
                        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">
                          {d.strength}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  Contributing products ({cap.products.length})
                </div>
                {cap.products.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No products mapped yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {cap.products.slice(0, 8).map(p => (
                      <li key={p.id} className="text-sm flex items-center justify-between">
                        <span className="truncate">
                          {p.productName}
                          {p.companyName && <span className="text-muted-foreground"> · {p.companyName}</span>}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{p.weight.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── CVI trend sparkline ───────────────────────────────────────────── */}
      {cap && <CviHistoryCard capabilityId={id} />}

      {/* ─── DVX zone (Disruption Velocity Index) ─────────────────────────── */}
      {cap && <DvxZoneCard capabilityId={id} capabilityName={cap.name} />}

      {/* ─── SEC filings panel ─────────────────────────────────────────────── */}
      {cap && <SecFilingsPanel capabilityId={id} capabilityName={cap.name} />}

      {/* ─── Peer benchmark card ───────────────────────────────────────────── */}
      {cap && <PeerBenchmarkCard capabilityId={id} industryId={cap.industryId} />}

      {/* ─── Analyst annotations widget ────────────────────────────────────── */}
      <CapabilityAnnotations capabilityId={id} />
    </div>
  );
}

interface CviHistoryResp {
  industryId: number;
  capabilityId: number;
  days: number;
  granularity?: "per-capability" | "industry-rollup";
  series: Array<{ at: string; value: number; reconstructed: boolean }>;
  liveCount: number;
  reconstructedCount: number;
}

function CviHistoryCard({ capabilityId }: { capabilityId: number }) {
  const [data, setData] = useState<CviHistoryResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState<30 | 90 | 180>(90);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/capabilities/${capabilityId}/cvi-history?days=${windowDays}`)
      .then(r => r.ok ? r.json() : null)
      .then((j: CviHistoryResp | null) => { if (!cancelled) setData(j); })
      .catch(() => { /* show empty state */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [capabilityId, windowDays]);

  const stats = useMemo(() => {
    if (!data || data.series.length < 2) return null;
    const series = data.series;
    const first = series[0].value;
    const last = series[series.length - 1].value;
    const min = Math.min(...series.map(p => p.value));
    const max = Math.max(...series.map(p => p.value));
    const delta = last - first;
    return { first, last, min, max, delta };
  }, [data]);

  const sparklinePath = useMemo(() => {
    if (!data || data.series.length < 2) return null;
    const w = 600;
    const h = 80;
    const padding = 4;
    const min = Math.min(...data.series.map(p => p.value));
    const max = Math.max(...data.series.map(p => p.value));
    const range = Math.max(0.01, max - min);
    const pts = data.series.map((p, i) => {
      const x = padding + (i / (data.series.length - 1)) * (w - 2 * padding);
      const y = h - padding - ((p.value - min) / range) * (h - 2 * padding);
      return { x, y, reconstructed: p.reconstructed };
    });
    // Split into live + reconstructed segments for dashed styling.
    const livePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    return { w, h, pts, livePath, min, max };
  }, [data]);

  return (
    <Card className="rounded-none">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-serif text-xl tracking-tight">CVI trend</h2>
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">
            {data?.granularity === "per-capability" ? "Per-capability" : "Industry index"}
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            {[30, 90, 180].map(d => (
              <button
                key={d}
                onClick={() => setWindowDays(d as 30 | 90 | 180)}
                className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] border ${windowDays === d ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading CVI history…
          </div>
        )}
        {!loading && (!data || data.series.length < 2) && (
          <p className="text-sm text-muted-foreground">
            Not enough history yet. Snapshots accumulate over time; once {windowDays} days of data exist, the trend appears here.
            {data && data.series.length > 0 && (
              <> (Currently {data.series.length} data point{data.series.length === 1 ? "" : "s"} in the window.)</>
            )}
          </p>
        )}
        {!loading && data && stats && sparklinePath && (
          <>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Latest</div>
                <div className="font-mono text-2xl tabular-nums">{stats.last.toFixed(1)}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{windowDays}-day Δ</div>
                <div className={`font-mono text-2xl tabular-nums ${stats.delta > 0 ? "text-emerald-600" : stats.delta < 0 ? "text-red-600" : ""}`}>
                  {stats.delta > 0 ? "+" : ""}{stats.delta.toFixed(1)}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Range</div>
                <div className="font-mono text-sm tabular-nums">{stats.min.toFixed(0)}–{stats.max.toFixed(0)}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Points</div>
                <div className="font-mono text-sm tabular-nums">{data.series.length}</div>
              </div>
            </div>
            <svg viewBox={`0 0 ${sparklinePath.w} ${sparklinePath.h}`} className="w-full h-20 border border-border/40">
              <path d={sparklinePath.livePath} fill="none" stroke="currentColor" strokeWidth="1.5" />
              {sparklinePath.pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={p.reconstructed ? 1 : 2} className={p.reconstructed ? "fill-muted-foreground/40" : "fill-foreground"} />
              ))}
            </svg>
            <div className="text-xs text-muted-foreground">
              {data.liveCount} live snapshot{data.liveCount === 1 ? "" : "s"}
              {data.reconstructedCount > 0 && (
                <> + <span className="text-muted-foreground/70">{data.reconstructedCount} reconstructed</span> (filled from historical source-triangulation data — small dots; methodology available on request)</>
              )}
              {data.granularity === "industry-rollup" && (
                <> · Per-capability history not yet banked — showing industry index as proxy.</>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface FilingsResp {
  filings: Array<{
    id: number;
    accessionNumber: string;
    companyName: string;
    ticker: string | null;
    formType: string;
    filingDate: string;
    filingUrl: string;
    excerpt: string | null;
  }>;
  cacheHit: boolean;
  newFilingsAdded: number;
}

function SecFilingsPanel({ capabilityId, capabilityName }: { capabilityId: number; capabilityName: string }) {
  const [data, setData] = useState<FilingsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/capabilities/${capabilityId}/filings?limit=10`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: FilingsResp) => { if (!cancelled) setData(j); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [capabilityId]);

  return (
    <Card className="rounded-none">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-serif text-xl tracking-tight">Public companies discussing this capability</h2>
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">
            SEC EDGAR
          </Badge>
          {data && (
            <span className="ml-auto text-xs text-muted-foreground">
              {data.cacheHit ? "from cache" : `freshly fetched — ${data.newFilingsAdded} new`}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Filings (10-K, 10-Q, 8-K, proxies) mentioning <span className="font-medium text-foreground">{capabilityName}</span> in their disclosures, sourced directly from SEC EDGAR full-text search.
        </p>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Searching SEC filings…
          </div>
        )}
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
        {data && !loading && data.filings.length === 0 && (
          <p className="text-sm text-muted-foreground">No public filings mention this capability yet. As more companies file 10-K disclosures referencing it, they'll appear here automatically.</p>
        )}
        {data && data.filings.length > 0 && (
          <ul className="divide-y divide-border">
            {data.filings.map(f => (
              <li key={f.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{f.companyName}</span>
                      {f.ticker && (
                        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">{f.ticker}</Badge>
                      )}
                      <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{f.formType}</Badge>
                    </div>
                    {f.excerpt && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-3 italic">"{f.excerpt}"</p>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                    <div>{new Date(f.filingDate).toLocaleDateString()}</div>
                    <a href={f.filingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-foreground hover:underline">
                      View <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface PeerBenchmarkResp {
  benchmark: {
    nOrgs: number;
    nRealOrgs: number;
    nSyntheticOrgs: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    minScore: number;
    maxScore: number;
    mean: number;
    computedAt: string;
  } | null;
  suppressed: boolean;
}

function PeerBenchmarkCard({ capabilityId, industryId }: { capabilityId: number; industryId: number }) {
  const [data, setData] = useState<PeerBenchmarkResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/capabilities/${capabilityId}/peer-benchmark?industryId=${industryId}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: PeerBenchmarkResp) => { if (!cancelled) setData(j); })
      .catch(() => { /* swallow — show empty state */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [capabilityId, industryId]);

  return (
    <Card className="rounded-none">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-serif text-xl tracking-tight">Peer benchmark</h2>
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">
            Industry cohort
          </Badge>
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading peer distribution…
          </div>
        )}
        {!loading && data?.suppressed && (
          <p className="text-sm text-muted-foreground">Insufficient peer data yet — at least 5 contributing organizations are required before a peer benchmark cell is published for privacy reasons.</p>
        )}
        {!loading && data?.benchmark && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "P25", value: data.benchmark.p25 },
                { label: "Median", value: data.benchmark.p50 },
                { label: "P75", value: data.benchmark.p75 },
                { label: "P90", value: data.benchmark.p90 },
                { label: "Mean", value: data.benchmark.mean },
              ].map(s => (
                <div key={s.label}>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{s.label}</div>
                  <div className="font-mono text-xl tabular-nums">{s.value.toFixed(0)}</div>
                </div>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              Range {data.benchmark.minScore.toFixed(0)}–{data.benchmark.maxScore.toFixed(0)} across {data.benchmark.nOrgs} orgs ({data.benchmark.nRealOrgs} real
              {data.benchmark.nSyntheticOrgs > 0 && (
                <> + <span className="text-amber-700">{data.benchmark.nSyntheticOrgs} synthetic agent{data.benchmark.nSyntheticOrgs > 1 ? "s" : ""}</span></>
              )}
              ). Computed {new Date(data.benchmark.computedAt).toLocaleString()}.
            </div>
            {data.benchmark.nSyntheticOrgs > 0 && (
              <p className="text-xs text-amber-700 italic">
                This benchmark includes data from synthetic agents (persona-typed bots that exercise the platform). Real-customer-only cells will appear as the customer cohort grows.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}



interface DvxResp {
  capabilityId?: number;
  industryId?: number;
  disruptionScore: number | null;
  velocity?: number;
  monthsToDisplacement?: number | null;
  topDisruptors?: string[];
  matchedPatternSlug?: string | null;
  factorBreakdown?: { velocityDivergence: number; dependencyFragility: number; patternMatchConfidence: number };
  rationale?: string;
  matchedPattern?: { slug: string; title: string; headline: string; disruptorCompany: string } | null;
  message?: string;
}

function DvxZoneCard({ capabilityId, capabilityName }: { capabilityId: number; capabilityName: string }) {
  const [data, setData] = useState<DvxResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/capabilities/${capabilityId}/dvx`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: DvxResp) => { if (!cancelled) setData(j); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load DVX'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [capabilityId]);

  const score = data?.disruptionScore ?? null;
  const tone = score == null ? 'neutral' : score >= 70 ? 'red' : score >= 30 ? 'amber' : 'green';
  const toneClass = tone === 'red'
    ? 'bg-rose-500/5 border-rose-500/40'
    : tone === 'amber'
    ? 'bg-amber-500/5 border-amber-500/40'
    : tone === 'green'
    ? 'bg-emerald-500/5 border-emerald-500/40'
    : '';
  const scoreColor = tone === 'red' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-emerald-600' : 'text-foreground';

  return (
    <Card className={`rounded-none border-2 ${toneClass}`}>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className={`w-5 h-5 ${scoreColor}`} />
          <h2 className="font-serif text-xl tracking-tight">DVX — Disruption Velocity Index</h2>
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">
            How fast will this be displaced
          </Badge>
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Computing disruption profile…
          </div>
        )}
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
        {!loading && data && score == null && (
          <p className="text-sm text-muted-foreground">
            {data.message ?? 'DVX score not yet computed for this capability. Wait for the next agent cycle (typically every few hours).'}
          </p>
        )}
        {!loading && data && score != null && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Disruption score</div>
                <div className={`font-mono text-4xl tabular-nums ${scoreColor}`}>{score.toFixed(0)}<span className="text-base text-muted-foreground">/100</span></div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Months to displacement</div>
                <div className="font-mono text-2xl tabular-nums">{data.monthsToDisplacement ?? '—'}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Velocity</div>
                <div className="font-mono text-2xl tabular-nums">{data.velocity != null ? (data.velocity > 0 ? '+' : '') + data.velocity.toFixed(1) : '—'}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Pattern match</div>
                <div className="text-sm font-medium">{data.matchedPattern ? data.matchedPattern.title.split(' — ')[0] : '—'}</div>
              </div>
            </div>
            {data.factorBreakdown && (
              <div className="border-t border-border pt-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Factor breakdown</div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">Velocity divergence</span> (40%) <span className="font-mono tabular-nums">{data.factorBreakdown.velocityDivergence.toFixed(0)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Dependency fragility</span> (30%) <span className="font-mono tabular-nums">{data.factorBreakdown.dependencyFragility.toFixed(0)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Pattern confidence</span> (30%) <span className="font-mono tabular-nums">{data.factorBreakdown.patternMatchConfidence.toFixed(0)}</span>
                  </div>
                </div>
              </div>
            )}
            {data.rationale && (
              <p className="text-sm text-muted-foreground italic">{data.rationale}</p>
            )}
            {data.topDisruptors && data.topDisruptors.length > 0 && (
              <div className="border-t border-border pt-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2 flex items-center gap-1">
                  <Target className="w-3 h-3" /> Top disruptors threatening {capabilityName}
                </div>
                <ul className="divide-y divide-border/60">
                  {data.topDisruptors.map((d, i) => (
                    <li key={i}>
                      <Link href={`/innovation/${capabilityId}/disruptor/${encodeURIComponent(d.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`} className="flex items-center justify-between py-2 hover:bg-muted/20 px-1 -mx-1">
                        <span className="text-sm font-medium">{d}</span>
                        <ArrowUp className="w-3 h-3 rotate-45 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.matchedPattern && (
              <div className="text-xs text-muted-foreground border-t border-border pt-3">
                <span className="font-medium">Matches pattern:</span> <span className="font-mono">{data.matchedPattern.slug}</span> — {data.matchedPattern.headline}
              </div>
            )}
            <AgentRecommendationCard capabilityId={capabilityId} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

const CSUITE_PERSONAS = [
  { slug: "ceo", label: "CEO" },
  { slug: "cfo", label: "CFO" },
  { slug: "coo", label: "COO" },
  { slug: "cto", label: "CTO" },
  { slug: "chro", label: "CHRO" },
] as const;

interface RecResp {
  capabilityId: number;
  persona: string;
  body: string;
  headline: string | null;
  cached: boolean;
}

function AgentRecommendationCard({ capabilityId }: { capabilityId: number }) {
  const [persona, setPersona] = useState<typeof CSUITE_PERSONAS[number]["slug"]>("ceo");
  const [rec, setRec] = useState<RecResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/capabilities/${capabilityId}/recommendations?persona=${persona}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: RecResp) => { if (!cancelled) setRec(j); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load recommendation"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [capabilityId, persona]);

  return (
    <div className="border-t border-border pt-4 mt-2">
      <div className="flex items-center justify-between mb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Agent recommendation — translated for</div>
        <div className="flex gap-1">
          {CSUITE_PERSONAS.map(p => (
            <button
              key={p.slug}
              onClick={() => setPersona(p.slug)}
              className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.18em] border ${persona === p.slug ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {loading && !rec && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> Generating {persona.toUpperCase()} framing…
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {rec && (
        <div className="space-y-1">
          {rec.headline && <div className="text-sm font-medium">{rec.headline}</div>}
          <p className="text-sm leading-relaxed">{rec.body}</p>
          {rec.cached === false && (
            <div className="text-[10px] text-muted-foreground/70">Freshly generated for current DVX score.</div>
          )}
        </div>
      )}
    </div>
  );
}
