import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Briefcase, Plus, Trash2, Edit3, ExternalLink, ArrowUpRight, ArrowDownRight, Building2, Loader2, Bell, FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API_BASE = "/api";

type Industry = { id: number; name: string };
type Portfolio = {
  id: number;
  name: string;
  industryId: number | null;
  companyIds: number[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
type CompanyRow = {
  id: number;
  name: string;
  industryId: number;
  industryName: string | null;
  country: string | null;
  ownership: string | null;
  publicTicker: string | null;
  websiteUrl: string | null;
  scores: null | {
    composite: number;
    moatScore: number;
    aiDisruptability: number;
    capabilityCoverage: number;
    ceiWeighted: number;
    forecastedValue: number;
  };
};
type CompanyOption = { id: number; name: string; industryId: number };

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function deltaClass(n: number | null | undefined): string {
  if (n === null || n === undefined) return "text-muted-foreground";
  return n >= 60 ? "text-emerald-600" : n >= 40 ? "text-amber-600" : "text-rose-600";
}

export default function PipelinePage() {
  const [portfolios, setPortfolios] = useState<Portfolio[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", industryId: "", notes: "" });
  const [creating, setCreating] = useState(false);
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);
  const [companyQuery, setCompanyQuery] = useState("");

  async function loadPortfolios() {
    setLoading(true);
    const res = await fetch(`${API_BASE}/pipeline/portfolios`, { credentials: "include" });
    const data = await res.json();
    const list: Portfolio[] = data.portfolios ?? [];
    setPortfolios(list);
    if (list.length && activeId === null) setActiveId(list[0].id);
    setLoading(false);
  }

  async function loadActive(id: number) {
    const res = await fetch(`${API_BASE}/pipeline/portfolios/${id}`, { credentials: "include" });
    if (!res.ok) { setCompanies([]); return; }
    const data = await res.json();
    const hydrated: CompanyRow[] = (data.companies ?? []).map((c: CompanyRow & { scores: CompanyRow["scores"] }) => ({
      id: c.id, name: c.name, industryId: c.industryId, industryName: c.industryName,
      country: c.country, ownership: c.ownership, publicTicker: c.publicTicker, websiteUrl: c.websiteUrl,
      scores: c.scores,
    }));
    setCompanies(hydrated);
  }

  useEffect(() => { void loadPortfolios(); fetch(`${API_BASE}/industries`).then(r => r.json()).then(d => setIndustries(d.industries ?? d ?? [])); }, []);
  useEffect(() => { if (activeId !== null) void loadActive(activeId); }, [activeId]);

  // Lazy-load company options when add dialog opens
  useEffect(() => {
    if (!addCompanyOpen || companyOptions.length) return;
    const active = portfolios?.find(p => p.id === activeId);
    const ind = active?.industryId;
    const url = ind ? `${API_BASE}/workbench/companies?industryId=${ind}` : `${API_BASE}/workbench/companies`;
    fetch(url, { credentials: "include" }).then(r => r.json()).then(d => {
      const items = (d.companies ?? d ?? []).map((row: { company?: { id: number; name: string; industryId: number }; id?: number; name?: string; industryId?: number }) => {
        const c = row.company ?? row;
        return { id: c.id!, name: c.name!, industryId: c.industryId! };
      });
      setCompanyOptions(items);
    });
  }, [addCompanyOpen, activeId, portfolios, companyOptions.length]);

  async function createPortfolio() {
    if (!draft.name.trim()) return;
    setCreating(true);
    const body = {
      name: draft.name.trim(),
      industryId: draft.industryId ? Number(draft.industryId) : null,
      notes: draft.notes.trim() || null,
      companyIds: [],
    };
    const res = await fetch(`${API_BASE}/pipeline/portfolios`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      setPortfolios((p) => [data.portfolio, ...(p ?? [])]);
      setActiveId(data.portfolio.id);
      setCreateOpen(false);
      setDraft({ name: "", industryId: "", notes: "" });
    }
    setCreating(false);
  }

  async function deletePortfolio(id: number) {
    if (!confirm("Delete this portfolio?")) return;
    await fetch(`${API_BASE}/pipeline/portfolios/${id}`, { method: "DELETE", credentials: "include" });
    setPortfolios((p) => (p ?? []).filter(x => x.id !== id));
    if (activeId === id) setActiveId(null);
  }

  async function addCompany(companyId: number) {
    if (activeId === null) return;
    const active = portfolios?.find(p => p.id === activeId);
    if (!active) return;
    if (active.companyIds.includes(companyId)) { setAddCompanyOpen(false); return; }
    const newIds = [...active.companyIds, companyId];
    const res = await fetch(`${API_BASE}/pipeline/portfolios/${activeId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ companyIds: newIds }),
    });
    if (res.ok) {
      setPortfolios((p) => (p ?? []).map(x => x.id === activeId ? { ...x, companyIds: newIds } : x));
      void loadActive(activeId);
    }
    setAddCompanyOpen(false);
    setCompanyQuery("");
  }

  async function removeCompany(companyId: number) {
    if (activeId === null) return;
    const active = portfolios?.find(p => p.id === activeId);
    if (!active) return;
    const newIds = active.companyIds.filter(id => id !== companyId);
    const res = await fetch(`${API_BASE}/pipeline/portfolios/${activeId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ companyIds: newIds }),
    });
    if (res.ok) {
      setPortfolios((p) => (p ?? []).map(x => x.id === activeId ? { ...x, companyIds: newIds } : x));
      setCompanies((cs) => cs.filter(c => c.id !== companyId));
    }
  }

  const active = useMemo(() => portfolios?.find(p => p.id === activeId), [portfolios, activeId]);
  const filteredOptions = useMemo(() => {
    const q = companyQuery.trim().toLowerCase();
    return companyOptions
      .filter(o => !active?.companyIds.includes(o.id))
      .filter(o => !q || o.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [companyOptions, companyQuery, active]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Deal Flow · Pipeline</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Briefcase className="w-8 h-8 text-primary" />
          Pipeline
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Track target companies side-by-side with capability composite, moat, AI disruptability, and CEI-weighted score.
          Create portfolios for each fund, vertical, or thesis.
        </p>
      </motion.div>

      <div className="grid grid-cols-12 gap-6">
        {/* Portfolio sidebar */}
        <aside className="col-span-12 lg:col-span-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-serif text-sm uppercase tracking-widest text-muted-foreground">Portfolios</h2>
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />New
            </Button>
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !portfolios?.length ? (
            <Card>
              <CardContent className="pt-6 text-center">
                <p className="text-sm text-muted-foreground mb-3">No portfolios yet.</p>
                <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" />Create your first</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1">
              {portfolios.map((p) => {
                const isActive = p.id === activeId;
                return (
                  <button
                    key={p.id}
                    data-testid={`portfolio-${p.id}`}
                    onClick={() => setActiveId(p.id)}
                    className={`w-full text-left rounded-md px-3 py-2 transition-colors ${
                      isActive ? "bg-primary/10 text-primary border border-primary/30" : "hover:bg-muted border border-transparent"
                    }`}
                  >
                    <div className="text-sm font-medium leading-tight">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {p.companyIds.length} {p.companyIds.length === 1 ? "company" : "companies"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Active portfolio */}
        <section className="col-span-12 lg:col-span-9">
          {!active ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Briefcase className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="font-serif text-lg mb-1">Pick a portfolio or create one</p>
                <p className="text-sm">Each portfolio is a saved list of companies you want to track together.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-serif text-2xl tracking-tight">{active.name}</h2>
                  {active.notes && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{active.notes}</p>}
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-3">
                    <span>Updated {new Date(active.updatedAt).toLocaleDateString()}</span>
                    <span>
                      {companies.length} {companies.length === 1 ? "company" : "companies"}
                      {companies.length !== active.companyIds.length && (
                        <span className="opacity-70"> · {active.companyIds.length - companies.length} unresolved</span>
                      )}
                    </span>
                    {active.industryId && industries.find(i => i.id === active.industryId) && (
                      <Badge variant="outline">{industries.find(i => i.id === active.industryId)?.name}</Badge>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAddCompanyOpen(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1" />Add company
                  </Button>
                  <Link href={`/diligence?portfolioId=${active.id}`}>
                    <Button size="sm" variant="outline"><FileText className="w-3.5 h-3.5 mr-1" />Diligence pack</Button>
                  </Link>
                  <Link href={`/comparables?ids=${active.companyIds.join(",")}`}>
                    <Button size="sm" variant="outline">Compare</Button>
                  </Link>
                  <Button size="sm" variant="ghost" onClick={() => deletePortfolio(active.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              {companies.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <Building2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="text-sm mb-3">This portfolio has no companies yet.</p>
                    <Button size="sm" onClick={() => setAddCompanyOpen(true)}>
                      <Plus className="w-3.5 h-3.5 mr-1" />Add your first company
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-0 overflow-x-auto">
                    <table className="w-full text-sm" data-testid="pipeline-table">
                      <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium">Company</th>
                          <th className="text-right px-3 py-3 font-medium">Composite</th>
                          <th className="text-right px-3 py-3 font-medium">Moat</th>
                          <th className="text-right px-3 py-3 font-medium">AI Risk</th>
                          <th className="text-right px-3 py-3 font-medium">Coverage</th>
                          <th className="text-right px-3 py-3 font-medium">CEI Wtd</th>
                          <th className="text-right px-3 py-3 font-medium">Forecast</th>
                          <th className="px-3 py-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {companies.map((c) => {
                          const s = c.scores;
                          return (
                            <tr key={c.id} className="border-t hover:bg-muted/30">
                              <td className="px-4 py-3">
                                <div className="font-medium">{c.name}</div>
                                <div className="text-xs text-muted-foreground flex items-center gap-2">
                                  {c.industryName ?? "—"}
                                  {c.publicTicker && <Badge variant="outline" className="text-xs h-4 px-1">{c.publicTicker}</Badge>}
                                  {c.country && <span>· {c.country}</span>}
                                  {c.ownership && <span>· {c.ownership}</span>}
                                </div>
                              </td>
                              <td className={`text-right px-3 font-mono ${deltaClass(s?.composite)}`}>{fmt(s?.composite)}</td>
                              <td className="text-right px-3 font-mono">{fmt(s?.moatScore)}</td>
                              <td className={`text-right px-3 font-mono ${s && s.aiDisruptability > 60 ? "text-rose-600" : "text-foreground"}`}>
                                {fmt(s?.aiDisruptability)}
                              </td>
                              <td className="text-right px-3 font-mono">{fmt(s?.capabilityCoverage)}</td>
                              <td className="text-right px-3 font-mono">{fmt(s?.ceiWeighted)}</td>
                              <td className="text-right px-3 font-mono">{fmt(s?.forecastedValue)}</td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                {c.websiteUrl && (
                                  <a href={c.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                                    <ExternalLink className="w-3.5 h-3.5 inline" />
                                  </a>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => removeCompany(c.id)} className="ml-1">
                                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </section>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New portfolio</DialogTitle>
            <DialogDescription>Group companies you want to track together for a fund, vertical, or thesis.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="pf-name">Name</Label>
              <Input
                id="pf-name" data-testid="portfolio-name-input"
                placeholder="Fund I — Banking targets"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="pf-industry">Industry (optional)</Label>
              <Select value={draft.industryId} onValueChange={(v) => setDraft({ ...draft, industryId: v })}>
                <SelectTrigger><SelectValue placeholder="Any industry" /></SelectTrigger>
                <SelectContent>
                  {industries.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pf-notes">Notes (optional)</Label>
              <Textarea
                id="pf-notes" rows={3}
                placeholder="Thesis, criteria, decision deadline…"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createPortfolio} disabled={creating || !draft.name.trim()} data-testid="portfolio-create-submit">
              {creating ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Creating…</> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add-company dialog */}
      <Dialog open={addCompanyOpen} onOpenChange={setAddCompanyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a company</DialogTitle>
            <DialogDescription>Search the catalog and pick one to add to {active?.name}.</DialogDescription>
          </DialogHeader>
          <Input
            data-testid="add-company-search"
            placeholder="Search by name…"
            value={companyQuery}
            onChange={(e) => setCompanyQuery(e.target.value)}
          />
          <div className="max-h-80 overflow-y-auto divide-y">
            {filteredOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No matches.</p>
            ) : (
              filteredOptions.map((o) => (
                <button
                  key={o.id}
                  data-testid={`add-company-${o.id}`}
                  onClick={() => addCompany(o.id)}
                  className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                >
                  {o.name}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
