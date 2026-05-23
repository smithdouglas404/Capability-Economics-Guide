/**
 * /search — cross-page search.
 *
 * Reuses the existing BM25 capability index (via `/api/search/all`) to
 * derive a query "capability fingerprint" — the set of capabilities the
 * query most strongly resembles. Other content types (regulations,
 * companies, members, posts, marketplace listings) are surfaced via ILIKE
 * and scored against that fingerprint. Each group renders with the
 * fingerprint match score on the right side.
 *
 * Capability-aware (2026-05-23): replaced the original capability-only
 * stub with a cross-page grouped result view.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Search as SearchIcon, Loader2, Compass, ShieldCheck, Building2, User, MessageSquare, ShoppingBag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const API_BASE = "/api";

interface CrossResult {
  id: number;
  title: string;
  subtitle?: string | null;
  href: string;
  capabilityFingerprintScore: number;
  lexicalScore?: number;
}

interface CrossSearchResponse {
  query: string;
  queryCapabilities: Array<{ id: number; name: string; slug: string }>;
  groups: {
    capabilities: CrossResult[];
    regulations: CrossResult[];
    companies: CrossResult[];
    members: CrossResult[];
    posts: CrossResult[];
    listings: CrossResult[];
  };
}

type GroupKey = keyof CrossSearchResponse["groups"];

const GROUP_META: Record<GroupKey, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  capabilities: { label: "Capabilities", icon: Compass },
  regulations: { label: "Regulations", icon: ShieldCheck },
  companies: { label: "Companies", icon: Building2 },
  members: { label: "Members", icon: User },
  posts: { label: "Posts", icon: MessageSquare },
  listings: { label: "Marketplace", icon: ShoppingBag },
};
const GROUP_ORDER: GroupKey[] = ["capabilities", "regulations", "companies", "members", "posts", "listings"];

export default function SearchPage() {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const initialQ = new URLSearchParams(search).get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [data, setData] = useState<CrossSearchResponse | null>(null);
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
        setData(null);
        return;
      }
      let cancelled = false;
      setLoading(true);
      setErr(null);
      fetch(`${API_BASE}/search/all?q=${encodeURIComponent(trimmed)}&limit=10`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then((d: CrossSearchResponse) => {
          if (cancelled) return;
          setData(d);
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

  const totalCount = data
    ? Object.values(data.groups).reduce((s, g) => s + g.length, 0)
    : 0;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <div>
        <Link href="/explore" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to explore
        </Link>
        <h1 className="font-serif text-3xl tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Describe a business problem in plain language. Returns matching capabilities, regulations, companies, members, posts, and marketplace listings — each scored by how well it aligns with the query's capability fingerprint.
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

      {data && totalCount === 0 && !loading && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No matches — try different terms.
          </CardContent>
        </Card>
      )}

      {data && totalCount > 0 && (
        <>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center justify-between flex-wrap gap-2">
            <span>{totalCount} match{totalCount === 1 ? "" : "es"} across {GROUP_ORDER.filter(k => data.groups[k].length > 0).length} types</span>
            {data.queryCapabilities.length > 0 && (
              <span className="text-muted-foreground/70">
                Query fingerprint: {data.queryCapabilities.slice(0, 3).map(c => c.name).join(", ")}
                {data.queryCapabilities.length > 3 ? ` +${data.queryCapabilities.length - 3} more` : ""}
              </span>
            )}
          </div>

          {GROUP_ORDER.map(key => {
            const rows = data.groups[key];
            if (rows.length === 0) return null;
            const meta = GROUP_META[key];
            const Icon = meta.icon;
            return (
              <section key={key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-accent" />
                  <h2 className="font-serif text-lg tracking-tight">{meta.label}</h2>
                  <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
                    {rows.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {rows.map(r => (
                    <ResultRow key={`${key}-${r.id}-${r.href}`} row={r} groupKey={key} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

/** One row in a result group. Renders the capability-fingerprint score on
 *  the right; falls back to "lexical" when fingerprint is zero (no capability
 *  alignment available — regulations / sellers). */
function ResultRow({ row, groupKey }: { row: CrossResult; groupKey: GroupKey }): React.ReactElement {
  // For capabilities the score is always 1 (self-match) — show the lexical
  // BM25 score instead so users see signal differentiation across results.
  const useFingerprint = groupKey !== "capabilities";
  const primary = useFingerprint ? row.capabilityFingerprintScore : (row.lexicalScore ?? 0);
  const label = useFingerprint ? "Fingerprint" : "Match";

  return (
    <Link href={row.href}>
      <Card className="rounded-none border-border/60 hover:border-primary transition-colors cursor-pointer">
        <CardContent className="p-4 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="font-serif text-base leading-snug line-clamp-2">{row.title}</div>
            {row.subtitle && (
              <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{row.subtitle}</div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
            <div className="font-mono text-lg tabular-nums">
              {primary > 0 ? `${(primary * 100).toFixed(0)}%` : "—"}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
