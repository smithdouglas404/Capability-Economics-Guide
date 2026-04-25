import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Filter, Download, RotateCcw, Search, Building2, ArrowUpDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const API_BASE = "/api";

type Industry = { id: number; name: string };
type ScreenerRow = {
  companyId: number;
  name: string;
  industryId: number;
  industryName: string | null;
  country: string | null;
  ownership: string | null;
  composite: number;
  moatScore: number;
  aiDisruptability: number;
  capabilityCoverage: number;
  ceiWeighted: number;
  acquisitionProbability: number;
};

type Filters = {
  industryId: string;
  scoreMin: number;
  scoreMax: number;
  moatMin: number;
  moatMax: number;
  aiDisruptabilityMax: number;
  coverageMin: number;
  ownership: string;
  country: string;
};

type SortKey = "name" | "industryName" | "composite" | "moatScore" | "aiDisruptability" | "capabilityCoverage" | "ceiWeighted";

const DEFAULTS: Filters = {
  industryId: "",
  scoreMin: 0,
  scoreMax: 100,
  moatMin: 0,
  moatMax: 100,
  aiDisruptabilityMax: 100,
  coverageMin: 0,
  ownership: "",
  country: "",
};

const LIMIT = 200;

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function deltaClass(n: number | null | undefined): string {
  if (n === null || n === undefined) return "text-muted-foreground";
  return n >= 60 ? "text-emerald-600" : n >= 40 ? "text-amber-600" : "text-rose-600";
}

function buildQuery(f: Filters): string {
  const params = new URLSearchParams();
  if (f.industryId) params.set("industryId", f.industryId);
  if (f.scoreMin > 0) params.set("scoreMin", String(f.scoreMin));
  if (f.scoreMax < 100) params.set("scoreMax", String(f.scoreMax));
  if (f.moatMin > 0) params.set("moatMin", String(f.moatMin));
  if (f.moatMax < 100) params.set("moatMax", String(f.moatMax));
  if (f.aiDisruptabilityMax < 100) params.set("aiDisruptabilityMax", String(f.aiDisruptabilityMax));
  if (f.coverageMin > 0) params.set("coverageMin", String(f.coverageMin));
  if (f.ownership.trim()) params.set("ownership", f.ownership.trim());
  if (f.country.trim()) params.set("country", f.country.trim());
  params.set("limit", String(LIMIT));
  return params.toString();
}

