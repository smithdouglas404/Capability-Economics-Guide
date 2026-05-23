import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Lock, TrendingUp, TrendingDown, Minus, Sparkles, Plus, X, Check, GitCompare, SlidersHorizontal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LifecycleChip, LIFECYCLE_STAGES, lifecycleLabel, type LifecycleStage } from "@/components/lifecycle-chip";

const API_BASE = "/api";

interface ExploreCap {
  id: number;
  slug: string;
  name: string;
  description: string;
  industry: { id: number; name: string; slug: string };
  score: number;
  ciLow: number | null;
  ciHigh: number | null;
  velocity: number | null;
  sourceCount: number;
  lastUpdatedAt: string | null;
  sampleMetrics: Array<{ name: string; unit: string; benchmarkValue: number | null }>;
}

interface EvarItem {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  quadrant: string | null;
  consensusQuadrant: string | null;
  evar36: number;
  evar24: number;
  evar12: number;
  bandPct: number;
}

interface EvarResp {
  items: EvarItem[];
}

/**
 * Mirror server-side lifecycle derivation client-side so /explore can offer
 * a lifecycle facet without an extra API call. We don't have full velocity
 * thresholds, so this is a pragmatic approximation matching the public chip:
 *   score >= 65 + velocity >= -0.5  → mature
 *   score < 35  + velocity < 0       → obsolete
 *   velocity < -0.5                  → decaying
 *   score < 45 + velocity > 0.5      → emerging
 *   else                             → adopted
 */
function deriveLifecycle(score: number, velocity: number | null): LifecycleStage {
  const v = velocity ?? 0;
  if (score < 35 && v <= 0) return "obsolete";
  if (v < -0.5) return "decaying";
  if (score >= 65 && v >= -0.5) return "mature";
  if (score < 45 && v > 0.5) return "emerging";
  return "adopted";
}

const QUADRANT_STYLE: Record<string, string> = {
  "wedge": "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  "category-king": "bg-violet-500/15 text-violet-500 border-violet-500/40",
  "commodity": "bg-amber-500/15 text-amber-500 border-amber-500/40",
  "obsolete": "bg-rose-500/15 text-rose-500 border-rose-500/40",
};

type EvarBand = "any" | "lt100" | "100to500" | "500to2000" | "gt2000";

const EVAR_BANDS: { value: EvarBand; label: string; min: number; max: number }[] = [
  { value: "any", label: "Any EVaR", min: -Infinity, max: Infinity },
  { value: "lt100", label: "< $100M", min: 0, max: 100 },
  { value: "100to500", label: "$100M – $500M", min: 100, max: 500 },
  { value: "500to2000", label: "$500M – $2B", min: 500, max: 2000 },
  { value: "gt2000", label: "> $2B", min: 2000, max: Infinity },
];

