import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Quote, Loader2, ExternalLink, Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = "/api";

type DataSource = {
  id: number;
  title: string;
  url: string | null;
  publisher: string | null;
  publishedDate: string | null;
  sourceType: string;
};
type Capability = { id: number; name: string; slug: string; industryId: number; parentCapabilityId?: number | null };
type Industry = { id: number; name: string };

export default function CitationsPage() {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pickedCap, setPickedCap] = useState<string>("");

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/data-sources`).then(r => r.json()).catch(() => []),
      fetch(`${API_BASE}/capabilities`).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/industries`).then(r => r.json()).catch(() => ({})),
    ]).then(([sRes, cRes, iRes]) => {
      setSources(Array.isArray(sRes) ? sRes : []);
      setCapabilities(cRes.capabilities ?? cRes ?? []);
      setIndustries(iRes.industries ?? iRes ?? []);
    }).finally(() => setLoading(false));
  }, []);

  const indById = useMemo(() => new Map(industries.map(i => [i.id, i.name])), [industries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(s => s.title.toLowerCase().includes(q) || (s.publisher ?? "").toLowerCase().includes(q));
  }, [sources, query]);

  function exportCitations(format: "bibtex" | "ris") {
    if (!pickedCap) return;
    window.open(`${API_BASE}/citations/export?capabilityId=${pickedCap}&format=${format}`, "_blank");
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Academic · Citations</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Quote className="w-8 h-8 text-primary" />
          Citations & Sources
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          The underlying source library. Search by title or publisher, or export every citation tied
          to a single capability as BibTeX or RIS for your reference manager.
        </p>
      </motion.div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Per-capability export</CardTitle>
          <CardDescription>Pulls all source citations attached to a capability's triangulations.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <Select value={pickedCap} onValueChange={setPickedCap}>
            <SelectTrigger className="sm:w-[320px]" data-testid="cap-select"><SelectValue placeholder="Select a capability…" /></SelectTrigger>
            <SelectContent className="max-h-96">
              {capabilities.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name} <span className="text-muted-foreground">· {indById.get(c.industryId) ?? c.industryId}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!pickedCap} onClick={() => exportCitations("bibtex")} data-testid="export-bibtex">
              <Download className="w-3.5 h-3.5 mr-1" />BibTeX
            </Button>
            <Button variant="outline" disabled={!pickedCap} onClick={() => exportCitations("ris")} data-testid="export-ris">
              <Download className="w-3.5 h-3.5 mr-1" />RIS
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Source library</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${filtered.length} of ${sources.length} sources${filtered.length > 200 ? ` — showing first 200` : ""}`}</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Search by title or publisher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-4"
            data-testid="source-search"
          />
          {loading ? (
            <p className="text-sm text-muted-foreground"><Loader2 className="w-3.5 h-3.5 inline mr-1 animate-spin" />Loading sources…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sources match.</p>
          ) : (
            <ul className="divide-y">
              {filtered.slice(0, 200).map(s => (
                <li key={s.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{s.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {s.publisher ?? "Unknown publisher"}
                      {s.publishedDate ? ` · ${s.publishedDate}` : ""} · {s.sourceType}
                    </div>
                  </div>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary inline-flex items-center gap-1 shrink-0">
                      Open <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
