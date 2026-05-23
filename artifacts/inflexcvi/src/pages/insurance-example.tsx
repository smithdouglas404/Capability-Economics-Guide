import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Activity, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * /insurance-example — was a redirect-only stub to /case-study/insurance.
 * Now renders a live snapshot card on top (CVI score for the industry +
 * top-3 capabilities by 3-year EVaR exposure) so the marketing URL feels
 * grounded in real data instead of bouncing the user. The CTA at the
 * bottom carries them into the full case study.
 *
 * Industry id: 1 = insurance, 2 = healthcare. We try insurance first and
 * fall back to healthcare if the EVaR query returns no eligible rows.
 */

interface CviCurrent {
  overallIndex: number;
  industryBreakdowns?: Record<string, { industryName: string; indexValue: number; capabilityCount: number }>;
}

interface EvarItem {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  evar36: number;
  bandPct: number;
}

interface EvarResponse {
  items: EvarItem[];
  totals?: { totalEvar36: number; count: number };
}

const TARGET_INDUSTRY_IDS = [1, 2] as const; // insurance, healthcare

export default function InsuranceExample() {
  const [cvi, setCvi] = useState<CviCurrent | null>(null);
  const [evar, setEvar] = useState<EvarItem[] | null>(null);
  const [industryName, setIndustryName] = useState<string>("Insurance");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cviRes = await fetch("/api/cvi/current");
        const cviData = (cviRes.ok ? await cviRes.json() : null) as CviCurrent | null;
        if (!cancelled && cviData) setCvi(cviData);

        // Try insurance first, then healthcare. Whichever has rows wins.
        for (const id of TARGET_INDUSTRY_IDS) {
          const res = await fetch(`/api/alpha/evar?industryId=${id}`);
          if (!res.ok) continue;
          const data = (await res.json()) as EvarResponse | null;
          const items = data?.items ?? [];
          if (items.length > 0) {
            if (cancelled) return;
            setEvar(items.slice(0, 3));
            setIndustryName(items[0].industryName || (id === 1 ? "Insurance" : "Healthcare"));
            break;
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const industryBreakdown = cvi?.industryBreakdowns
    ? Object.values(cvi.industryBreakdowns).find(
        b => b.industryName.toLowerCase().includes(industryName.toLowerCase())
      )
    : null;
  const headlineScore = industryBreakdown?.indexValue ?? cvi?.overallIndex ?? null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-16 space-y-8">
        <div>
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider mb-3">
            Live snapshot · {industryName}
          </Badge>
          <h1 className="font-serif text-4xl lg:text-5xl tracking-tight leading-tight mb-3">
            {industryName} — capability exposure snapshot
          </h1>
          <p className="text-base text-muted-foreground max-w-2xl">
            A live read of the {industryName.toLowerCase()} industry's current CVI score and the three
            capabilities carrying the most 3-year economic value at risk (EVaR).
          </p>
        </div>

        {loading ? (
          <Card>
            <CardContent className="py-10 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading live {industryName.toLowerCase()} snapshot…
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
            {/* CVI score tile */}
            <Card className="border-accent/30 bg-accent/[0.04]">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-3.5 h-3.5 text-accent" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
                    {industryBreakdown ? `${industryName} CVI` : "Overall CVI"}
                  </span>
                </div>
                <div className="font-mono text-5xl tabular-nums leading-none">
                  {headlineScore !== null ? headlineScore.toFixed(1) : "—"}
                </div>
                {industryBreakdown && (
                  <div className="text-[11px] text-muted-foreground mt-2">
                    {industryBreakdown.capabilityCount} capabilities tracked
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top-3 EVaR tile */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Top capabilities by 3-year EVaR
                  </span>
                </div>
                {evar && evar.length > 0 ? (
                  <ol className="space-y-2">
                    {evar.map((row, i) => (
                      <li key={row.capabilityId} className="flex items-center justify-between gap-3 py-1.5 border-t border-border/40 first:border-t-0">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono text-[10px] tabular-nums text-muted-foreground w-4">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="text-sm truncate">{row.capabilityName}</span>
                        </div>
                        <span className="font-mono text-sm tabular-nums text-rose-500 shrink-0">
                          ${row.evar36.toFixed(1)}M
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-sm text-muted-foreground py-4">
                    No EVaR-eligible capabilities yet in this industry.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Link
          href="/case-study/insurance"
          className="inline-flex items-center gap-2 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] bg-foreground text-background hover:bg-foreground/90 transition-colors"
        >
          Read the full {industryName.toLowerCase()} case study
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
