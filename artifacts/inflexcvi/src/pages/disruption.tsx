import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Activity,
  Zap,
  TrendingUp,
  Sparkles,
  Loader2,
  Lightbulb,
  History,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonaDescription } from "@/components/page-header";
import { SynthesisBriefCard } from "@/components/synthesis-brief-card";
import { DvxHero } from "@/components/dvx-hero";
import { ConsensusView } from "@/components/consensus-view";

const API_BASE = "/api";

type Band = "low" | "moderate" | "high" | "critical";

interface WatchEntry {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  probability: number;
  band: Band;
  velocity: number | null;
  consensusScore: number | null;
  lifecycleStage: string;
  topDrivers: string[];
  ageMonths: number;
  macroEventCount: number;
  vcCapitalUsd: number;
  startupCount: number;
}

interface WatchResult {
  generatedAt: string;
  rows: WatchEntry[];
  filters: { minBand: Band; minVelocity: number; requireMacroEvent: boolean; maxAgeMonths: number };
}

interface NewCapEntry {
  capabilityId: number;
  capabilityName: string;
  capabilityDescription: string;
  industryId: number;
  industryName: string;
  consensusScore: number | null;
  velocity: number | null;
  lifecycleStage: string;
  ageMonths: number;
  createdAt: string;
  vcCapitalUsd: number;
  startupCount: number;
  patentCount: number;
}

interface NewCapResult {
  generatedAt: string;
  rows: NewCapEntry[];
  filters: { maxAgeMonths: number; minScore: number };
}

const BAND_TONE: Record<Band, string> = {
  low: "bg-muted text-muted-foreground border-border/60",
  moderate: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  high: "bg-rose-500/15 text-rose-500 border-rose-500/40",
  critical: "bg-rose-600/20 text-rose-600 border-rose-600/40",
};

const LIFECYCLE_TONE: Record<string, string> = {
  emerging: "bg-violet-500/15 text-violet-500 border-violet-500/40",
  adopted: "bg-sky-500/15 text-sky-500 border-sky-500/40",
  mature: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  decaying: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  obsolete: "bg-rose-500/15 text-rose-500 border-rose-500/40",
};

interface HistoricalEntry {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  consensusScore: number;
  velocity: number;
  confidence: number;
  snapshotAt: string;
  triggeringMacroEvents: Array<{ id: number; title: string; severity: number; startedAt: string }>;
}

interface HistoricalResult {
  asOf: string;
  filters: { consensusBandThreshold: number; minVelocity: number };
  rows: HistoricalEntry[];
  outsideHistoryWindow: boolean;
}

type PlaybackOffset = 0 | 30 | 60 | 90;

const PLAYBACK_OPTIONS: { label: string; days: PlaybackOffset }[] = [
  { label: "Today", days: 0 },
  { label: "30d ago", days: 30 },
  { label: "60d ago", days: 60 },
  { label: "90d ago", days: 90 },
];

interface MacroEvent {
  id: number;
  title: string;
  description: string | null;
  severity: number;
  sentimentDirection: "positive" | "negative" | "neutral" | string;
  startedAt: string;
  affectedIndustryIds?: number[];
  industryId?: number | null;
}

