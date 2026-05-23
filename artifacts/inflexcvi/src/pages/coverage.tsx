import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, AlertCircle, CheckCircle2, Activity, Clock, Layers, Database, AlertTriangle, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useAuth } from "@clerk/react";

const API_BASE = "/api";

type Tier = "Mature" | "Developing" | "Sparse";

interface IndustryRow {
  industryId: number;
  industrySlug: string;
  industryName: string;
  capsTracked: number;
  leafCaps: number;
  pctApproved: number;
  pctWithQuadrant: number;
  pctWithFullEconomics: number;
  pctFreshUnder60d: number;
  medianFreshnessDays: number | null;
  hasGdpWeight: boolean;
  healthScore: number;
  tier: Tier;
}

interface CoverageResp {
  generatedAt: string;
  ttlSeconds: number;
  totals: {
    industries: number;
    capabilities: number;
    leafCapabilities: number;
    pctApproved: number;
    pctWithQuadrant: number;
    pctWithFullEconomics: number;
    pctFreshUnder60d: number;
  };
  industries: IndustryRow[];
  admin?: AdminExtras;
}

interface AdminExtras {
  enrichmentQueue: {
    queued: number;
    running: number;
    failed: number;
    completedLast24h: number;
    oldestQueuedAgeMinutes: number | null;
  };
  rotation: {
    enabled: boolean;
    refreshDays: number;
    lastRunAt: string | null;
    lastRunEnqueued: number;
    minutesSinceLastRun: number | null;
    lagHours: number | null;
  };
}

interface SourceQualityStats {
  totalSources: number;
  queriedLast7d: number;
  mostActiveSource: string | null;
  mostActiveSourceCount: number;
  contradictedLast7d: number;
}

type QualityFlag =
  | "stale"
  | "single_source"
  | "no_consulting_corroboration"
  | "low_confidence"
  | "wide_credible_interval"
  | "seed_only"
  | "no_evidence";

interface CapabilityQualityRow {
  capabilityId: number;
  capabilitySlug: string;
  capabilityName: string;
  industryId: number;
  industryName: string;
  reviewStatus: string;
  isLeaf: boolean;
  sourceCount: number;
  distinctMethodologies: string[];
  lastQueriedAt: string | null;
  ageDays: number | null;
  consensusScore: number | null;
  confidence: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  ciWidth: number | null;
  flags: QualityFlag[];
  severity: "critical" | "warning" | "ok";
}

interface SourceQualityResp {
  generatedAt: string;
  ttlSeconds: number;
  summary: {
    totalCapabilities: number;
    totalLeaf: number;
    stale90d: number;
    singleSource: number;
    noConsultingCorroboration: number;
    lowConfidence: number;
    wideCredibleInterval: number;
    seedOnly: number;
    noEvidence: number;
    critical: number;
    warning: number;
    ok: number;
  };
  capabilities: CapabilityQualityRow[];
}

type EnrichmentLevel = "full" | "partial" | "none";

/**
 * Map a capability quality row to a 3-level enrichment status.
 *   - full: has evidence, NOT flagged seed_only, has ≥ 1 corroborating
 *     consulting/regulatory source (i.e. real triangulation), low/no
 *     critical flags.
 *   - partial: has evidence but missing corroboration or single-source.
 *   - none: seed_only or no_evidence.
 */
function enrichmentLevel(row: CapabilityQualityRow): EnrichmentLevel {
  if (row.flags.includes("no_evidence") || row.flags.includes("seed_only")) return "none";
  if (row.severity === "ok" && row.sourceCount >= 2) return "full";
  return "partial";
}

type SortKey =
  | "industryName"
  | "capsTracked"
  | "leafCaps"
  | "pctApproved"
  | "pctWithQuadrant"
  | "pctWithFullEconomics"
  | "pctFreshUnder60d"
  | "medianFreshnessDays"
  | "healthScore";
type SortDir = "asc" | "desc";

