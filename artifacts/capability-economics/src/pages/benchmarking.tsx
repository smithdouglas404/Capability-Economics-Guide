import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, Search, Check, ArrowLeft, Building2, Shield, Globe, Sparkles, Loader2, Clock, RefreshCw } from "lucide-react";

const API_BASE = "/api";

type Filters = {
  industries: Array<{ id: number; name: string }>;
  regions: string[];
  countries: string[];
  ownerships: string[];
};

type CompanyListing = {
  id: number;
  name: string;
  industry: string;
  industryId: number;
  country: string | null;
  hqCity: string | null;
  ownership: string | null;
  employeeCount: number | null;
  revenueUsd: number | null;
  composite: number | null;
  moatScore: number | null;
  aiDisruptability: number | null;
  ceiWeighted: number | null;
};

type BenchmarkResult = {
  sessionId: number;
  myOrgName: string;
  companies: Array<{
    id: number; name: string; country: string | null; ownership: string | null;
    composite: number | null; moatScore: number | null; aiDisruptability: number | null;
    capabilityCoverage: number | null; capabilityCount: number; avgWeight: number;
  }>;
  capabilities: Array<{
    capabilityId: number; capabilityName: string; benchmark: number | null; myScore: number | null;
    companyStrengths: Array<{ companyId: number; companyName: string; weight: number; evidence: string | null }>;
    avgCompanyWeight: number; ceiScore: number | null; aiExposure: number | null; moatHalfLife: number | null;
  }>;
  totalCapabilities: number;
  totalCompanies: number;
};

type Session = { id: number; name: string; selectedCompanyIds: number[]; selectedCapabilityIds: number[]; region: string | null; createdAt: string };
type Capability = { id: number; name: string; industryId: number };

const fmtRev = (n: number | null) => {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
};