export default function DisruptionPage() {
  const [watch, setWatch] = useState<WatchResult | null>(null);
  const [newCaps, setNewCaps] = useState<NewCapResult | null>(null);
  const [macroEvents, setMacroEvents] = useState<MacroEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackOffset>(0);
  const [historical, setHistorical] = useState<HistoricalResult | null>(null);
  const [historicalLoading, setHistoricalLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${API_BASE}/disruption/watch`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
      fetch(`${API_BASE}/capabilities/new?maxAgeMonths=24&minScore=30&limit=30`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
      fetch(`${API_BASE}/macro-events/active`).then(r => r.ok ? r.json() : { events: [] }).catch(() => ({ events: [] })),
    ])
      .then(([w, n, m]) => {
        if (cancelled) return;
        setWatch(w);
        setNewCaps(n);
        const evs = (m as { events?: MacroEvent[] }).events ?? [];
        // Top-severity first, take 5
        setMacroEvents([...evs].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0)).slice(0, 5));
      })
      .catch(e => { if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Fetch the historical snapshot whenever the playback offset changes.
  // playback=0 is "Today" — we already have `watch` for that, no fetch needed.
  useEffect(() => {
    if (playback === 0) { setHistorical(null); return; }
    let cancelled = false;
    setHistoricalLoading(true);
    const asOf = new Date(Date.now() - playback * 24 * 60 * 60 * 1000).toISOString();
    fetch(`${API_BASE}/disruption/watch/historical?asOf=${encodeURIComponent(asOf)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((h: HistoricalResult) => { if (!cancelled) setHistorical(h); })
      .catch(e => { if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load history"); })
      .finally(() => { if (!cancelled) setHistoricalLoading(false); });
    return () => { cancelled = true; };
  }, [playback]);

  // Diff: which capabilities are on the watch list today but were NOT on the
  // historical list (entered since `playback` days ago), and vice versa.
  const diff = useMemo(() => {
    if (playback === 0 || !historical || !watch) return null;
    const todaySet = new Set(watch.rows.map(r => r.capabilityId));
    const thenSet = new Set(historical.rows.map(r => r.capabilityId));
    const entered = watch.rows.filter(r => !thenSet.has(r.capabilityId));
    const exited = historical.rows.filter(r => !todaySet.has(r.capabilityId));
    return { entered, exited };
  }, [playback, historical, watch]);

  const industriesInPlay = useMemo(() => {
    const s = new Set<string>();
    for (const r of watch?.rows ?? []) s.add(r.industryName);
    return Array.from(s);
  }, [watch]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl space-y-8">
      <div>
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Home
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-5 h-5 text-rose-500" />
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">Disruption surface</Badge>
        </div>
        <h1 className="font-serif text-4xl tracking-tight">What's disrupting industries right now</h1>
        <p className="text-base text-muted-foreground mt-3 max-w-3xl leading-relaxed">
          Two feeds. Top: capabilities flagged for active disruption — high probability bands, rising velocity,
          recent macro events. Bottom: net-new capabilities that didn't exist 12-24 months ago and are already
          showing meaningful CVI. Drop any of these onto the{" "}
          <Link href="/workbench" className="text-primary hover:underline">Capability Workbench</Link> to ideate against them.
        </p>
        <PersonaDescription
          descriptions={{
            default: "Top feed is rising threats; bottom feed is brand-new capability categories. Click any row to see the underlying triggers.",
            pe: "Risk radar for portfolio cos. The high-probability disruption band on the top feed is where you should be pressure-testing your existing positions before next quarter's review.",
            vc: "Net-new capabilities (bottom feed) are the cleanest signal for fund-formation theses — capability categories younger than 24 months haven't had a winner picked yet.",
            f500: "If your industry sits on any row in the top feed, you have ≤18 months. The bottom feed is where to look for partnership targets or early-stage acquisitions.",
            student: "Worked example of how the system flags disruption — the probability bands and velocity metrics come from cited macro events. Read /methodology to see the model.",
            professor: "Real-time disruption dataset. The probability formula + macro-event link structure is documented; the bottom feed is a ready-made case bank for emerging-tech courses.",
          }}
          className="mt-3"
        />
      </div>

      {/* House view — cross-agent synthesis grounding for what follows below */}
      <SynthesisBriefCard compact />

      {/* Triggered-by panel — surfaces the 5 most-severe active macro events
          driving the disruption signals below. Without this, the watch + new-
          caps feeds look like opinion; this turns them into traceable
          consequences of named real-world events. */}
      {macroEvents.length > 0 && (
        <Card className="rounded-none border-l-2 border-l-rose-500">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-0.5">Triggered by</div>
                <div className="font-serif text-base">Top {macroEvents.length} active macro events driving the watch list</div>
              </div>
              <Link href="/cvi" className="text-xs text-primary hover:underline whitespace-nowrap">
                View all on CVI →
              </Link>
            </div>
            <ul className="space-y-1.5">
              {macroEvents.map(ev => (
                <li key={ev.id} className="flex items-start gap-3 text-sm">
                  <span
                    className={`mt-0.5 inline-flex items-center justify-center min-w-[1.75rem] h-5 px-1.5 rounded-none font-mono text-[10px] font-bold ${
                      ev.severity >= 7 ? "bg-rose-500/15 text-rose-600 border border-rose-500/40"
                        : ev.severity >= 4 ? "bg-amber-500/15 text-amber-600 border border-amber-500/40"
                        : "bg-muted text-muted-foreground border border-border"
                    }`}
                    title={`Severity ${ev.severity}/10`}
                  >
                    {ev.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium leading-tight">{ev.title}</div>
                    {ev.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1">{ev.description}</div>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap mt-1">
                    {ev.sentimentDirection === "negative" ? "↘" : ev.sentimentDirection === "positive" ? "↗" : "→"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Move 5: Disruption Index hero — surfaces the DVX score that was already
          computed but invisible. Lives above the existing watch/new-cap feeds. */}
      <DvxHero />

      {err && <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-4 py-3 text-sm">{err}</div>}
      {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

      {/* ─── Playback control ─── replay the watch list at 30 / 60 / 90 days ago.
          Server reads `cvi_capability_history` for the as-of snapshot and applies
          a simplified eligibility filter (consensusScore ≤ threshold + velocity).
          Diff card below summarises who entered / exited since then. */}
      <Card className="rounded-none border-l-2 border-l-violet-500">
        <CardContent className="py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-violet-500" />
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Playback</div>
                <div className="font-serif text-base">Time-travel the watch list</div>
              </div>
            </div>
            <div className="inline-flex rounded-none border border-border/60 overflow-hidden">
              {PLAYBACK_OPTIONS.map(opt => (
                <button
                  key={opt.days}
                  type="button"
                  onClick={() => setPlayback(opt.days)}
                  className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                    playback === opt.days
                      ? "bg-violet-500/15 text-violet-600 border-r border-border/60 last:border-r-0"
                      : "bg-background text-muted-foreground hover:text-foreground border-r border-border/60 last:border-r-0"
                  }`}
                  aria-pressed={playback === opt.days}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {playback !== 0 && (
            <div className="mt-3 pt-3 border-t border-border/40">
              {historicalLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> Replaying watch list as of {playback}d ago…
                </div>
              )}
              {!historicalLoading && historical?.outsideHistoryWindow && (
                <div className="text-xs text-muted-foreground italic">
                  No capability-history snapshots available {playback} days ago — the rotation hasn't backfilled that far yet.
                </div>
              )}
              {!historicalLoading && historical && !historical.outsideHistoryWindow && diff && (
                <div className="space-y-2">
                  <div className="font-mono text-[11px] text-muted-foreground">
                    Since {playback}d ago:
                    {" "}
                    <span className="text-emerald-600">{diff.entered.length} entered</span>
                    {" · "}
                    <span className="text-amber-600">{diff.exited.length} exited</span>
                    {" · "}
                    <span>{historical.rows.length} on watch then vs {watch?.rows.length ?? 0} now</span>
                  </div>
                  {(diff.entered.length > 0 || diff.exited.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {diff.entered.length > 0 && (
                        <div className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-600 mb-1.5">
                            <ArrowUpRight className="w-3 h-3" />
                            Entered watch list
                          </div>
                          <ul className="space-y-1">
                            {diff.entered.slice(0, 8).map(r => (
                              <li key={r.capabilityId} className="text-xs flex items-start gap-2">
                                <Link href={`/capability/${r.capabilityId}`} className="hover:underline flex-1 min-w-0 truncate">
                                  {r.capabilityName}
                                </Link>
                                <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                                  {r.industryName}
                                </span>
                              </li>
                            ))}
                            {diff.entered.length > 8 && (
                              <li className="text-[10px] text-muted-foreground italic">+ {diff.entered.length - 8} more</li>
                            )}
                          </ul>
                        </div>
                      )}
                      {diff.exited.length > 0 && (
                        <div className="border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-600 mb-1.5">
                            <ArrowDownRight className="w-3 h-3" />
                            Exited watch list
                          </div>
                          <ul className="space-y-1">
                            {diff.exited.slice(0, 8).map(r => (
                              <li key={r.capabilityId} className="text-xs flex items-start gap-2">
                                <Link href={`/capability/${r.capabilityId}`} className="hover:underline flex-1 min-w-0 truncate">
                                  {r.capabilityName}
                                </Link>
                                <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                                  {r.industryName}
                                </span>
                              </li>
                            ))}
                            {diff.exited.length > 8 && (
                              <li className="text-[10px] text-muted-foreground italic">+ {diff.exited.length - 8} more</li>
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {historical.rows.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
                        Full watch list {playback}d ago ({historical.rows.length})
                      </summary>
                      <ul className="mt-2 space-y-1 pl-2 border-l border-border/40">
                        {historical.rows.map(r => (
                          <li key={r.capabilityId} className="text-xs flex items-start gap-2">
                            <Link href={`/capability/${r.capabilityId}`} className="hover:underline flex-1 min-w-0 truncate">
                              {r.capabilityName}
                            </Link>
                            <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                              CVI {r.consensusScore.toFixed(0)} · v{r.velocity > 0 ? "+" : ""}{r.velocity.toFixed(1)}
                            </span>
                            {r.triggeringMacroEvents.length > 0 && (
                              <span
                                className="font-mono text-[10px] text-rose-500 whitespace-nowrap"
                                title={r.triggeringMacroEvents.map(e => e.title).join("\n")}
                              >
                                {r.triggeringMacroEvents.length} ev
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Disruption Watch ─── */}
      {watch && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-rose-500" />
              <h2 className="font-serif text-2xl tracking-tight">Disruption Watch</h2>
              <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
                {watch.rows.length} active
              </Badge>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              filters: band ≥ {watch.filters.minBand}, velocity ≥ {watch.filters.minVelocity}, age ≤ {watch.filters.maxAgeMonths}mo
            </span>
          </div>
          {watch.rows.length === 0 ? (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-6 text-sm text-muted-foreground text-center">
                No capabilities currently meet the disruption-watch criteria. Either the index is quiet, or the rotation needs a refresh.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {watch.rows.map(r => (
                <Card key={r.capabilityId} className="rounded-none border-border/60">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/capability/${r.capabilityId}`} className="font-serif text-base hover:underline flex-1 min-w-0">
                        {r.capabilityName}
                      </Link>
                      <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${BAND_TONE[r.band]}`}>
                        {r.band}
                      </Badge>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.industryName}</div>
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">P(disrupt)</div>
                        <div className="font-mono text-lg tabular-nums">{(r.probability * 100).toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Velocity</div>
                        <div className="font-mono text-lg tabular-nums">{r.velocity === null ? "—" : (r.velocity > 0 ? "+" : "") + r.velocity.toFixed(1)}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">CVI</div>
                        <ConsensusView
                          capabilityId={r.capabilityId}
                          ourScore={r.consensusScore}
                          precision={0}
                          className="font-mono text-lg tabular-nums"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap pt-1">
                      <Badge variant="outline" className={`rounded-none font-mono text-[9px] uppercase tracking-wider ${LIFECYCLE_TONE[r.lifecycleStage] ?? "bg-muted text-muted-foreground border-border/60"}`}>
                        {r.lifecycleStage}
                      </Badge>
                      {r.macroEventCount > 0 && (
                        <Badge variant="outline" className="rounded-none font-mono text-[9px] uppercase tracking-wider">
                          {r.macroEventCount} macro event{r.macroEventCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                    {r.topDrivers.length > 0 && (
                      <div className="font-mono text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                        Drivers: {r.topDrivers.join(", ")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {industriesInPlay.length > 0 && (
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-2">
              Industries in play: {industriesInPlay.join(" · ")}
            </p>
          )}
        </section>
      )}

      {/* ─── Net-new capabilities ─── */}
      {newCaps && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <h2 className="font-serif text-2xl tracking-tight">Net-new capabilities ({newCaps.filters.maxAgeMonths}-month window)</h2>
              <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
                {newCaps.rows.length} tracked
              </Badge>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Capabilities that did not exist in the ontology when we started tracking — the platform records capability <em>genesis</em>, not just maturity.
          </p>
          {newCaps.rows.length === 0 ? (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-6 text-sm text-muted-foreground text-center">
                No net-new capabilities in the current window. Increase <code className="font-mono text-xs bg-muted px-1">maxAgeMonths</code> or lower <code className="font-mono text-xs bg-muted px-1">minScore</code>.
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-left font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        <th className="px-4 py-3">Capability</th>
                        <th className="px-4 py-3">Industry</th>
                        <th className="px-4 py-3">Lifecycle</th>
                        <th className="px-4 py-3 text-right">Age (mo)</th>
                        <th className="px-4 py-3 text-right">CVI</th>
                        <th className="px-4 py-3 text-right">Velocity</th>
                        <th className="px-4 py-3 text-right">VC ($B)</th>
                        <th className="px-4 py-3 text-right">Startups</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {newCaps.rows.map(r => (
                        <tr key={r.capabilityId} className="border-t border-border/40">
                          <td className="px-4 py-2 max-w-[260px]">
                            <Link href={`/capability/${r.capabilityId}`} className="hover:underline font-medium">{r.capabilityName}</Link>
                            <div className="text-[10px] text-muted-foreground line-clamp-1">{r.capabilityDescription}</div>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{r.industryName}</td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className={`rounded-none font-mono text-[9px] uppercase tracking-wider ${LIFECYCLE_TONE[r.lifecycleStage] ?? "bg-muted text-muted-foreground border-border/60"}`}>
                              {r.lifecycleStage}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{r.ageMonths.toFixed(1)}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">
                            <ConsensusView
                              capabilityId={r.capabilityId}
                              ourScore={r.consensusScore}
                              precision={1}
                            />
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums inline-flex items-center gap-1 justify-end">
                            {(r.velocity ?? 0) > 0.5 && <TrendingUp className="w-3 h-3 text-emerald-500" />}
                            {r.velocity === null ? "—" : (r.velocity > 0 ? "+" : "") + r.velocity.toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{(r.vcCapitalUsd / 1e9).toFixed(1)}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{r.startupCount}</td>
                          <td className="px-4 py-2">
                            <Link href={`/workbench?seed=${r.capabilityId}`}>
                              <Button size="sm" variant="ghost" className="rounded-none h-7 px-2 text-[10px] font-mono uppercase tracking-wider">
                                <Lightbulb className="w-3 h-3 mr-1" />
                                Ideate
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
