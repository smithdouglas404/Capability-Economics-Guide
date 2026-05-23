import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ExternalLink } from "lucide-react";

interface Props {
  article: string | null;
  evidenceNotes: string | null;
  sourceUrl?: string | null;
}

/**
 * Hoverable provenance for a regulation requirement. Shows the article
 * citation as plain text; the tooltip surfaces the evidence_notes and an
 * external source link when present.
 */
export function RequirementProvenanceTooltip({ article, evidenceNotes, sourceUrl }: Props) {
  if (!article) return null;

  // No tooltip if there's nothing extra to show — just render the article string.
  if (!evidenceNotes && !sourceUrl) {
    return <span className="text-xs text-muted-foreground">{article}</span>;
  }

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            {article}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-md text-sm leading-relaxed">
          {evidenceNotes && <p>{evidenceNotes}</p>}
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open source
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
