import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Sparkles, TrendingUp, TrendingDown, Zap } from "lucide-react";

interface SynthesisBrief {
  brief: string;
  keyFindings: string[];
  crossAgentInsights: string[];
  generatedAt: string;
}

interface ShiftRow {
  subject: string;
  predicate: string;
  object: string;
  trend: string;
  signalStrength: number;
}

interface TemporalShifts {
  accelerating?: ShiftRow[];
  reversing?: ShiftRow[];
  generatedAt?: string;
  summary?: string;
}

interface BriefResponse {
  available: boolean;
  message?: string;
  synthesis?: SynthesisBrief | null;
  temporalShifts?: TemporalShifts | null;
}

const fmtTime = (iso: string | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hours = Math.floor((Date.now() - d.getTime()) / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export function SynthesisBriefButton() {
  const [data, setData] = useState<BriefResponse | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/synthesis/brief?_=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BriefResponse | null) => setData(d))
      .catch(() => {});
  }, []);

  const synthesis = data?.synthesis ?? null;
  const briefAge = fmtTime(synthesis?.generatedAt);
  const temporalShifts = data?.temporalShifts ?? null;
  const hasContent = data?.available && synthesis;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-accent/40 bg-accent/5 hover:border-accent hover:bg-accent/10 transition-colors text-xs font-mono uppercase tracking-[0.15em] text-accent rounded-none"
          data-testid="button-synthesis-brief"
        >
          <Sparkles className="w-3.5 h-3.5" />
          House view
          {briefAge && <span className="text-[10px] text-muted-foreground normal-case tracking-normal">· {briefAge}</span>}
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-none">
        <DialogHeader className="pb-2 border-b border-border/60">
          <DialogTitle className="font-serif text-2xl flex items-center gap-2.5 leading-tight">
            <Sparkles className="w-5 h-5 text-accent flex-shrink-0" />
            House view
          </DialogTitle>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            A daily strategic brief composed by the Synthesis Agent from macro-event,
            disruption, peer-coop, stack-optimizer, and ontology digests.
          </p>
        </DialogHeader>

        {!hasContent ? (
          <div className="py-10 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Brief not ready yet
            </p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {data?.message ??
                "The Synthesis Agent runs daily and combines findings from all 5 specialized agents. Check back shortly."}
            </p>
          </div>
        ) : (
          <div className="space-y-5 pt-4">
            {/* Headline brief paragraph */}
            <section>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
                  Strategic brief
                </span>
                {briefAge && (
                  <Badge variant="outline" className="rounded-none text-[10px] font-mono">
                    {briefAge}
                  </Badge>
                )}
              </div>
              <p className="font-serif text-base leading-relaxed whitespace-pre-line text-foreground">
                {synthesis.brief}
              </p>
            </section>

            {/* Key findings — numbered list with strong visual hierarchy */}
            {synthesis.keyFindings && synthesis.keyFindings.length > 0 && (
              <section>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent mb-3">
                  Key findings
                </div>
                <ol className="space-y-3">
                  {synthesis.keyFindings.map((f, i) => (
                    <li key={i} className="grid grid-cols-[28px_1fr] gap-3 pb-3 border-b border-border/30 last:border-b-0">
                      <span className="font-mono text-[10px] tabular-nums tracking-[0.18em] text-muted-foreground/70 pt-1">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="text-sm leading-relaxed text-foreground/90">{f}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* Cross-agent insights — italic pullquotes */}
            {synthesis.crossAgentInsights && synthesis.crossAgentInsights.length > 0 && (
              <section>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent mb-3">
                  Cross-agent insights
                </div>
                <ul className="space-y-2.5">
                  {synthesis.crossAgentInsights.map((c, i) => (
                    <li
                      key={i}
                      className="text-sm leading-relaxed text-foreground/80 italic border-l-2 border-accent/60 pl-4 py-1"
                    >
                      {c}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Temporal shifts */}
            {temporalShifts &&
              ((temporalShifts.accelerating?.length ?? 0) > 0 ||
                (temporalShifts.reversing?.length ?? 0) > 0) && (
                <section>
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent mb-3">
                    Temporal shifts · last 30 days
                  </div>
                  <div className="grid gap-3">
                    {(temporalShifts.accelerating ?? []).slice(0, 3).map((row, i) => (
                      <div key={`a-${i}`} className="flex items-start gap-2 text-xs">
                        <TrendingUp className="w-3.5 h-3.5 mt-0.5 text-emerald-600 flex-shrink-0" />
                        <div className="leading-relaxed">
                          <span className="font-medium">{row.subject}</span>
                          <span className="text-muted-foreground"> {row.predicate} </span>
                          <span className="font-medium">{row.object}</span>
                          {row.trend && <span className="text-muted-foreground italic"> — {row.trend}</span>}
                        </div>
                      </div>
                    ))}
                    {(temporalShifts.reversing ?? []).slice(0, 3).map((row, i) => (
                      <div key={`r-${i}`} className="flex items-start gap-2 text-xs">
                        <TrendingDown className="w-3.5 h-3.5 mt-0.5 text-rose-500 flex-shrink-0" />
                        <div className="leading-relaxed">
                          <span className="font-medium">{row.subject}</span>
                          <span className="text-muted-foreground"> {row.predicate} </span>
                          <span className="font-medium">{row.object}</span>
                          {row.trend && <span className="text-muted-foreground italic"> — {row.trend}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

            <p className="text-[10px] text-muted-foreground/60 pt-2 border-t border-border/30 leading-relaxed">
              <Zap className="w-3 h-3 inline mr-1" />
              Brief is regenerated daily. Every recommendation across the platform is grounded against it.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
