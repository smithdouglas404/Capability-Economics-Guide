import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, AlertCircle, CheckCircle2, Activity, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
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
                <table className="w-full text-xs">
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
                            <span className="text-[10px] text-rose-500/80 italic">missing</span>
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

        <Separator className="my-8" />
        <div className="text-[11px] text-muted-foreground leading-relaxed max-w-3xl">
          <strong className="text-foreground">How &ldquo;Full economics&rdquo; is computed:</strong>{" "}
          a capability counts when its <code>cei_components</code> row has at least one
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
