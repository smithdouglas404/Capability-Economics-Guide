import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GitCompare, ExternalLink } from "lucide-react";

interface SourceScore {
  sourceLabel: string;
  rawScore: number;
  weight: number;
  methodology: string;
  citations: string[];
  queriedAt: string;
}

interface ConsensusResponse {
  capabilityId: number;
  capabilityName: string;
  ourScore: number | null;
  ourConfidence: number | null;
  ourCiLow: number | null;
  ourCiHigh: number | null;
  sources: SourceScore[];
  maxDisagreement: number;
  mostDisagreeingSource: string | null;
  lastUpdatedAt: string | null;
}

/**
 * Compact inline component: shows our score with a hover-revealed comparison
 * vs every source we triangulated. Surfaces the magnitude of disagreement
 * and the most-disagreeing source — the "we see something different" angle.
 *
 * Designed to wrap any score cell on Scorecard, Alpha, Capability detail,
 * Regulations requirement rows, etc.
 */
export function ConsensusView({
  capabilityId,
  ourScore,
  precision = 0,
  suffix = "",
  className = "",
  children,
}: {
  capabilityId: number;
  ourScore: number | null;
  precision?: number;
  suffix?: string;
  className?: string;
  /** Optional custom trigger. When provided, replaces the default score display. */
  children?: React.ReactNode;
}) {
  const [data, setData] = useState<ConsensusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);

  // Lazy-load on first hover/open to avoid N+1 fetches per page load.
  useEffect(() => {
    if (!opened || data || loading) return;
    setLoading(true);
    fetch(`/api/consensus/capability/${capabilityId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: ConsensusResponse | null) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [opened, data, loading, capabilityId]);

  const display = ourScore !== null
    ? `${ourScore.toFixed(precision)}${suffix}`
    : "—";

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip onOpenChange={setOpened}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`underline decoration-dotted underline-offset-2 hover:text-foreground transition-colors ${className}`}
            data-testid={`consensus-view-${capabilityId}`}
          >
            {children ?? display}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" className="max-w-md p-3">
          {loading && <p className="text-xs italic text-muted-foreground">Loading sources…</p>}
          {!loading && !data && <p className="text-xs italic text-muted-foreground">No consensus data available.</p>}
          {!loading && data && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <GitCompare className="w-3.5 h-3.5 text-accent" />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Model vs sources
                </span>
              </div>

              {/* Our score */}
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Our consensus</span>
                  <span className="font-mono tabular-nums text-lg font-bold text-foreground">
                    {data.ourScore !== null ? `${data.ourScore.toFixed(precision)}${suffix}` : "—"}
                  </span>
                </div>
                {data.ourCiLow !== null && data.ourCiHigh !== null && (
                  <div className="font-mono text-[10px] text-muted-foreground">
                    95% CI [{data.ourCiLow.toFixed(precision)}, {data.ourCiHigh.toFixed(precision)}]{suffix}
                  </div>
                )}
              </div>

              {/* Source-by-source */}
              {data.sources.length > 0 ? (
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
                    {data.sources.length} {data.sources.length === 1 ? "source" : "sources"} triangulated
                  </div>
                  <ul className="space-y-1">
                    {data.sources.map((s, i) => {
                      const diff = data.ourScore !== null ? s.rawScore - data.ourScore : 0;
                      const diffSign = diff > 0 ? "+" : "";
                      const isMaxDisagreement = data.mostDisagreeingSource === s.sourceLabel;
                      return (
                        <li
                          key={i}
                          className={`flex items-baseline justify-between gap-2 text-xs ${
                            isMaxDisagreement ? "text-amber-600 dark:text-amber-400 font-medium" : ""
                          }`}
                        >
                          <span className="truncate flex-1" title={s.methodology}>
                            {s.sourceLabel}
                          </span>
                          <span className="font-mono tabular-nums whitespace-nowrap">
                            {s.rawScore.toFixed(precision)}{suffix}
                            {data.ourScore !== null && (
                              <span className="text-muted-foreground ml-1.5">
                                ({diffSign}{diff.toFixed(1)})
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="text-xs italic text-muted-foreground">No external sources yet — this score is synthesized internally.</p>
              )}

              {/* Disagreement callout */}
              {data.maxDisagreement >= 5 && data.mostDisagreeingSource && (
                <div className="border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
                    Disagreement
                  </span>
                  <div className="text-foreground">
                    We diverge from <strong>{data.mostDisagreeingSource}</strong> by {data.maxDisagreement.toFixed(1)}{suffix} points
                  </div>
                </div>
              )}

              {/* Citation link */}
              {data.sources[0]?.citations[0] && (
                <a
                  href={data.sources[0].citations[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open primary source
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
