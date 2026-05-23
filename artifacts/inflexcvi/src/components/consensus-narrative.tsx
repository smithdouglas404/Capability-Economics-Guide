import { useEffect, useState } from "react";
import { GitCompare, ExternalLink, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

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
 * Prominent INLINE consensus narrative — promotes the "our number vs every
 * source we triangulated" story from a tooltip to a headline block. Renders
 * the per-source score grid + the disagreement callout always-visible, not
 * on hover. Sits on /capability/:id, /scorecard, /regulations detail.
 *
 * Different from <ConsensusView>: that's a click/hover trigger; this is the
 * full narrative as a card. Pair them — use the trigger inline on tables,
 * use this on the page that's actually about the score.
 */
export function ConsensusNarrative({
  capabilityId,
  precision = 0,
  suffix = "",
}: {
  capabilityId: number;
  precision?: number;
  suffix?: string;
}) {
  const [data, setData] = useState<ConsensusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/consensus/capability/${capabilityId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: ConsensusResponse | null) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [capabilityId]);

  if (loading) {
    return (
      <Card className="rounded-none border-border/60">
        <CardContent className="p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Loading consensus…</div>
        </CardContent>
      </Card>
    );
  }
  if (!data || data.sources.length === 0) return null;

  const ourScore = data.ourScore;
  const sortedSources = [...data.sources].sort((a, b) => {
    const da = ourScore !== null ? Math.abs(a.rawScore - ourScore) : 0;
    const db = ourScore !== null ? Math.abs(b.rawScore - ourScore) : 0;
    return db - da;
  });

  // Headline sentence: "We see {capName} at {our}. {disagreer} sees it at {their}."
  const lead = (() => {
    if (ourScore === null) return null;
    if (data.maxDisagreement >= 5 && data.mostDisagreeingSource) {
      const dis = data.sources.find(s => s.sourceLabel === data.mostDisagreeingSource);
      if (dis) {
        const verb = dis.rawScore > ourScore ? "higher" : "lower";
        const diff = Math.abs(dis.rawScore - ourScore);
        return `We score ${data.capabilityName} at ${ourScore.toFixed(precision)}${suffix}. ${dis.sourceLabel} is ${diff.toFixed(1)}${suffix} ${verb}.`;
      }
    }
    return `Our score for ${data.capabilityName}: ${ourScore.toFixed(precision)}${suffix}, triangulated from ${data.sources.length} sources within ${(data.maxDisagreement).toFixed(1)}${suffix} of each other.`;
  })();

  return (
    <Card className="rounded-none border-border/60">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Model vs sources
          </span>
        </div>

        {/* Lead sentence — the headline story */}
        {lead && (
          <p className="text-base font-serif leading-snug text-foreground">{lead}</p>
        )}

        {/* Our number prominently + CI */}
        <div className="flex items-baseline gap-6 pt-1 border-t border-border/40">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Our consensus</div>
            <div className="font-mono text-3xl tabular-nums font-bold">{ourScore !== null ? `${ourScore.toFixed(precision)}${suffix}` : "—"}</div>
            {data.ourCiLow !== null && data.ourCiHigh !== null && (
              <div className="font-mono text-[10px] text-muted-foreground mt-1">
                95% CI [{data.ourCiLow.toFixed(precision)}, {data.ourCiHigh.toFixed(precision)}]{suffix}
                {data.ourConfidence !== null && <span className="ml-2">conf {Math.round(data.ourConfidence * 100)}%</span>}
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
              Sources sorted by divergence from ours
            </div>
            <ul className="space-y-1">
              {sortedSources.map((s, i) => {
                const diff = ourScore !== null ? s.rawScore - ourScore : 0;
                const sign = diff > 0 ? "+" : "";
                const isMaxDisagreement = data.mostDisagreeingSource === s.sourceLabel;
                return (
                  <li
                    key={i}
                    className={`flex items-baseline justify-between gap-2 text-xs py-1 ${
                      isMaxDisagreement ? "text-amber-600 dark:text-amber-400 font-medium" : ""
                    }`}
                    title={s.methodology}
                  >
                    <span className="truncate flex-1">{s.sourceLabel}</span>
                    <span className="font-mono tabular-nums whitespace-nowrap">
                      {s.rawScore.toFixed(precision)}{suffix}
                      {ourScore !== null && (
                        <span className="text-muted-foreground ml-1.5">({sign}{diff.toFixed(1)})</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Citation deep-link */}
        {data.sources[0]?.citations[0] && (
          <a
            href={data.sources[0].citations[0]}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline pt-1"
          >
            Open primary source
            <ExternalLink className="w-3 h-3" />
            <ArrowRight className="w-3 h-3 -ml-0.5 opacity-60" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}
