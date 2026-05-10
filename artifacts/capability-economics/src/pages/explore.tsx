import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Lock, TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { MobileNotice } from "@/components/mobile";
const API_BASE = "/api";

interface ExploreCap {
  id: number;
  slug: string;
  name: string;
  description: string;
  industry: { id: number; name: string; slug: string };
  score: number;
  ciLow: number | null;
  ciHigh: number | null;
  velocity: number | null;
  sourceCount: number;
  lastUpdatedAt: string | null;
  sampleMetrics: Array<{ name: string; unit: string; benchmarkValue: number | null }>;
}

export default function ExplorePage() {
  const [caps, setCaps] = useState<ExploreCap[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/explore/capabilities`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { capabilities: ExploreCap[] }) => setCaps(d.capabilities))
      .catch(e => setErr(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  return (
    <div className="min-h-[calc(100dvh-64px)] bg-background">
      <MobileNotice />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-24">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to home
        </Link>

        <div className="flex items-center gap-2 mb-3">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            Public preview
          </Badge>
          <Badge variant="secondary" className="text-[10px]">No login required</Badge>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Browse a sample of capabilities we track
        </h1>
        <p className="mt-3 text-base text-muted-foreground max-w-3xl leading-relaxed">
          A curated set of capabilities, fully open. Each one shows the live
          consensus score, the 95% credible interval from our Bayesian
          triangulation engine, source count, and a couple of representative
          metrics. The full library covers hundreds more across {" "}
          <Link href="/coverage" className="text-primary hover:underline">7+ industries</Link>{" "}
          for members.
        </p>

        {err && (
          <Card className="mt-8 border-rose-500/40 bg-rose-500/5">
            <CardContent className="p-4 text-sm text-rose-500">{err}</CardContent>
          </Card>
        )}

        {!err && caps !== null && caps.length === 0 && (
          <Card className="mt-8">
            <CardContent className="p-6 text-sm text-muted-foreground text-center">
              <Sparkles className="w-5 h-5 mx-auto mb-2 opacity-60" />
              No capabilities are currently flagged for public preview. Check back soon.
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          {caps?.map(cap => {
            const VIcon = cap.velocity == null
              ? Minus
              : cap.velocity > 0.5 ? TrendingUp
              : cap.velocity < -0.5 ? TrendingDown
              : Minus;
            const vColor = cap.velocity == null
              ? "text-muted-foreground"
              : cap.velocity > 0.5 ? "text-emerald-500"
              : cap.velocity < -0.5 ? "text-rose-500"
              : "text-muted-foreground";
            return (
              <Card key={cap.id} className="rounded-md hover:border-primary/40 transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <Badge variant="outline" className="text-[10px] mb-2">
                        {cap.industry.name}
                      </Badge>
                      <h3 className="text-base font-semibold leading-tight">{cap.name}</h3>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-2xl font-semibold tabular-nums leading-none">
                        {cap.score.toFixed(1)}
                      </div>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <VIcon className={`w-3 h-3 ${vColor}`} />
                        {cap.ciLow !== null && cap.ciHigh !== null && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            ±{((cap.ciHigh - cap.ciLow) / 2).toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug line-clamp-3">
                    {cap.description}
                  </p>
                  {cap.sampleMetrics.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/40">
                      {cap.sampleMetrics.map((m, i) => (
                        <div key={i}>
                          <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">
                            {m.name}
                          </div>
                          <div className="text-xs font-mono tabular-nums">
                            {m.benchmarkValue !== null
                              ? `${m.benchmarkValue.toFixed(1)} ${m.unit}`
                              : <span className="opacity-50">no benchmark</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {cap.sourceCount} sources ·{" "}
                      {cap.lastUpdatedAt ? new Date(cap.lastUpdatedAt).toLocaleDateString() : "—"}
                    </div>
                    <Link href={`/cei?capability=${cap.id}`}>
                      <Button size="sm" variant="ghost" className="text-[11px] h-7 gap-1">
                        See full data
                        <Lock className="w-3 h-3" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {caps && caps.length > 0 && (
          <Card className="mt-8 border-primary/30 bg-primary/[0.03]">
            <CardContent className="p-5 flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="text-sm font-semibold">Want the full library?</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Members access all capabilities, full triangulation evidence, scenario
                  modelling, and the embeddable widgets.
                </div>
              </div>
              <Link href="/membership">
                <Button size="sm" className="gap-1.5">
                  Apply for membership
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
