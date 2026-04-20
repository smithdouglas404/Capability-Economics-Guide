import { useState, useEffect, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useListIndustries, useGetIndustry, useGetCapability, useCompareIndustries, getGetIndustryQueryKey, getGetCapabilityQueryKey } from "@workspace/api-client-react";
import type { Industry, Capability, CapabilityMetric, CapabilityDependency, RoleMapping } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Shield, Heart, Landmark, Factory, Cpu, ShoppingCart,
  ChevronRight, ArrowLeft, BarChart3, GitBranch, Users,
  TrendingUp, TrendingDown, Minus, Loader2, Layers, Network,
  Sparkles, AlertTriangle, Activity, BookOpen, RefreshCw, ExternalLink, Info,
  Bot, Zap, Target,
} from "lucide-react";
import {
  ResponsiveContainer, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip
} from "recharts";

const ForceGraph = lazy(() => import("@/components/ForceGraph"));

const iconMap: Record<string, React.ElementType> = {
  Shield, Heart, Landmark, Factory, Cpu, ShoppingCart,
};

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

function StrengthBadge({ strength }: { strength: string }) {
  const colors: Record<string, string> = {
    strong: "bg-emerald-100 text-emerald-700 border-emerald-200",
    moderate: "bg-amber-100 text-amber-700 border-amber-200",
    weak: "bg-slate-100 text-slate-500 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold ${colors[strength] || colors.moderate}`}>
      {strength}
    </span>
  );
}

function RelevanceBadge({ relevance }: { relevance: string }) {
  const colors: Record<string, string> = {
    high: "bg-primary/10 text-primary border-primary/20",
    medium: "bg-amber-100 text-amber-700 border-amber-200",
    low: "bg-slate-100 text-slate-500 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold ${colors[relevance] || colors.medium}`}>
      {relevance}
    </span>
  );
}

