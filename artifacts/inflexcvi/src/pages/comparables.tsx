/**
 * /comparables/:companyId — Comparable-deal valuation analysis.
 *
 * Third of three "job-mapped" VC/PE pages (Source, Portfolio,
 * Comparables). Takes a target company → finds the N most similar
 * companies by capability-fingerprint cosine similarity → computes
 * funding/revenue multiples on peers → produces an implied
 * valuation range for the target.
 *
 * Pure consumer of existing endpoints:
 *   GET /api/workbench/companies/:id
 *   GET /api/workbench/companies/:id/similar?limit=N
 *
 * Math is transparent — every multiple is shown per-peer with
 * provenance.
 */
import { useEffect, useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Building2, Calculator, AlertCircle } from "lucide-react";

interface Company {
  id: number;
  industryId: number;
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
}

interface CompanyDetail {
  company: Company;
  scores: { composite: number; moatScore: number; aiDisruptability: number } | null;
  fingerprint?: Array<{ capabilityId: number; capabilityName: string; weight: number }>;
}

interface SimilarRow {
  company: Company;
  similarity: number;
  sharedCaps: number;
}

const fmtUsd = (n: number | null): string => {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  return `$${(n / 1000).toFixed(0)}K`;
};

const fmtMult = (n: number | null): string => n == null ? "—" : `${n.toFixed(1)}×`;

