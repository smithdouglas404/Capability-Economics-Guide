import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { motion } from "framer-motion";
import { Search, Loader2, ArrowUp, ArrowDown, Building2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const API_BASE = "/api";

type Capability = { id: number; name: string; slug: string; industryId: number; description?: string | null; parentCapabilityId?: number | null };
type Industry = { id: number; name: string };
type Component = { capabilityId: number; industryId: number; consensusScore: number; velocity: number; confidence: number };
type CompanyRow = {
  id: number;
  name: string;
  industryId: number;
  industryName: string | null;
  scores: null | { composite: number; moatScore: number; aiDisruptability: number; capabilityCoverage: number; ceiWeighted: number; forecastedValue: number };
};

function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

export default function LookupPage() {
  const search = useSearch();
  const initialCapId = useMemo(() => {
    const params = new URLSearchParams(search);
    const v = Number(params.get("capabilityId"));
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [search]);

  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(initialCapId);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/capabilities`).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/industries`).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/cei/components`).then(r => r.json()).catch(() => []),
    ]).then(([cRes, iRes, kRes]) => {
      setCapabilities(cRes.capabilities ?? cRes ?? []);
      setIndustries(iRes.industries ?? iRes ?? []);
      setComponents(Array.isArray(kRes) ? kRes : (kRes.components ?? []));
    });
  }, []);

  useEffect(() => {
    if (selectedId === null) { setCompanies([]); return; }
    const cap = capabilities.find(c => c.id === selectedId);
    if (!cap) return;
    setLoadingCompanies(true);
    fetch(`${API_BASE}/workbench/companies?industryId=${cap.industryId}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        const items = (d.companies ?? d ?? []).slice(0, 50).map((row: { company?: CompanyRow; id?: number; name?: string; industryId?: number; industryName?: string; scores?: CompanyRow["scores"] }) => {
          const c = row.company ?? row;
          return {
            id: c.id!,
            name: c.name!,
            industryId: c.industryId!,
            industryName: (c as CompanyRow).industryName ?? null,
            scores: (c as CompanyRow).scores ?? null,
          } as CompanyRow;
        });
        items.sort((a: CompanyRow, b: CompanyRow) => (b.scores?.composite ?? 0) - (a.scores?.composite ?? 0));
        setCompanies(items.slice(0, 3));
      })
      .catch(() => setCompanies([]))
      .finally(() => setLoadingCompanies(false));
  }, [selectedId, capabilities]);

  const indById = useMemo(() => new Map(industries.map(i => [i.id, i.name])), [industries]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return capabilities
      .filter(c => c.name.toLowerCase().includes(q) || (c.slug ?? "").toLowerCase().includes(q))
      .slice(0, 12);
  }, [query, capabilities]);

  const selected = useMemo(() => capabilities.find(c => c.id === selectedId) ?? null, [capabilities, selectedId]);

  const breakdown = useMemo(() => {
    if (!selected) return [];
    const sameName = capabilities.filter(c => c.name.trim().toLowerCase() === selected.name.trim().toLowerCase());
    const ids = new Set(sameName.map(c => c.id));
    return components
      .filter(c => ids.has(c.capabilityId))
      .map(c => ({
        industryId: c.industryId,
        industryName: indById.get(c.industryId) ?? "—",
        consensusScore: c.consensusScore,
        velocity: c.velocity,
        confidence: c.confidence,
      }))
      .sort((a, b) => b.consensusScore - a.consensusScore);
  }, [selected, capabilities, components, indById]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Academic · Capability Lookup</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Search className="w-8 h-8 text-primary" />
          Capability Lookup
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Type to find a capability across the catalog. Select one to see its definition,
          industry-by-industry consensus, and the leader companies in its home industry.
        </p>
      </motion.div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <Input
            placeholder="Search capabilities…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="capability-search"
          />
          {matches.length > 0 && (
            <div className="mt-3 border rounded-md divide-y max-h-72 overflow-y-auto">
              {matches.map(m => (
                <button
                  key={m.id}
                  className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex items-center justify-between"
                  onClick={() => { setSelectedId(m.id); setQuery(""); }}
                  data-testid={`match-${m.id}`}
                >
                  <span>{m.name}</span>
                  <Badge variant="outline" className="text-xs">{indById.get(m.industryId) ?? m.industryId}</Badge>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selected ? (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">{selected.name}</CardTitle>
              <CardDescription>{indById.get(selected.industryId) ?? "Industry"} · slug: {selected.slug}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{selected.description ?? "No description available yet."}</p>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="font-serif text-lg">Industry breakdown</CardTitle>
              <CardDescription>Consensus score and velocity per industry where this capability appears.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Industry</th>
                    <th className="text-right px-3 py-3 font-medium">Consensus</th>
                    <th className="text-right px-3 py-3 font-medium">Velocity</th>
                    <th className="text-right px-3 py-3 font-medium">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No CEI components yet for this capability.</td></tr>
                  ) : breakdown.map(b => (
                    <tr key={b.industryId} className="border-t">
                      <td className="px-4 py-2">{b.industryName}</td>
                      <td className={`text-right px-3 font-mono ${b.consensusScore >= 60 ? "text-emerald-600" : b.consensusScore >= 40 ? "text-amber-600" : "text-rose-600"}`}>{fmt(b.consensusScore, 0)}</td>
                      <td className="text-right px-3 font-mono">
                        <span className="inline-flex items-center gap-1">
                          {b.velocity > 0.001 && <ArrowUp className="w-3 h-3 text-emerald-600" />}
                          {b.velocity < -0.001 && <ArrowDown className="w-3 h-3 text-rose-600" />}
                          {fmt(b.velocity, 3)}
                        </span>
                      </td>
                      <td className="text-right px-3 font-mono">{fmt(b.confidence, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg">Top {companies.length || 3} leader companies</CardTitle>
              <CardDescription>Highest composite scores in {indById.get(selected.industryId) ?? "this industry"}{companies.length > 0 && companies.length < 3 ? ` — only ${companies.length} available` : ""}.</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCompanies ? (
                <p className="text-sm text-muted-foreground"><Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" />Loading…</p>
              ) : companies.length === 0 ? (
                <p className="text-sm text-muted-foreground">No companies found.</p>
              ) : (
                <ul className="space-y-3">
                  {companies.map(c => (
                    <li key={c.id} className="flex items-center justify-between border-b pb-3 last:border-b-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">{c.industryName ?? ""}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm">{fmt(c.scores?.composite)}</div>
                        <div className="text-xs text-muted-foreground">composite</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-serif text-lg">Search above to pick a capability.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
