import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ChevronDown, ChevronRight, TrendingUp, TrendingDown, Zap } from "lucide-react";
import { LiveBacktestBadge } from "@/components/live-backtest-badge";

interface SynthesisBrief {
  brief: string;
  keyFindings: string[];
  crossAgentInsights: string[];
  generatedAt: string;
  cachedAt: string;
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
  cachedAt: string;
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
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

/**
 * Renders the Synthesis Agent's daily cross-agent strategic brief +
 * the temporal-shift detector's accelerating/reversing-relationship
 * report. Both are written to kv_cache by their respective agents;
 * this surfaces them on any page that drops it in.
 *
 * Quiet failure: if the brief hasn't been generated yet (e.g., fresh
 * deploy in the 5-minute warm-up window), shows a muted placeholder.
 */
export function SynthesisBriefCard({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!compact);

  useEffect(() => {
    fetch("/api/synthesis/brief")
      .then((r) => r.json())
      .then((d: BriefResponse) => setData(d))
      .catch(() => setData({ available: false, message: "Unable to reach synthesis brief endpoint." }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!data?.available || !data.synthesis) {
    // Friendly placeholder instead of silent hide — tells the user the
    // platform is actively composing a view rather than just leaving a
    // suspicious gap on the page.
    return (
      <Card className="rounded-none border-l-2 border-l-accent/40 bg-muted/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-serif flex items-center gap-2 text-muted-foreground">
            <Sparkles className="w-3.5 h-3.5" />
            House view — synthesis warming up
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The Synthesis Agent composes a cross-agent strategic brief from the
            five specialized agents (macro-event, disruption, peer-coop, stack-optimizer,
            ontology). The first brief lands ~5 minutes after a fresh deploy and is
            refreshed daily as the upstream agents complete their cycles. Once
            available, every page on the platform surfaces the brief here as
            the house view.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { synthesis, temporalShifts } = data;
  const briefAge = fmtTime(synthesis?.generatedAt);
  const tsAge = fmtTime(temporalShifts?.generatedAt);

  return (
    <Card className="rounded-none border-l-2 border-l-accent">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <CardTitle className="text-base font-serif flex items-center gap-2 flex-wrap">
              <Sparkles className="w-4 h-4 text-accent" />
              House view — synthesis from all 5 agents
              <LiveBacktestBadge variant="compact" />
            </CardTitle>
            <CardDescription className="text-xs">
              Cross-agent strategic brief composed daily by the Synthesis Agent from macro-event, disruption, peer-coop, stack-optimizer, and ontology digests. Grounds every recommendation across the platform.
            </CardDescription>
          </div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            aria-label={expanded ? "Collapse synthesis brief" : "Expand synthesis brief"}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </CardHeader>
      {expanded && synthesis && (
        <CardContent className="space-y-4">
          {/* Headline narrative */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Strategic brief</span>
              {briefAge && (
                <Badge variant="outline" className="rounded-none text-[10px] font-mono">
                  {briefAge}
                </Badge>
              )}
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-line">{synthesis.brief}</p>
          </div>

          {/* Key findings */}
          {synthesis.keyFindings && synthesis.keyFindings.length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Key findings
              </div>
              <ul className="space-y-1.5 text-sm">
                {synthesis.keyFindings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Zap className="w-3.5 h-3.5 mt-0.5 text-accent flex-shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cross-agent insights */}
          {synthesis.crossAgentInsights && synthesis.crossAgentInsights.length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                Cross-agent insights
              </div>
              <ul className="space-y-1.5 text-sm">
                {synthesis.crossAgentInsights.map((c, i) => (
                  <li key={i} className="text-foreground/80 italic border-l-2 border-border pl-3">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Temporal shifts — accelerating + reversing */}
          {temporalShifts && (temporalShifts.accelerating?.length || temporalShifts.reversing?.length) ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Temporal shifts — last 30 days
                </span>
                {tsAge && (
                  <Badge variant="outline" className="rounded-none text-[10px] font-mono">
                    {tsAge}
                  </Badge>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {temporalShifts.accelerating && temporalShifts.accelerating.length > 0 && (
                  <div className="border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
                    <div className="flex items-center gap-1.5 mb-1.5 text-emerald-700 dark:text-emerald-400">
                      <TrendingUp className="w-3.5 h-3.5" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">Accelerating</span>
                    </div>
                    <ul className="space-y-1 text-xs">
                      {temporalShifts.accelerating.slice(0, 5).map((s, i) => (
                        <li key={i} className="truncate">
                          <span className="font-medium">{s.subject}</span>{" "}
                          <span className="text-muted-foreground">{s.predicate}</span>{" "}
                          <span className="font-medium">{s.object}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {temporalShifts.reversing && temporalShifts.reversing.length > 0 && (
                  <div className="border border-amber-500/20 bg-amber-500/[0.04] p-3">
                    <div className="flex items-center gap-1.5 mb-1.5 text-amber-700 dark:text-amber-400">
                      <TrendingDown className="w-3.5 h-3.5" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">Reversing</span>
                    </div>
                    <ul className="space-y-1 text-xs">
                      {temporalShifts.reversing.slice(0, 5).map((s, i) => (
                        <li key={i} className="truncate">
                          <span className="font-medium">{s.subject}</span>{" "}
                          <span className="text-muted-foreground">{s.predicate}</span>{" "}
                          <span className="font-medium">{s.object}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}
