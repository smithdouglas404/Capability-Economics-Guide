import { Fragment, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Building2, TrendingUp, Target, Activity, Zap, Trophy, RefreshCw, ChevronDown, ChevronRight, Layers, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { SavedViewsMenu } from "@/components/saved-views-menu";
import { useSavedView } from "@/hooks/use-saved-view";
import { ScoreWithProvenance } from "@/components/score-with-provenance";

type CompaniesViewState = { industryId: number | null; tab: string };

type Industry = { id: number; name: string };
type CompanyRow = {
  company: {
    id: number;
    name: string;
    description: string;
    country: string | null;
    foundedYear: number | null;
    employeeCount: number | null;
    revenueUsd: number | null;
    fundingUsd: number | null;
    publicTicker: string | null;
    ownership: string | null;
    websiteUrl: string | null;
    sourceUrls?: string[] | null;
    citationsCount?: number | null;
    updatedAt?: string | null;
  };
  scores: null | {
    composite: number;
    forecastedValue: number;
    qualityOfAsset: number;
    moatScore: number;
    actionability: number;
    acquisitionProbability: number;
    aiDisruptability: number;
    awarenessScore: number;
    agedIndex: number;
    capabilityCoverage: number;
    cviWeighted: number;
    riskProfile: number;
    lastComputedAt?: string | null;
    details?: { avgConf?: number; avgVelocity?: number; capCount?: number } | null;
  };
};
type StageRow = {
  stage: string;
  capCount: number;
  patents: number;
  vcUsd: number;
  startups: number;
  avgCvi: number | null;
  avgConfidence: number | null;
  avgVelocity: number | null;
  companyCount: number;
};
type QuadPoint = {
  id: number;
  name: string;
  stage: string | null;
  isLeaf: boolean;
  score: number;
  velocity: number;
  confidence: number;
  quadrant: "hot" | "emerging" | "cooling" | "table_stakes";
};

function fmtMoney(n: number | null): string {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function ScoreBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="w-full h-2 bg-muted rounded overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

const QUAD_LABELS: Record<QuadPoint["quadrant"], { label: string; color: string }> = {
  hot: { label: "Hot", color: "bg-red-500" },
  emerging: { label: "Emerging", color: "bg-blue-500" },
  cooling: { label: "Cooling", color: "bg-amber-500" },
  table_stakes: { label: "Table Stakes", color: "bg-muted-foreground/50" },
};

type IngestStatus =
  | { state: "idle"; industryId: number }
  | { state: "running"; industryId: number; startedAt: string }
  | { state: "done"; industryId: number; startedAt: string; finishedAt: string; inserted: number; updated: number; companies: number; errors: string[] }
  | { state: "failed"; industryId: number; startedAt: string; finishedAt: string; error: string };

export default function Companies() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<number | null>(null);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [quad, setQuad] = useState<QuadPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [ingestStatus, setIngestStatus] = useState<IngestStatus | null>(null);
  const [ingestDismissed, setIngestDismissed] = useState(false);
  const [tab, setTab] = useState("shortlist");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const viewsApi = useSavedView<CompaniesViewState>("companies");
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [defaultApplied, setDefaultApplied] = useState(false);
  useEffect(() => {
    if (defaultApplied || !viewsApi.ready) return;
    if (viewsApi.defaultView) {
      const s = viewsApi.defaultView.stateJson;
      if ("industryId" in s) setIndustryId(s.industryId);
      if (typeof s.tab === "string") setTab(s.tab);
      setActiveViewId(viewsApi.defaultView.id);
    }
    setDefaultApplied(true);
  }, [viewsApi.ready, viewsApi.defaultView, defaultApplied]);
  const applyView = (s: CompaniesViewState) => {
    if ("industryId" in s) setIndustryId(s.industryId);
    if (typeof s.tab === "string") setTab(s.tab);
  };
  const [productsByCo, setProductsByCo] = useState<Record<number, Array<{ id: number; name: string; description: string; status: string; category: string | null; websiteUrl: string | null; capabilities: Array<{ capabilityId: number; capabilityName: string; weight: number }> }>>>({});

  const toggleExpand = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!productsByCo[id]) {
      const r = await fetch(`/api/companies/${id}/products`).then(r => r.json());
      setProductsByCo(p => ({ ...p, [id]: r.products ?? [] }));
    }
  };

  useEffect(() => {
    fetch("/api/industries").then(r => r.json()).then((rows: Industry[]) => {
      setIndustries(rows);
      // Functional updater so we don't clobber an industryId that was already
      // set by the default-view auto-apply effect (which may run earlier).
      if (rows.length) setIndustryId(prev => prev ?? rows[0].id);
    });
  }, []);

  const refetchTabs = (id: number) => {
    setLoading(true);
    Promise.all([
      fetch(`/api/workbench/companies?industryId=${id}&limit=100`).then(r => r.json()),
      fetch(`/api/workbench/value-chain/${id}`).then(r => r.json()),
      fetch(`/api/workbench/quadrant/${id}`).then(r => r.json()),
    ]).then(([co, vc, q]) => {
      setCompanies(co.companies ?? []);
      setStages(vc.stages ?? []);
      setQuad(q.points ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    if (!industryId) return;
    refetchTabs(industryId);
    // When the user switches industries, surface any in-flight or recently-
    // completed ingestion for the new industry; clear any dismissed flag.
    setIngestDismissed(false);
    fetch(`/api/workbench/companies/_ingest-status?industryId=${industryId}`)
      .then(r => r.json())
      .then((s: IngestStatus) => setIngestStatus(s))
      .catch(() => { /* non-fatal */ });
  }, [industryId]);

  // Poll the ingestion status while a run is in flight. Stops the moment the
  // backend reports done/failed; also refetches the shortlist on success so
  // the new rows appear without the user reloading.
  useEffect(() => {
    if (!industryId || !ingestStatus || ingestStatus.state !== "running") return;
    let consecutiveErrors = 0;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/workbench/companies/_ingest-status?industryId=${industryId}`);
        if (!r.ok) throw new Error(`status endpoint returned HTTP ${r.status}`);
        const s = await r.json() as IngestStatus;
        consecutiveErrors = 0;
        setIngestStatus(s);
        if (s.state === "done") refetchTabs(industryId);
      } catch (err) {
        consecutiveErrors++;
        // Three failed polls in a row (~12s) means the deploy doesn't have
        // the /_ingest-status endpoint yet (old bundle still serving) or the
        // api-server is unreachable. Stop polling and surface the issue
        // instead of spinning forever with no feedback.
        if (consecutiveErrors >= 3) {
          const startedAt = ingestStatus?.state === "running" ? ingestStatus.startedAt : new Date().toISOString();
          setIngestStatus({
            state: "failed",
            industryId,
            startedAt,
            finishedAt: new Date().toISOString(),
            error: `Status endpoint not responding: ${err instanceof Error ? err.message : String(err)}. Hard-refresh the browser (Cmd+Shift+R / Ctrl+Shift+R) — the deployed bundle may be older than the API.`,
          });
        }
      }
    }, 4000);
    return () => clearInterval(id);
  }, [industryId, ingestStatus?.state]);

  // Tick once a second while running so the banner shows real elapsed time —
  // no more "is it hung or working?" guessing. Stops automatically when
  // state transitions out of "running".
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!ingestStatus || ingestStatus.state !== "running") return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [ingestStatus?.state]);

  const triggerIngest = async () => {
    if (!industryId) return;
    const r = await fetch("/api/workbench/companies/_ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ industryId, limit: 25 }),
    });
    if (r.status === 409) {
      // Already running — the poller below will pick it up.
      setIngestStatus({ state: "running", industryId, startedAt: new Date().toISOString() });
      return;
    }
    if (!r.ok) {
      setIngestStatus({ state: "failed", industryId, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: `kickoff failed: HTTP ${r.status}` });
      return;
    }
    const body = await r.json() as { startedAt: string };
    setIngestStatus({ state: "running", industryId, startedAt: body.startedAt });
  };

  const triggerSignals = async () => {
    if (!industryId) return;
    await fetch("/api/workbench/external-signals/_ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ industryId }),
    });
    alert("Background patent/VC scrape started — refresh in 5-10 minutes.");
  };

  const recompute = async () => {
    if (!industryId) return;
    await fetch("/api/workbench/companies/_recompute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ industryId }),
    });
    setIndustryId(industryId); // trigger refetch
  };

  const sortedCompanies = useMemo(() => {
    return [...companies].sort((a, b) => (b.scores?.composite ?? 0) - (a.scores?.composite ?? 0));
  }, [companies]);

  const quadGroups = useMemo(() => {
    const g: Record<QuadPoint["quadrant"], QuadPoint[]> = { hot: [], emerging: [], cooling: [], table_stakes: [] };
    for (const p of quad) g[p.quadrant].push(p);
    return g;
  }, [quad]);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="inline-flex items-center gap-2 mb-3">
              <span className="h-px w-5 bg-accent" />
              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Portfolio</span>
            </div>
            <h1 className="font-serif text-4xl tracking-tight">Companies, Value-Chain &amp; Quadrant</h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
              The deal-sourcing layer: short-list companies by capability fingerprint with transparent
              Moneyball composites, profile the value chain by stage with patents / VC / startup counts,
              and read the hot/emerging/cooling/table-stakes quadrant — all anchored on the live CVI.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={industryId ?? ""}
              onChange={(e) => setIndustryId(parseInt(e.target.value, 10))}
              className="border rounded px-3 py-2 bg-background"
              data-testid="industry-select"
            >
              {industries.map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}
            </select>
            <Button variant="outline" size="sm" onClick={triggerIngest}><RefreshCw className="w-4 h-4 mr-1" />Ingest companies</Button>
            <Button variant="outline" size="sm" onClick={triggerSignals}><Zap className="w-4 h-4 mr-1" />Scrape patents/VC</Button>
            <Button variant="outline" size="sm" onClick={recompute}>Recompute scores</Button>
            <SavedViewsMenu
              viewsApi={viewsApi}
              currentState={{ industryId, tab }}
              onApply={(s, id) => { if (s && typeof s === "object") applyView(s); setActiveViewId(id); }}
              activeViewId={activeViewId}
            />
          </div>
        </div>

        {ingestStatus && ingestStatus.state !== "idle" && !ingestDismissed && ingestStatus.industryId === industryId && (
          <Card className={`border-l-4 ${
            ingestStatus.state === "running" ? "border-l-blue-500" :
            ingestStatus.state === "failed" ? "border-l-red-500" :
            ingestStatus.errors.length > 0 ? "border-l-amber-500" : "border-l-emerald-500"
          }`}>
            <CardContent className="p-4 flex items-start gap-3">
              {ingestStatus.state === "running" && <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-blue-500 shrink-0" />}
              {ingestStatus.state === "failed" && <AlertCircle className="w-4 h-4 mt-0.5 text-red-500 shrink-0" />}
              {ingestStatus.state === "done" && (ingestStatus.errors.length > 0
                ? <AlertCircle className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
                : <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" />)}
              <div className="flex-1 min-w-0">
                {ingestStatus.state === "running" && (() => {
                  // `tick` is referenced so React re-renders this branch every
                  // second and the elapsed counter actually advances.
                  void tick;
                  const elapsedSec = Math.floor((Date.now() - new Date(ingestStatus.startedAt).getTime()) / 1000);
                  const overTime = elapsedSec > 130;
                  return (
                    <div className="text-sm">
                      <span className="font-medium">Ingesting companies via Perplexity…</span>
                      <span className={`ml-2 font-mono ${overTime ? "text-amber-700" : "text-muted-foreground"}`}>
                        {elapsedSec}s elapsed
                      </span>
                      <span className="text-muted-foreground ml-2">
                        {overTime
                          ? "(longer than typical — Perplexity 120s timeout will trip soon if it's stuck)"
                          : "(typical: 60–90s for Perplexity + ~10s DB inserts)"}
                      </span>
                    </div>
                  );
                })()}
                {ingestStatus.state === "failed" && (
                  <div className="text-sm">
                    <div className="font-medium text-red-700">Ingestion failed to start</div>
                    <div className="text-xs text-muted-foreground mt-0.5 font-mono">{ingestStatus.error}</div>
                  </div>
                )}
                {ingestStatus.state === "done" && (
                  <div className="text-sm space-y-1">
                    <div className="font-medium">
                      Ingestion complete · <span className="text-emerald-700">{ingestStatus.inserted} new</span>
                      {", "}<span className="text-blue-700">{ingestStatus.updated} updated</span>
                      {ingestStatus.errors.length > 0 && <>, <span className="text-amber-700">{ingestStatus.errors.length} issue{ingestStatus.errors.length === 1 ? "" : "s"}</span></>}
                    </div>
                    {ingestStatus.errors.length > 0 && (
                      <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside font-mono">
                        {ingestStatus.errors.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}
                        {ingestStatus.errors.length > 4 && <li>…+{ingestStatus.errors.length - 4} more</li>}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              {ingestStatus.state !== "running" && (
                <Button variant="ghost" size="sm" className="shrink-0 h-7 text-xs" onClick={() => setIngestDismissed(true)}>Dismiss</Button>
              )}
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="shortlist"><Trophy className="w-4 h-4 mr-1" />Company Shortlist</TabsTrigger>
            <TabsTrigger value="value-chain"><Activity className="w-4 h-4 mr-1" />Value Chain</TabsTrigger>
            <TabsTrigger value="quadrant"><Target className="w-4 h-4 mr-1" />Quadrant</TabsTrigger>
          </TabsList>

          <TabsContent value="shortlist" className="space-y-4 pt-4">
            {loading && <p className="text-muted-foreground">Loading…</p>}
            {!loading && sortedCompanies.length === 0 && (
              <Card><CardContent className="pt-6">
                <p className="text-muted-foreground">No companies ingested yet for this industry. Click "Ingest companies" to fetch the top 25 via Perplexity.</p>
              </CardContent></Card>
            )}
            {!loading && sortedCompanies.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" />Top {sortedCompanies.length} companies — ranked by CE composite</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm responsive-table">
                    <thead className="border-b">
                      <tr className="text-left text-muted-foreground text-xs uppercase tracking-wide">
                        <th className="py-2 pr-2 w-6"></th>
                        <th className="py-2 pr-2">#</th>
                        <th className="py-2 pr-2">Company</th>
                        <th className="py-2 pr-2">Composite</th>
                        <th className="py-2 pr-2">Forecast</th>
                        <th className="py-2 pr-2">Quality</th>
                        <th className="py-2 pr-2">Moat</th>
                        <th className="py-2 pr-2">Action</th>
                        <th className="py-2 pr-2">Acq. Prob</th>
                        <th className="py-2 pr-2">AI Disrupt</th>
                        <th className="py-2 pr-2">Aged</th>
                        <th className="py-2 pr-2">Revenue</th>
                        <th className="py-2 pr-2">Funding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCompanies.map((row, i) => {
                        const s = row.scores;
                        const isOpen = expandedId === row.company.id;
                        const prods = productsByCo[row.company.id];
                        return (
                          <Fragment key={row.company.id}>
                          <tr className="border-b hover:bg-muted/30">
                            <td className="py-2 pr-1">
                              <button onClick={() => toggleExpand(row.company.id)} className="p-1 hover:bg-muted rounded" aria-label="Expand company X-Ray">
                                {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                            <td className="py-2 pr-2 text-muted-foreground">{i + 1}</td>
                            <td className="py-2 pr-2 max-w-xs">
                              <div className="font-medium">{row.company.name}</div>
                              <div className="text-xs text-muted-foreground line-clamp-1">{row.company.description}</div>
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {row.company.publicTicker && <Badge variant="outline" className="text-[10px]">{row.company.publicTicker}</Badge>}
                                {row.company.ownership && <Badge variant="secondary" className="text-[10px]">{row.company.ownership}</Badge>}
                                {row.company.country && <span className="text-[10px] text-muted-foreground">{row.company.country}</span>}
                              </div>
                            </td>
                            {(() => {
                              const cites = (row.company.sourceUrls ?? []) as string[];
                              const sCount = row.company.citationsCount ?? cites.length;
                              const lastAt = s?.lastComputedAt ?? row.company.updatedAt ?? null;
                              const conf = s?.details?.avgConf ?? null;
                              const hw = (v: number) => conf !== null ? Math.max(0, (1 - conf) * 30) : null;
                              const ci = (v: number) => {
                                const h = hw(v);
                                return h !== null
                                  ? { ciLow: Math.max(0, v - h), ciHigh: Math.min(100, v + h) }
                                  : { ciLow: undefined, ciHigh: undefined };
                              };
                              return <>
                            <td className="py-2 pr-2 w-32">
                              <div className="mb-1">
                                {s ? (
                                  <ScoreWithProvenance
                                    label={`${row.company.name} — CE Composite`}
                                    value={s.composite}
                                    precision={1}
                                    model="Moneyball composite v1.0"
                                    citations={cites}
                                    sourceCount={sCount}
                                    lastUpdatedAt={lastAt}
                                    {...ci(s.composite)}
                                    sourceBreakdown={[
                                      { sourceLabel: "Forecasted value", rawScore: s.forecastedValue, weight: 0.25 },
                                      { sourceLabel: "Quality of asset", rawScore: s.qualityOfAsset, weight: 0.20 },
                                      { sourceLabel: "Moat", rawScore: s.moatScore, weight: 0.20 },
                                      { sourceLabel: "Actionability", rawScore: s.actionability, weight: 0.15 },
                                      { sourceLabel: "CVI-weighted", rawScore: s.cviWeighted, weight: 0.20 },
                                    ]}
                                    className="font-mono text-xs"
                                  />
                                ) : (
                                  <span className="font-mono text-xs">—</span>
                                )}
                              </div>
                              {s && <ScoreBar value={s.composite} color="bg-primary" />}
                            </td>
                            <td className="py-2 pr-2 w-24">
                              {s ? (
                                <ScoreWithProvenance label={`${row.company.name} — Forecasted value`} value={s.forecastedValue} precision={0} model="DCF + capability rollup v1.1" citations={cites} sourceCount={sCount} lastUpdatedAt={lastAt} {...ci(s.forecastedValue)} className="font-mono text-xs" />
                              ) : <span className="font-mono text-xs">—</span>}
                            </td>
                            <td className="py-2 pr-2 w-24">
                              {s ? (
                                <ScoreWithProvenance label={`${row.company.name} — Quality of asset`} value={s.qualityOfAsset} precision={0} model="Quality composite v1.1" citations={cites} sourceCount={sCount} lastUpdatedAt={lastAt} {...ci(s.qualityOfAsset)} className="font-mono text-xs" />
                              ) : <span className="font-mono text-xs">—</span>}
                            </td>
                            <td className="py-2 pr-2 w-24">
                              {s ? (
                                <ScoreWithProvenance label={`${row.company.name} — Moat`} value={s.moatScore} precision={0} model="Defensibility v1.1" citations={cites} sourceCount={sCount} lastUpdatedAt={lastAt} {...ci(s.moatScore)} className="font-mono text-xs" />
                              ) : <span className="font-mono text-xs">—</span>}
                            </td>
                            <td className="py-2 pr-2 w-24">
                              {s ? (
                                <ScoreWithProvenance label={`${row.company.name} — Actionability`} value={s.actionability} precision={0} model="Deal-readiness v1.1" citations={cites} sourceCount={sCount} lastUpdatedAt={lastAt} {...ci(s.actionability)} className="font-mono text-xs" />
                              ) : <span className="font-mono text-xs">—</span>}
                            </td>
                            <td className="py-2 pr-2 w-24">
                              {s ? (
                                <ScoreWithProvenance label={`${row.company.name} — Acquisition probability`} value={s.acquisitionProbability} precision={0} model="M&A signal v1.1" citations={cites} sourceCount={sCount} lastUpdatedAt={lastAt} {...ci(s.acquisitionProbability)} className="font-mono text-xs" />
                              ) : <span className="font-mono text-xs">—</span>}
                            </td>
                            <td className="py-2 pr-2 w-24">
                              {s ? (
                                <ScoreWithProvenance label={`${row.company.name} — AI disruptability`} value={s.aiDisruptability} precision={0} model="AI exposure v1.1" citations={cites} sourceCount={sCount} lastUpdatedAt={lastAt} {...ci(s.aiDisruptability)} className={`font-mono text-xs ${s.aiDisruptability > 50 ? "text-red-500" : ""}`} />
                              ) : <span className="font-mono text-xs">—</span>}
                            </td>
                            <td className="py-2 pr-2 w-20">
                              {s ? (
                                <ScoreWithProvenance label={`${row.company.name} — Aged index`} value={s.agedIndex} precision={0} model="Time-decay weighted v1.1" citations={cites} sourceCount={sCount} lastUpdatedAt={lastAt} {...ci(s.agedIndex)} className="font-mono text-xs" />
                              ) : <span className="font-mono text-xs">—</span>}
                            </td>
                            </>;
                            })()}
                            <td className="py-2 pr-2 text-xs">{fmtMoney(row.company.revenueUsd)}</td>
                            <td className="py-2 pr-2 text-xs">{fmtMoney(row.company.fundingUsd)}</td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-muted/20 border-b">
                              <td colSpan={13} className="p-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <Layers className="w-4 h-4 text-primary" />
                                  <h4 className="text-sm font-semibold">Products grouped by capability</h4>
                                </div>
                                {!prods && <p className="text-xs text-muted-foreground">Loading…</p>}
                                {prods && prods.length === 0 && <p className="text-xs text-muted-foreground">No products mapped yet. Use Admin → Products to add.</p>}
                                {prods && prods.length > 0 && (() => {
                                  // Group products under EVERY capability they map to so
                                  // multi-capability products appear in each relevant bucket.
                                  const groups = new Map<string, Array<{ name: string; description: string; status: string; weight: number; websiteUrl: string | null }>>();
                                  for (const p of prods) {
                                    const caps = p.capabilities.length ? p.capabilities : [{ capabilityId: 0, capabilityName: "Uncategorized", weight: 0 }];
                                    for (const c of caps) {
                                      const key = c.capabilityName;
                                      const arr = groups.get(key) ?? [];
                                      arr.push({ name: p.name, description: p.description, status: p.status, weight: c.weight, websiteUrl: p.websiteUrl });
                                      groups.set(key, arr);
                                    }
                                  }
                                  // Sort items within each group by weight desc.
                                  for (const arr of groups.values()) arr.sort((a, b) => b.weight - a.weight);
                                  return (
                                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                                      {Array.from(groups.entries()).map(([cap, items]) => (
                                        <div key={cap} className="border bg-background p-3">
                                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">{cap}</div>
                                          <ul className="space-y-1.5">
                                            {items.map((it, k) => (
                                              <li key={k} className="text-xs">
                                                <div className="flex items-center justify-between gap-2">
                                                  <span className="font-medium truncate">{it.websiteUrl ? <a href={it.websiteUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{it.name}</a> : it.name}</span>
                                                  <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider">{it.status}</Badge>
                                                </div>
                                                <p className="text-muted-foreground line-clamp-2">{it.description}</p>
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="value-chain" className="space-y-4 pt-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" />Value-chain stage profile</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm responsive-table">
                  <thead className="border-b">
                    <tr className="text-left text-muted-foreground text-xs uppercase tracking-wide">
                      <th className="py-2 pr-2">Stage</th>
                      <th className="py-2 pr-2"># Caps</th>
                      <th className="py-2 pr-2">Avg CVI</th>
                      <th className="py-2 pr-2">Avg conf</th>
                      <th className="py-2 pr-2">Avg velocity</th>
                      <th className="py-2 pr-2">Companies</th>
                      <th className="py-2 pr-2">Patents (5y)</th>
                      <th className="py-2 pr-2">VC capital (5y)</th>
                      <th className="py-2 pr-2">Startups (5y)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stages.map((s) => (
                      <tr key={s.stage} className="border-b hover:bg-muted/30">
                        <td className="py-2 pr-2 font-medium capitalize">{s.stage}</td>
                        <td className="py-2 pr-2 font-mono text-xs">{s.capCount}</td>
                        <td className="py-2 pr-2 font-mono text-xs">{s.avgCvi ?? "—"}</td>
                        <td className="py-2 pr-2 font-mono text-xs">{s.avgConfidence ?? "—"}</td>
                        <td className="py-2 pr-2 font-mono text-xs">{s.avgVelocity ?? "—"}</td>
                        <td className="py-2 pr-2 font-mono text-xs">{s.companyCount}</td>
                        <td className="py-2 pr-2 font-mono text-xs">{s.patents.toLocaleString()}</td>
                        <td className="py-2 pr-2 font-mono text-xs">{fmtMoney(s.vcUsd)}</td>
                        <td className="py-2 pr-2 font-mono text-xs">{s.startups.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-3">
                  Replaces the SunasiAI value-chain table — but every cell is a live CE aggregation, not a one-off slide.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quadrant" className="space-y-4 pt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Target className="w-5 h-5" />Capability quadrant</CardTitle>
                <p className="text-xs text-muted-foreground">x = velocity (Δscore/30d) · y = current CVI · bubble size = confidence</p>
              </CardHeader>
              <CardContent>
                <div className="relative bg-muted/20 rounded border" style={{ height: 480 }}>
                  {/* axes */}
                  <div className="absolute left-1/2 top-0 bottom-0 border-l border-dashed border-muted-foreground/30" />
                  <div className="absolute top-1/2 left-0 right-0 border-t border-dashed border-muted-foreground/30" />
                  <div className="absolute top-2 right-2 text-xs text-muted-foreground">↑ CVI</div>
                  <div className="absolute bottom-2 right-2 text-xs text-muted-foreground">→ velocity</div>
                  <div className="absolute top-2 left-2 text-xs font-medium text-amber-600">Cooling</div>
                  <div className="absolute top-2 right-12 text-xs font-medium text-red-600">Hot</div>
                  <div className="absolute bottom-8 left-2 text-xs font-medium text-muted-foreground">Table-stakes</div>
                  <div className="absolute bottom-8 right-12 text-xs font-medium text-blue-600">Emerging</div>
                  {quad.map((p) => {
                    const x = 50 + (p.velocity / 0.5) * 50; // velocity range ±0.5
                    const y = 100 - p.score; // 0..100 inverted
                    const size = 6 + p.confidence * 14;
                    const color = QUAD_LABELS[p.quadrant].color;
                    return (
                      <div
                        key={p.id}
                        className={`absolute rounded-full ${color} opacity-70 hover:opacity-100 hover:ring-2 hover:ring-primary cursor-pointer`}
                        style={{
                          left: `${Math.max(1, Math.min(98, x))}%`,
                          top: `${Math.max(2, Math.min(96, y))}%`,
                          width: size,
                          height: size,
                          transform: "translate(-50%,-50%)",
                        }}
                        title={`${p.name}\nCEI ${p.score} · velocity ${p.velocity} · conf ${p.confidence} · ${QUAD_LABELS[p.quadrant].label}`}
                      />
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                  {(Object.keys(quadGroups) as Array<QuadPoint["quadrant"]>).map((k) => (
                    <Card key={k}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full ${QUAD_LABELS[k].color}`} />
                          <span className="font-medium text-sm">{QUAD_LABELS[k].label}</span>
                          <span className="text-xs text-muted-foreground ml-auto">{quadGroups[k].length}</span>
                        </div>
                      </CardHeader>
                      <CardContent className="text-xs space-y-1 max-h-48 overflow-y-auto">
                        {quadGroups[k].slice(0, 12).map(p => (
                          <div key={p.id} className="flex justify-between gap-2">
                            <span className="truncate">{p.name}</span>
                            <span className="font-mono text-muted-foreground">{p.score.toFixed(0)}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <TrendingUp className="w-4 h-4" />
                  Replaces the SunasiAI 2×2 quadrant — but every dot is a live CVI score with confidence and velocity from triangulated sources.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
    </div>
  );
}