export default function ExplorePage() {
  const [caps, setCaps] = useState<ExploreCap[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [evarByCap, setEvarByCap] = useState<Map<number, EvarItem>>(new Map());

  // Facet state
  const [lifecycleFilter, setLifecycleFilter] = useState<Set<LifecycleStage>>(new Set());
  const [industryFilter, setIndustryFilter] = useState<Set<number>>(new Set());
  const [evarBand, setEvarBand] = useState<EvarBand>("any");

  // Comparison tray — selected capability ids preserved across filter changes
  const [compareIds, setCompareIds] = useState<number[]>(() => {
    try {
      const raw = sessionStorage.getItem("ce_explore_compare_ids");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((n: unknown) => typeof n === "number") : [];
    } catch { return []; }
  });

  useEffect(() => {
    fetch(`${API_BASE}/explore/capabilities`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { capabilities: ExploreCap[] }) => setCaps(d.capabilities))
      .catch(e => setErr(e instanceof Error ? e.message : "Failed to load"));
    // EVaR data is best-effort — quietly fail if the alpha pipeline hasn't
    // generated rows for the visible caps.
    fetch(`${API_BASE}/alpha/evar`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: EvarResp) => {
        const map = new Map<number, EvarItem>();
        for (const it of d.items ?? []) map.set(it.capabilityId, it);
        setEvarByCap(map);
      })
      .catch(() => { /* quiet — EVaR/quadrant data is enrichment-gated */ });
  }, []);

  // Persist comparison tray to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem("ce_explore_compare_ids", JSON.stringify(compareIds));
    } catch { /* storage may be unavailable */ }
  }, [compareIds]);

  const industriesList = useMemo(() => {
    if (!caps) return [];
    const seen = new Map<number, string>();
    for (const c of caps) {
      if (!seen.has(c.industry.id)) seen.set(c.industry.id, c.industry.name);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [caps]);

  const filteredCaps = useMemo(() => {
    if (!caps) return null;
    const band = EVAR_BANDS.find(b => b.value === evarBand) ?? EVAR_BANDS[0];
    return caps.filter(c => {
      const stage = deriveLifecycle(c.score, c.velocity);
      if (lifecycleFilter.size > 0 && !lifecycleFilter.has(stage)) return false;
      if (industryFilter.size > 0 && !industryFilter.has(c.industry.id)) return false;
      if (evarBand !== "any") {
        const evar = evarByCap.get(c.id)?.evar36 ?? null;
        if (evar === null) return false;
        if (evar < band.min || evar >= band.max) return false;
      }
      return true;
    });
  }, [caps, evarByCap, lifecycleFilter, industryFilter, evarBand]);

  const compareCaps = useMemo(() => {
    if (!caps) return [];
    return compareIds
      .map(id => caps.find(c => c.id === id))
      .filter((c): c is ExploreCap => Boolean(c));
  }, [caps, compareIds]);

  function toggleCompare(id: number) {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 4) return prev; // soft cap to keep tray readable
      return [...prev, id];
    });
  }

  function toggleLifecycle(stage: LifecycleStage) {
    setLifecycleFilter(prev => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }

  function toggleIndustry(id: number) {
    setIndustryFilter(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setLifecycleFilter(new Set());
    setIndustryFilter(new Set());
    setEvarBand("any");
  }

  const hasActiveFilters = lifecycleFilter.size > 0 || industryFilter.size > 0 || evarBand !== "any";

  return (
    <div className="min-h-[calc(100dvh-64px)] bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-24">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to home
        </Link>

        <div className="flex items-center gap-2 mb-3">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            Public preview
          </Badge>
          <Badge variant="secondary" className="text-[10px]">No login required</Badge>
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl tracking-tight">
          Browse a sample of capabilities we track
        </h1>
        <p className="mt-3 text-base text-muted-foreground max-w-3xl leading-relaxed">
          A curated set of capabilities, fully open. Each one shows the live
          consensus score, the 95% credible interval from our Bayesian
          triangulation engine, source count, and a couple of representative
          metrics. The full library covers hundreds more across {" "}
          <Link href="/coverage" className="text-primary hover:underline">7+ industries</Link>{" "}
          for members.
        </p>

        {err && (
          <Card className="mt-8 border-rose-500/40 bg-rose-500/5">
            <CardContent className="p-4 text-sm text-rose-500">{err}</CardContent>
          </Card>
        )}

        {!err && caps !== null && caps.length === 0 && (
          <Card className="mt-8">
            <CardContent className="p-6 text-sm text-muted-foreground text-center">
              <Sparkles className="w-5 h-5 mx-auto mb-2 opacity-60" />
              No capabilities are currently flagged for public preview. Check back soon.
            </CardContent>
          </Card>
        )}

        {/* Filter facets — combine lifecycle stage + industry + EVaR range */}
        {caps && caps.length > 0 && (
          <Card className="mt-8 rounded-none border-l-2 border-l-primary/40">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Filter facets
                </div>
                {hasActiveFilters && (
                  <button onClick={clearFilters} className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
                    Clear all
                  </button>
                )}
              </div>

              {/* Lifecycle row */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Lifecycle stage</div>
                <div className="flex flex-wrap gap-1.5">
                  {LIFECYCLE_STAGES.map(stage => {
                    const active = lifecycleFilter.has(stage);
                    return (
                      <button
                        key={stage}
                        onClick={() => toggleLifecycle(stage)}
                        className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider border px-2 py-1 transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"}`}
                      >
                        {active && <Check className="w-2.5 h-2.5" />}
                        {lifecycleLabel(stage)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Industry row */}
              {industriesList.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Industry</div>
                  <div className="flex flex-wrap gap-1.5">
                    {industriesList.map(ind => {
                      const active = industryFilter.has(ind.id);
                      return (
                        <button
                          key={ind.id}
                          onClick={() => toggleIndustry(ind.id)}
                          className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider border px-2 py-1 transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"}`}
                        >
                          {active && <Check className="w-2.5 h-2.5" />}
                          {ind.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* EVaR range row */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">36-mo EVaR range</div>
                <div className="flex flex-wrap gap-1.5">
                  {EVAR_BANDS.map(b => {
                    const active = evarBand === b.value;
                    return (
                      <button
                        key={b.value}
                        onClick={() => setEvarBand(b.value)}
                        className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider border px-2 py-1 transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"}`}
                      >
                        {active && <Check className="w-2.5 h-2.5" />}
                        {b.label}
                      </button>
                    );
                  })}
                </div>
                {evarBand !== "any" && evarByCap.size === 0 && (
                  <div className="text-[10px] text-amber-500 italic mt-1.5">
                    EVaR data not yet enriched for the public catalog — filtered list may be empty.
                  </div>
                )}
              </div>

              <div className="text-[10px] text-muted-foreground font-mono pt-1 border-t border-border/40">
                Showing {filteredCaps?.length ?? 0} of {caps.length} capabilities
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          {filteredCaps?.map(cap => {
            const VIcon = cap.velocity == null
              ? Minus
              : cap.velocity > 0.5 ? TrendingUp
              : cap.velocity < -0.5 ? TrendingDown
              : Minus;
            const vColor = cap.velocity == null
              ? "text-muted-foreground"
              : cap.velocity > 0.5 ? "text-emerald-500"
              : cap.velocity < -0.5 ? "text-rose-500"
              : "text-muted-foreground";
            const stage = deriveLifecycle(cap.score, cap.velocity);
            const evarItem = evarByCap.get(cap.id);
            const quadrant = evarItem?.quadrant ?? evarItem?.consensusQuadrant ?? null;
            const inCompare = compareIds.includes(cap.id);
            return (
              <Card key={cap.id} className={`rounded-none hover:border-primary/40 transition-colors ${inCompare ? "border-primary/60 ring-1 ring-primary/30" : ""}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5 mb-2">
                        <Badge variant="outline" className="text-[10px]">
                          {cap.industry.name}
                        </Badge>
                        <LifecycleChip stage={stage} />
                        {quadrant && (
                          <span className={`inline-flex items-center text-[10px] font-mono uppercase tracking-wider border px-1.5 py-0.5 rounded-none ${QUADRANT_STYLE[quadrant] ?? "border-border bg-muted/40 text-muted-foreground"}`}>
                            {quadrant.replace("-", " ")}
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold leading-tight">{cap.name}</h3>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-semibold tabular-nums leading-none">
                        {cap.score.toFixed(1)}
                      </div>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <VIcon className={`w-3 h-3 ${vColor}`} />
                        {cap.ciLow !== null && cap.ciHigh !== null && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            ±{((cap.ciHigh - cap.ciLow) / 2).toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug line-clamp-3">
                    {cap.description}
                  </p>

                  {/* EVaR + benchmark row */}
                  {(evarItem || cap.sampleMetrics.length > 0) && (
                    <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/40">
                      {evarItem && (
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">
                            EVaR 36-mo
                          </div>
                          <div className="text-xs font-mono tabular-nums">
                            ${evarItem.evar36.toFixed(0)}M
                            <span className="ml-1 text-[10px] text-muted-foreground">±{(evarItem.bandPct * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                      )}
                      {cap.sampleMetrics.slice(0, evarItem ? 1 : 2).map((m, i) => (
                        <div key={i}>
                          <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">
                            {m.name}
                          </div>
                          <div className="text-xs font-mono tabular-nums">
                            {m.benchmarkValue !== null
                              ? `${m.benchmarkValue.toFixed(1)} ${m.unit}`
                              : <span className="opacity-50">no benchmark</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40 gap-2">
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {cap.sourceCount} sources ·{" "}
                      {cap.lastUpdatedAt ? new Date(cap.lastUpdatedAt).toLocaleDateString() : "—"}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleCompare(cap.id)}
                        disabled={!inCompare && compareIds.length >= 4}
                        title={inCompare ? "Remove from comparison tray" : compareIds.length >= 4 ? "Compare tray full (max 4)" : "Add to comparison tray"}
                        className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider border px-1.5 py-1 h-7 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${inCompare ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"}`}
                      >
                        {inCompare ? <><Check className="w-3 h-3" /> Added</> : <><Plus className="w-3 h-3" /> Compare</>}
                      </button>
                      <Link href={`/capability/${cap.id}`}>
                        <Button size="sm" variant="ghost" className="text-[11px] h-7 gap-1">
                          See full data
                          <Lock className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {filteredCaps && filteredCaps.length === 0 && caps && caps.length > 0 && (
          <Card className="mt-6">
            <CardContent className="p-6 text-sm text-muted-foreground text-center">
              No capabilities match your filters.{" "}
              <button onClick={clearFilters} className="text-primary hover:underline">Clear filters</button>
            </CardContent>
          </Card>
        )}

        {caps && caps.length > 0 && (
          <Card className="mt-8 border-primary/30 bg-primary/[0.03]">
            <CardContent className="p-5 flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="text-sm font-semibold">Want the full library?</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Members access all capabilities, full triangulation evidence, scenario
                  modelling, and the embeddable widgets.
                </div>
              </div>
              <Link href="/membership">
                <Button size="sm" className="gap-1.5">
                  Apply for membership
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Comparison tray — sticky bottom bar, only visible when 1+ capabilities are queued */}
      {compareCaps.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-primary/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 shadow-lg">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 shrink-0">
                <GitCompare className="w-4 h-4 text-primary" />
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Compare tray
                </div>
                <Badge variant="outline" className="text-[10px]">{compareCaps.length}/4</Badge>
              </div>
              <div className="flex items-center gap-1.5 flex-1 flex-wrap min-w-0">
                {compareCaps.map(cap => (
                  <div key={cap.id} className="inline-flex items-center gap-1 border border-border bg-muted/30 px-2 py-1 text-xs">
                    <span className="font-medium truncate max-w-[14ch]" title={cap.name}>{cap.name}</span>
                    <button
                      onClick={() => toggleCompare(cap.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      aria-label={`Remove ${cap.name} from comparison`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setCompareIds([])}
                  className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                >
                  Clear
                </button>
                <Link href={`/compare?ids=${compareIds.join(",")}`}>
                  <Button size="sm" className="gap-1.5 h-8" disabled={compareCaps.length < 2}>
                    <GitCompare className="w-3.5 h-3.5" />
                    Compare {compareCaps.length} side-by-side
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
