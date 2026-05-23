import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Scale, ShieldCheck, ShieldAlert, AlertTriangle, ChevronRight, ArrowLeft,
  Bell, BellOff, ArrowUpRight, ArrowDownRight, RefreshCw,
} from "lucide-react";
import { PersonaDescription } from "@/components/page-header";
import { RequirementProvenanceTooltip } from "@/components/requirement-provenance-tooltip";
import { ConsensusView } from "@/components/consensus-view";
import { CapabilityCascadeChip } from "@/components/capability-cascade-chip";

const API_BASE = "/api";

type Regulation = {
  id: number;
  name: string;
  shortCode: string;
  description: string | null;
  jurisdiction: string;
  effectiveDate: string | null;
  industries: number[];
};

type OverviewRow = {
  regulation: Regulation;
  overallCompliance: number | null;
  total: number;
  assessed: number;
  compliant: number;
  nonCompliant: number;
  criticalGaps: number;
  totalGapPoints: number;
  evarWeightedExposure: number;
  enforcementForecast: {
    direction: "stricter" | "steady" | "softer";
    confidence: number;
    summary: string;
    forecastedAt: string;
  } | null;
};

type Requirement = {
  capabilityId: number;
  capabilityName: string | null;
  requiredMaturity: number;
  priority: string;
  article: string | null;
  evidenceNotes: string | null;
  myScore: number | null;
  compliant: boolean | null;
  gap: number | null;
};

type ComplianceResult = {
  regulation: Regulation;
  overallCompliance: number | null;
  total: number;
  assessed: number;
  compliant: number;
  nonCompliant: number;
  criticalGaps: number;
  results: Requirement[];
};

type Industry = { id: number; name: string };

type WatchRow = { id: number; userId: string; regulationId: number };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

function formatDollarsMm(usdMm: number): string {
  if (usdMm >= 1000) return `$${(usdMm / 1000).toFixed(1)}B`;
  if (usdMm >= 1) return `$${usdMm.toFixed(1)}M`;
  if (usdMm <= 0) return "—";
  return `$${(usdMm * 1000).toFixed(0)}K`;
}

