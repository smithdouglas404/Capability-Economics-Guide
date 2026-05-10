import { useState } from "react";
import { Link } from "wouter";
import { Info, ExternalLink, Database, Clock, Sigma } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ScoreProvenance {
  citations?: string[] | null;
  sourceCount?: number | null;
  lastUpdatedAt?: string | Date | null;
  model?: string | null;
  ciLow?: number | null;
  ciHigh?: number | null;
  gdpWeight?: number | null;
  gdpWeightSourceUrl?: string | null;
  gdpWeightSourceYear?: number | null;
  sourceBreakdown?: Array<{ sourceLabel: string; rawScore: number; weight: number; methodology?: string }> | null;
}

export interface ScoreWithProvenanceProps extends ScoreProvenance {
  value?: number | null;
  precision?: number;
  unit?: string;
  label: string;
  children?: React.ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}

function formatTimestamp(ts: string | Date | null | undefined): string | null {
  if (!ts) return null;
  const d = typeof ts === "string" ? new Date(ts) : ts;
  if (isNaN(d.getTime())) return null;
  const ageMs = Date.now() - d.getTime();
  const days = Math.floor(ageMs / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

export function ScoreWithProvenance({
  value,
  precision = 0,
  unit = "",
  label,
  children,
  className = "",
  side = "top",
  citations,
  sourceCount,
  lastUpdatedAt,
  model,
  ciLow,
  ciHigh,
  gdpWeight,
  gdpWeightSourceUrl,
  gdpWeightSourceYear,
  sourceBreakdown,
}: ScoreWithProvenanceProps) {
  const [open, setOpen] = useState(false);
  const rendered =
    children ?? (typeof value === "number" ? `${value.toFixed(precision)}${unit}` : "—");
  const ageLabel = formatTimestamp(lastUpdatedAt);
  const cites = (citations ?? []).filter(Boolean);
  const effectiveCount = sourceCount ?? cites.length;
  const hasAnyProvenance =
    cites.length > 0 ||
    !!ageLabel ||
    !!model ||
    typeof ciLow === "number" ||
    typeof ciHigh === "number" ||
    !!gdpWeightSourceUrl ||
    (sourceBreakdown && sourceBreakdown.length > 0);

  if (!hasAnyProvenance) {
    return <span className={className}>{rendered}</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${typeof rendered === "string" ? rendered : value ?? ""}. Open provenance details.`}
          aria-expanded={open}
          className={`inline-flex items-baseline gap-1 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm ${className}`}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          data-testid="score-with-provenance-trigger"
        >
          <span>{rendered}</span>
          <Info className="w-3 h-3 self-center text-muted-foreground/50 group-hover:text-foreground group-focus-visible:text-foreground transition-colors shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 text-xs leading-relaxed p-0"
        side={side}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-3 pt-3 pb-2 border-b border-border/60">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="font-mono text-base font-semibold text-foreground mt-0.5 break-words">
            {rendered}
            {(typeof ciLow === "number" || typeof ciHigh === "number") && (
              <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                95% CI {typeof ciLow === "number" ? ciLow.toFixed(precision) : "—"}–
                {typeof ciHigh === "number" ? ciHigh.toFixed(precision) : "—"}
                {unit}
              </span>
            )}
          </div>
        </div>

        <div className="px-3 py-2 space-y-1.5">
          {model && (
            <div className="flex items-start gap-2">
              <Sigma className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">Model: </span>
                <span className="font-medium text-foreground">{model}</span>
              </div>
            </div>
          )}
          {effectiveCount > 0 && (
            <div className="flex items-start gap-2">
              <Database className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">Sources: </span>
                <span className="font-medium text-foreground">
                  {effectiveCount} independent {effectiveCount === 1 ? "source" : "sources"}
                </span>
              </div>
            </div>
          )}
          {ageLabel && (
            <div className="flex items-start gap-2">
              <Clock className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">Last updated: </span>
                <span className="font-medium text-foreground">{ageLabel}</span>
              </div>
            </div>
          )}
          {gdpWeight !== null && gdpWeight !== undefined && (
            <div className="flex items-start gap-2">
              <Sigma className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">GDP weight: </span>
                <span className="font-medium text-foreground">{(gdpWeight * 100).toFixed(2)}%</span>
                {gdpWeightSourceUrl && (
                  <>
                    {" "}
                    <a
                      href={gdpWeightSourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline decoration-dotted hover:no-underline break-all"
                    >
                      {hostname(gdpWeightSourceUrl)}
                      {gdpWeightSourceYear ? ` (${gdpWeightSourceYear})` : ""}
                    </a>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {sourceBreakdown && sourceBreakdown.length > 0 && (
          <div className="px-3 pb-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Source breakdown
            </div>
            <div className="space-y-0.5 font-mono text-[10.5px]">
              {sourceBreakdown.map((s, i) => (
                <div key={i} className="flex justify-between gap-2">
                  <span className="text-muted-foreground truncate">{s.sourceLabel}</span>
                  <span className="text-foreground shrink-0">
                    {s.rawScore.toFixed(1)}{" "}
                    <span className="text-muted-foreground/70">× {s.weight.toFixed(2)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {cites.length > 0 && (
          <div className="px-3 pb-2 border-t border-border/60 pt-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Citations ({cites.length})
            </div>
            <ul className="space-y-0.5 max-h-32 overflow-y-auto">
              {cites.slice(0, 8).map((url, i) => (
                <li key={i} className="truncate">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline text-[11px] max-w-full"
                    title={url}
                  >
                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{hostname(url)}</span>
                  </a>
                </li>
              ))}
              {cites.length > 8 && (
                <li className="text-[10px] text-muted-foreground italic">
                  + {cites.length - 8} more
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="px-3 py-2 border-t border-border/60 bg-muted/30 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            How is this calculated?
          </span>
          <Link
            href="/methodology"
            className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
          >
            Methodology →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ScoreWithProvenance;
