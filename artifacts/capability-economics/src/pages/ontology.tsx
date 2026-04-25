import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { GitBranch, Loader2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const API_BASE = "/api";

type Industry = { id: number; name: string };

type Relationship = {
  id: number;
  sourceCapabilityId: number;
  targetCapabilityId: number;
  relationshipType: string;
  strength: number | null;
  description: string | null;
  sourceName: string;
  sourceSlug: string;
  sourceIndustryId: number;
  targetName: string;
  targetSlug: string;
  targetIndustryId: number;
};

type Adapter = { id: number; industryId: number; ontologyKey: string; localCapabilityId: number | null; rationale: string | null };

const TYPE_COLORS: Record<string, string> = {
  enables: "bg-emerald-500/10 text-emerald-700",
  composes: "bg-sky-500/10 text-sky-700",
  blocks: "bg-rose-500/10 text-rose-700",
  influences: "bg-amber-500/10 text-amber-700",
};

export default function OntologyPage() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [data, setData] = useState<{ relationships: Relationship[]; adapters: Adapter[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/industries`).then(r => r.json()).then(d => setIndustries(d.industries ?? d ?? []));
  }, []);

  useEffect(() => {
    setLoading(true);
    const url = industryFilter === "all" ? `${API_BASE}/ontology` : `${API_BASE}/ontology?industryId=${industryFilter}`;
    fetch(url, { credentials: "include" }).then(r => r.json()).then(d => {
      setData({ relationships: d.relationships ?? [], adapters: d.adapters ?? [] });
      setLoading(false);
    }).catch(() => { setData({ relationships: [], adapters: [] }); setLoading(false); });
  }, [industryFilter]);

  const indMap = useMemo(() => new Map(industries.map(i => [i.id, i.name])), [industries]);

  const grouped = useMemo(() => {
    if (!data) return new Map<number, Relationship[]>();
    const m = new Map<number, Relationship[]>();
    for (const r of data.relationships) {
      const arr = m.get(r.sourceCapabilityId) ?? [];
      arr.push(r);
      m.set(r.sourceCapabilityId, arr);
    }
    return m;
  }, [data]);

  const sourceList = useMemo(() => {
    if (!data) return [];
    const seen = new Map<number, { id: number; name: string; industryId: number; count: number }>();
    for (const r of data.relationships) {
      const cur = seen.get(r.sourceCapabilityId);
      if (cur) { cur.count++; }
      else seen.set(r.sourceCapabilityId, { id: r.sourceCapabilityId, name: r.sourceName, industryId: r.sourceIndustryId, count: 1 });
    }
    return Array.from(seen.values()).sort((a, b) => b.count - a.count);
  }, [data]);

  const typeCounts = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const out: Record<string, number> = {};
    for (const r of data.relationships) out[r.relationshipType] = (out[r.relationshipType] ?? 0) + 1;
    return out;
  }, [data]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Researcher · Methodology</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <GitBranch className="w-8 h-8 text-primary" />
          Ontology
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Cross-industry capability graph. Edges are typed (enables, composes, blocks, influences) and weighted —
          this is the structural backbone underneath the index.
        </p>
      </motion.div>

      <div className="grid grid-cols-12 gap-6 mb-6">
        <Card className="col-span-12 md:col-span-4">
          <CardContent className="pt-6">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Industry filter</Label>
            <Select value={industryFilter} onValueChange={setIndustryFilter}>
              <SelectTrigger data-testid="industry-filter" className="mt-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All industries</SelectItem>
                {industries.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        <Card className="col-span-12 md:col-span-8">
          <CardContent className="pt-6">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Relationships</div>
                <div className="font-mono text-2xl mt-1">{data?.relationships.length.toLocaleString() ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Source capabilities</div>
                <div className="font-mono text-2xl mt-1">{sourceList.length.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Adapters</div>
                <div className="font-mono text-2xl mt-1">{data?.adapters.length.toLocaleString() ?? "—"}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {Object.entries(typeCounts).map(([t, n]) => (
                <Badge key={t} variant="outline" className={`text-xs ${TYPE_COLORS[t] ?? ""}`}>{t} · {n}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 mx-auto animate-spin" />
          </CardContent>
        </Card>
      ) : sourceList.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <GitBranch className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-serif text-lg mb-1">No relationships defined</p>
            <p className="text-sm">Pick a different industry, or check back after the next ontology run.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sourceList.map((src) => {
            const edges = grouped.get(src.id) ?? [];
            return (
              <Card key={src.id} data-testid={`ontology-node-${src.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="font-serif text-base flex items-center justify-between">
                    <span>{src.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{indMap.get(src.industryId) ?? "Unknown"}</Badge>
                      <Badge variant="secondary" className="text-xs font-mono">{src.count} edge{src.count === 1 ? "" : "s"}</Badge>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y text-sm">
                    {edges.map((e) => (
                      <li key={e.id} className="py-2 flex items-center gap-3">
                        <Badge className={`text-[10px] font-mono shrink-0 ${TYPE_COLORS[e.relationshipType] ?? "bg-muted"}`}>
                          {e.relationshipType}
                        </Badge>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{e.targetName}</div>
                          {e.description && <div className="text-xs text-muted-foreground truncate" title={e.description}>{e.description}</div>}
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0 font-mono">
                          {indMap.get(e.targetIndustryId) ?? "—"}
                          {e.strength !== null && <span className="ml-2">· {(e.strength * 100).toFixed(0)}%</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
