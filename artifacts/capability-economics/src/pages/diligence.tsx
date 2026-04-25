import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FileText, Loader2, Search, Building2, CheckCircle2, ChevronRight, Download, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = "/api";

type Industry = { id: number; name: string };
type CompanyOption = {
  id: number;
  name: string;
  industryId: number;
  industryName: string | null;
  publicTicker: string | null;
  country: string | null;
  scores: null | {
    composite: number;
    moatScore: number;
    aiDisruptability: number;
    capabilityCoverage: number;
  };
};
type Portfolio = { id: number; name: string; industryId: number | null; companyIds: number[] };

type Step = "pick" | "confirm" | "generating" | "done";

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

export default function DiligencePage() {
  const portfolioId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("portfolioId");
    return v ? Number(v) : null;
  }, []);

  const [step, setStep] = useState<Step>("pick");
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryFilter, setIndustryFilter] = useState<string>("");
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CompanyOption | null>(null);
  const [includeSecLink, setIncludeSecLink] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>("diligence.pdf");

  // Load industries on mount
  useEffect(() => {
    fetch(`${API_BASE}/industries`).then(r => r.json()).then(d => {
      setIndustries(d.industries ?? d ?? []);
    });
  }, []);

  // If portfolioId was passed, hydrate the portfolio's industry as default filter
  useEffect(() => {
    if (portfolioId === null) return;
    fetch(`${API_BASE}/pipeline/portfolios/${portfolioId}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((data: { portfolio?: Portfolio; companies?: CompanyOption[] } | null) => {
        if (!data?.portfolio) return;
        if (data.portfolio.industryId) setIndustryFilter(String(data.portfolio.industryId));
        if (data.companies?.length) {
          // Preselect first company in portfolio
          const first = data.companies[0];
          setSelected({
            id: first.id,
            name: first.name,
            industryId: first.industryId,
            industryName: first.industryName ?? null,
            publicTicker: first.publicTicker ?? null,
            country: first.country ?? null,
            scores: first.scores ?? null,
          });
        }
      })
      .catch(() => undefined);
  }, [portfolioId]);

  // Load companies when industry filter changes (or initial)
  useEffect(() => {
    setLoading(true);
    const url = industryFilter
      ? `${API_BASE}/workbench/companies?industryId=${industryFilter}&limit=200`
      : `${API_BASE}/workbench/companies?limit=200`;
    fetch(url, { credentials: "include" })
      .then(r => r.ok ? r.json() : { companies: [] })
      .then((d: { companies?: Array<{ company?: any; scores?: any; id?: number; name?: string; industryName?: string }> }) => {
        const indById = new Map(industries.map(i => [i.id, i.name]));
        const items: CompanyOption[] = (d.companies ?? []).map((row) => {
          const c = row.company ?? row;
          return {
            id: c.id!,
            name: c.name!,
            industryId: c.industryId!,
            industryName: indById.get(c.industryId) ?? row.industryName ?? null,
            publicTicker: c.publicTicker ?? null,
            country: c.country ?? null,
            scores: row.scores ?? null,
          };
        });
        setCompanies(items);
        setLoading(false);
      })
      .catch(() => { setCompanies([]); setLoading(false); });
  }, [industryFilter, industries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies.slice(0, 100);
    return companies.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.publicTicker?.toLowerCase().includes(q) ?? false)
    ).slice(0, 100);
  }, [companies, query]);

  async function generate() {
    if (!selected) return;
    setStep("generating");
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/diligence/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selected.id, includeSecLink }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const e = await res.json(); msg = e.error ?? msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename="?([^"]+)"?/);
      const name = m?.[1] ?? `diligence-${selected.id}.pdf`;
      setDownloadUrl(url);
      setDownloadName(name);
      // Trigger automatic download
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("confirm");
    }
  }

  function reset() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl(null);
    setDownloadName("diligence.pdf");
    setSelected(null);
    setIncludeSecLink(true);
    setError(null);
    setStep("pick");
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Deal Flow · Diligence Pack</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <FileText className="w-8 h-8 text-primary" />
          Diligence Pack
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Generate a multi-page PDF memo for any target — exec summary, capability gaps vs industry leaders,
          M&amp;A twin candidates, an investment thesis, and optional SEC filing reference.
        </p>
      </motion.div>

      {/* Stepper */}
      <div className="flex items-center gap-3 mb-8 text-xs">
        {[
          { id: "pick", label: "Pick company" },
          { id: "confirm", label: "Confirm" },
          { id: "generating", label: "Generate" },
          { id: "done", label: "Done" },
        ].map((s, i, arr) => {
          const isActive = step === s.id;
          const isPast = arr.findIndex(x => x.id === step) > i;
          return (
            <div key={s.id} className="flex items-center gap-2">
              <div className={`rounded-full w-6 h-6 flex items-center justify-center font-mono ${
                isActive ? "bg-primary text-primary-foreground" :
                isPast ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
              }`}>
                {isPast ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={isActive ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
              {i < arr.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
            </div>
          );
        })}
      </div>

      {step === "pick" && (
        <Card>
          <CardHeader>
            <CardTitle>Pick a target company</CardTitle>
            <CardDescription>Filter by industry, search by name or ticker.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div>
                <Label htmlFor="ind">Industry</Label>
                <Select value={industryFilter || "all"} onValueChange={(v) => setIndustryFilter(v === "all" ? "" : v)}>
                  <SelectTrigger id="ind"><SelectValue placeholder="All industries" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All industries</SelectItem>
                    {industries.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="q">Search</Label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="q"
                    data-testid="diligence-search"
                    placeholder="Company name or ticker…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="border rounded-md max-h-[28rem] overflow-y-auto divide-y">
              {loading ? (
                <p className="text-sm text-muted-foreground py-8 text-center"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading companies…</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No companies match.</p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    data-testid={`diligence-pick-${c.id}`}
                    onClick={() => { setSelected(c); setStep("confirm"); }}
                    className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-sm">{c.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        {c.industryName ?? "—"}
                        {c.publicTicker && <Badge variant="outline" className="text-xs h-4 px-1">{c.publicTicker}</Badge>}
                        {c.country && <span>· {c.country}</span>}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {c.scores ? `${fmt(c.scores.composite, 0)} comp` : "—"}
                    </div>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {step === "confirm" && selected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              {selected.name}
            </CardTitle>
            <CardDescription>
              {selected.industryName ?? "—"}
              {selected.publicTicker && <span> · <Badge variant="outline" className="text-xs h-4 px-1 ml-1">{selected.publicTicker}</Badge></span>}
              {selected.country && <span> · {selected.country}</span>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { k: "Composite", v: selected.scores?.composite },
                { k: "Moat", v: selected.scores?.moatScore },
                { k: "AI Risk", v: selected.scores?.aiDisruptability },
                { k: "Coverage", v: selected.scores?.capabilityCoverage },
              ].map((m) => (
                <div key={m.k} className="rounded-md border p-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{m.k}</div>
                  <div className="font-mono text-2xl mt-1">{fmt(m.v, 0)}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-6">
              <Checkbox
                id="sec"
                checked={includeSecLink}
                onCheckedChange={(v) => setIncludeSecLink(v === true)}
                data-testid="diligence-sec-toggle"
              />
              <Label htmlFor="sec" className="cursor-pointer">
                Include SEC filings reference
                <span className="text-xs text-muted-foreground ml-2">
                  (only useful for public tickers — adds a 6th page)
                </span>
              </Label>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 mb-4 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep("pick")}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />Back
              </Button>
              <Button onClick={generate} data-testid="diligence-generate">
                <FileText className="w-3.5 h-3.5 mr-1" />Generate PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "generating" && (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
            <p className="font-serif text-lg mb-1">Building diligence pack…</p>
            <p className="text-sm text-muted-foreground">
              Computing capability gaps, finding M&amp;A twins, generating thesis. This usually takes 30–90 seconds.
            </p>
          </CardContent>
        </Card>
      )}

      {step === "done" && selected && (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <p className="font-serif text-xl mb-1">Diligence pack downloaded</p>
            <p className="text-sm text-muted-foreground mb-6">
              {downloadName} should have started downloading. If not, click below.
            </p>
            <div className="flex items-center justify-center gap-2">
              {downloadUrl && (
                <a href={downloadUrl} download={downloadName}>
                  <Button variant="outline" size="sm"><Download className="w-3.5 h-3.5 mr-1" />Re-download</Button>
                </a>
              )}
              <Button size="sm" onClick={reset} data-testid="diligence-restart">
                Generate another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