function complianceTone(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

export default function Regulations() {
  const { isSignedIn } = useAuth();
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<number | null>(() => {
    const v = typeof window !== "undefined" ? localStorage.getItem("ce_industry_id") : null;
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReg, setSelectedReg] = useState<ComplianceResult | null>(null);
  const [watches, setWatches] = useState<Set<number>>(new Set());
  const [busyWatchId, setBusyWatchId] = useState<number | null>(null);

  const sessionToken = typeof window !== "undefined" ? (localStorage.getItem("ce_session_token") ?? "") : "";

  const loadIndustries = async () => {
    try {
      const res = await fetch(`${API_BASE}/industries`);
      const rows = (await res.json()) as Industry[];
      setIndustries(rows);
    } catch (err) {
      console.error(err);
    }
  };

  const loadOverview = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (industryId) qs.set("industryId", String(industryId));
      if (sessionToken) qs.set("sessionToken", sessionToken);
      const res = await fetch(`${API_BASE}/regulations/overview${qs.size ? `?${qs}` : ""}`);
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadWatches = async () => {
    if (!isSignedIn) { setWatches(new Set()); return; }
    try {
      const res = await fetch(`${API_BASE}/me/regulation-watches`, { credentials: "include" });
      if (!res.ok) { setWatches(new Set()); return; }
      const data = (await res.json()) as WatchRow[];
      setWatches(new Set(data.map((w) => w.regulationId)));
    } catch { /* ignore */ }
  };

  useEffect(() => { loadIndustries(); }, []);
  useEffect(() => { loadOverview(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [industryId]);
  useEffect(() => { loadWatches(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isSignedIn]);

  const checkCompliance = async (id: number) => {
    try {
      const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : "";
      const res = await fetch(`${API_BASE}/regulations/${id}/compliance${qs}`);
      setSelectedReg(await res.json());
    } catch (err) { console.error(err); }
  };

  const toggleWatch = async (regId: number) => {
    if (!isSignedIn) {
      window.alert("Sign in to watch a regulation.");
      return;
    }
    setBusyWatchId(regId);
    try {
      const watching = watches.has(regId);
      const res = await fetch(`${API_BASE}/me/regulation-watches/${regId}`, {
        method: watching ? "DELETE" : "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        window.alert(`Watch toggle failed: ${err.error ?? res.statusText}`);
        return;
      }
      setWatches((prev) => {
        const next = new Set(prev);
        if (watching) next.delete(regId);
        else next.add(regId);
        return next;
      });
    } finally {
      setBusyWatchId(null);
    }
  };

  const goToScorecard = (compliance: ComplianceResult) => {
    const gapIds = compliance.results
      .filter((r) => r.compliant === false)
      .map((r) => r.capabilityId);
    if (gapIds.length === 0) {
      window.alert("No capability gaps to remediate.");
      return;
    }
    const qs = new URLSearchParams({
      capabilityIds: gapIds.join(","),
      source: compliance.regulation.shortCode,
    });
    window.location.href = `/scorecard?${qs.toString()}`;
  };

  // Past-effective-with-gaps banner state
  const now = Date.now();
  const overdueRegulations = useMemo(() => {
    return rows.filter((r) => {
      if (!r.regulation.effectiveDate) return false;
      const ed = new Date(r.regulation.effectiveDate).getTime();
      if (Number.isNaN(ed) || ed > now) return false;
      return r.overallCompliance !== null && r.overallCompliance < 100;
    });
  }, [rows, now]);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <Badge className="mb-2">Compliance</Badge>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Compliance</span>
          </div>
          <h1 className="text-3xl font-serif tracking-tight">Regulatory Capability Mapping</h1>
          <p className="text-muted-foreground mt-1">Map regulatory requirements to capabilities and check your compliance posture.</p>
          <PersonaDescription
            descriptions={{
              default: "Every active regulation (HIPAA, GDPR, SOX, …) is mapped to the capabilities it requires. Click a regulation to see compliance gaps.",
              pe: "Regulatory risk view for portfolio cos. Click any regulation to see which target capabilities are below the required-maturity threshold — the precise gap your remediation plan needs to close.",
              vc: "Defensibility moat. A startup that already has the capabilities mapped to HIPAA / SOC2 / GDPR has a lower customer-acquisition friction; this page tells you where they stand.",
              f500: "Compliance gap board. Every regulation sorts by EVaR-weighted dollar exposure — biggest exposure on top. Pair with /scorecard for the remediation priorities by capability.",
              student: "Concrete worked example of why capability maturity matters. Regulations specify required maturity levels per capability — you can see the math.",
              professor: "Citable regulation → capability mapping. Useful in compliance / risk-management curricula; mappings are exportable for assignments.",
            }}
            className="mt-3"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={industryId ?? ""}
            onChange={(e) => setIndustryId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="px-3 py-2 text-sm border border-border bg-background rounded-none"
            data-testid="regulations-industry-filter"
          >
            <option value="">All jurisdictions</option>
            {industries.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={loadOverview} disabled={loading} className="rounded-none">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {overdueRegulations.length > 0 && !selectedReg && (
        <div className="border border-destructive/30 bg-destructive/[0.06] px-4 py-3 text-sm">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive mb-1 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            Effective with gaps
          </div>
          <div className="text-foreground">
            {overdueRegulations.length === 1 ? "1 regulation is" : `${overdueRegulations.length} regulations are`}{" "}
            past their effective date with compliance below 100%:{" "}
            <strong>{overdueRegulations.map((r) => r.regulation.shortCode).join(", ")}</strong>. Click into each to see the gap and remediate.
          </div>
        </div>
      )}

      {!selectedReg ? (
        <>
          {loading ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground italic">Loading…</CardContent></Card>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Scale className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No regulations match this filter. Try "All jurisdictions" or pick a different industry.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-none">
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base font-serif">Regulations — sorted by EVaR-weighted exposure</CardTitle>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {rows.length} {rows.length === 1 ? "regulation" : "regulations"}
                </span>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        <th className="px-3 py-2 text-left w-10"></th>
                        <th className="px-3 py-2 text-left">Code</th>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Jurisdiction</th>
                        <th className="px-3 py-2 text-left">Effective</th>
                        <th className="px-3 py-2 text-right">Compliance</th>
                        <th className="px-3 py-2 text-left">Enforcement</th>
                        <th className="px-3 py-2 text-right">Critical gaps</th>
                        <th className="px-3 py-2 text-right">EVaR-weighted exposure</th>
                        <th className="px-3 py-2 text-right w-32"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const isWatched = watches.has(row.regulation.id);
                        const effectiveDate = row.regulation.effectiveDate
                          ? new Date(row.regulation.effectiveDate).getTime()
                          : null;
                        const pastEffective = effectiveDate !== null && effectiveDate < now;
                        const overdue = pastEffective && row.overallCompliance !== null && row.overallCompliance < 100;
                        return (
                          <tr
                            key={row.regulation.id}
                            className="border-b border-border last:border-b-0 hover:bg-muted/40 cursor-pointer transition-colors"
                            onClick={() => checkCompliance(row.regulation.id)}
                          >
                            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => toggleWatch(row.regulation.id)}
                                disabled={busyWatchId === row.regulation.id}
                                aria-label={isWatched ? `Unwatch ${row.regulation.shortCode}` : `Watch ${row.regulation.shortCode}`}
                                className={`p-1 transition-colors ${isWatched ? "text-amber-500" : "text-muted-foreground hover:text-foreground"}`}
                                data-testid={`button-watch-${row.regulation.shortCode}`}
                              >
                                {isWatched ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                              </button>
                            </td>
                            <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                              <Scale className="w-3.5 h-3.5 inline mr-1.5 text-primary/70 align-text-bottom" />
                              {row.regulation.shortCode}
                            </td>
                            <td className="px-3 py-3 max-w-[24rem]">
                              <span className="font-medium">{row.regulation.name}</span>
                            </td>
                            <td className="px-3 py-3">
                              <Badge variant="outline" className="rounded-none font-mono text-[10px]">{row.regulation.jurisdiction}</Badge>
                            </td>
                            <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
                              <span className={overdue ? "text-destructive" : ""}>{fmtDate(row.regulation.effectiveDate)}</span>
                              {overdue && <span className="ml-1.5 text-destructive">•</span>}
                            </td>
                            <td className={`px-3 py-3 text-right font-mono tabular-nums ${complianceTone(row.overallCompliance)}`}>
                              {row.overallCompliance !== null ? `${row.overallCompliance}%` : "—"}
                            </td>
                            <td className="px-3 py-3">
                              {row.enforcementForecast ? (
                                <span
                                  title={`${row.enforcementForecast.summary} (confidence ${(row.enforcementForecast.confidence * 100).toFixed(0)}%)`}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${
                                    row.enforcementForecast.direction === "stricter"
                                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                                      : row.enforcementForecast.direction === "softer"
                                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                        : "border-border bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {row.enforcementForecast.direction === "stricter" ? "↗" : row.enforcementForecast.direction === "softer" ? "↘" : "→"}{" "}
                                  {row.enforcementForecast.direction}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-mono tabular-nums">
                              {row.criticalGaps > 0 ? (
                                <span className="text-destructive">{row.criticalGaps}</span>
                              ) : (
                                <span className="text-muted-foreground">{row.criticalGaps}</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-mono tabular-nums">
                              {row.evarWeightedExposure > 0 ? (
                                <span className="text-foreground">{formatDollarsMm(row.evarWeightedExposure)}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <span className="font-mono text-xs text-primary inline-flex items-center gap-1">
                                Details <ChevronRight className="w-3.5 h-3.5" />
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!sessionToken && (
                  <div className="px-3 py-2 border-t border-border font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    No assessment yet — compliance shows industry benchmarks only. Run an assessment to populate your scores.
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <>
          {/* Compliance Detail View */}
          <Button variant="ghost" onClick={() => setSelectedReg(null)} className="rounded-none">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to all regulations
          </Button>

          <div className="flex items-center gap-4 flex-wrap">
            <h2 className="text-2xl font-serif tracking-tight">{selectedReg.regulation.shortCode}: {selectedReg.regulation.name}</h2>
            <Badge variant="outline" className="rounded-none">{selectedReg.regulation.jurisdiction}</Badge>
            {selectedReg.regulation.effectiveDate && (
              <span className="font-mono text-xs text-muted-foreground">
                Effective {fmtDate(selectedReg.regulation.effectiveDate)}
              </span>
            )}
          </div>

          {selectedReg.regulation.description && (
            <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">{selectedReg.regulation.description}</p>
          )}

          {/* Compliance Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="rounded-none">
              <CardContent className="pt-6 text-center">
                {selectedReg.overallCompliance !== null ? (
                  <>
                    <p className={`text-3xl font-bold ${complianceTone(selectedReg.overallCompliance)}`}>
                      {selectedReg.overallCompliance}%
                    </p>
                    <p className="text-xs text-muted-foreground">Overall Compliance</p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-bold text-muted-foreground">—</p>
                    <p className="text-xs text-muted-foreground">Not Assessed</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-none">
              <CardContent className="pt-6 text-center">
                <ShieldCheck className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
                <p className="text-2xl font-bold">{selectedReg.compliant}</p>
                <p className="text-xs text-muted-foreground">Compliant</p>
              </CardContent>
            </Card>
            <Card className="rounded-none">
              <CardContent className="pt-6 text-center">
                <ShieldAlert className="w-6 h-6 mx-auto mb-2 text-destructive" />
                <p className="text-2xl font-bold">{selectedReg.nonCompliant}</p>
                <p className="text-xs text-muted-foreground">Non-Compliant</p>
              </CardContent>
            </Card>
            <Card className="rounded-none">
              <CardContent className="pt-6 text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-500" />
                <p className="text-2xl font-bold">{selectedReg.total - selectedReg.assessed}</p>
                <p className="text-xs text-muted-foreground">Unassessed</p>
              </CardContent>
            </Card>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => goToScorecard(selectedReg)} className="rounded-none" data-testid="button-remediate-to-scorecard">
              <ArrowUpRight className="w-4 h-4 mr-2" />
              Remediate {selectedReg.nonCompliant > 0 ? `(${selectedReg.nonCompliant} gaps)` : ""} → Scorecard
            </Button>
            {isSignedIn && (
              <Button
                variant="outline"
                onClick={() => toggleWatch(selectedReg.regulation.id)}
                disabled={busyWatchId === selectedReg.regulation.id}
                className="rounded-none"
              >
                {watches.has(selectedReg.regulation.id) ? (
                  <><Bell className="w-4 h-4 mr-2 text-amber-500" /> Watching</>
                ) : (
                  <><BellOff className="w-4 h-4 mr-2" /> Watch this regulation</>
                )}
              </Button>
            )}
          </div>

          {/* Requirements Table */}
          <Card className="rounded-none">
            <CardHeader><CardTitle>Capability Requirements</CardTitle></CardHeader>
            <CardContent>
              {selectedReg.results.length > 0 ? (
                <div className="space-y-2">
                  {selectedReg.results.sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0)).map((r, i) => (
                    <div key={i} className={`flex items-center justify-between p-3 border ${
                      r.compliant === true ? "border-emerald-500/30 bg-emerald-500/5" :
                      r.compliant === false ? "border-destructive/30 bg-destructive/5" :
                      ""
                    }`}>
                      <div>
                        <ConsensusView
                          capabilityId={r.capabilityId}
                          ourScore={r.myScore ?? r.requiredMaturity}
                          precision={0}
                          className="font-medium text-sm text-foreground"
                        >
                          {r.capabilityName ?? `Capability ${r.capabilityId}`}
                        </ConsensusView>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="rounded-none text-xs">{r.priority}</Badge>
                          <RequirementProvenanceTooltip
                            article={r.article}
                            evidenceNotes={r.evidenceNotes}
                          />
                        </div>
                        {r.compliant === false && (
                          <div className="mt-2">
                            <CapabilityCascadeChip capabilityId={r.capabilityId} />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Required</p>
                          <p className="font-mono">{r.requiredMaturity}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Your Score</p>
                          <p className="font-mono">{r.myScore?.toFixed(0) ?? "—"}</p>
                        </div>
                        <div className="text-right min-w-[60px]">
                          {r.compliant === true && <Badge className="bg-emerald-500 rounded-none">Compliant</Badge>}
                          {r.compliant === false && <Badge variant="destructive" className="rounded-none">Gap: {r.gap?.toFixed(0)}</Badge>}
                          {r.compliant === null && <Badge variant="outline" className="rounded-none">Unassessed</Badge>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">No capability requirements configured for this regulation yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