function median(values: number[]): number | null {
  const xs = values.slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function percentile(values: number[], p: number): number | null {
  const xs = values.slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const idx = (xs.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}

export default function ComparablesPage() {
  const [, params] = useRoute<{ companyId: string }>("/comparables/:companyId");
  const targetId = params?.companyId ? parseInt(params.companyId, 10) : null;

  const [target, setTarget] = useState<CompanyDetail | null>(null);
  const [peers, setPeers] = useState<SimilarRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!targetId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/workbench/companies/${targetId}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/workbench/companies/${targetId}/similar?limit=10`).then(r => r.ok ? r.json() : { similar: [] }),
    ])
      .then(([detail, sim]) => {
        setTarget(detail);
        setPeers(sim.similar ?? []);
      })
      .finally(() => setLoading(false));
  }, [targetId]);

  // Peer multiples — funding/revenue when both > 0
  const peersWithMults = useMemo(() => peers.map(p => {
    const rev = p.company.revenueUsd ?? 0;
    const fund = p.company.fundingUsd ?? 0;
    const fundOverRev = rev > 0 && fund > 0 ? fund / rev : null;
    return { ...p, fundOverRev };
  }), [peers]);

  // Aggregate peer multiples
  const peerMults = peersWithMults.map(p => p.fundOverRev).filter((x): x is number => x != null);
  const p25 = percentile(peerMults, 0.25);
  const med = median(peerMults);
  const p75 = percentile(peerMults, 0.75);

  // Implied valuation range for target
  const targetRev = target?.company?.revenueUsd ?? null;
  const impliedLow = targetRev && p25 != null ? targetRev * p25 : null;
  const impliedMed = targetRev && med != null ? targetRev * med : null;
  const impliedHigh = targetRev && p75 != null ? targetRev * p75 : null;

  if (!targetId) {
    return <div className="container mx-auto px-4 py-8"><p>No company specified.</p></div>;
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <Link href="/source" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
        <ArrowLeft className="w-3 h-3" /> Back to Source
      </Link>

      <div>
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="h-px w-5 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Comparable-Deal Valuation</span>
        </div>
        <h1 className="font-serif text-4xl tracking-tight">{target?.company.name ?? "Loading…"}</h1>
        {target?.company.description && (
          <p className="text-muted-foreground text-sm mt-1 max-w-3xl">{target.company.description}</p>
        )}
      </div>

      {/* Target metadata */}
      {target && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-serif text-lg flex items-center gap-2"><Building2 className="w-4 h-4" /> Target</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><div className="text-xs text-muted-foreground">Revenue</div><div className="font-medium">{fmtUsd(target.company.revenueUsd)}</div></div>
              <div><div className="text-xs text-muted-foreground">Funding</div><div className="font-medium">{fmtUsd(target.company.fundingUsd)}</div></div>
              <div><div className="text-xs text-muted-foreground">Ownership</div><div className="font-medium capitalize">{target.company.ownership ?? "—"}</div></div>
              <div><div className="text-xs text-muted-foreground">FEVI</div><div className="font-medium">{target.scores?.composite.toFixed(0) ?? "—"}</div></div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Implied valuation range */}
      {targetRev && peerMults.length >= 2 && (
        <Card data-testid="implied-valuation">
          <CardHeader>
            <CardTitle className="font-serif text-lg flex items-center gap-2"><Calculator className="w-4 h-4" /> Implied valuation range</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Applies peer-group funding/revenue multiples to the target's revenue. Three bands —
              25th percentile (conservative), median (central), 75th percentile (aggressive).
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Conservative (P25)</div>
                <div className="text-2xl font-serif font-medium mt-1">{fmtUsd(impliedLow)}</div>
                <div className="text-[10px] text-muted-foreground mt-1">@ {fmtMult(p25)} of revenue</div>
              </div>
              <div className="text-center border-x">
                <div className="text-xs uppercase tracking-wider text-accent">Median</div>
                <div className="text-3xl font-serif font-medium mt-1 text-accent">{fmtUsd(impliedMed)}</div>
                <div className="text-[10px] text-muted-foreground mt-1">@ {fmtMult(med)} of revenue</div>
              </div>
              <div className="text-center">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Aggressive (P75)</div>
                <div className="text-2xl font-serif font-medium mt-1">{fmtUsd(impliedHigh)}</div>
                <div className="text-[10px] text-muted-foreground mt-1">@ {fmtMult(p75)} of revenue</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-4 italic">
              Derived from {peerMults.length} peer companies with both revenue and funding disclosed.
              Funding-over-revenue used as a private-market proxy for EV/Revenue; for public peers a
              real market-cap feed would refine the multiple.
            </div>
          </CardContent>
        </Card>
      )}

      {targetRev && peerMults.length < 2 && (
        <Card>
          <CardContent className="py-6 flex items-center gap-3 text-sm text-muted-foreground">
            <AlertCircle className="w-4 h-4" />
            <span>Need at least 2 peers with both revenue and funding disclosed to compute multiples — only {peerMults.length} found.</span>
          </CardContent>
        </Card>
      )}

      {!targetRev && (
        <Card>
          <CardContent className="py-6 flex items-center gap-3 text-sm text-muted-foreground">
            <AlertCircle className="w-4 h-4" />
            <span>Target company has no disclosed revenue — can't compute implied valuation. Update the company record or use peer table below for context.</span>
          </CardContent>
        </Card>
      )}

      {/* Peer table */}
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Cap-fingerprint peers</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Top {peers.length} companies by cosine similarity over capability weights (same industry).
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="text-left py-2">Peer</th>
                  <th className="text-left">Ownership</th>
                  <th className="text-right">Similarity</th>
                  <th className="text-right">Shared Caps</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Funding</th>
                  <th className="text-right">Funding / Revenue</th>
                </tr>
              </thead>
              <tbody>
                {peersWithMults.map((p) => (
                  <tr key={p.company.id} className="border-b last:border-0 hover:bg-muted/40" data-testid={`peer-${p.company.id}`}>
                    <td className="py-2">
                      <div className="font-medium">{p.company.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.company.country ?? ""}
                        {p.company.publicTicker ? ` · ${p.company.publicTicker}` : ""}
                      </div>
                    </td>
                    <td><Badge variant="outline" className="text-[10px] capitalize">{p.company.ownership ?? "?"}</Badge></td>
                    <td className="text-right tabular-nums">{(p.similarity * 100).toFixed(0)}%</td>
                    <td className="text-right tabular-nums">{p.sharedCaps}</td>
                    <td className="text-right tabular-nums text-xs">{fmtUsd(p.company.revenueUsd)}</td>
                    <td className="text-right tabular-nums text-xs">{fmtUsd(p.company.fundingUsd)}</td>
                    <td className="text-right tabular-nums">{fmtMult(p.fundOverRev)}</td>
                  </tr>
                ))}
                {peers.length === 0 && !loading && (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground text-sm">
                    No peers found. The target company may have no capability fingerprint yet, or it's the only company in its industry with one.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