export default function ScreenerPage() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [draft, setDraft] = useState<Filters>(DEFAULTS);
  const [applied, setApplied] = useState<Filters>(DEFAULTS);
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("composite");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    fetch(`${API_BASE}/industries`).then(r => r.json()).then(d => setIndustries(d.industries ?? d ?? []));
  }, []);

  async function runQuery(f: Filters) {
    setLoading(true);
    const qs = buildQuery(f);
    const res = await fetch(`${API_BASE}/screener?${qs}`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setRows(data.rows ?? []);
    } else {
      setRows([]);
    }
    setLoading(false);
  }

  useEffect(() => { void runQuery(applied); }, [applied]);

  function apply() { setApplied(draft); }
  function reset() { setDraft(DEFAULTS); setApplied(DEFAULTS); }

  function exportXlsx() {
    const qs = buildQuery(applied);
    window.open(`${API_BASE}/export/xlsx?view=screener&${qs}`);
  }

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  }

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
    return out;
  }, [rows, sortKey, sortDir]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Deal Sourcing · Screener</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Search className="w-8 h-8 text-primary" />
          Screener
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Bloomberg-style multi-parameter filter across the company universe. Tune composite, moat, AI disruptability,
          and coverage thresholds, then export to XLSX for the deal team.
        </p>
      </motion.div>

      <div className="grid grid-cols-12 gap-6">
        {/* Filter sidebar */}
        <aside className="col-span-12 lg:col-span-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-serif uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Filter className="w-4 h-4" />Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <Label htmlFor="sc-industry" className="text-xs">Industry</Label>
                <Select value={draft.industryId} onValueChange={(v) => setDraft({ ...draft, industryId: v })}>
                  <SelectTrigger id="sc-industry"><SelectValue placeholder="Any industry" /></SelectTrigger>
                  <SelectContent>
                    {industries.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs">Composite score</Label>
                  <span className="text-xs font-mono text-muted-foreground">{draft.scoreMin}–{draft.scoreMax}</span>
                </div>
                <Slider
                  value={[draft.scoreMin]} min={0} max={100} step={1}
                  onValueChange={(v) => setDraft({ ...draft, scoreMin: v[0] })}
                  className="mb-2"
                />
                <Slider
                  value={[draft.scoreMax]} min={0} max={100} step={1}
                  onValueChange={(v) => setDraft({ ...draft, scoreMax: v[0] })}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs">Moat score</Label>
                  <span className="text-xs font-mono text-muted-foreground">{draft.moatMin}–{draft.moatMax}</span>
                </div>
                <Slider
                  value={[draft.moatMin]} min={0} max={100} step={1}
                  onValueChange={(v) => setDraft({ ...draft, moatMin: v[0] })}
                  className="mb-2"
                />
                <Slider
                  value={[draft.moatMax]} min={0} max={100} step={1}
                  onValueChange={(v) => setDraft({ ...draft, moatMax: v[0] })}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs">AI disruptability ≤</Label>
                  <span className="text-xs font-mono text-muted-foreground">{draft.aiDisruptabilityMax}</span>
                </div>
                <Slider
                  value={[draft.aiDisruptabilityMax]} min={0} max={100} step={1}
                  onValueChange={(v) => setDraft({ ...draft, aiDisruptabilityMax: v[0] })}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs">Coverage ≥</Label>
                  <span className="text-xs font-mono text-muted-foreground">{draft.coverageMin}</span>
                </div>
                <Slider
                  value={[draft.coverageMin]} min={0} max={100} step={1}
                  onValueChange={(v) => setDraft({ ...draft, coverageMin: v[0] })}
                />
              </div>

              <div>
                <Label htmlFor="sc-ownership" className="text-xs">Ownership</Label>
                <Input
                  id="sc-ownership" placeholder="Public, Private, PE-backed…"
                  value={draft.ownership}
                  onChange={(e) => setDraft({ ...draft, ownership: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="sc-country" className="text-xs">Country</Label>
                <Input
                  id="sc-country" placeholder="USA, UK, …"
                  value={draft.country}
                  onChange={(e) => setDraft({ ...draft, country: e.target.value })}
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button size="sm" onClick={apply} className="flex-1" data-testid="screener-apply">
                  Apply filters
                </Button>
                <Button size="sm" variant="ghost" onClick={reset} data-testid="screener-reset">
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* Results */}
        <section className="col-span-12 lg:col-span-9">
          <Card>
            <CardHeader className="pb-3 flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="font-serif text-2xl tracking-tight">Results</CardTitle>
                <CardDescription className="mt-1">
                  {loading
                    ? "Loading…"
                    : rows.length === 0
                      ? "No companies match these filters."
                      : `Top ${sorted.length} of ${rows.length === LIMIT ? `${LIMIT}+` : rows.length} matches`}
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={exportXlsx} disabled={rows.length === 0} data-testid="screener-export">
                <Download className="w-3.5 h-3.5 mr-1" />Export XLSX
              </Button>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {rows.length === 0 && !loading ? (
                <div className="py-16 text-center text-muted-foreground">
                  <Building2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-sm">Adjust the filters and apply to see matches.</p>
                </div>
              ) : (
                <table className="w-full text-sm" data-testid="screener-table">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">
                        <button onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-foreground">
                          Company <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="text-left px-3 py-3 font-medium">
                        <button onClick={() => toggleSort("industryName")} className="inline-flex items-center gap-1 hover:text-foreground">
                          Industry <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="text-right px-3 py-3 font-medium">
                        <button onClick={() => toggleSort("composite")} className="inline-flex items-center gap-1 hover:text-foreground">
                          Composite <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="text-right px-3 py-3 font-medium">
                        <button onClick={() => toggleSort("moatScore")} className="inline-flex items-center gap-1 hover:text-foreground">
                          Moat <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="text-right px-3 py-3 font-medium">
                        <button onClick={() => toggleSort("aiDisruptability")} className="inline-flex items-center gap-1 hover:text-foreground">
                          AI Risk <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="text-right px-3 py-3 font-medium">
                        <button onClick={() => toggleSort("capabilityCoverage")} className="inline-flex items-center gap-1 hover:text-foreground">
                          Coverage <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="text-right px-3 py-3 font-medium">
                        <button onClick={() => toggleSort("ceiWeighted")} className="inline-flex items-center gap-1 hover:text-foreground">
                          CEI Wtd <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.companyId} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            {r.country && <span>{r.country}</span>}
                            {r.ownership && <Badge variant="outline" className="text-xs h-4 px-1">{r.ownership}</Badge>}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{r.industryName ?? "—"}</td>
                        <td className={`text-right px-3 font-mono ${deltaClass(r.composite)}`}>{fmt(r.composite)}</td>
                        <td className="text-right px-3 font-mono">{fmt(r.moatScore)}</td>
                        <td className={`text-right px-3 font-mono ${r.aiDisruptability > 60 ? "text-rose-600" : "text-foreground"}`}>
                          {fmt(r.aiDisruptability)}
                        </td>
                        <td className="text-right px-3 font-mono">{fmt(r.capabilityCoverage)}</td>
                        <td className="text-right px-3 font-mono">{fmt(r.ceiWeighted)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
