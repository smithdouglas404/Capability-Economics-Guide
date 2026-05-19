/**
 * /source — VC/PE deal-sourcing surface.
 *
 * Purpose: turn the existing companies + FEVI infrastructure into a
 * ranked, filterable shortlist where each row carries a 1-paragraph
 * "why this matters" thesis so an analyst can scan 20 companies and
 * pick the 3 worth a real diligence pass.
 *
 * Pure consumer of existing endpoints — no new schema, no LLM cost:
 *   GET /api/workbench/companies?industryId=X
 *   GET /api/workbench/companies/:id
 *   GET /api/workbench/companies/:id/similar
 *   POST /api/watchlist/companies/:id  (existing watchlist hook)
 *
 * Thesis paragraph is template-generated from the company's FEVI
 * sub-scores + capability fingerprint + industry context. Deterministic.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, TrendingUp, ChevronRight, RefreshCw, Star, ArrowUpDown, Search } from "lucide-react";

type Industry = { id: number; name: string };
type Scores = {
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
};
type Company = {
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
};
type CompanyRow = { company: Company; scores: Scores | null };

const fmtUsd = (n: number | null): string => {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

/**
 * Deterministic thesis snippet — 3 short fragments derived from FEVI
 * sub-scores. Captures the "why look here" intuition without LLM cost.
 */
function thesisSnippet(s: Scores | null): { headline: string; reasons: string[] } {
  if (!s) return { headline: "Insufficient data", reasons: ["No scores yet — recompute to populate"] };
  const reasons: string[] = [];

  if (s.moatScore >= 65 && s.qualityOfAsset >= 60) reasons.push(`Defensible incumbent — moat ${s.moatScore.toFixed(0)} + quality ${s.qualityOfAsset.toFixed(0)}`);
  if (s.aiDisruptability >= 60) reasons.push(`AI-disruption risk elevated (${s.aiDisruptability.toFixed(0)}) — entrant exposure`);
  if (s.acquisitionProbability >= 60) reasons.push(`Likely strategic-buyer target (acq prob ${s.acquisitionProbability.toFixed(0)})`);
  if (s.forecastedValue >= 70) reasons.push(`Strong forecasted-value trajectory (${s.forecastedValue.toFixed(0)})`);
  if (s.actionability >= 65) reasons.push(`Actionable thesis (${s.actionability.toFixed(0)}) — clear next step`);
  if (s.riskProfile <= 35) reasons.push(`Low risk profile (${s.riskProfile.toFixed(0)})`);
  if (s.riskProfile >= 70) reasons.push(`High risk profile (${s.riskProfile.toFixed(0)}) — value play if pricing reflects`);
  if (s.cviWeighted >= 65) reasons.push(`Capability stack scoring above peers (CVI weighted ${s.cviWeighted.toFixed(0)})`);
  if (s.agedIndex <= 30) reasons.push(`Fresh signal (aged-index ${s.agedIndex.toFixed(0)}) — recent capability investment`);

  // Headline from composite
  let headline: string;
  if (s.composite >= 75) headline = "Top-quartile fit — prioritize";
  else if (s.composite >= 60) headline = "Strong candidate — diligence worthwhile";
  else if (s.composite >= 45) headline = "Worth a second look";
  else headline = "Lower priority — consider only if thesis-fit";

  if (reasons.length === 0) reasons.push("Scores in the middle band — no strong directional signal");
  return { headline, reasons: reasons.slice(0, 3) };
}

