import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Loader2, Building2, Shield, Cpu, Award, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = "/api";

type Industry = { id: number; name: string };
type CompanyListRow = {
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
  };
};
type CompanyDetail = {
  company: { id: number; name: string; industryId: number; country: string | null; ownership: string | null; publicTicker: string | null; websiteUrl: string | null };
  scores: null | { composite: number; moatScore: number; aiDisruptability: number; capabilityCoverage: number; ceiWeighted: number };
  fingerprint: Array<{ fp: { weight: number; evidenceNote: string | null }; cap: { id: number; name: string; benchmarkScore: number } }>;
};

function metricColor(n: number, kind: "moat" | "ai" | "score"): string {
  if (kind === "moat") return n >= 60 ? "text-emerald-600" : n >= 40 ? "text-amber-600" : "text-rose-600";
  if (kind === "ai") return n >= 60 ? "text-rose-600" : n >= 40 ? "text-amber-600" : "text-emerald-600";
  return n >= 60 ? "text-emerald-600" : n >= 40 ? "text-amber-600" : "text-rose-600";
}

export default function CompetitorScan() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<string>("");
  const [companies, setCompanies] = useState<CompanyListRow[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/industries`)
      .then((r) => r.json())
      .then((d) => {
        const list: Industry[] = d.industries ?? d ?? [];
        setIndustries(list);
        if (list.length && !industryId) setIndustryId(String(list[0].id));
      });
  }, []);

  useEffect(() => {
    if (!industryId) return;
    setLoadingList(true);
    fetch(`${API_BASE}/workbench/companies?industryId=${industryId}&limit=200`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const items = (d.companies ?? []).map((row: { company?: CompanyListRow; scores?: CompanyListRow["scores"] } & CompanyListRow) => {
          const c = row.company ?? row;
          return { ...c, scores: row.scores ?? c.scores ?? null };
        });
        setCompanies(items);
        setLoadingList(false);
      })
      .catch(() => setLoadingList(false));
    setSelectedId(null);
    setDetail(null);
  }, [industryId]);

  useEffect(() => {
    if (selectedId === null) { setDetail(null); return; }
    setLoadingDetail(true);
    fetch(`${API_BASE}/workbench/companies/${selectedId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { setDetail(d); setLoadingDetail(false); })
      .catch(() => setLoadingDetail(false));
  }, [selectedId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies.slice(0, 25);
    return companies.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.publicTicker ?? "").toLowerCase().includes(q)
    ).slice(0, 25);
  }, [companies, query]);

  const top5 = useMemo(() => {
    if (!detail) return [];
    return [...detail.fingerprint]
      .sort((a, b) => b.fp.weight - a.fp.weight)
      .slice(0, 5);
  }, [detail]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Discover · Competitor Scan</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Search className="w-8 h-8 text-primary" />
          Competitor Scan
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Look up any company in the catalog and pull their capability fingerprint — what they actually do well, where
          their moat is, and how AI-disruptable they are.
        </p>
      </motion.div>

      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-12 lg:col-span-4 space-y-3">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Industry</p>
                <Select value={industryId} onValueChange={setIndustryId}>
                  <SelectTrigger><SelectValue placeholder="Industry" /></SelectTrigger>
                  <SelectContent>
                    {industries.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="Search by name or ticker…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0 max-h-[560px] overflow-y-auto">
              {loadingList ? (
                <div className="py-12 text-center text-muted-foreground">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin opacity-50" />
                  <p className="text-xs">Loading companies…</p>
                </div>
              ) : matches.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No matches.</p>
              ) : (
                <div className="divide-y">
                  {matches.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors ${selectedId === c.id ? "bg-primary/10 border-l-2 border-primary" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-sm truncate">{c.name}</div>
                        {c.publicTicker && <Badge variant="outline" className="text-[10px]">{c.publicTicker}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {c.country ?? "—"}{c.ownership ? ` · ${c.ownership}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </aside>

        <section className="col-span-12 lg:col-span-8">
          {selectedId === null ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Building2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="font-serif text-lg mb-1">Pick a company.</p>
                <p className="text-sm">We'll pull their capability fingerprint and rank their top 5 strengths.</p>
              </CardContent>
            </Card>
          ) : loadingDetail || !detail ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin opacity-50" />
                <p className="text-sm">Loading capability profile…</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="mb-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-2xl tracking-tight flex items-center gap-2">
                      {detail.company.name}
                      {detail.company.publicTicker && <Badge variant="outline">{detail.company.publicTicker}</Badge>}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {detail.company.country ?? ""}{detail.company.ownership ? ` · ${detail.company.ownership}` : ""}
                    </p>
                  </div>
                  {detail.company.websiteUrl && (
                    <a href={detail.company.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary text-sm flex items-center gap-1">
                      site<ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>

              {detail.scores && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">Composite</p>
                      <p className={`font-mono text-2xl font-semibold ${metricColor(detail.scores.composite, "score")}`}>{detail.scores.composite.toFixed(0)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Shield className="w-3 h-3" />Moat</p>
                      <p className={`font-mono text-2xl font-semibold ${metricColor(detail.scores.moatScore, "moat")}`}>{detail.scores.moatScore.toFixed(0)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Cpu className="w-3 h-3" />AI Risk</p>
                      <p className={`font-mono text-2xl font-semibold ${metricColor(detail.scores.aiDisruptability, "ai")}`}>{detail.scores.aiDisruptability.toFixed(0)}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">Coverage</p>
                      <p className={`font-mono text-2xl font-semibold ${metricColor(detail.scores.capabilityCoverage, "score")}`}>{detail.scores.capabilityCoverage.toFixed(0)}</p>
                    </CardContent>
                  </Card>
                </div>
              )}

              <Card>
                <CardContent className="p-6">
                  <h3 className="font-serif text-xl tracking-tight mb-1 flex items-center gap-2">
                    <Award className="w-5 h-5 text-primary" />Top {Math.min(5, top5.length) || 5} capability strengths
                  </h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Where this company has shown evidence of capability — your competitive surface area.
                    {top5.length > 0 && top5.length < 5 && ` Only ${top5.length} fingerprinted.`}
                  </p>
                  {top5.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No fingerprint data yet for this company.</p>
                  ) : (
                    <ol className="space-y-2">
                      {top5.map((row, i) => (
                        <li key={row.cap.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted/30 border border-transparent">
                          <span className="text-xs font-mono text-muted-foreground w-6">{String(i + 1).padStart(2, "0")}</span>
                          <span className="text-sm font-medium flex-1">{row.cap.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">weight {row.fp.weight.toFixed(2)}</span>
                          <Badge variant="outline" className="text-[10px]">bench {row.cap.benchmarkScore.toFixed(0)}</Badge>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
