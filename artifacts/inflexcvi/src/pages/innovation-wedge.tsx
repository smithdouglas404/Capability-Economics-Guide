import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Loader2, Zap, Target, TrendingUp, Lightbulb } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const API_BASE = "/api";

interface DvxResp {
  capabilityId?: number;
  industryId?: number;
  disruptionScore: number | null;
  velocity?: number;
  monthsToDisplacement?: number | null;
  topDisruptors?: string[];
  matchedPatternSlug?: string | null;
  rationale?: string;
  matchedPattern?: {
    slug: string;
    title: string;
    headline: string;
    disruptorCompany: string;
    narrative: string;
    whatToLookFor: string[];
    crossIndustryAnalogues: string[];
  } | null;
}

interface CapResp {
  id: number;
  name: string;
  industryId: number;
  description: string;
}

/**
 * Innovation Wedge — landed from clicking a "top disruptor" on the
 * capability detail page DVX zone. Shows the disruptor framed as the
 * opportunity it represents: what it could displace, the matched
 * disruption pattern, the recommended action.
 *
 * Phase 1 v1 reads the parent capability's DVX row to extract the
 * disruptor list + matched pattern + rationale. Phase 2 (future) will
 * resolve disruptor → its own capability row if one exists, showing
 * the disruptor's own CVI score and projected growth.
 */
export default function InnovationWedgePage() {
  const params = useParams<{ capabilityId: string; disruptorSlug: string }>();
  const capabilityId = Number(params.capabilityId);
  const disruptorSlug = decodeURIComponent(params.disruptorSlug ?? "");

  const [cap, setCap] = useState<CapResp | null>(null);
  const [dvx, setDvx] = useState<DvxResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(capabilityId)) {
      setError("Invalid capability id");
      setLoading(false);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch(`${API_BASE}/capabilities/${capabilityId}`).then(r => r.ok ? r.json() : null),
      fetch(`${API_BASE}/capabilities/${capabilityId}/dvx`).then(r => r.ok ? r.json() : null),
    ])
      .then(([capJson, dvxJson]) => {
        if (cancelled) return;
        setCap(capJson);
        setDvx(dvxJson);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [capabilityId]);

  // Restore the human-readable disruptor name from the slug if possible by
  // matching against the dvx topDisruptors list.
  const disruptor = dvx?.topDisruptors?.find(d =>
    d.toLowerCase().replace(/[^a-z0-9]+/g, "-") === disruptorSlug
  ) ?? disruptorSlug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading innovation wedge…
        </div>
      </div>
    );
  }

  if (error || !cap) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Link href="/explore" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to explore
        </Link>
        <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-4 py-3 text-sm font-mono">
          {error ?? "Capability not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
      <Link href={`/capability/${capabilityId}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to {cap.name}
      </Link>

      <div className="border-l-4 border-violet-500 pl-4 py-2">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-violet-600">Innovation Wedge</div>
        <h1 className="font-serif text-3xl tracking-tight mt-1">{disruptor}</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Identified by the Inflexcvi research agent as a potential disruptor of <Link href={`/capability/${capabilityId}`} className="font-medium text-foreground hover:underline">{cap.name}</Link>.
        </p>
      </div>

      {/* Disruption thesis */}
      <Card className="rounded-none">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-violet-500" />
            <h2 className="font-serif text-xl tracking-tight">Disruption thesis</h2>
          </div>
          {dvx?.rationale ? (
            <p className="text-sm leading-relaxed">{dvx.rationale}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No agent rationale yet — wait for the next research cycle.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Target DVX</div>
              <div className="font-mono text-2xl tabular-nums">{dvx?.disruptionScore != null ? `${dvx.disruptionScore.toFixed(0)}/100` : "—"}</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Months to displacement</div>
              <div className="font-mono text-2xl tabular-nums">{dvx?.monthsToDisplacement ?? "—"}</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Velocity of risk</div>
              <div className="font-mono text-2xl tabular-nums">{dvx?.velocity != null ? `${dvx.velocity > 0 ? "+" : ""}${dvx.velocity.toFixed(1)}` : "—"}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pattern match */}
      {dvx?.matchedPattern && (
        <Card className="rounded-none">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-violet-500" />
              <h2 className="font-serif text-xl tracking-tight">Pattern match</h2>
              <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-[0.12em]">
                {dvx.matchedPattern.slug}
              </Badge>
            </div>
            <div>
              <div className="text-base font-medium">{dvx.matchedPattern.title}</div>
              <div className="text-sm text-muted-foreground mt-1">{dvx.matchedPattern.headline}</div>
            </div>
            <div className="prose prose-sm max-w-none text-sm">
              <p>{dvx.matchedPattern.narrative}</p>
            </div>
            {dvx.matchedPattern.whatToLookFor && dvx.matchedPattern.whatToLookFor.length > 0 && (
              <div className="border-t border-border pt-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">What to look for</div>
                <ul className="list-disc ml-5 text-sm space-y-1">
                  {dvx.matchedPattern.whatToLookFor.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {dvx.matchedPattern.crossIndustryAnalogues && dvx.matchedPattern.crossIndustryAnalogues.length > 0 && (
              <div className="border-t border-border pt-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Cross-industry analogues</div>
                <div className="flex flex-wrap gap-2">
                  {dvx.matchedPattern.crossIndustryAnalogues.map((a, i) => (
                    <Badge key={i} variant="outline" className="rounded-none text-xs">{a}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Other disruptors threatening the same capability */}
      {dvx?.topDisruptors && dvx.topDisruptors.length > 1 && (
        <Card className="rounded-none">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-violet-500" />
              <h2 className="font-serif text-xl tracking-tight">Other disruptors of {cap.name}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {dvx.topDisruptors
                .filter(d => d.toLowerCase().replace(/[^a-z0-9]+/g, "-") !== disruptorSlug)
                .map(d => (
                  <Link
                    key={d}
                    href={`/innovation/${capabilityId}/disruptor/${encodeURIComponent(d.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`}
                    className="px-3 py-1.5 border border-border hover:border-violet-500 hover:bg-violet-500/5 text-sm"
                  >
                    {d}
                  </Link>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-none border-violet-500/40 bg-violet-500/5">
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-violet-600" />
            <h2 className="font-serif text-xl tracking-tight">Recommended action</h2>
          </div>
          <p className="text-sm">
            {dvx?.disruptionScore != null && dvx.disruptionScore >= 70
              ? `Active threat. Build production-ready pilots in ${disruptor} within the next 12 months or identify a defensive M&A target.`
              : dvx?.disruptionScore != null && dvx.disruptionScore >= 30
              ? `Watch this space. Run a small bet on ${disruptor} to learn the technology before a 12-24 month decision window opens.`
              : `Low immediate threat. Track quarterly; revisit if velocity of risk turns positive.`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