export default function SourcePage() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<number | null>(null);
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [search, setSearch] = useState("");
  const [ownership, setOwnership] = useState<string>("all");
  const [sortBy, setSortBy] = useState<keyof Scores>("composite");
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busyAdd, setBusyAdd] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/industries").then(r => r.json()).then((d: Industry[] | { industries: Industry[] }) => {
      const list = Array.isArray(d) ? d : d.industries;
      setIndustries(list);
      if (list.length > 0 && industryId == null) setIndustryId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!industryId) return;
    setLoading(true);
    fetch(`/api/workbench/companies?industryId=${industryId}&limit=100`)
      .then(r => r.json())
      .then((d: CompanyRow[] | { rows: CompanyRow[] }) => {
        const list = Array.isArray(d) ? d : d.rows;
        setRows(list ?? []);
      })
      .finally(() => setLoading(false));
  }, [industryId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows
      .filter(r => !q || r.company.name.toLowerCase().includes(q) || (r.company.description ?? "").toLowerCase().includes(q))
      .filter(r => ownership === "all" || r.company.ownership === ownership)
      .sort((a, b) => {
        const av = a.scores?.[sortBy] ?? -1;
        const bv = b.scores?.[sortBy] ?? -1;
        return bv - av;
      });
  }, [rows, search, ownership, sortBy]);

  const selected = useMemo(() => rows.find(r => r.company.id === selectedId) ?? null, [rows, selectedId]);

  const addToWatchlist = async (companyId: number) => {
    setBusyAdd(companyId);
    try {
      await fetch(`/api/watchlist/companies/${companyId}`, { method: "POST" });
    } finally {
      setBusyAdd(null);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Deal Sourcing</span>
          </div>
          <h1 className="font-serif text-4xl tracking-tight">Source</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
            Ranked, filterable shortlist of companies with composite FEVI scores. Each thesis snippet
            is generated from the company's sub-scores + capability fingerprint — so you scan 20 rows
            and surface the 3 worth a real diligence pass.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={industryId ?? ""}
            onChange={(e) => setIndustryId(parseInt(e.target.value, 10))}
            className="border rounded px-3 py-2 bg-background text-sm"
            data-testid="industry-select"
          >
            {industries.map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}
          </select>
          <select
            value={ownership}
            onChange={(e) => setOwnership(e.target.value)}
            className="border rounded px-3 py-2 bg-background text-sm"
            data-testid="ownership-filter"
          >
            <option value="all">All ownership</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
            <option value="pe-backed">PE-backed</option>
            <option value="vc-backed">VC-backed</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as keyof Scores)}
            className="border rounded px-3 py-2 bg-background text-sm"
            data-testid="sort-by"
          >
            <option value="composite">Sort: FEVI Composite</option>
            <option value="moatScore">Sort: Moat</option>
            <option value="acquisitionProbability">Sort: Acquisition Prob</option>
            <option value="aiDisruptability">Sort: AI Disruption Risk</option>
            <option value="forecastedValue">Sort: Forecasted Value</option>
            <option value="cviWeighted">Sort: CVI-Weighted</option>
          </select>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name / desc…"
              className="pl-7 w-44 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="search-input"
            />
          </div>
        </div>
      </div>

      <div className={`grid gap-4 ${selected ? "lg:grid-cols-[1fr_400px]" : "grid-cols-1"}`}>
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg flex items-center gap-2">
              <Building2 className="w-4 h-4" /> Shortlist
              <span className="text-xs text-muted-foreground font-normal ml-2">{filtered.length} / {rows.length} companies</span>
              {loading && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground ml-2" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="text-left py-2">Company</th>
                    <th className="text-left">Ownership</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">FEVI</th>
                    <th className="text-right">Moat</th>
                    <th className="text-right">AI Risk</th>
                    <th className="text-left pl-4">Thesis</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const t = thesisSnippet(r.scores);
                    const isSelected = r.company.id === selectedId;
                    return (
                      <Fragment key={r.company.id}>
                        <tr
                          className={`border-b last:border-0 hover:bg-muted/40 cursor-pointer ${isSelected ? "bg-muted/30" : ""}`}
                          onClick={() => setSelectedId(r.company.id)}
                          data-testid={`row-${r.company.id}`}
                        >
                          <td className="py-2">
                            <div className="font-medium">{r.company.name}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {r.company.country ?? ""}
                              {r.company.foundedYear ? ` · est. ${r.company.foundedYear}` : ""}
                              {r.company.publicTicker ? ` · ${r.company.publicTicker}` : ""}
                            </div>
                          </td>
                          <td>
                            <Badge variant="outline" className="text-[10px] capitalize">{r.company.ownership ?? "?"}</Badge>
                          </td>
                          <td className="text-right tabular-nums text-xs">{fmtUsd(r.company.revenueUsd)}</td>
                          <td className="text-right tabular-nums font-medium">{r.scores?.composite.toFixed(0) ?? "—"}</td>
                          <td className="text-right tabular-nums text-xs">{r.scores?.moatScore.toFixed(0) ?? "—"}</td>
                          <td className="text-right tabular-nums text-xs">{r.scores?.aiDisruptability.toFixed(0) ?? "—"}</td>
                          <td className="pl-4 max-w-md">
                            <div className="text-xs font-medium">{t.headline}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{t.reasons[0]}</div>
                          </td>
                          <td className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={(e) => { e.stopPropagation(); addToWatchlist(r.company.id); }}
                              disabled={busyAdd === r.company.id}
                              data-testid={`add-watch-${r.company.id}`}
                            >
                              {busyAdd === r.company.id ? "…" : <Star className="w-3 h-3" />}
                            </Button>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                  {filtered.length === 0 && !loading && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted-foreground text-sm">
                        No companies match — try a different industry or clear the filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {selected && (
          <Card data-testid="company-detail">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="font-serif text-lg">{selected.company.name}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{selected.company.description}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>×</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Country:</span> {selected.company.country ?? "—"}</div>
                <div><span className="text-muted-foreground">Founded:</span> {selected.company.foundedYear ?? "—"}</div>
                <div><span className="text-muted-foreground">Employees:</span> {selected.company.employeeCount?.toLocaleString() ?? "—"}</div>
                <div><span className="text-muted-foreground">Revenue:</span> {fmtUsd(selected.company.revenueUsd)}</div>
                <div><span className="text-muted-foreground">Funding:</span> {fmtUsd(selected.company.fundingUsd)}</div>
                <div><span className="text-muted-foreground">Ownership:</span> {selected.company.ownership ?? "—"}</div>
              </div>

              {selected.scores && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">FEVI Composite Breakdown</div>
                  <div className="space-y-1">
                    {(
                      [
                        ["Forecasted Value", "forecastedValue", 0.30],
                        ["Quality of Asset", "qualityOfAsset", 0.20],
                        ["Moat", "moatScore", 0.15],
                        ["Actionability", "actionability", 0.15],
                        ["Acquisition Probability", "acquisitionProbability", 0.10],
                        ["Risk Profile (inverted)", "riskProfile", 0.10],
                      ] as Array<[string, keyof Scores, number]>
                    ).map(([label, key, weight]) => {
                      const v = selected.scores![key];
                      return (
                        <div key={key} className="flex items-center gap-2 text-xs">
                          <span className="w-44 text-muted-foreground">{label}</span>
                          <div className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
                            <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
                          </div>
                          <span className="w-12 text-right tabular-nums">{v.toFixed(0)}</span>
                          <span className="w-12 text-right text-[10px] text-muted-foreground tabular-nums">×{(weight * 100).toFixed(0)}%</span>
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-2 text-xs pt-1 mt-1 border-t">
                      <span className="w-44 font-medium">Composite</span>
                      <div className="flex-1" />
                      <span className="w-12 text-right tabular-nums font-medium">{selected.scores.composite.toFixed(0)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Source Thesis</div>
                <div className="text-sm font-medium mb-1">{thesisSnippet(selected.scores).headline}</div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {thesisSnippet(selected.scores).reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={() => addToWatchlist(selected.company.id)}
                  disabled={busyAdd === selected.company.id}
                  data-testid="detail-add-watch"
                >
                  <Star className="w-3 h-3 mr-1" /> Add to Watchlist
                </Button>
                {selected.company.websiteUrl && (
                  <Button asChild size="sm" variant="outline">
                    <a href={selected.company.websiteUrl} target="_blank" rel="noopener noreferrer">Visit Site</a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
