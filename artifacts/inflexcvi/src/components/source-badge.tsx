/**
 * Small inline source-attribution chip. Use anywhere a score, table, or
 * panel is sourced from one of the platform's data feeds.
 *
 * Move 9 of the strategic UX overhaul — makes the platform's epistemic
 * stack visible so visitors understand we're not just a Perplexity
 * wrapper. Hover shows the source description; click goes to /provenance.
 */
import { Link } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Database, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { sourceFor, type DataSourceSlug, type DataSource } from "@/lib/data-sources";

const TONE_CLASSES: Record<DataSource["tone"], string> = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  rose: "bg-rose-500/10 text-rose-500 border-rose-500/30",
  violet: "bg-violet-500/10 text-violet-500 border-violet-500/30",
  slate: "bg-muted text-muted-foreground border-border/60",
};

export interface SourceBadgeProps {
  source: DataSourceSlug;
  /** "sm" is the default — a single-line chip. "md" adds the source kind label. */
  size?: "sm" | "md";
  /** Extra Tailwind classes for the chip. */
  className?: string;
}

export function SourceBadge({ source, size = "sm", className }: SourceBadgeProps) {
  const s = sourceFor(source);
  const tone = TONE_CLASSES[s.tone];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border font-mono uppercase tracking-wider transition-opacity hover:opacity-90",
            tone,
            size === "sm" ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-0.5",
            className,
          )}
          aria-label={`Source: ${s.label}`}
        >
          <Database className={size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3"} />
          <span>{s.label}</span>
          {size === "md" && (
            <span className="opacity-60 normal-case tracking-normal">· {s.kind.replace(/-/g, " ")}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 text-xs leading-relaxed" align="start">
        <div className="font-medium text-sm text-foreground mb-1 flex items-center gap-2">
          <span>{s.label}</span>
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border uppercase tracking-wider", tone)}>
            {s.trust} trust
          </span>
        </div>
        <p className="text-muted-foreground">{s.description}</p>
        {s.surfaceExamples && s.surfaceExamples.length > 0 && (
          <div className="mt-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground-soft mb-1">Shows up in</div>
            <ul className="space-y-0.5">
              {s.surfaceExamples.map(ex => (
                <li key={ex} className="text-foreground/80 before:content-['—'] before:text-muted-foreground before:mr-1.5">
                  {ex}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 pt-2 border-t border-border/60 flex items-center justify-between text-[10px]">
          {s.homepage ? (
            <a href={s.homepage} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <ExternalLink className="w-2.5 h-2.5" />
              {new URL(s.homepage).hostname}
            </a>
          ) : <span />}
          <Link to="/provenance" className="text-muted-foreground hover:text-foreground">All sources →</Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Inline row of source badges — for "this view powered by X / Y / Z". */
export function SourceRow({ sources, label = "Sources" }: { sources: DataSourceSlug[]; label?: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {sources.map(slug => <SourceBadge key={slug} source={slug} />)}
    </div>
  );
}
