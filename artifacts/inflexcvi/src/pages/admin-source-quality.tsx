import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Filter,
  Clock,
  Layers,
  ShieldAlert,
} from "lucide-react";
import { AdminPageShell } from "@/components/admin-page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@clerk/react";

const API_BASE = "/api";

type Severity = "critical" | "warning" | "ok";
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
  severity: Severity;
}

interface SourceQualitySummary {
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
}

interface AuditResp {
  generatedAt: string;
  ttlSeconds: number;
  summary: SourceQualitySummary;
  capabilities: CapabilityQualityRow[];
}

const FLAG_LABEL: Record<QualityFlag, string> = {
  stale: "Stale > 90d",
  single_source: "Single source",
  no_consulting_corroboration: "No consulting corroboration",
  low_confidence: "Low confidence",
  wide_credible_interval: "Wide CI",
  seed_only: "Seed-only",
  no_evidence: "No evidence",
};

const FLAG_TONE: Record<QualityFlag, string> = {
  stale: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  single_source: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  no_consulting_corroboration: "bg-rose-500/15 text-rose-500 border-rose-500/40",
  low_confidence: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  wide_credible_interval: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  seed_only: "bg-rose-500/15 text-rose-500 border-rose-500/40",
  no_evidence: "bg-rose-500/15 text-rose-500 border-rose-500/40",
};

const SEV_STYLE: Record<Severity, string> = {
  critical: "bg-rose-500/15 text-rose-500 border-rose-500/40",
  warning: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  ok: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
};

const ALL_FLAGS: QualityFlag[] = [
  "no_evidence",
  "seed_only",
  "stale",
  "no_consulting_corroboration",
  "single_source",
  "low_confidence",
  "wide_credible_interval",
];

function StatCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  tone: "critical" | "warning" | "ok" | "neutral";
  icon: typeof AlertCircle;
}) {
  const toneClass =
    tone === "critical"
      ? "text-rose-500"
      : tone === "warning"
        ? "text-amber-500"
        : tone === "ok"
          ? "text-emerald-500"
          : "text-foreground";
  return (
    <Card className="rounded-none border-border/60">
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className={`w-4 h-4 ${toneClass}`} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground truncate">
            {label}
          </div>
          <div className={`font-mono text-2xl tabular-nums ${toneClass}`}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminSourceQualityPage() {
  const [data, setData] = useState<AuditResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [flagFilter, setFlagFilter] = useState<QualityFlag | "all">("all");
  const [industryFilter, setIndustryFilter] = useState<number | "all">("all");
  const [leafOnly, setLeafOnly] = useState(false);
  const { getToken } = useAuth();

  async function load(force = false) {
    if (force) setRefreshing(true);
    else setLoading(true);
    setErr(null);
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE}/admin/source-quality`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${resp.status}`);
      }
      const json = (await resp.json()) as AuditResp;
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load audit");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const industries = useMemo(() => {
    if (!data) return [] as Array<{ id: number; name: string }>;
    const seen = new Map<number, string>();
    for (const c of data.capabilities) seen.set(c.industryId, c.industryName);
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [] as CapabilityQualityRow[];
    return data.capabilities.filter(r => {
      if (severityFilter !== "all" && r.severity !== severityFilter) return false;
      if (flagFilter !== "all" && !r.flags.includes(flagFilter)) return false;
      if (industryFilter !== "all" && r.industryId !== industryFilter) return false;
      if (leafOnly && !r.isLeaf) return false;
      return true;
    });
  }, [data, severityFilter, flagFilter, industryFilter, leafOnly]);

  return (
    <AdminPageShell
      title="Source Quality Audit"
      description="Capabilities flagged for thin evidence, single-source dependence, stale triangulations, or wide credible intervals."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(true)}
          disabled={refreshing || loading}
          className="rounded-none font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      }
    >
      {err && (
        <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-4 py-3 mb-6 text-sm font-mono">
          {err}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Critical" value={data.summary.critical} tone="critical" icon={AlertCircle} />
            <StatCard label="Warning" value={data.summary.warning} tone="warning" icon={AlertTriangle} />
            <StatCard label="OK" value={data.summary.ok} tone="ok" icon={CheckCircle2} />
            <StatCard label="Total capabilities" value={data.summary.totalCapabilities} tone="neutral" icon={Layers} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            <StatCard label="No evidence" value={data.summary.noEvidence} tone="critical" icon={ShieldAlert} />
            <StatCard label="Seed-only" value={data.summary.seedOnly} tone="critical" icon={ShieldAlert} />
            <StatCard label="Stale > 90d" value={data.summary.stale90d} tone="critical" icon={Clock} />
            <StatCard label="No consulting" value={data.summary.noConsultingCorroboration} tone="critical" icon={AlertCircle} />
            <StatCard label="Single source" value={data.summary.singleSource} tone="warning" icon={AlertTriangle} />
            <StatCard label="Low confidence" value={data.summary.lowConfidence} tone="warning" icon={AlertTriangle} />
            <StatCard label="Wide CI" value={data.summary.wideCredibleInterval} tone="warning" icon={AlertTriangle} />
          </div>

          <Card className="rounded-none border-border/60 mb-4">
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <div className="flex items-center gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Severity</label>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as Severity | "all")}
                  className="bg-background border border-border/60 px-2 py-1 text-sm font-mono"
                >
                  <option value="all">All</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="ok">OK</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Flag</label>
                <select
                  value={flagFilter}
                  onChange={(e) => setFlagFilter(e.target.value as QualityFlag | "all")}
                  className="bg-background border border-border/60 px-2 py-1 text-sm font-mono"
                >
                  <option value="all">All</option>
                  {ALL_FLAGS.map(f => (
                    <option key={f} value={f}>{FLAG_LABEL[f]}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Industry</label>
                <select
                  value={industryFilter}
                  onChange={(e) => setIndustryFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                  className="bg-background border border-border/60 px-2 py-1 text-sm font-mono max-w-[260px]"
                >
                  <option value="all">All</option>
                  {industries.map(i => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={leafOnly}
                  onChange={(e) => setLeafOnly(e.target.checked)}
                />
                Leaf caps only
              </label>
              <div className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
                {filtered.length} / {data.summary.totalCapabilities} shown
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-border/60">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      <th className="px-4 py-3">Severity</th>
                      <th className="px-4 py-3">Capability</th>
                      <th className="px-4 py-3">Industry</th>
                      <th className="px-4 py-3 text-right">Sources</th>
                      <th className="px-4 py-3 text-right">Age (d)</th>
                      <th className="px-4 py-3 text-right">Conf.</th>
                      <th className="px-4 py-3 text-right">CI width</th>
                      <th className="px-4 py-3">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(row => (
                      <tr key={row.capabilityId} className="border-t border-border/40 hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-[0.12em] ${SEV_STYLE[row.severity]}`}>
                            {row.severity}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/explore?capabilityId=${row.capabilityId}`}
                            className="hover:underline font-medium"
                          >
                            {row.capabilityName}
                          </Link>
                          <div className="text-[10px] font-mono text-muted-foreground">
                            #{row.capabilityId} · {row.isLeaf ? "leaf" : "rollup"} · {row.reviewStatus}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{row.industryName}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{row.sourceCount}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {row.ageDays === null ? "—" : row.ageDays.toFixed(0)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {row.confidence === null ? "—" : row.confidence.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {row.ciWidth === null ? "—" : row.ciWidth.toFixed(1)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {row.flags.length === 0 ? (
                              <span className="text-muted-foreground text-xs">—</span>
                            ) : (
                              row.flags.map(f => (
                                <Badge
                                  key={f}
                                  variant="outline"
                                  className={`rounded-none font-mono text-[10px] uppercase tracking-[0.12em] ${FLAG_TONE[f]}`}
                                >
                                  {FLAG_LABEL[f]}
                                </Badge>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">
                          No capabilities match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Separator className="my-6" />
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Generated {new Date(data.generatedAt).toLocaleString()} · cache TTL {data.ttlSeconds}s
          </p>
        </>
      )}

      {loading && !data && (
        <div className="text-sm text-muted-foreground py-8">Loading source quality audit…</div>
      )}
    </AdminPageShell>
  );
}