const TIER_STYLE: Record<Tier, string> = {
  Mature: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  Developing: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  Sparse: "bg-rose-500/15 text-rose-500 border-rose-500/40",
};

function pctBar(value: number) {
  const clamped = Math.max(0, Math.min(100, value));
  const color =
    clamped >= 75 ? "bg-emerald-500" : clamped >= 40 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="font-mono text-[11px] tabular-nums w-10 text-right">
        {clamped.toFixed(1)}%
      </div>
      <div className="flex-1 h-1.5 bg-muted/60 rounded-sm overflow-hidden min-w-[40px]">
        <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function formatMinutes(m: number | null): string {
  if (m === null) return "—";
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${(m / 60).toFixed(1)}h`;
  return `${(m / (60 * 24)).toFixed(1)}d`;
}

export default function CoveragePage() {
  const [data, setData] = useState<CoverageResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("healthScore");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { isAdmin, isLoaded: adminLoaded } = useIsAdmin();
  const { getToken } = useAuth();

  const [sqStats, setSqStats] = useState<SourceQualityStats | null>(null);
  const [sqRows, setSqRows] = useState<CapabilityQualityRow[] | null>(null);
  const [sqLoading, setSqLoading] = useState(false);
  const [drillCap, setDrillCap] = useState<CapabilityQualityRow | null>(null);
  const [heatmapIndustry, setHeatmapIndustry] = useState<number | "all">("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        if (adminLoaded && isAdmin) {
          const token = await getToken();
          const res = await fetch(`${API_BASE}/admin/coverage`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (!cancelled) setData(await res.json());
        } else {
          const res = await fetch(`${API_BASE}/coverage`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (!cancelled) setData(await res.json());
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load coverage");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (adminLoaded) load();
    return () => { cancelled = true; };
  }, [isAdmin, adminLoaded, getToken]);

  // Pull global source-quality stats (public endpoint).
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/source-quality/stats`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: SourceQualityStats) => { if (!cancelled) setSqStats(d); })
      .catch(() => { /* quiet */ });
    return () => { cancelled = true; };
  }, []);

  // Pull per-capability source-quality (admin only). Provides the
  // enrichment-level heatmap. Non-admins see the industry-level heatmap
  // computed from the public /coverage data.
  useEffect(() => {
    if (!adminLoaded || !isAdmin) return;
    let cancelled = false;
    setSqLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/admin/source-quality?limit=1000`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: SourceQualityResp = await res.json();
        if (!cancelled) setSqRows(json.capabilities);
      } catch {
        /* quiet — heatmap simply hides if admin endpoint fails */
      } finally {
        if (!cancelled) setSqLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, adminLoaded, getToken]);

  const heatmapRowsByIndustry = useMemo(() => {
    if (!sqRows) return new Map<number, CapabilityQualityRow[]>();
    const filtered = heatmapIndustry === "all" ? sqRows : sqRows.filter(r => r.industryId === heatmapIndustry);
    const map = new Map<number, CapabilityQualityRow[]>();
    for (const r of filtered) {
      const list = map.get(r.industryId) ?? [];
      list.push(r);
      map.set(r.industryId, list);
    }
    return map;
  }, [sqRows, heatmapIndustry]);

  const heatmapTotals = useMemo(() => {
    if (!sqRows) return null;
    const filtered = heatmapIndustry === "all" ? sqRows : sqRows.filter(r => r.industryId === heatmapIndustry);
    let full = 0, partial = 0, none = 0;
    for (const r of filtered) {
      const l = enrichmentLevel(r);
      if (l === "full") full++;
      else if (l === "partial") partial++;
      else none++;
    }
    return { full, partial, none, total: filtered.length };
  }, [sqRows, heatmapIndustry]);

  const sortedRows = useMemo(() => {
    if (!data) return [];
    const rows = [...data.industries];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = av as number;
      const bn = bv as number;
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "industryName" ? "asc" : "desc");
    }
  }

  function SortHeader({ k, label, align = "right" }: { k: SortKey; label: string; align?: "left" | "right" }) {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th className={`py-2 px-2 ${align === "right" ? "text-right" : "text-left"} font-medium`}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground" : "text-muted-foreground"}`}
        >
          {label}
          <Icon className="w-3 h-3" />
        </button>
      </th>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-64px)] bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-24">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to home
          </Link>
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              Industry coverage scorecard
            </Badge>
            <Badge variant="secondary" className="text-[10px]">Public</Badge>
            {isAdmin && <Badge className="text-[10px] bg-primary/15 text-primary border-primary/40">Admin view</Badge>}
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl tracking-tight text-foreground">
            How mature is your industry in our data?
          </h1>
          <p className="mt-3 text-base text-muted-foreground max-w-3xl leading-relaxed">
            Per-industry coverage of our capability map: how many capabilities we track, what
            share are human-reviewed, how fresh the underlying triangulation evidence is, and
            whether each capability has a full quadrant + economics block. Use this to
            self-qualify whether the data is dense enough for your buy / sell / build
            decisions.
          </p>
        </div>

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <SummaryCard label="Industries" value={data.totals.industries.toString()} />
            <SummaryCard
              label="Capabilities tracked"
              value={data.totals.capabilities.toString()}
              sub={`${data.totals.leafCapabilities} leaf`}
            />
            <SummaryCard
              label="Approved"
              value={`${data.totals.pctApproved.toFixed(1)}%`}
              sub="reviewed by humans"
            />
            <SummaryCard
              label="Fresh ≤ 60d"
              value={`${data.totals.pctFreshUnder60d.toFixed(1)}%`}
              sub="re-triangulated recently"
            />
          </div>
        )}

        {isAdmin && data?.admin && <AdminExtrasPanel extras={data.admin} />}

        {/* Global source-quality stats — public endpoint */}
        {sqStats && (
          <Card className="rounded-md mb-6 border-l-2 border-l-primary/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Database className="w-3.5 h-3.5 text-primary" />
                <div className="text-sm font-semibold">Triangulation engine — global state</div>
                <Badge variant="outline" className="text-[10px]">public</Badge>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Stat label="Total sources" value={sqStats.totalSources.toLocaleString()} />
                <Stat label="Queried (7d)" value={sqStats.queriedLast7d.toLocaleString()} />
                <Stat
                  label="Most active source"
                  value={sqStats.mostActiveSource ?? "—"}
                  sub={`${sqStats.mostActiveSourceCount.toLocaleString()} queries`}
                />
                <Stat
                  label="Contradictions (7d)"
                  value={sqStats.contradictedLast7d.toString()}
                  tone={sqStats.contradictedLast7d > 0 ? "warn" : "ok"}
                  sub=">25-pt deviation"
                />
                <Stat label="Refresh cadence" value="5 min cache" sub="stats endpoint" />
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="rounded-md">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Per-industry coverage</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Tier:{" "}
                  <span className="text-emerald-500">Mature ≥ 75</span>{" "}·{" "}
                  <span className="text-amber-500">Developing 40–75</span>{" "}·{" "}
                  <span className="text-rose-500">Sparse &lt; 40</span>
                  {data && (
                    <>
                      {" "}· cached {Math.round(data.ttlSeconds / 60)} min,
                      generated {new Date(data.generatedAt).toLocaleTimeString()}
                    </>
                  )}
                </div>
              </div>
              {loading && <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
            </div>

            {err && (
              <div className="px-4 py-6 text-sm text-rose-500 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> {err}
              </div>
            )}

            {!err && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs responsive-table">
                  <thead className="bg-muted/40 text-muted-foreground border-b border-border/60">
                    <tr>
                      <SortHeader k="industryName" label="Industry" align="left" />
                      <SortHeader k="healthScore" label="Health" />
                      <SortHeader k="capsTracked" label="Caps" />
                      <SortHeader k="leafCaps" label="Leaves" />
                      <SortHeader k="pctApproved" label="Approved" />
                      <SortHeader k="pctWithQuadrant" label="Quadrant" />
                      <SortHeader k="pctWithFullEconomics" label="Full economics" />
                      <SortHeader k="pctFreshUnder60d" label="Fresh ≤60d" />
                      <SortHeader k="medianFreshnessDays" label="Median age" />
                      <th className="py-2 px-2 text-right font-medium text-muted-foreground">GDP weight</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {sortedRows.map(row => (
                      <tr key={row.industryId} className="hover:bg-muted/30">
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-[10px] ${TIER_STYLE[row.tier]}`}>
                              {row.tier}
                            </Badge>
                            <span className="font-medium text-foreground">{row.industryName}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold">
                          {row.healthScore.toFixed(1)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">{row.capsTracked}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">{row.leafCaps}</td>
                        <td className="py-2 px-2 min-w-[120px]">{pctBar(row.pctApproved)}</td>
                        <td className="py-2 px-2 min-w-[120px]">{pctBar(row.pctWithQuadrant)}</td>
                        <td className="py-2 px-2 min-w-[120px]">{pctBar(row.pctWithFullEconomics)}</td>
                        <td className="py-2 px-2 min-w-[120px]">{pctBar(row.pctFreshUnder60d)}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">
                          {row.medianFreshnessDays !== null
                            ? `${row.medianFreshnessDays.toFixed(1)}d`
                            : <span className="text-muted-foreground italic">no data</span>}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {row.hasGdpWeight ? (
                            <CheckCircle2 className="inline w-3.5 h-3.5 text-emerald-500" aria-label="GDP weight cited" />
                          ) : (
                            <span className="text-xs text-rose-600 italic">missing</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {sortedRows.length === 0 && !loading && (
                      <tr>
                        <td colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                          No industries indexed yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-capability enrichment heatmap — admin-only data, public industry-tier fallback */}
        {sqRows && sqRows.length > 0 && heatmapTotals && (
          <Card className="rounded-md mt-6 border-l-2 border-l-primary/40">
            <CardContent className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <div>
                    <div className="text-sm font-semibold">Capability enrichment heatmap</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      <span className="text-emerald-500">Full</span> = alpha + components + ≥2 triangulated sources ·{" "}
                      <span className="text-amber-500">Partial</span> = evidence but flagged ·{" "}
                      <span className="text-rose-500">None</span> = seed-only or no evidence. Click any tile to drill into the source quality report.
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {sqLoading && <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
                  <select
                    value={heatmapIndustry === "all" ? "all" : String(heatmapIndustry)}
                    onChange={e => setHeatmapIndustry(e.target.value === "all" ? "all" : Number(e.target.value))}
                    className="text-xs h-7 px-2 border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="all">All industries</option>
                    {data?.industries.map(i => (
                      <option key={i.industryId} value={i.industryId}>{i.industryName}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Totals strip */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <HeatmapTotal level="full" count={heatmapTotals.full} total={heatmapTotals.total} />
                <HeatmapTotal level="partial" count={heatmapTotals.partial} total={heatmapTotals.total} />
                <HeatmapTotal level="none" count={heatmapTotals.none} total={heatmapTotals.total} />
              </div>

              {/* The actual heatmap — one row per industry, tiles per capability */}
              <div className="space-y-3">
                {Array.from(heatmapRowsByIndustry.entries()).map(([industryId, rows]) => {
                  const industry = data?.industries.find(i => i.industryId === industryId);
                  return (
                    <div key={industryId} className="border border-border/60 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold text-foreground">{industry?.industryName ?? `Industry #${industryId}`}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {rows.length} cap{rows.length === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {rows
                          .slice()
                          .sort((a, b) => {
                            // Sort by enrichment level then by name
                            const la = enrichmentLevel(a);
                            const lb = enrichmentLevel(b);
                            const order: Record<EnrichmentLevel, number> = { full: 0, partial: 1, none: 2 };
                            if (order[la] !== order[lb]) return order[la] - order[lb];
                            return a.capabilityName.localeCompare(b.capabilityName);
                          })
                          .map(row => {
                            const level = enrichmentLevel(row);
                            const tile =
                              level === "full" ? "bg-emerald-500/30 hover:bg-emerald-500/50 border-emerald-500/50" :
                              level === "partial" ? "bg-amber-500/30 hover:bg-amber-500/50 border-amber-500/50" :
                              "bg-rose-500/30 hover:bg-rose-500/50 border-rose-500/50";
                            return (
                              <button
                                key={row.capabilityId}
                                onClick={() => setDrillCap(row)}
                                title={`${row.capabilityName} — ${level} (${row.sourceCount} sources${row.ageDays !== null ? `, ${row.ageDays}d old` : ""})`}
                                className={`w-6 h-6 border ${tile} transition-colors rounded-sm`}
                                aria-label={`Drill into ${row.capabilityName} quality detail`}
                              />
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Industry-tier heatmap fallback for non-admin viewers — uses public /coverage data */}
        {(!sqRows || sqRows.length === 0) && data?.industries.length && (
          <Card className="rounded-md mt-6 border-l-2 border-l-primary/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-3.5 h-3.5 text-primary" />
                <div>
                  <div className="text-sm font-semibold">Coverage tier heatmap (industry-level)</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    For per-capability detail with click-through to source quality, sign in as an admin. This view uses the public industry-tier rollup.
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {data.industries.map(i => {
                  const cellColor =
                    i.tier === "Mature" ? "bg-emerald-500/15 border-emerald-500/40" :
                    i.tier === "Developing" ? "bg-amber-500/15 border-amber-500/40" :
                    "bg-rose-500/15 border-rose-500/40";
                  return (
                    <Link key={i.industryId} href={`/industries/${i.industryId}`}>
                      <div className={`border p-3 ${cellColor} hover:opacity-90 transition-opacity cursor-pointer`}>
                        <div className="text-xs font-semibold text-foreground truncate">{i.industryName}</div>
                        <div className="grid grid-cols-2 gap-1 mt-2 text-[10px] font-mono">
                          <div>
                            <div className="text-muted-foreground">Full econ</div>
                            <div className="text-foreground tabular-nums">{i.pctWithFullEconomics.toFixed(0)}%</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Approved</div>
                            <div className="text-foreground tabular-nums">{i.pctApproved.toFixed(0)}%</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Fresh ≤60d</div>
                            <div className="text-foreground tabular-nums">{i.pctFreshUnder60d.toFixed(0)}%</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Caps</div>
                            <div className="text-foreground tabular-nums">{i.capsTracked}</div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Capability quality drill-in panel */}
        {drillCap && (
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center sm:justify-end"
            onClick={() => setDrillCap(null)}
          >
            <div
              className="w-full sm:max-w-md bg-background border-l border-border h-full max-h-screen overflow-y-auto p-5"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-3 gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                    {drillCap.industryName}
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{drillCap.capabilityName}</h3>
                </div>
                <button onClick={() => setDrillCap(null)} className="text-muted-foreground hover:text-foreground">
                  <span aria-hidden>×</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <Stat
                  label="Source count"
                  value={drillCap.sourceCount.toString()}
                  tone={drillCap.sourceCount === 0 ? "warn" : "ok"}
                />
                <Stat
                  label="Confidence"
                  value={drillCap.confidence !== null ? drillCap.confidence.toFixed(2) : "—"}
                  tone={drillCap.confidence !== null && drillCap.confidence < 0.5 ? "warn" : "ok"}
                />
                <Stat
                  label="Age (days)"
                  value={drillCap.ageDays !== null ? `${drillCap.ageDays}d` : "—"}
                  tone={drillCap.ageDays !== null && drillCap.ageDays > 90 ? "warn" : "ok"}
                />
                <Stat
                  label="CI width"
                  value={drillCap.ciWidth !== null ? drillCap.ciWidth.toFixed(1) : "—"}
                  tone={drillCap.ciWidth !== null && drillCap.ciWidth > 30 ? "warn" : "ok"}
                />
              </div>

              <div className="mb-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-2">Quality flags</div>
                {drillCap.flags.length === 0 ? (
                  <div className="text-xs text-emerald-500 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> No quality flags — fully enriched.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {drillCap.flags.map(f => (
                      <span key={f} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider border border-amber-500/40 bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded-sm">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        {f.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mb-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-2">Methodologies</div>
                {drillCap.distinctMethodologies.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">No triangulated methodologies on record.</div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {drillCap.distinctMethodologies.map(m => (
                      <span key={m} className="text-[10px] border border-border bg-muted/30 text-muted-foreground px-1.5 py-0.5 rounded-sm">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <Link href={`/capability/${drillCap.capabilityId}`}>
                <Button size="sm" variant="outline" className="w-full gap-1.5">
                  Open capability detail
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </div>
        )}

        <Separator className="my-8" />
        <div className="text-[11px] text-muted-foreground leading-relaxed max-w-3xl">
          <strong className="text-foreground">How &ldquo;Full economics&rdquo; is computed:</strong>{" "}
          a capability counts when its <code>cvi_components</code> row has at least one
          triangulated source (i.e. real Perplexity-cited evidence rather than the
          prior-only fallback). See the{" "}
          <Link href="/methodology" className="text-primary hover:underline">methodology white paper</Link>{" "}
          for the underlying Bayesian model and source weights.
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="rounded-md">
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function AdminExtrasPanel({ extras }: { extras: AdminExtras }) {
  const { enrichmentQueue: q, rotation: r } = extras;
  const lagBad = r.lagHours !== null && r.lagHours > 0;
  return (
    <Card className="rounded-md mb-6 border-primary/30 bg-primary/[0.03]">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-3.5 h-3.5 text-primary" />
          <div className="text-sm font-semibold">Operations (admin only)</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Queued jobs" value={q.queued.toString()} tone={q.queued > 50 ? "warn" : "ok"} />
          <Stat label="Running" value={q.running.toString()} />
          <Stat label="Failed" value={q.failed.toString()} tone={q.failed > 0 ? "warn" : "ok"} />
          <Stat label="Completed (24h)" value={q.completedLast24h.toString()} />
          <Stat
            label="Oldest queued"
            value={formatMinutes(q.oldestQueuedAgeMinutes)}
            tone={q.oldestQueuedAgeMinutes !== null && q.oldestQueuedAgeMinutes > 60 ? "warn" : "ok"}
          />
          <Stat
            label="Rotation"
            value={r.enabled ? "Enabled" : "Disabled"}
            tone={r.enabled ? "ok" : "warn"}
          />
          <Stat
            label="Last rotation"
            value={formatMinutes(r.minutesSinceLastRun) + " ago"}
            sub={r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : "never"}
          />
          <Stat
            label="Rotation lag"
            value={r.lagHours === null ? "—" : `${r.lagHours}h`}
            sub={`refresh every ${r.refreshDays}d`}
            tone={lagBad ? "warn" : "ok"}
          />
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground inline-flex items-center gap-1">
          <Clock className="w-3 h-3" /> Lag is hours past the configured rotation cadence (0h = on schedule).
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "text-amber-500" : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums mt-0.5 ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function HeatmapTotal({ level, count, total }: { level: EnrichmentLevel; count: number; total: number }) {
  const pct = total === 0 ? 0 : (count / total) * 100;
  const meta =
    level === "full" ? { label: "Full enrichment", color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" } :
    level === "partial" ? { label: "Partial", color: "border-amber-500/40 bg-amber-500/10 text-amber-500" } :
    { label: "None / seed-only", color: "border-rose-500/40 bg-rose-500/10 text-rose-500" };
  return (
    <div className={`border p-2.5 ${meta.color}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{meta.label}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-xl font-semibold tabular-nums">{count}</span>
        <span className="text-[10px] font-mono opacity-70">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}
