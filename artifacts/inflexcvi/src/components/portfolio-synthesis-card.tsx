import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, ChevronDown, ChevronRight, TrendingDown, DollarSign } from "lucide-react";

interface WeakCapability {
  capabilityId: number;
  name: string;
  count: number;
  avgScore: number;
}

interface PortfolioSynthesisResponse {
  headline: string;
  weakestCapabilities: WeakCapability[];
  totalExposureMm: number;
  companyCount: number;
  generatedAt: string;
}

const fmtTime = (iso: string | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const minutes = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

/**
 * Portfolio-scoped synthesis brief — mirrors the global
 * <SynthesisBriefCard /> look/feel, but the narrative is composed
 * deterministically server-side from the caller's tracked companies.
 *
 * Reads /api/portfolio/synthesis. Quietly hides when there's nothing
 * to say (e.g. no portcos yet — the empty-state lives in the main
 * portfolio page).
 */
export function PortfolioSynthesisCard({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<PortfolioSynthesisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!compact);

  useEffect(() => {
    fetch("/api/portfolio/synthesis")
      .then(r => r.json())
      .then((d: PortfolioSynthesisResponse) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;
  // Empty portfolio — the parent page renders its own empty state, so
  // there's no need for us to add a second "nothing here" card.
  if (data.companyCount === 0) return null;

  const age = fmtTime(data.generatedAt);
  const hasFindings = data.weakestCapabilities.length > 0 || data.totalExposureMm > 0;

  return (
    <Card className="rounded-none border-l-2 border-l-accent">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <CardTitle className="text-base font-serif flex items-center gap-2 flex-wrap">
              <Briefcase className="w-4 h-4 text-accent" />
              House view — portfolio synthesis
            </CardTitle>
            <CardDescription className="text-xs">
              Deterministic aggregate composed from your {data.companyCount} tracked compan{data.companyCount === 1 ? "y" : "ies"}'
              capability fingerprints + capability-alpha EVaR. Refreshes on every load.
            </CardDescription>
          </div>
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            aria-label={expanded ? "Collapse portfolio synthesis" : "Expand portfolio synthesis"}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          {/* Headline narrative */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Portfolio brief
              </span>
              {age && (
                <Badge variant="outline" className="rounded-none text-[10px] font-mono">
                  {age}
                </Badge>
              )}
            </div>
            <p className="text-sm leading-relaxed">{data.headline}</p>
          </div>

          {hasFindings && (
            <div className="grid sm:grid-cols-2 gap-3">
              {/* Weakest capabilities */}
              {data.weakestCapabilities.length > 0 && (
                <div className="border border-amber-500/20 bg-amber-500/[0.04] p-3">
                  <div className="flex items-center gap-1.5 mb-2 text-amber-700 dark:text-amber-400">
                    <TrendingDown className="w-3.5 h-3.5" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                      Dominant weaknesses
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-xs">
                    {data.weakestCapabilities.map(c => (
                      <li key={c.capabilityId} className="flex items-baseline justify-between gap-2">
                        <span className="font-medium truncate">{c.name}</span>
                        <span className="text-muted-foreground tabular-nums whitespace-nowrap text-[10px]">
                          {c.count} portco{c.count === 1 ? "" : "s"} · {c.avgScore.toFixed(0)}/100
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Aggregate EVaR */}
              <div className="border border-rose-500/20 bg-rose-500/[0.04] p-3">
                <div className="flex items-center gap-1.5 mb-2 text-rose-700 dark:text-rose-400">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                    Aggregate 12-mo EVaR
                  </span>
                </div>
                <div className="text-2xl font-serif tabular-nums">
                  ${data.totalExposureMm.toFixed(1)}M
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Summed across all portfolio fingerprints, weighted by edge weight.
                </div>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
