/**
 * /portfolio — VC/PE portfolio monitoring surface.
 *
 * Purpose: a user adds companies from /source → here they see their
 * portfolio at a glance plus a digest of what's moved that should
 * change their behavior:
 *   - Current FEVI for each portfolio company
 *   - Macro events (last 30d) hitting any portfolio industry
 *   - Regulatory exposure on any portfolio capability
 *
 * Pure consumer of /api/portfolio (GET + DELETE). No new schema work
 * beyond the portfolio_companies table.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Briefcase, TrendingUp, Zap, AlertTriangle, Trash2, RefreshCw, Scale, ChevronRight, Link2 } from "lucide-react";

interface PortfolioRow {
  portfolioId: number;
  addedAt: string;
  notes: string | null;
  alerts: { feviDelta: boolean; capabilityDecay: boolean; regulationChange: boolean };
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
    industryId: number;
  };
  scores: {
    composite: number;
    forecastedValue: number;
    qualityOfAsset: number;
    moatScore: number;
    actionability: number;
    acquisitionProbability: number;
    aiDisruptability: number;
    riskProfile: number;
    cviWeighted: number;
  } | null;
}

interface PortfolioResponse {
  portfolio: PortfolioRow[];
  digest: {
    companyCount: number;
    industryCount: number;
    macroEvents: Array<{
      id: number;
      title: string;
      severity: number;
      sentimentDirection: string | null;
      startedAt: string;
    }>;
    regulatoryExposure: Array<{
      regulationCode: string;
      regulationName: string;
      capabilityName: string;
      priority: string;
    }>;
  };
}

const fmtUsd = (n: number | null): string => {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  return `$${(n / 1000).toFixed(0)}K`;
};

export default function PortfolioPage() {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/portfolio");
      if (r.ok) setData(await r.json());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const remove = async (companyId: number) => {
    if (!window.confirm("Remove from portfolio?")) return;
    setBusyId(companyId);
    try {
      await fetch(`/api/portfolio/companies/${companyId}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  // Aggregate regulatory exposure by regulation
  const exposureByReg = (() => {
    const m = new Map<string, { name: string; count: number; capabilities: Set<string>; priorities: Set<string> }>();
    for (const r of data?.digest?.regulatoryExposure ?? []) {
      if (!m.has(r.regulationCode)) {
        m.set(r.regulationCode, { name: r.regulationName, count: 0, capabilities: new Set(), priorities: new Set() });
      }
      const v = m.get(r.regulationCode)!;
      v.count++;
      v.capabilities.add(r.capabilityName);
      v.priorities.add(r.priority);
    }
    return Array.from(m.entries()).map(([code, v]) => ({
      code,
      name: v.name,
      capabilities: Array.from(v.capabilities),
      priorities: Array.from(v.priorities),
    }));
  })();

  const portfolio = data?.portfolio ?? [];

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Portfolio Monitoring</span>
          </div>
          <h1 className="font-serif text-4xl tracking-tight">Portfolio</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
            Companies you're watching, with current FEVI, macro events hitting their industries,
            and regulatory exposure on their capabilities. Adds from <a href="/source" className="text-accent underline">/source</a>.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Digest tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card data-testid="kpi-companies">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><Briefcase className="w-3 h-3" /> Companies</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-serif">{portfolio.length}</div>
            <div className="text-xs text-muted-foreground">{data?.digest?.industryCount ?? 0} industries</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-avg-fevi">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Avg FEVI</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-serif">
              {portfolio.length === 0 ? "—" : (portfolio.reduce((s, p) => s + (p.scores?.composite ?? 0), 0) / portfolio.filter(p => p.scores).length || 0).toFixed(0)}
            </div>
            <div className="text-xs text-muted-foreground">composite</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-macro">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3" /> Macro Events (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-serif">{data?.digest?.macroEvents.length ?? 0}</div>
            <div className="text-xs text-muted-foreground">hitting your industries</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-reg">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><Scale className="w-3 h-3" /> Regulations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-serif">{exposureByReg.length}</div>
            <div className="text-xs text-muted-foreground">touching your caps</div>
          </CardContent>
        </Card>
      </div>

      {/* Portfolio companies */}
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Your companies</CardTitle>
        </CardHeader>
        <CardContent>
          {portfolio.length === 0 ? (
            <div className="text-center py-12">
              <Briefcase className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground mb-3">Nothing in your portfolio yet.</p>
              <Button asChild size="sm">
                <a href="/source"><ChevronRight className="w-3 h-3 mr-1" /> Browse Source</a>
              </Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="text-left py-2">Company</th>
                  <th className="text-left">Ownership</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">FEVI</th>
                  <th className="text-right">Moat</th>
                  <th className="text-right">AI Risk</th>
                  <th className="text-left">Notes</th>
                  <th className="text-right">Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {portfolio.map(p => (
                  <tr key={p.portfolioId} className="border-b last:border-0 hover:bg-muted/40" data-testid={`row-${p.company.id}`}>
                    <td className="py-2">
                      <div className="font-medium">{p.company.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.company.country ?? ""}
                        {p.company.publicTicker ? ` · ${p.company.publicTicker}` : ""}
                      </div>
                    </td>
                    <td><Badge variant="outline" className="text-[10px] capitalize">{p.company.ownership ?? "?"}</Badge></td>
                    <td className="text-right tabular-nums text-xs">{fmtUsd(p.company.revenueUsd)}</td>
                    <td className="text-right tabular-nums font-medium">{p.scores?.composite.toFixed(0) ?? "—"}</td>
                    <td className="text-right tabular-nums text-xs">{p.scores?.moatScore.toFixed(0) ?? "—"}</td>
                    <td className="text-right tabular-nums text-xs">{p.scores?.aiDisruptability.toFixed(0) ?? "—"}</td>
                    <td className="text-xs text-muted-foreground max-w-xs truncate" title={p.notes ?? ""}>{p.notes ?? ""}</td>
                    <td className="text-right text-[10px] text-muted-foreground tabular-nums">{new Date(p.addedAt).toLocaleDateString()}</td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-destructive"
                        onClick={() => remove(p.company.id)}
                        disabled={busyId === p.company.id}
                        data-testid={`remove-${p.company.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Macro events digest */}
      {(data?.digest?.macroEvents.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg flex items-center gap-2"><Zap className="w-4 h-4" /> Macro Events (last 30 days)</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Events affecting industries your portfolio touches.</p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data!.digest.macroEvents.map(e => (
                <li key={e.id} className="flex items-start gap-3 py-2 border-b last:border-0 text-sm">
                  <div className="flex-shrink-0 mt-0.5">
                    {e.sentimentDirection === "negative"
                      ? <AlertTriangle className="w-4 h-4 text-destructive" />
                      : e.sentimentDirection === "positive"
                        ? <TrendingUp className="w-4 h-4 text-emerald-600" />
                        : <Zap className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{e.title}</div>
                    <div className="text-xs text-muted-foreground">
                      severity {e.severity?.toFixed(0) ?? "?"} · {new Date(e.startedAt).toLocaleDateString()}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Regulatory exposure */}
      {exposureByReg.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg flex items-center gap-2"><Scale className="w-4 h-4" /> Regulatory exposure</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Regulations that touch capabilities your portfolio companies have on their fingerprint.</p>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="text-left py-2">Regulation</th>
                  <th className="text-left">Capabilities exposed</th>
                  <th className="text-left">Priority mix</th>
                </tr>
              </thead>
              <tbody>
                {exposureByReg.map(r => (
                  <tr key={r.code} className="border-b last:border-0 text-xs">
                    <td className="py-2 font-mono">{r.code}<div className="text-[10px] text-muted-foreground font-sans">{r.name}</div></td>
                    <td className="max-w-md">
                      <div className="flex flex-wrap gap-1">
                        {r.capabilities.slice(0, 6).map(c => (
                          <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                        ))}
                        {r.capabilities.length > 6 && (
                          <Badge variant="outline" className="text-[10px]">+{r.capabilities.length - 6} more</Badge>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {r.priorities.map(p => (
                          <Badge key={p} variant={p === "required" ? "default" : "secondary"} className="text-[10px] capitalize">{p}</Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        <Link2 className="w-3 h-3 inline mr-1" />
        Portfolio is per-session. Same session token (cookie) returns the same companies.
      </p>
    </div>
  );
}
