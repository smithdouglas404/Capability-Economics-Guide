import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LifecycleChip } from "@/components/lifecycle-chip";

type LifecycleStage = "emerging" | "adopted" | "mature" | "decaying" | "obsolete";
const STAGE_ORDER: LifecycleStage[] = ["emerging", "adopted", "mature", "decaying", "obsolete"];

/**
 * Standalone documentation page for capability lifecycle stages.
 * Linked from the Scorecard legend, the CVI Dashboard tooltip, and the
 * Knowledge Graph capability detail header.
 */
export default function LifecycleDocs() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl space-y-8">
      <header>
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Methodology</span>
        </div>
        <h1 className="text-3xl font-serif tracking-tight">Capability Lifecycle Stages</h1>
        <p className="text-muted-foreground text-sm mt-2 max-w-2xl">
          Every capability in the platform is tagged with a five-value lifecycle stage so an analyst can read
          the state of a capability at a glance — without parsing the underlying score and velocity numbers.
        </p>
      </header>

      <LifecycleStageCountsPanel />

      <Card>
        <CardHeader><CardTitle className="font-serif tracking-tight text-lg">How the stage is computed</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>
            The stage is derived on every read from two posterior fields the CVI engine already maintains:
            the Bayesian <strong>consensus score</strong> (0–100) and the EMA-smoothed <strong>velocity</strong> (−0.5 to +0.5).
            It is never persisted, so it can never go stale: the moment the next triangulation lands, the stage
            reflects it.
          </p>
          <p>
            When a capability has no triangulation evidence yet, the seeded <code>benchmarkScore</code> is used
            as the fallback consensus and velocity is treated as zero — yielding a sensible default stage
            instead of a blank label.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-serif tracking-tight text-lg">The five stages</CardTitle></CardHeader>
        <CardContent className="space-y-5 text-sm">
          <Row stage="emerging">
            <strong>Score &lt; 40</strong> AND <strong>velocity ≥ +0.03</strong>. Low maturity but climbing fast — early
            adopters are investing and scores are rising rapidly. Expect mainstream adoption within the next
            few quarters.
          </Row>
          <Row stage="adopted">
            Anything that doesn't qualify for one of the other stages. Mid-range maturity with positive or
            neutral momentum — mainstream adoption is underway but the capability hasn't reached table-stakes
            level yet.
          </Row>
          <Row stage="mature">
            <strong>Score ≥ 65</strong> AND <strong>|velocity| &lt; 0.015</strong>. Table stakes. Most leaders already
            operate at this level and the score is no longer moving meaningfully.
          </Row>
          <Row stage="decaying">
            <strong>velocity ≤ −0.03</strong> at any score. Sustained downward drift in the EMA-smoothed score —
            the industry is collectively de-prioritising or replacing this capability.
          </Row>
          <Row stage="obsolete">
            <strong>Score &lt; 30</strong> AND <strong>velocity ≤ −0.03</strong>. Low score AND falling. The capability is
            being actively abandoned. Checked before "decaying" so a freefall isn't mislabelled as a routine
            slowdown.
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-serif tracking-tight text-lg">Where stages appear</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <ul className="list-disc list-inside space-y-1">
            <li>Capability Scorecard — chip on every row, with a stage filter dropdown and a stage-sort column.</li>
            <li>CVI Dashboard — chip in the freshness tables (Most Recently Refreshed, Stalest in Queue).</li>
            <li>Knowledge Graph — chip next to each capability detail page title.</li>
            <li>Every capability API surface (<code>/api/capabilities</code>, <code>/api/capabilities/:id</code>,
              <code> /api/industries/:id</code>, <code>/api/cvi/components</code>, <code>/api/cvi/freshness</code>,
              <code> /api/war-room/compare</code>) emits <code>lifecycleStage</code> on each cap row.</li>
          </ul>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Out of scope for the v1 lifecycle field: per-organisation stages (each org's own maturity vs the
        industry baseline) and predictive transitions (forecasting when a stage is likely to change).
      </p>
    </div>
  );
}

/**
 * Live "capabilities by lifecycle stage today" panel. Fetches /api/capabilities
 * (which already enriches every row with a derived lifecycleStage) and rolls up
 * the per-stage counts. Re-runs on mount so the page always reflects the
 * current corpus.
 */
function LifecycleStageCountsPanel() {
  const [counts, setCounts] = useState<Record<LifecycleStage, number> | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/capabilities");
        if (!r.ok) throw new Error("fetch failed");
        const caps = await r.json() as Array<{ lifecycleStage?: LifecycleStage }>;
        if (cancelled) return;
        const next: Record<LifecycleStage, number> = { emerging: 0, adopted: 0, mature: 0, decaying: 0, obsolete: 0 };
        for (const c of caps) {
          const s = c.lifecycleStage ?? "adopted";
          if (s in next) next[s as LifecycleStage]++;
        }
        setCounts(next);
        setTotal(caps.length);
      } catch { if (!cancelled) setError(true); }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card>
      <CardHeader><CardTitle className="font-serif tracking-tight text-lg">Capabilities by lifecycle stage today</CardTitle></CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-muted-foreground italic">Live counts unavailable.</p>
        ) : !counts ? (
          <p className="text-sm text-muted-foreground italic animate-pulse">Loading live counts…</p>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground italic">No capabilities in the corpus yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {STAGE_ORDER.map(stage => {
                const n = counts[stage];
                const pct = total > 0 ? Math.round((n / total) * 100) : 0;
                return (
                  <div key={stage} className="border border-border/40 p-3">
                    <LifecycleChip stage={stage} />
                    <div className="font-mono text-2xl tabular-nums mt-2">{n}</div>
                    <div className="text-[11px] text-muted-foreground">{pct}% of {total}</div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {STAGE_ORDER.map(s => `${counts[s]} ${s}`).join(", ")} — across {total} live capabilities.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ stage, children }: { stage: "emerging" | "adopted" | "mature" | "decaying" | "obsolete"; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="pt-0.5 w-24 shrink-0"><LifecycleChip stage={stage} /></div>
      <p className="text-foreground/90 leading-relaxed">{children}</p>
    </div>
  );
}
