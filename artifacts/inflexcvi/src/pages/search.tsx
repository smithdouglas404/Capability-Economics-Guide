import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Search as SearchIcon, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const API_BASE = "/api";

interface SearchResult {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  slug: string;
  isLeaf: boolean;
  score: number;
  matchedTerms: string[];
}

export default function SearchPage() {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const initialQ = new URLSearchParams(search).get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [backend, setBackend] = useState<string>("bm25");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = q.trim();
      const params = new URLSearchParams(window.location.search);
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
      setLocation(`/search${params.toString() ? `?${params.toString()}` : ""}`, { replace: true });

      if (!trimmed) {
        setResults(null);
        return;
      }
      let cancelled = false;
      setLoading(true);
      setErr(null);
      fetch(`${API_BASE}/search/capabilities?q=${encodeURIComponent(trimmed)}&limit=30`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then((d: { results: SearchResult[]; backend: string }) => {
          if (cancelled) return;
          setResults(d.results);
          setBackend(d.backend);
        })
        .catch(e => {
          if (!cancelled) setErr(e instanceof Error ? e.message : "Search failed");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => { cancelled = true; };
    }, 200);
    return () => clearTimeout(handle);
  }, [q, setLocation]);

  const exampleQueries = useMemo(() => [
    "how do we detect fraud in real-time payment streams",
    "underwriting automation for commercial lines",
    "supply chain visibility across multi-tier suppliers",
    "physician burnout reduction tooling",
    "data quality for AI training",
  ], []);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <div>
        <Link href="/explore" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to explore
        </Link>
        <h1 className="font-serif text-3xl tracking-tight">Search capabilities</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Describe a business problem in plain language. Returns capabilities whose name, description, traditional view, or economic view match.
        </p>
      </div>

      <div className="relative">
        <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="e.g. real-time fraud detection in payments"
          className="rounded-none pl-9 h-11 text-base"
        />
      </div>

      {!q.trim() && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Try</div>
            <div className="flex flex-col gap-1">
              {exampleQueries.map(ex => (
                <button key={ex} onClick={() => setQ(ex)} className="text-left text-sm text-foreground hover:underline">
                  &raquo; {ex}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {err && (
        <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-4 py-3 text-sm font-mono">{err}</div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Searching…
        </div>
      )}

      {results && results.length === 0 && !loading && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No capabilities match — try different terms.
          </CardContent>
        </Card>
      )}

      {results && results.length > 0 && (
        <>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {results.length} match{results.length === 1 ? "" : "es"} · backend: {backend}
          </div>
          <div className="space-y-2">
            {results.map(r => (
              <Link key={r.capabilityId} href={`/capability/${r.capabilityId}`}>
                <Card className="rounded-none border-border/60 hover:border-primary transition-colors cursor-pointer">
                  <CardContent className="p-4 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
                          {r.industryName}
                        </Badge>
                        {r.isLeaf ? (
                          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">Leaf</Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">Rollup</Badge>
                        )}
                      </div>
                      <div className="font-serif text-lg">{r.capabilityName}</div>
                      {r.matchedTerms.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {r.matchedTerms.map(t => (
                            <span key={t} className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Score</div>
                      <div className="font-mono text-lg tabular-nums">{r.score.toFixed(2)}</div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