export default function Benchmarking() {
  const [step, setStep] = useState<"filter" | "select" | "results">("filter");
  const [filters, setFilters] = useState<Filters | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [companies, setCompanies] = useState<CompanyListing[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  const [industryId, setIndustryId] = useState<number | "">("");
  const [region, setRegion] = useState("");
  const [ownership, setOwnership] = useState("");
  const [selectedCaps, setSelectedCaps] = useState<number[]>([]);

  const sessionToken = localStorage.getItem("ce_session_token") ?? "";

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/benchmarking/filters`).then(r => r.json()),
      fetch(`${API_BASE}/capabilities`).then(r => r.json()),
      fetch(`${API_BASE}/benchmarking/sessions`).then(r => r.json()),
    ]).then(([f, c, s]) => { setFilters(f); setCapabilities(c); setSessions(s); }).catch(() => {});
  }, []);

  const searchCompanies = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (industryId) params.set("industryId", String(industryId));
      if (region) params.set("region", region);
      if (ownership) params.set("ownership", ownership);
      if (selectedCaps.length) params.set("capabilityIds", selectedCaps.join(","));
      const res = await fetch(`${API_BASE}/benchmarking/companies?${params}`);
      setCompanies(await res.json());
      setSelected(new Set());
      setStep("select");
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const discoverMore = async () => {
    if (!industryId) return;
    setDiscovering(true);
    try {
      const capNames = selectedCaps.length
        ? capabilities.filter(c => selectedCaps.includes(c.id)).map(c => c.name)
        : [];
      const res = await fetch(`${API_BASE}/benchmarking/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industryId: Number(industryId),
          region: region || undefined,
          capabilityIds: selectedCaps.length ? selectedCaps : undefined,
          capabilityNames: capNames.length ? capNames : undefined,
        }),
      });
      const data = await res.json();
      if (data.companies?.length) {
        setCompanies(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const newOnes = data.companies.filter((c: CompanyListing) => !existingIds.has(c.id));
          return [...prev, ...newOnes];
        });
      }
    } catch (err) { console.error(err); }
    setDiscovering(false);
  };

  const toggleCompany = (id: number) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const runBenchmark = async () => {
    if (!selected.size) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/benchmarking/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken,
          companyIds: [...selected],
          capabilityIds: selectedCaps.length ? selectedCaps : undefined,
          industryId: industryId || undefined,
          region: region || undefined,
          ownership: ownership || undefined,
        }),
      });
      setResult(await res.json());
      setStep("results");
      // Refresh sessions
      fetch(`${API_BASE}/benchmarking/sessions`).then(r => r.json()).then(setSessions).catch(() => {});
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const rerunSession = async (s: Session) => {
    setSelected(new Set(s.selectedCompanyIds));
    setSelectedCaps(s.selectedCapabilityIds ?? []);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/benchmarking/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, companyIds: s.selectedCompanyIds, capabilityIds: s.selectedCapabilityIds?.length ? s.selectedCapabilityIds : undefined }),
      });
      setResult(await res.json());
      setStep("results");
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const filteredCaps = industryId
    ? capabilities.filter(c => c.industryId === Number(industryId) && (c as any).isLeaf !== false)
    : capabilities.filter(c => (c as any).isLeaf !== false);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Benchmark</span>
          </div>
          <h1 className="text-3xl font-serif tracking-tight">Competitive Benchmarking</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {step === "filter" && "Select your industry, capabilities, and region to find companies to benchmark against."}
            {step === "select" && `${companies.length} companies found. Select the ones to benchmark — or discover more via AI research.`}
            {step === "results" && `${result?.myOrgName} vs ${result?.totalCompanies} companies across ${result?.totalCapabilities} capabilities.`}
          </p>
        </div>
        {step !== "filter" && (
          <Button variant="outline" onClick={() => { setStep(step === "results" ? "select" : "filter"); setResult(null); }}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
        )}
      </div>

      {/* Step 1: Filters */}
      {step === "filter" && filters && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4" /> Industry</CardTitle></CardHeader>
              <CardContent>
                <select className="w-full border rounded px-3 py-2 bg-background text-sm" value={industryId} onChange={e => { setIndustryId(e.target.value ? Number(e.target.value) : ""); setSelectedCaps([]); }}>
                  <option value="">All Industries</option>
                  {filters.industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Globe className="w-4 h-4" /> Region</CardTitle></CardHeader>
              <CardContent>
                <select className="w-full border rounded px-3 py-2 bg-background text-sm" value={region} onChange={e => setRegion(e.target.value)}>
                  <option value="">All Regions</option>
                  {filters.regions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <p className="text-xs text-muted-foreground mt-2">Countries in data: {filters.countries.join(", ")}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" /> Ownership</CardTitle></CardHeader>
              <CardContent>
                <select className="w-full border rounded px-3 py-2 bg-background text-sm" value={ownership} onChange={e => setOwnership(e.target.value)}>
                  <option value="">All Types</option>
                  {filters.ownerships.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Capabilities to Benchmark</CardTitle>
                {selectedCaps.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelectedCaps([])}>Clear ({selectedCaps.length})</Button>}
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 max-h-[200px] overflow-y-auto">
                {filteredCaps.slice(0, 60).map(c => (
                  <Badge key={c.id} variant={selectedCaps.includes(c.id) ? "default" : "outline"} className="cursor-pointer"
                    onClick={() => setSelectedCaps(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])}>
                    {c.name}
                  </Badge>
                ))}
              </div>
              {!filteredCaps.length && <p className="text-sm text-muted-foreground">Select an industry to see capabilities.</p>}
              {selectedCaps.length === 0 && filteredCaps.length > 0 && <p className="text-xs text-muted-foreground mt-2">Leave empty to benchmark across all capabilities.</p>}
            </CardContent>
          </Card>

          <Button className="w-full" onClick={searchCompanies} disabled={loading}>
            <Search className="w-4 h-4 mr-2" /> {loading ? "Searching..." : "Find Companies"}
          </Button>

          {/* Past Sessions */}
          {sessions.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4" /> Past Benchmarks</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sessions.slice(0, 10).map(s => (
                    <div key={s.id} className="flex items-center justify-between p-2 rounded border hover:bg-muted/30 cursor-pointer" onClick={() => rerunSession(s)}>
                      <div>
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.selectedCompanyIds.length} companies • {new Date(s.createdAt).toLocaleDateString()}</p>
                      </div>
                      <Button size="sm" variant="ghost"><RefreshCw className="w-4 h-4" /></Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Step 2: Select Companies */}
      {step === "select" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set(companies.map(c => c.id)))}>Select All</Button>
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>Clear</Button>
            <span className="text-sm text-muted-foreground">{selected.size} of {companies.length} selected</span>
            <div className="ml-auto">
              <Button size="sm" variant="outline" onClick={discoverMore} disabled={discovering || !industryId}>
                {discovering ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Researching...</> : <><Sparkles className="w-4 h-4 mr-2" /> Discover More Companies</>}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {companies.map(c => (
              <div key={c.id}
                className={`flex items-center gap-4 p-3 rounded-none border cursor-pointer transition-colors ${selected.has(c.id) ? "ring-2 ring-primary bg-primary/5" : "hover:bg-muted/30"}`}
                onClick={() => toggleCompany(c.id)}>
                <div className={`w-6 h-6 rounded border-2 flex items-center justify-center shrink-0 ${selected.has(c.id) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                  {selected.has(c.id) && <Check className="w-4 h-4 text-primary-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{c.name}</span>
                    {c.ownership && <Badge variant="outline" className="text-xs">{c.ownership}</Badge>}
                    {c.country && <span className="text-xs text-muted-foreground">{c.country}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{c.industry} {c.hqCity ? `• ${c.hqCity}` : ""}</p>
                </div>
                <div className="flex gap-4 text-sm shrink-0">
                  {c.composite != null && <div className="text-right"><p className="text-xs text-muted-foreground">Score</p><p className="font-mono">{c.composite.toFixed(0)}</p></div>}
                  {c.revenueUsd != null && <div className="text-right"><p className="text-xs text-muted-foreground">Revenue</p><p className="font-mono">{fmtRev(c.revenueUsd)}</p></div>}
                  {c.moatScore != null && <div className="text-right"><p className="text-xs text-muted-foreground">Moat</p><p className="font-mono">{c.moatScore.toFixed(0)}</p></div>}
                </div>
              </div>
            ))}
          </div>

          {companies.length === 0 && !discovering && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Building2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No companies match your filters in the database.</p>
                {industryId && (
                  <Button className="mt-4" onClick={discoverMore} disabled={discovering}>
                    <Sparkles className="w-4 h-4 mr-2" /> Discover Companies via AI Research
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {selected.size > 0 && (
            <Button className="w-full" onClick={runBenchmark} disabled={loading}>
              <BarChart3 className="w-4 h-4 mr-2" /> {loading ? "Running Benchmark..." : `Benchmark Against ${selected.size} Companies`}
            </Button>
          )}
        </div>
      )}

      {/* Step 3: Results */}
      {step === "results" && result && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {result.companies.map(c => (
              <Card key={c.id}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.country} • {c.ownership}</p>
                    </div>
                    {c.composite != null && <Badge variant="outline" className="text-lg font-mono">{c.composite.toFixed(0)}</Badge>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div><p className="text-xs text-muted-foreground">Moat</p><p className="font-bold">{c.moatScore?.toFixed(0) ?? "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">AI Risk</p><p className={`font-bold ${(c.aiDisruptability ?? 0) > 50 ? "text-destructive" : ""}`}>{c.aiDisruptability?.toFixed(0) ?? "—"}</p></div>
                    <div><p className="text-xs text-muted-foreground">Capabilities</p><p className="font-bold">{c.capabilityCount}</p></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle>Capability Comparison</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 sticky left-0 bg-background">Capability</th>
                      <th className="text-right py-2 px-2">Benchmark</th>
                      <th className="text-right py-2 px-2">Your Score</th>
                      <th className="text-right py-2 px-2">CEI</th>
                      {result.companies.map(c => (
                        <th key={c.id} className="text-right py-2 px-2 max-w-[100px] truncate" title={c.name}>{c.name.split(" ")[0]}</th>
                      ))}
                      <th className="text-right py-2 px-2">AI Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.capabilities.map(cap => (
                      <tr key={cap.capabilityId} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-2 font-medium sticky left-0 bg-background">{cap.capabilityName}</td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{cap.benchmark?.toFixed(0) ?? "—"}</td>
                        <td className="text-right py-2 px-2">
                          {cap.myScore != null ? (
                            <span className={cap.benchmark != null && cap.myScore >= cap.benchmark ? "text-emerald-500 font-medium" : cap.benchmark != null ? "text-destructive font-medium" : ""}>{cap.myScore.toFixed(0)}</span>
                          ) : "—"}
                        </td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{cap.ceiScore?.toFixed(0) ?? "—"}</td>
                        {result.companies.map(co => {
                          const s = cap.companyStrengths.find(x => x.companyId === co.id);
                          return (
                            <td key={co.id} className="text-right py-2 px-2">
                              {s ? (
                                <span title={s.evidence ?? undefined}>
                                  <Badge variant={s.weight >= 0.7 ? "default" : "outline"} className="text-xs font-mono cursor-help">{(s.weight * 100).toFixed(0)}%</Badge>
                                </span>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                          );
                        })}
                        <td className="text-right py-2 px-2">
                          {cap.aiExposure != null ? <Badge variant={cap.aiExposure > 50 ? "destructive" : "outline"} className="text-xs">{cap.aiExposure.toFixed(0)}%</Badge> : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.capabilities.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No capability overlap found. Try selecting companies in the same industry or discover more.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