export default function KnowledgeGraph() {
  const [selectedIndustryId, setSelectedIndustryId] = useState<number | null>(null);
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<number | null>(null);
  const [radarParentId, setRadarParentId] = useState<number | null>(null);
  interface CapImpact { eventId: number; title: string; description: string; severity: number; sentimentDirection: "positive" | "negative" | "neutral"; decayFactor: number; source: string; via: "explicit" | "parent" | "child" }
  const [capImpacts, setCapImpacts] = useState<Record<number, CapImpact[]>>({});
  useEffect(() => {
    let abort = false;
    fetch("/api/macro-events/affected-capabilities")
      .then(r => r.ok ? r.json() : { impacts: {} })
      .then((d: { impacts: Record<number, CapImpact[]> }) => { if (!abort) setCapImpacts(d.impacts || {}); })
      .catch(() => { if (!abort) setCapImpacts({}); });
    return () => { abort = true; };
  }, [selectedIndustryId]);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const [tab, setTab] = useState<"network" | "industries" | "compare">(isMobile ? "industries" : "network");
  interface GraphDataShape {
    industries: Array<{ id: number; name: string; slug: string; icon: string }>;
    capabilities: Array<{ id: number; name: string; industryId: number; benchmarkScore: number; quadrant: string; economicImpactScore: number; adoptionMomentumScore: number; disruptionIntensity: number }>;
    dependencies: Array<{ id: number; capabilityId: number; dependsOnId: number; strength: string }>;
  }
  const [graphData, setGraphData] = useState<GraphDataShape | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  const { data: industries, isLoading: loadingIndustries } = useListIndustries();
  const { data: comparison, isLoading: loadingComparison } = useCompareIndustries();

  const [graphError, setGraphError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "network" && !graphData && !graphError) {
      setGraphLoading(true);
      fetch("/api/ontology/graph")
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(d => {
          if (!d.industries || !d.capabilities || !d.dependencies) {
            throw new Error("Invalid graph data shape");
          }
          setGraphData(d);
        })
        .catch(err => setGraphError(err.message || "Failed to load graph"))
        .finally(() => setGraphLoading(false));
    }
  }, [tab, graphData, graphError]);
  const { data: industryDetail, isLoading: loadingIndustry } = useGetIndustry(selectedIndustryId ?? 0, {
    query: { queryKey: getGetIndustryQueryKey(selectedIndustryId ?? 0), enabled: !!selectedIndustryId },
  });
  const { data: capabilityDetail, isLoading: loadingCapability } = useGetCapability(selectedCapabilityId ?? 0, {
    query: { queryKey: getGetCapabilityQueryKey(selectedCapabilityId ?? 0), enabled: !!selectedCapabilityId },
  });

  interface AlphaDetailShape {
    economics: null | {
      tamUsdMm: number | null;
      marginStructurePct: number | null;
      halfLifeMonths: number | null;
      revenueExposureMm: number | null;
      consensusQuadrant: string | null;
      consensusConfidence: number | null;
      consensusSummary: string | null;
      consensusSources: string[] | null;
      rationale: string | null;
      summaryNarrative: string | null;
      aiExposureScore: number | null;
      aiTimeToDisplacementMonths: number | null;
      aiSubstitutes: string[] | null;
      aiNarrative: string | null;
      traditionalNarrative: string | null;
      economicNarrative: string | null;
      metricInterpretations: Array<{ name: string; interpretation: string }> | null;
      dependencyRationales: Array<{ dependsOnName: string; rationale: string }> | null;
      roleConsequences: Array<{ roleTitle: string; consequence: string }> | null;
      playbook: string[] | null;
      benchmarkInterpretation: string | null;
      generatedAt: string | null;
    };
    evar: { mo12: number | null; mo24: number | null; mo36: number | null; ceQuadrant: string | null };
    fragility: { score: number | null; topUpstreamRiskMm: number | null; scoredEdges: number; totalUpstreamEdges: number };
    cascade: { nodes: Array<{ id: number; name: string; depth: number }>; edges: Array<{ fromId: number; toId: number; dollarImpactMm: number | null; disruptionProbability: number | null }>; totalExpectedImpactMm: number };
    sources: string[] | null;
    generatedAt: string | null;
  }
  const [alphaDetail, setAlphaDetail] = useState<AlphaDetailShape | null>(null);
  const [alphaLoading, setAlphaLoading] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCapabilityId) { setAlphaDetail(null); setRerunError(null); return; }
    setAlphaLoading(true);
    fetch(`/api/alpha/capability/${selectedCapabilityId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: AlphaDetailShape | null) => setAlphaDetail(d))
      .catch(() => setAlphaDetail(null))
      .finally(() => setAlphaLoading(false));
  }, [selectedCapabilityId]);

  const rerunDetail = async () => {
    if (!selectedCapabilityId) return;
    setRerunning(true);
    setRerunError(null);
    try {
      // Synchronous per-capability rerun — runs alpha + detail inline
      // (1–3 min) then returns. When it returns, the data is in the DB
      // and we re-fetch it for display.
      const resp = await fetch(`/api/alpha/rerun/${selectedCapabilityId}`, {
        method: "POST",
        credentials: "include",
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({} as { error?: string }));
        throw new Error(body?.error ?? `HTTP ${resp.status}`);
      }
      const r = await fetch(`/api/alpha/capability/${selectedCapabilityId}`);
      if (r.ok) setAlphaDetail(await r.json());
    } catch (e) {
      setRerunError(e instanceof Error ? e.message : "Rerun failed");
    } finally {
      setRerunning(false);
    }
  };

  if (selectedCapabilityId && capabilityDetail) {
    const econ = alphaDetail?.economics;
    const evar = alphaDetail?.evar;
    const fragility = alphaDetail?.fragility;
    const cascade = alphaDetail?.cascade;
    const fmt$ = (n: number | null | undefined) => n == null ? "—" : n >= 1000 ? `$${(n / 1000).toFixed(1)}B` : `$${Math.round(n)}M`;
    const interpForMetric = (name: string) => econ?.metricInterpretations?.find(i => i.name.toLowerCase() === name.toLowerCase())?.interpretation;
    const rationaleForDep = (name: string) => econ?.dependencyRationales?.find(d => d.dependsOnName.toLowerCase() === name.toLowerCase())?.rationale;
    const consequenceForRole = (title: string) => econ?.roleConsequences?.find(r => r.roleTitle.toLowerCase() === title.toLowerCase())?.consequence;
    const ceQ = evar?.ceQuadrant;
    const streetQ = econ?.consensusQuadrant;
    const quadrantsDisagree = ceQ && streetQ && ceQ !== streetQ;
    return (
      <div className="min-h-screen bg-background pb-24">
        <section className="bg-muted/30 py-8 border-b">
          <div className="container mx-auto px-4 max-w-5xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <Button variant="ghost" onClick={() => setSelectedCapabilityId(null)} className="mb-4 -ml-2 text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to {industryDetail?.name}
                </Button>
                <h1 className="text-3xl md:text-4xl font-serif font-medium text-foreground">{capabilityDetail.name}</h1>
                <p className="text-lg text-muted-foreground mt-2">{capabilityDetail.description}</p>
              </div>
              <div className="hidden md:flex flex-col items-end gap-2">
                {alphaDetail?.generatedAt && (
                  <span className="text-xs text-muted-foreground">
                    Economics refreshed {new Date(alphaDetail.generatedAt).toLocaleDateString()}
                  </span>
                )}
                <Button size="sm" variant="outline" onClick={rerunDetail} disabled={rerunning} className="rounded-sm">
                  {rerunning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                  {rerunning ? "Rerunning…" : "Rerun economics"}
                </Button>
                {rerunError && (
                  <span className="text-xs text-rose-600 max-w-[12rem] text-right">{rerunError}</span>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="container mx-auto px-4 max-w-5xl py-8 space-y-8">
          {/* WHAT THIS CAPABILITY IS — plain-English explainer */}
          {econ?.summaryNarrative ? (
            <Card className="rounded-none border-l-4 border-l-foreground/60 bg-card">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <BookOpen className="w-5 h-5 text-foreground/60 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">What this capability is</div>
                    <p className="text-base text-foreground leading-relaxed">{econ.summaryNarrative}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : alphaLoading ? null : (
            <Card className="rounded-none border-dashed border-muted-foreground/30 bg-muted/20">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <BookOpen className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">What this capability is</div>
                    <p className="text-sm text-muted-foreground">Plain-English summary is awaiting economic enrichment. Click <em>Rerun economics</em> above to generate it now.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* TOP ALPHA STRIP: EVaR · CE-vs-Street · AI Exposure */}
          <div className="grid md:grid-cols-3 gap-4">
            {/* EVaR */}
            <Card className="rounded-none border-l-4 border-l-primary">
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  <Activity className="w-3.5 h-3.5" /> Enterprise Value at Risk
                </div>
                {alphaLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : evar?.mo36 != null ? (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div><div className="text-xs text-muted-foreground">12mo</div><div className="font-mono text-sm font-semibold text-foreground">{fmt$(evar.mo12)}</div></div>
                      <div><div className="text-xs text-muted-foreground">24mo</div><div className="font-mono text-sm font-semibold text-amber-600">{fmt$(evar.mo24)}</div></div>
                      <div><div className="text-xs text-muted-foreground">36mo</div><div className="font-mono text-base font-semibold text-rose-600">{fmt$(evar.mo36)}</div></div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                      Decay-adjusted $ at risk if half-life of {Math.round(econ?.halfLifeMonths ?? 0)}mo holds.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Awaiting economic enrichment.</p>
                )}
              </CardContent>
            </Card>

            {/* CE vs Street */}
            <Card className={`rounded-none border-l-4 ${quadrantsDisagree ? "border-l-amber-500" : "border-l-muted-foreground"}`}>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  <Target className="w-3.5 h-3.5" /> CE vs Street
                </div>
                {econ?.consensusQuadrant && ceQ ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs px-2 py-0.5 rounded-sm bg-primary/10 text-primary font-medium">CE: {ceQ}</span>
                      <span className="text-muted-foreground text-xs">vs</span>
                      <span className="text-xs px-2 py-0.5 rounded-sm bg-muted text-foreground font-medium">Street: {streetQ}</span>
                    </div>
                    {quadrantsDisagree && (
                      <div className="text-xs text-amber-700 font-medium mb-2">Disagreement · conf {econ.consensusConfidence != null ? Math.round(econ.consensusConfidence * 100) + "%" : "—"}</div>
                    )}
                    {econ.rationale && (
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{econ.rationale}</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Awaiting economic enrichment.</p>
                )}
              </CardContent>
            </Card>

            {/* AI Exposure */}
            <Card className="rounded-none border-l-4 border-l-violet-500">
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  <Bot className="w-3.5 h-3.5" /> AI Exposure
                </div>
                {econ?.aiExposureScore != null ? (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-mono font-semibold text-violet-700">{Math.round(econ.aiExposureScore)}%</span>
                      <span className="text-xs text-muted-foreground">revenue at risk</span>
                    </div>
                    {econ.aiTimeToDisplacementMonths != null && (
                      <div className="text-xs text-muted-foreground mt-1">in ~{Math.round(econ.aiTimeToDisplacementMonths)} months</div>
                    )}
                    {econ.aiSubstitutes && econ.aiSubstitutes.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {econ.aiSubstitutes.slice(0, 4).map((s, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-sm border border-violet-100">{s}</span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{alphaLoading ? "Loading…" : "AI exposure scoring queued."}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* AI narrative if present */}
          {econ?.aiNarrative && (
            <Card className="rounded-none bg-violet-50/50 border-violet-200">
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-violet-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-violet-700 mb-1">How AI &amp; other innovative ideas reshape this capability</div>
                    <p className="text-sm text-foreground leading-relaxed">{econ.aiNarrative}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Traditional vs Economic narrative */}
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="rounded-none border-l-4 border-l-muted-foreground">
              <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-sans">Traditional View</CardTitle></CardHeader>
              <CardContent>
                <p className="text-foreground font-medium mb-2">{capabilityDetail.traditionalView}</p>
                {econ?.traditionalNarrative && (
                  <p className="text-sm text-muted-foreground leading-relaxed">{econ.traditionalNarrative}</p>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-none border-l-4 border-l-primary">
              <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider text-primary font-sans">Economic View</CardTitle></CardHeader>
              <CardContent>
                <p className="text-foreground font-medium mb-2">{capabilityDetail.economicView}</p>
                {econ?.economicNarrative && (
                  <p className="text-sm text-muted-foreground leading-relaxed">{econ.economicNarrative}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Fragility + Cascade preview */}
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="rounded-none border-l-4 border-l-rose-500">
              <CardHeader className="pb-2">
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-rose-600" /> Fragility
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fragility?.score != null ? (
                  <>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-3xl font-mono font-semibold text-rose-600">{fragility.score}</span>
                      <span className="text-xs text-muted-foreground">/ 100</span>
                    </div>
                    <p className="text-sm text-foreground">
                      Top upstream risk: <span className="font-mono font-semibold">{fmt$(fragility.topUpstreamRiskMm)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{fragility.scoredEdges} of {fragility.totalUpstreamEdges} upstream edges priced.</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{fragility?.totalUpstreamEdges === 0 ? "No upstream dependencies." : "Upstream edges not yet priced."}</p>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-none border-l-4 border-l-accent">
              <CardHeader className="pb-2">
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <Network className="w-5 h-5 text-accent" /> Cascade Impact
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cascade && cascade.nodes.length > 1 ? (
                  <>
                    <p className="text-sm text-foreground mb-2">
                      <span className="font-mono font-semibold">{cascade.nodes.length - 1}</span> downstream capabilities · expected blast radius{" "}
                      <span className="font-mono font-semibold text-rose-600">{fmt$(cascade.totalExpectedImpactMm)}</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {cascade.nodes.filter(n => n.depth > 0).slice(0, 8).map(n => (
                        <button
                          key={n.id}
                          onClick={() => setSelectedCapabilityId(n.id)}
                          className="text-xs px-2 py-0.5 bg-accent/10 text-accent rounded-sm hover:bg-accent/20 transition-colors"
                        >
                          {n.name}
                          {n.depth > 1 && <span className="text-muted-foreground ml-1">·{n.depth}</span>}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No downstream cascade yet (no dependents priced).</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Key Metrics + Dependencies + C-Suite, with interpretations */}
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="rounded-none">
              <CardHeader>
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  Key Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {capabilityDetail.metrics.map((metric: CapabilityMetric) => {
                    const interp = interpForMetric(metric.name);
                    return (
                      <div key={metric.id} className="border-b border-border/50 pb-3 last:border-0 last:pb-0">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-semibold text-sm text-foreground">{metric.name}</span>
                          {metric.benchmarkValue != null && (
                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-sm font-mono">
                              Benchmark: {metric.benchmarkValue} {metric.unit}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{metric.description}</p>
                        {interp && (
                          <p className="text-xs text-foreground mt-1.5 leading-relaxed border-l-2 border-primary/40 pl-2 italic">{interp}</p>
                        )}
                      </div>
                    );
                  })}
                  {capabilityDetail.metrics.length === 0 && (
                    <p className="text-sm text-muted-foreground">No metrics defined yet.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="rounded-none">
                <CardHeader>
                  <CardTitle className="font-serif text-lg flex items-center gap-2">
                    <GitBranch className="w-5 h-5 text-accent" />
                    Dependencies
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {capabilityDetail.dependencies.map((dep: CapabilityDependency) => {
                      const rationale = rationaleForDep(dep.dependsOnName);
                      return (
                        <div key={dep.id} className="border-b border-border/50 pb-2 last:border-0 last:pb-0">
                          <div className="flex items-center justify-between mb-1">
                            <button
                              onClick={() => setSelectedCapabilityId(dep.dependsOnId)}
                              className="text-sm text-primary hover:underline cursor-pointer"
                            >
                              {dep.dependsOnName}
                            </button>
                            <StrengthBadge strength={dep.strength} />
                          </div>
                          {rationale && (
                            <p className="text-xs text-muted-foreground leading-relaxed">{rationale}</p>
                          )}
                        </div>
                      );
                    })}
                    {capabilityDetail.dependencies.length === 0 && (
                      <p className="text-sm text-muted-foreground">No dependencies mapped.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-none">
                <CardHeader>
                  <CardTitle className="font-serif text-lg flex items-center gap-2">
                    <Users className="w-5 h-5 text-primary" />
                    C-Suite Relevance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {capabilityDetail.roleMappings.map((rm: RoleMapping) => {
                      const consequence = consequenceForRole(rm.roleTitle);
                      return (
                        <div key={rm.roleId} className="border-b border-border/50 pb-3 last:border-0 last:pb-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-sm">{rm.roleTitle} — {rm.roleName}</span>
                            <RelevanceBadge relevance={rm.relevance} />
                          </div>
                          <p className="text-xs text-muted-foreground">{rm.perspective}</p>
                          {consequence && (
                            <p className="text-xs text-foreground mt-1.5 leading-relaxed border-l-2 border-primary/40 pl-2 italic">{consequence}</p>
                          )}
                        </div>
                      );
                    })}
                    {capabilityDetail.roleMappings.length === 0 && (
                      <p className="text-sm text-muted-foreground">No role mappings defined.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Playbook */}
          {econ?.playbook && econ.playbook.length > 0 && (
            <Card className="rounded-none border-l-4 border-l-emerald-500 bg-emerald-50/40">
              <CardHeader className="pb-2">
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <Zap className="w-5 h-5 text-emerald-600" /> This Week's Playbook
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2">
                  {econ.playbook.map((p, i) => (
                    <li key={i} className="flex gap-3 text-sm text-foreground">
                      <span className="font-mono text-emerald-700 font-semibold shrink-0">{i + 1}.</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {/* Benchmark Score with interpretation */}
          <Card className="rounded-none bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="font-serif text-lg">Benchmark Score</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${capabilityDetail.benchmarkScore}%` }}
                  />
                </div>
                <span className="font-mono text-lg font-semibold text-foreground">{capabilityDetail.benchmarkScore}/100</span>
              </div>
              {econ?.benchmarkInterpretation ? (
                <p className="text-sm text-foreground mt-3 leading-relaxed">{econ.benchmarkInterpretation}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-2">Industry average maturity benchmark score</p>
              )}
            </CardContent>
          </Card>

          {/* Sources + last-updated trust footer */}
          <Card className="rounded-none">
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5" /> Sources & Methodology
                  </div>
                  {alphaDetail?.sources && alphaDetail.sources.length > 0 ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="rounded-sm h-8">
                          <Info className="w-3.5 h-3.5 mr-1.5" />
                          View {alphaDetail.sources.length} citations
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-96 max-h-80 overflow-auto">
                        <div className="space-y-2">
                          {econ?.consensusSummary && (
                            <div className="text-xs text-muted-foreground italic mb-2 pb-2 border-b">{econ.consensusSummary}</div>
                          )}
                          {alphaDetail.sources.map((src, i) => (
                            <a key={i} href={src} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 text-xs text-primary hover:underline">
                              <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" />
                              <span className="break-all">{src}</span>
                            </a>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <p className="text-xs text-muted-foreground">No sources captured yet.</p>
                  )}
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {alphaDetail?.generatedAt
                    ? <>Economics refreshed<br/><span className="font-mono">{new Date(alphaDetail.generatedAt).toLocaleString()}</span></>
                    : "Not yet enriched"}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (selectedIndustryId && industryDetail) {
    // Top-level (parent-less) capabilities are the default radar axes — much cleaner
    // than mapping all 50+ caps after the sub-capability backfill.
    const topLevelCaps = industryDetail.capabilities.filter(
      (c: Capability) => (c as Capability & { parentCapabilityId: number | null }).parentCapabilityId == null,
    );
    const decomposedParents = topLevelCaps.filter((p: Capability) =>
      industryDetail.capabilities.some(
        (c: Capability) => (c as Capability & { parentCapabilityId: number | null }).parentCapabilityId === p.id,
      ),
    );
    const radarParent = decomposedParents.find((p) => p.id === radarParentId) ?? null;
    const sourceCaps = radarParent
      ? industryDetail.capabilities.filter(
          (c: Capability) =>
            (c as Capability & { parentCapabilityId: number | null }).parentCapabilityId === radarParent.id,
        )
      : topLevelCaps;
    const radarData = sourceCaps.map((c: Capability) => ({
      name: c.name.length > 20 ? c.name.substring(0, 18) + "..." : c.name,
      benchmark: c.benchmarkScore,
    }));

    return (
      <div className="min-h-screen bg-background pb-24">
        <section className="bg-muted/30 py-8 border-b">
          <div className="container mx-auto px-4 max-w-5xl">
            <Button variant="ghost" onClick={() => { setSelectedIndustryId(null); setSelectedCapabilityId(null); setRadarParentId(null); }} className="mb-4 -ml-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" />
              All Industries
            </Button>
            <div className="flex items-center gap-4">
              {(() => { const Icon = iconMap[industryDetail.icon] || Shield; return <Icon className="w-10 h-10 text-primary" />; })()}
              <div>
                <h1 className="text-3xl md:text-4xl font-serif font-medium text-foreground">{industryDetail.name}</h1>
                <p className="text-muted-foreground">{industryDetail.capabilities.length} capabilities mapped</p>
              </div>
            </div>
            <p className="text-lg text-muted-foreground mt-4 max-w-3xl">{industryDetail.description}</p>
          </div>
        </section>

        <div className="container mx-auto px-4 max-w-5xl py-8">
          <div className="grid lg:grid-cols-3 gap-8 mb-8">
            <div className="lg:col-span-2">
              <h2 className="text-xl font-serif mb-4 text-foreground">Capability Map</h2>
              <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
                {industryDetail.capabilities.map((cap: Capability) => {
                  const impacts = capImpacts[cap.id] || [];
                  const hasImpact = impacts.length > 0;
                  return (
                    <motion.div key={cap.id} variants={item}>
                      <button
                        onClick={() => setSelectedCapabilityId(cap.id)}
                        className="w-full text-left bg-card border shadow-sm p-4 rounded-sm hover:border-primary/40 hover:shadow-md transition-all group cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{cap.name}</h3>
                              {hasImpact && (
                                <span
                                  onClick={(e) => e.stopPropagation()}
                                  className="relative inline-flex items-center group/bubble"
                                  title=""
                                >
                                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-600 rounded-full ring-2 ring-background animate-pulse cursor-help">
                                    {impacts.length}
                                  </span>
                                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-80 p-3 bg-popover border border-border shadow-xl rounded-md text-left opacity-0 group-hover/bubble:opacity-100 pointer-events-none group-hover/bubble:pointer-events-auto transition-opacity">
                                    <div className="text-xs font-semibold text-red-600 mb-2 uppercase tracking-wide">
                                      {impacts.length} active macro {impacts.length === 1 ? "event" : "events"}
                                    </div>
                                    <ul className="space-y-2">
                                      {impacts.slice(0, 4).map((imp) => (
                                        <li key={imp.eventId} className="text-xs">
                                          <div className="flex items-center gap-2 mb-0.5">
                                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${imp.sentimentDirection === "negative" ? "bg-red-500" : imp.sentimentDirection === "positive" ? "bg-emerald-500" : "bg-amber-500"}`} />
                                            <span className="font-semibold text-foreground line-clamp-1">{imp.title}</span>
                                          </div>
                                          <p className="text-muted-foreground line-clamp-2 ml-3.5">{imp.description}</p>
                                          <div className="ml-3.5 mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                                            <span>severity {imp.severity}/10</span>
                                            <span>·</span>
                                            <span>decay {Math.round(imp.decayFactor * 100)}%</span>
                                            <span>·</span>
                                            <span className="italic">
                                              {imp.via === "explicit" ? "directly tagged" : imp.via === "parent" ? "via parent capability" : "via child capability"}
                                            </span>
                                          </div>
                                        </li>
                                      ))}
                                      {impacts.length > 4 && <li className="text-[10px] text-muted-foreground italic">+ {impacts.length - 4} more…</li>}
                                    </ul>
                                  </div>
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{cap.description}</p>
                          </div>
                          <div className="flex items-center gap-3 ml-4">
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">Benchmark</div>
                              <div className="font-mono font-semibold text-foreground">{cap.benchmarkScore}</div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                        </div>
                      </button>
                    </motion.div>
                  );
                })}
              </motion.div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-serif text-foreground">
                  {radarParent ? `${radarParent.name} — Sub-Capabilities` : "Industry Radar"}
                </h2>
              </div>
              {decomposedParents.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => setRadarParentId(null)}
                    className={`text-xs rounded-sm border px-2 py-1 transition-colors ${
                      radarParent === null
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:border-primary/40"
                    }`}
                  >
                    Top-level ({topLevelCaps.length})
                  </button>
                  {decomposedParents.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setRadarParentId(p.id)}
                      className={`text-xs rounded-sm border px-2 py-1 transition-colors ${
                        radarParent?.id === p.id
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-muted-foreground border-border hover:border-primary/40"
                      }`}
                      title={`Drill into ${p.name}`}
                    >
                      {p.name.length > 22 ? p.name.substring(0, 20) + "…" : p.name}
                    </button>
                  ))}
                </div>
              )}
              <Card className="rounded-none">
                <CardContent className="pt-6">
                  <div className="h-[300px]">
                    {radarData.length >= 3 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
                          <PolarGrid stroke="hsl(var(--muted-foreground)/0.2)" />
                          <PolarAngleAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                          <Radar name="Benchmark" dataKey="benchmark" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} />
                        </RadarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                        Need 3+ capabilities to render radar.
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-center text-muted-foreground mt-2">
                    {radarParent
                      ? `${sourceCaps.length} sub-capabilities under ${radarParent.name}`
                      : `${topLevelCaps.length} top-level capabilities · click a parent above to drill in`}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <section className="bg-muted/30 py-16 border-b">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary mb-4">
            Knowledge Graph
          </div>
          <h1 className="text-3xl md:text-5xl font-serif font-medium tracking-tight mb-4 text-foreground">
            Industry Capability Explorer
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Explore the capability landscape across six key industries. Each industry has 8-12 core capabilities with benchmarks, metrics, dependencies, and C-suite relevance mappings.
          </p>
          <div className="flex gap-2 mt-6">
            <Button
              variant={tab === "network" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("network")}
              className="rounded-sm hidden md:inline-flex"
            >
              <Network className="w-4 h-4 mr-2" />
              Network
            </Button>
            <Button
              variant={tab === "industries" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("industries")}
              className="rounded-sm"
            >
              <Layers className="w-4 h-4 mr-2" />
              Industries
            </Button>
            <Button
              variant={tab === "compare" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("compare")}
              className="rounded-sm"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Cross-Industry Comparison
            </Button>
          </div>
        </div>
      </section>

      {tab === "network" ? (
        <section className="relative" style={{ height: "calc(100vh - 260px)", minHeight: 500 }}>
          {graphLoading ? (
            <div className="flex justify-center items-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : graphData ? (
            <Suspense fallback={<div className="flex justify-center items-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
              <ForceGraph data={graphData} />
            </Suspense>
          ) : graphError ? (
            <div className="flex flex-col justify-center items-center h-full text-muted-foreground gap-2">
              <p>Failed to load graph: {graphError}</p>
              <button onClick={() => { setGraphError(null); setGraphData(null); }} className="text-primary text-sm underline">Retry</button>
            </div>
          ) : (
            <div className="flex justify-center items-center h-full text-muted-foreground">
              No graph data available. Run the enrichment pipeline first.
            </div>
          )}
        </section>
      ) : tab === "compare" ? (
        <section className="py-12 container mx-auto px-4 max-w-5xl">
          {loadingComparison ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : comparison ? (
            <div className="space-y-10">
              <div>
                <h2 className="text-xl font-serif mb-4 text-foreground">Average Benchmark by Industry</h2>
                <Card className="rounded-none">
                  <CardContent className="pt-6">
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={comparison.industries} layout="vertical" margin={{ left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground)/0.15)" />
                          <XAxis type="number" domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                          <YAxis type="category" dataKey="name" width={120} tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }} />
                          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 4 }} />
                          <Bar dataKey="avgBenchmark" name="Avg Benchmark" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {comparison.industries.map((ind) => (
                  <Card key={ind.id} className="rounded-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="font-serif text-base">{ind.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Capabilities</span>
                          <span className="font-semibold">{ind.capabilityCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Avg Benchmark</span>
                          <span className="font-mono font-semibold">{ind.avgBenchmark}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Top Capability</span>
                          <span className="text-xs font-medium text-primary">{ind.topCapability}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {comparison.sharedCapabilities.length > 0 && (
                <div>
                  <h2 className="text-xl font-serif mb-4 text-foreground">Shared Capabilities Across Industries</h2>
                  <p className="text-sm text-muted-foreground mb-6">
                    Capabilities that appear in two or more industries, showing how benchmark scores differ by sector.
                  </p>
                  <div className="space-y-4">
                    {comparison.sharedCapabilities.map((shared) => {
                      const uniqueIndustryCount = new Set(shared.industries.map(i => i.industryId)).size;
                      return (
                        <Card key={shared.name} className="rounded-none">
                          <CardHeader className="pb-2">
                            <CardTitle className="font-serif text-base flex items-center gap-2">
                              <GitBranch className="w-4 h-4 text-primary" />
                              {shared.name}
                              <span className="ml-auto text-xs font-sans text-muted-foreground font-normal">
                                {uniqueIndustryCount} industries, {shared.industries.length} capabilities
                              </span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                              {shared.industries.map((ind) => (
                                <div
                                  key={`${ind.industryId}-${ind.capabilityId}`}
                                  className="flex items-center justify-between p-2 bg-muted/40 rounded-sm"
                                >
                                  <span className="text-sm text-foreground">{ind.industryName}</span>
                                  <span className="font-mono text-sm font-semibold text-primary">{ind.benchmarkScore}</span>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="py-12 container mx-auto px-4 max-w-5xl">
          {loadingIndustries ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {industries?.map((industry: Industry) => {
                const Icon = iconMap[industry.icon] || Shield;
                return (
                  <motion.div key={industry.id} variants={item}>
                    <button
                      onClick={() => { setSelectedIndustryId(industry.id); setRadarParentId(null); }}
                      className="w-full text-left bg-card border shadow-sm p-6 rounded-sm hover:border-primary/40 hover:shadow-lg transition-all group cursor-pointer"
                    >
                      <div className="flex items-start gap-4">
                        <div className="p-3 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          <Icon className="w-6 h-6" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-xl font-serif text-foreground mb-1">{industry.name}</h3>
                          <p className="text-sm text-muted-foreground line-clamp-3">{industry.description}</p>
                          <div className="flex items-center gap-2 mt-4 text-primary text-sm font-medium">
                            {industry.capabilityCount} capabilities
                            <ChevronRight className="w-4 h-4" />
                          </div>
                        </div>
                      </div>
                    </button>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </section>
      )}
    </div>
  );
}
