import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  ArrowRight,
  ArrowUpRight,
  Activity,
  Sparkles,
  Zap,
  Lightbulb,
  Telescope,
  Layers,
  ShieldCheck,
  Rocket,
  Store,
  CheckCircle2,
  TrendingUp,
  Calendar,
  Users,
  Star,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_BASE = "/api";

// ─── Data shapes (just what each slide needs) ─────────────────────────────────

interface CVIData {
  overallIndex: number;
  overallCiLow: number | null;
  overallCiHigh: number | null;
  industryBreakdowns: Record<string, { industryName: string; indexValue: number; capabilityCount: number }>;
  generatedAt?: string;
}

interface BacktestSummary {
  aggregateAccuracy: number;
  aggregateMatched: number;
  aggregateScored: number;
  events: Array<{ eventId: number; title: string; accuracy: number }>;
}

interface DisruptionEntry {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  probability: number;
  velocity: number | null;
  consensusScore: number | null;
}

interface NewCapEntry {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  consensusScore: number | null;
  velocity: number | null;
  ageMonths: number;
  vcCapitalUsd: number;
  startupCount: number;
}

interface Pattern {
  id: number;
  slug: string;
  title: string;
  headline: string;
  disruptorCompany: string;
  newCapabilityCreated: string;
}

interface MarketplaceListing {
  id: number;
  title: string;
  type: string;
  priceCents: number;
  sellerName: string | null;
  sellerTier: string | null;
  featured: boolean;
}

interface IntroCapability {
  id: number;
  name: string;
  industryName?: string;
  consensusScore?: number | null;
}

interface IntroMacroEvent {
  id: number;
  title: string;
  severity: number;
  startDate?: string | null;
  category?: string | null;
}

// ─── Slide definitions ────────────────────────────────────────────────────────

type SlideKey = "intro" | "cei" | "proof" | "disruption" | "newcaps" | "workbench" | "patterns" | "marketplace" | "close";

interface SlideDef {
  key: SlideKey;
  durationMs: number;
  /** Where the "see it live" CTA points. null = no link. */
  liveLink: string | null;
  liveLabel: string | null;
}

const SLIDES: SlideDef[] = [
  { key: "intro",       durationMs: 18000, liveLink: null,            liveLabel: null },
  { key: "cei",         durationMs: 35000, liveLink: "/cvi",          liveLabel: "Open the live CVI" },
  { key: "proof",       durationMs: 32000, liveLink: "/proof",        liveLabel: "See the proof gallery" },
  { key: "disruption",  durationMs: 32000, liveLink: "/disruption",   liveLabel: "Open Disruption Watch" },
  { key: "newcaps",     durationMs: 28000, liveLink: "/disruption",   liveLabel: "See net-new capabilities" },
  { key: "workbench",   durationMs: 42000, liveLink: "/workbench",    liveLabel: "Open the Workbench" },
  { key: "patterns",    durationMs: 32000, liveLink: "/patterns",     liveLabel: "Read the patterns" },
  { key: "marketplace", durationMs: 30000, liveLink: "/marketplace",  liveLabel: "Browse the marketplace" },
  { key: "close",       durationMs: 25000, liveLink: null,            liveLabel: null },
];

const TOTAL_MS = SLIDES.reduce((s, x) => s + x.durationMs, 0);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [slideIdx, setSlideIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [slideProgress, setSlideProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);

  // Data state — one fetch per source
  const [cei, setCei] = useState<CVIData | null>(null);
  const [backtest, setBacktest] = useState<BacktestSummary | null>(null);
  const [disruption, setDisruption] = useState<DisruptionEntry[] | null>(null);
  const [newCaps, setNewCaps] = useState<NewCapEntry[] | null>(null);
  const [patterns, setPatterns] = useState<Pattern[] | null>(null);
  const [listings, setListings] = useState<MarketplaceListing[] | null>(null);
  // Intro slide live highlight — one random capability + one active macro
  // event. Picked once on mount so the same row shows for the whole walkthrough
  // (the rest of the slides have their own per-slide data fetches above).
  const [introCap, setIntroCap] = useState<IntroCapability | null>(null);
  const [introMacro, setIntroMacro] = useState<IntroMacroEvent | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/cvi/current`).then(r => r.ok ? r.json() : null).then(setCei).catch(() => setCei(null));
    fetch(`${API_BASE}/proof/backtest`).then(r => r.ok ? r.json() : null).then(setBacktest).catch(() => setBacktest(null));
    fetch(`${API_BASE}/disruption/watch?limit=4`).then(r => r.ok ? r.json() : null).then((d) => setDisruption(d?.rows ?? [])).catch(() => setDisruption([]));
    fetch(`${API_BASE}/capabilities/new?maxAgeMonths=24&minScore=30&limit=4`).then(r => r.ok ? r.json() : null).then((d) => setNewCaps(d?.rows ?? [])).catch(() => setNewCaps([]));
    fetch(`${API_BASE}/patterns`).then(r => r.ok ? r.json() : null).then((d) => setPatterns(d?.patterns?.slice(0, 3) ?? [])).catch(() => setPatterns([]));
    fetch(`${API_BASE}/marketplace/listings`).then(r => r.ok ? r.json() : null).then((d) => setListings(d?.listings?.slice(0, 4) ?? [])).catch(() => setListings([]));

    // Random capability — fetch full catalog, pick one at random. The endpoint
    // returns array of { id, name, industryId, ... }. We don't have industry
    // names here; the IntroSlide just displays the capability name.
    fetch(`${API_BASE}/capabilities`)
      .then(r => r.ok ? r.json() : null)
      .then((caps: Array<{ id: number; name: string; industryId?: number }> | null) => {
        if (!caps || caps.length === 0) return;
        const pick = caps[Math.floor(Math.random() * caps.length)];
        setIntroCap({ id: pick.id, name: pick.name });
      })
      .catch(() => {});

    // Most recent active macro event — /macro-events/active already orders
    // by startedAt DESC.
    fetch(`${API_BASE}/macro-events/active`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { active?: Array<{ id: number; title: string; severity: number; startedAt?: string; eventType?: string }> } | null) => {
        const first = d?.active?.[0];
        if (!first) return;
        setIntroMacro({
          id: first.id,
          title: first.title,
          severity: first.severity,
          startDate: first.startedAt,
          category: first.eventType ?? null,
        });
      })
      .catch(() => {});
  }, []);

  // Slide timing engine — RAF-driven so it stays in sync when tab is foregrounded.
  useEffect(() => {
    if (!playing || completed) return;
    let raf = 0;
    const slide = SLIDES[slideIdx];
    if (!slide) return;

    function tick(now: number) {
      if (startedAtRef.current === null) startedAtRef.current = now;
      const elapsed = now - startedAtRef.current;
      const frac = Math.min(1, elapsed / slide.durationMs);
      setSlideProgress(frac);
      if (frac >= 1) {
        if (slideIdx + 1 < SLIDES.length) {
          startedAtRef.current = null;
          setSlideIdx(slideIdx + 1);
          setSlideProgress(0);
        } else {
          setPlaying(false);
          setCompleted(true);
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Stash the elapsed so resume continues where we paused.
      if (startedAtRef.current !== null) {
        const elapsed = performance.now() - startedAtRef.current;
        pausedAtRef.current = elapsed;
      }
    };
  }, [playing, slideIdx, completed]);

  // When resuming after pause, rebase the "start" so the timer continues correctly.
  useEffect(() => {
    if (playing && pausedAtRef.current !== null) {
      startedAtRef.current = performance.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }
  }, [playing]);

  const jumpTo = useCallback((idx: number) => {
    setSlideIdx(Math.max(0, Math.min(SLIDES.length - 1, idx)));
    setSlideProgress(0);
    startedAtRef.current = null;
    pausedAtRef.current = null;
    setCompleted(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (completed) {
      jumpTo(0);
      setPlaying(true);
      return;
    }
    setPlaying(p => !p);
  }, [completed, jumpTo]);

  // Cumulative ms elapsed across all slides, for the overall bar.
  const overallElapsed = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < slideIdx; i++) sum += SLIDES[i].durationMs;
    return sum + slideProgress * SLIDES[slideIdx].durationMs;
  }, [slideIdx, slideProgress]);

  const overallPct = Math.min(100, (overallElapsed / TOTAL_MS) * 100);
  const slide = SLIDES[slideIdx];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header bar ─────────────────────────────────────────────── */}
      <header className="border-b border-border/40 bg-muted/20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-3.5 h-3.5" />
          </Link>
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
            <Sparkles className="w-3 h-3 mr-1 inline text-amber-500" />
            5-minute walkthrough
          </Badge>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground ml-auto">
            Slide {slideIdx + 1} / {SLIDES.length}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => jumpTo(slideIdx - 1)} disabled={slideIdx === 0} className="rounded-none h-8 px-2">
              <SkipBack className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={togglePlay} className="rounded-none h-8 px-2">
              {completed ? <RotateCcw className="w-3.5 h-3.5" /> : playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => jumpTo(slideIdx + 1)} disabled={slideIdx === SLIDES.length - 1} className="rounded-none h-8 px-2">
              <SkipForward className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-2">
          <div className="h-0.5 bg-border/30 relative overflow-hidden">
            <div className="absolute top-0 left-0 h-full bg-accent transition-all duration-100" style={{ width: `${overallPct}%` }} />
          </div>
          <div className="grid mt-1 gap-0.5" style={{ gridTemplateColumns: `repeat(${SLIDES.length}, 1fr)` }}>
            {SLIDES.map((s, i) => (
              <button
                key={s.key}
                onClick={() => jumpTo(i)}
                className={`h-1 ${i < slideIdx ? "bg-accent" : i === slideIdx ? "bg-accent/40" : "bg-border/30"} hover:bg-accent/80 transition-colors`}
                aria-label={`Jump to slide ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </header>

      {/* ── Slide content ──────────────────────────────────────────── */}
      <main className="flex-1 flex items-center">
        <div className="max-w-6xl mx-auto w-full px-4 py-10">
          <SlideErrorBoundary slideKey={slide.key}>
            {slide.key === "intro" && <IntroSlide cap={introCap} macro={introMacro} />}
            {slide.key === "cei" && <CviSlide data={cei} />}
            {slide.key === "proof" && <ProofSlide data={backtest} />}
            {slide.key === "disruption" && <DisruptionSlide rows={disruption} />}
            {slide.key === "newcaps" && <NewCapsSlide rows={newCaps} />}
            {slide.key === "workbench" && <WorkbenchSlide />}
            {slide.key === "patterns" && <PatternsSlide rows={patterns} />}
            {slide.key === "marketplace" && <MarketplaceSlide rows={listings} />}
            {slide.key === "close" && <CloseSlide />}
          </SlideErrorBoundary>
        </div>
      </main>

      {/* ── Footer: "see it live" link + slide counter ─────────────── */}
      <footer className="border-t border-border/40 bg-muted/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {playing && !completed ? "Auto-advancing…" : completed ? "Tour complete" : "Paused"}
          </div>
          {slide.liveLink && slide.liveLabel && (
            <Link href={slide.liveLink}>
              <Button size="sm" variant="outline" className="rounded-none font-mono text-[11px] uppercase tracking-wider h-8">
                {slide.liveLabel}
                <ArrowUpRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          )}
        </div>
      </footer>
    </div>
  );
}

// ─── Slide error boundary ─────────────────────────────────────────────────
// A render error inside one slide must NOT blank the whole tour — that's the
// kind of bug an investor notices immediately. The boundary catches throws
// inside the active slide and shows a small "this slide had an issue,
// auto-advancing" card instead. Recovers automatically when slideKey changes.
class SlideErrorBoundary extends Component<
  { children: ReactNode; slideKey: string },
  { error: Error | null; lastKey: string }
> {
  constructor(props: { children: ReactNode; slideKey: string }) {
    super(props);
    this.state = { error: null, lastKey: props.slideKey };
  }
  static getDerivedStateFromProps(
    props: { slideKey: string },
    state: { error: Error | null; lastKey: string },
  ): { error: Error | null; lastKey: string } | null {
    // Reset on slide change so each slide gets its own try.
    if (props.slideKey !== state.lastKey) {
      return { error: null, lastKey: props.slideKey };
    }
    return null;
  }
  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    console.warn(`[demo] slide "${this.props.slideKey}" threw:`, error.message, info.componentStack?.split("\n")[1]?.trim());
  }
  static getDerivedStateFromError(error: Error): { error: Error; lastKey: string } {
    return { error, lastKey: "__error__" };
  }
  render(): ReactNode {
    if (this.state.error) {
      return (
        <Card className="rounded-none border-amber-500/40 bg-amber-500/[0.04] max-w-2xl mx-auto">
          <CardContent className="p-6 space-y-2 text-center">
            <p className="font-serif text-base">This slide hit a temporary issue</p>
            <p className="text-sm text-muted-foreground">
              The tour continues — use the arrows above to advance, or wait for auto-advance.
            </p>
            <p className="text-xs font-mono text-muted-foreground/70">{this.state.error.message.slice(0, 120)}</p>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

// ─── Slide components ─────────────────────────────────────────────────────────

function SlideHeader({ eyebrow, title, subtitle, icon: Icon }: { eyebrow: string; title: string; subtitle: string; icon: typeof Activity }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-accent" />
        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">{eyebrow}</Badge>
      </div>
      <h1 className="font-serif text-4xl lg:text-5xl tracking-tight leading-tight">{title}</h1>
      <p className="text-base lg:text-lg text-muted-foreground mt-3 max-w-3xl leading-relaxed">{subtitle}</p>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm leading-relaxed">
      <CheckCircle2 className="w-3.5 h-3.5 mt-1 text-emerald-500 shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function IntroSlide({ cap, macro }: { cap: IntroCapability | null; macro: IntroMacroEvent | null }) {
  return (
    <div className="space-y-8">
      <div className="text-center max-w-3xl mx-auto">
        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider mb-4">
          <Sparkles className="w-3 h-3 mr-1 inline text-amber-500" />
          Inflexcvi
        </Badge>
        <h1 className="font-serif text-5xl lg:text-7xl tracking-tight leading-[0.95] mb-6">
          A probabilistic capability index <span className="italic text-foreground/60">and</span> the workbench that invents the next one.
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          In the next five minutes you'll see how Inflexcvi scores every business capability with
          Bayesian triangulation, replays history to prove it, and turns the data into a design-thinking
          surface where Claude helps you find new markets.
        </p>
      </div>
      {/* Live-data badge row — proves this isn't a slide deck. One random
          capability + the most recent active macro event, fetched on mount. */}
      {(cap || macro) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl mx-auto">
          <Card className="rounded-none border-accent/30 bg-accent/[0.04]">
            <CardContent className="p-4 flex items-start gap-3">
              <Activity className="w-4 h-4 text-accent shrink-0 mt-1" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-accent mb-1">Live capability</div>
                <div className="font-medium truncate">{cap?.name ?? "Loading…"}</div>
                <div className="text-[11px] text-muted-foreground">
                  Sampled at random from the live capability graph
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-none border-rose-500/30 bg-rose-500/[0.04]">
            <CardContent className="p-4 flex items-start gap-3">
              <Zap className="w-4 h-4 text-rose-500 shrink-0 mt-1" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-rose-500 mb-1">Most recent macro event</div>
                <div className="font-medium truncate">{macro?.title ?? "No active events"}</div>
                {macro && (
                  <div className="text-[11px] text-muted-foreground">
                    Severity {macro.severity.toFixed(1)}
                    {macro.category ? ` · ${macro.category}` : ""}
                    {macro.startDate ? ` · ${new Date(macro.startDate).toISOString().slice(0, 10)}` : ""}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
        <Card className="rounded-none border-border/60">
          <CardContent className="p-5">
            <Activity className="w-5 h-5 text-accent mb-2" />
            <h3 className="font-serif text-xl mb-1">Numbers</h3>
            <p className="text-sm text-muted-foreground">CVI scores with 95% credible intervals, GDP weighting, evidence provenance on every value, historical backtesting against real shocks.</p>
          </CardContent>
        </Card>
        <Card className="rounded-none border-border/60">
          <CardContent className="p-5">
            <Lightbulb className="w-5 h-5 text-amber-500 mb-2" />
            <h3 className="font-serif text-xl mb-1">Ideas</h3>
            <p className="text-sm text-muted-foreground">Capability Workbench kanban, Claude-powered ideation actions, cross-industry analogue finder, design-thinking patterns from Uber, Stripe, OpenAI.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CviSlide({ data }: { data: CVIData | null }) {
  const topIndustries = data
    ? Object.values(data.industryBreakdowns).sort((a, b) => b.indexValue - a.indexValue).slice(0, 5)
    : [];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div>
        <SlideHeader
          eyebrow="The Index"
          title="One number that traces to its sources."
          subtitle="The Capability Value Index is a GDP-weighted composite of capability maturity across every tracked industry. Every score is a Bayesian posterior with a 95% credible interval. Every input is cited."
          icon={Activity}
        />
        <ul className="space-y-2 mt-4">
          <Callout>GDP-weighted across industries — light industries don't drown out heavy ones.</Callout>
          <Callout>Per-capability posterior variance propagates to industry CIs to the overall CI.</Callout>
          <Callout>Every source row carries methodology (consulting / academic / regulatory / news) and queried-at timestamp.</Callout>
          <Callout>Industries without a cited GDP weight are excluded from the rollup — never editorialized.</Callout>
        </ul>
      </div>
      <Card className="rounded-none border-border/60 self-center">
        <CardContent className="p-6 space-y-4">
          {data ? (
            <>
              <div className="text-center">
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-1">Overall CVI</div>
                <div className="font-mono text-6xl tabular-nums">{data.overallIndex.toFixed(1)}</div>
                {data.overallCiLow !== null && data.overallCiHigh !== null && (
                  <div className="font-mono text-xs text-muted-foreground mt-1">
                    95% CI [{data.overallCiLow.toFixed(1)}, {data.overallCiHigh.toFixed(1)}]
                  </div>
                )}
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Top industries by index</div>
                {topIndustries.map((ind, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-t border-border/40 first:border-t-0">
                    <span className="text-sm">{ind.industryName}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">{ind.capabilityCount} caps</span>
                      <span className="font-mono text-sm tabular-nums w-12 text-right">{ind.indexValue.toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading live CVI…
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProofSlide({ data }: { data: BacktestSummary | null }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
      <div>
        <SlideHeader
          eyebrow="Did the model see it coming?"
          title="We replay history through the engine."
          subtitle="The same CVI engine that runs the live index is re-run with each curated historical event injected as a macro shock. We measure whether the engine's response matches the recorded historical direction."
          icon={CheckCircle2}
        />
        <ul className="space-y-2 mt-4">
          <Callout>COVID, ChatGPT launch, SVB collapse, 2025 tariffs — replayed against the live engine.</Callout>
          <Callout>Dry-run mode (no writes to the live index) — admins replay as often as they like.</Callout>
          <Callout>Expected direction is allowed to disagree with event sentiment — COVID is negative globally but positive for telehealth.</Callout>
          <Callout>One-hour result cache, public read — VC walkthrough page is bulletproof.</Callout>
        </ul>
      </div>
      <Card className="rounded-none border-border/60">
        <CardContent className="p-6 space-y-4">
          {data ? (
            <>
              <div className="text-center">
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-1">Directional accuracy</div>
                <div className={`font-mono text-6xl tabular-nums ${data.aggregateAccuracy >= 0.7 ? "text-emerald-500" : data.aggregateAccuracy >= 0.5 ? "text-amber-500" : "text-rose-500"}`}>
                  {(data.aggregateAccuracy * 100).toFixed(0)}%
                </div>
                <div className="font-mono text-xs text-muted-foreground mt-1">
                  {data.aggregateMatched} matched / {data.aggregateScored} scored across {data.events.length} events
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Per-event</div>
                {data.events.slice(0, 4).map(ev => (
                  <div key={ev.eventId} className="flex items-center justify-between text-sm py-1 border-t border-border/40">
                    <span className="truncate pr-2">{ev.title}</span>
                    <span className={`font-mono text-xs tabular-nums shrink-0 ${ev.accuracy >= 0.7 ? "text-emerald-500" : ev.accuracy >= 0.5 ? "text-amber-500" : ev.accuracy < 0 ? "text-muted-foreground" : "text-rose-500"}`}>
                      {ev.accuracy < 0 ? "—" : `${(ev.accuracy * 100).toFixed(0)}%`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Running backtest…
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DisruptionSlide({ rows }: { rows: DisruptionEntry[] | null }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
      <div>
        <SlideHeader
          eyebrow="Disruption Watch"
          title="Live feed of capabilities disrupting industries right now."
          subtitle="Filtered to high probability bands, rising velocity, recent macro events touching the cap or its dependencies. Stays fresh as new triangulations land."
          icon={Zap}
        />
        <ul className="space-y-2 mt-4">
          <Callout>Disruption probability = lifecycle stage × velocity × confidence × macro exposure × source freshness × innovation pressure.</Callout>
          <Callout>Excludes stale capabilities — source quality gates apply.</Callout>
          <Callout>Click any row → land on the capability detail page with score-change explainability.</Callout>
        </ul>
      </div>
      <div className="space-y-2">
        {rows === null ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading watch…</div>
        ) : rows.length === 0 ? (
          <Card className="rounded-none border-border/60"><CardContent className="p-6 text-sm text-muted-foreground text-center">No capabilities currently meet the watch criteria.</CardContent></Card>
        ) : rows.map(r => (
          <Card key={r.capabilityId} className="rounded-none border-border/60">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{r.capabilityName}</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{r.industryName}</div>
              </div>
              <div className="text-right shrink-0 flex items-center gap-4">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">P(disrupt)</div>
                  <div className="font-mono text-xl tabular-nums text-rose-500">{(r.probability * 100).toFixed(0)}%</div>
                </div>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Velocity</div>
                  <div className="font-mono text-xl tabular-nums text-emerald-500">+{(r.velocity ?? 0).toFixed(1)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function NewCapsSlide({ rows }: { rows: NewCapEntry[] | null }) {
  return (
    <div className="space-y-6">
      <SlideHeader
        eyebrow="Net-new capabilities"
        title="The capabilities that didn't exist 24 months ago."
        subtitle="No competitor tracks the genesis of capabilities — just the maturity. We capture the moment a new capability emerges with non-trivial CVI, VC flowing in, and startups racing to own it."
        icon={Sparkles}
      />
      {rows === null ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <Card className="rounded-none border-border/60"><CardContent className="p-6 text-sm text-muted-foreground text-center">No net-new capabilities in the 24-month window yet.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map(r => (
            <Card key={r.capabilityId} className="rounded-none border-border/60">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium truncate">{r.capabilityName}</div>
                  <Badge variant="outline" className="rounded-none font-mono text-[9px] uppercase tracking-wider"><Calendar className="w-3 h-3 mr-1 inline" />{r.ageMonths.toFixed(0)}mo old</Badge>
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{r.industryName}</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">CVI</div>
                    <div className="font-mono text-lg tabular-nums">{r.consensusScore?.toFixed(0) ?? "—"}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Velocity</div>
                    <div className="font-mono text-lg tabular-nums text-emerald-500 inline-flex items-center gap-0.5">
                      <TrendingUp className="w-3 h-3" />
                      {(r.velocity ?? 0).toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">VC ($B)</div>
                    <div className="font-mono text-lg tabular-nums">{(r.vcCapitalUsd / 1e9).toFixed(1)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkbenchSlide() {
  const lanes: Array<{ key: string; label: string; Icon: typeof Telescope; tone: string; sample: string[] }> = [
    { key: "scan", label: "Scan", Icon: Telescope, tone: "bg-sky-500/10 border-sky-500/30", sample: ["Agentic AI orchestration", "Real-time fraud detection"] },
    { key: "frame", label: "Frame", Icon: Layers, tone: "bg-violet-500/10 border-violet-500/30", sample: ["Healthcare claims white-space"] },
    { key: "ideate", label: "Ideate", Icon: Lightbulb, tone: "bg-amber-500/10 border-amber-500/30", sample: ["Patient-side claims agent", "Provider workflow copilot"] },
    { key: "validate", label: "Validate", Icon: ShieldCheck, tone: "bg-emerald-500/10 border-emerald-500/30", sample: ["3 design partners signed"] },
    { key: "launch", label: "Launch", Icon: Rocket, tone: "bg-rose-500/10 border-rose-500/30", sample: [] },
  ];
  return (
    <div className="space-y-6">
      <SlideHeader
        eyebrow="The Workbench"
        title="Drag capabilities through a Double-Diamond pipeline. Claude critiques each one."
        subtitle="Personal and team boards. Five lanes from Scan to Launch. Five Claude actions per card: generate 10 unexpected applications, find cross-industry analogues, critique a disruption idea, propose what to invent next, judge lifecycle outlook. Every output is cached so refresh never re-bills."
        icon={Lightbulb}
      />
      <div className="grid grid-cols-5 gap-2">
        {lanes.map(l => {
          const I = l.Icon;
          return (
            <div key={l.key} className={`border ${l.tone} rounded-none p-2 flex flex-col`}>
              <div className="flex items-center gap-1.5 mb-2">
                <I className="w-3.5 h-3.5" />
                <span className="font-mono text-[10px] uppercase tracking-wider font-medium">{l.label}</span>
              </div>
              <div className="space-y-1.5 flex-1">
                {l.sample.length === 0 ? (
                  <div className="text-[10px] text-muted-foreground italic text-center py-3">Drop here</div>
                ) : l.sample.map((s, i) => (
                  <div key={i} className="bg-background border border-border/60 p-2 text-xs">{s}</div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        {[
          { kind: "10 unexpected applications", help: "Mix obvious + cross-industry stretches" },
          { kind: "Cross-industry analogues", help: "Where does this exist elsewhere?" },
          { kind: "Critique my idea", help: "Defensibility, time-to-traction, moat" },
          { kind: "What to invent", help: "The Uber pattern — assemble existing into new" },
          { kind: "Lifecycle outlook", help: "Leading, peaking, or declining?" },
        ].map(a => (
          <Card key={a.kind} className="rounded-none border-border/60">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles className="w-3 h-3 text-amber-500" />
                <span className="text-xs font-medium">{a.kind}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">{a.help}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PatternsSlide({ rows }: { rows: Pattern[] | null }) {
  return (
    <div className="space-y-6">
      <SlideHeader
        eyebrow="Design-thinking patterns"
        title="How they invented the capability nobody else thought to build."
        subtitle="Uber didn't make taxis better. They combined mobile-GPS + payments + ratings + matching into a NEW capability called ride-hailing platform. The /patterns library shows you the assemblies so you can spot the next one in your industry."
        icon={Sparkles}
      />
      {rows === null ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading patterns…</div>
      ) : rows.length === 0 ? (
        <Card className="rounded-none border-amber-500/40 bg-amber-500/10">
          <CardContent className="p-6 text-sm text-center">
            <p>Disruption patterns are still populating. Refresh in a moment.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {rows.map(p => (
            <Card key={p.id} className="rounded-none border-border/60">
              <CardContent className="p-4 space-y-2">
                <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">{p.disruptorCompany}</Badge>
                <h3 className="font-serif text-lg leading-tight">{p.title}</h3>
                <p className="text-xs text-muted-foreground line-clamp-3">{p.headline}</p>
                <div className="pt-2 border-t border-border/40">
                  <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">New capability invented</div>
                  <div className="text-xs font-medium line-clamp-2">{p.newCapabilityCreated}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketplaceSlide({ rows }: { rows: MarketplaceListing[] | null }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
      <div>
        <SlideHeader
          eyebrow="Marketplace"
          title="Analysts sell research on top of the data. Network effect, no add."
          subtitle="Three seller tiers (open / verified analyst / featured), four listing types (reports, datasets, templates, services), Stripe Connect payouts, KYC, watermarked PDF delivery. The CVI is the moat; the marketplace is the revenue mechanism."
          icon={Store}
        />
        <ul className="space-y-2 mt-4">
          <Callout>Open tier: anyone with Stripe Connect onboarded can list. Platform takes 20%.</Callout>
          <Callout>Verified Analyst tier: vetted consultants get a badge. 15% take rate.</Callout>
          <Callout>Featured Author tier: curated showcase, top placement, amber ring on listings.</Callout>
          <Callout>Datasets and templates are first-class listing types — not just PDFs.</Callout>
        </ul>
      </div>
      <div className="space-y-2">
        {rows === null ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading marketplace…</div>
        ) : rows.length === 0 ? (
          <Card className="rounded-none border-border/60"><CardContent className="p-6 text-sm text-muted-foreground text-center">No live listings yet — recruit the first analyst.</CardContent></Card>
        ) : rows.map(l => (
          <Card key={l.id} className={`rounded-none border-border/60 ${l.featured ? "ring-1 ring-amber-500/40" : ""}`}>
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="rounded-none font-mono text-[9px] uppercase tracking-wider">{l.type}</Badge>
                  {l.featured && <Badge variant="outline" className="rounded-none font-mono text-[9px] uppercase tracking-wider bg-amber-500/15 text-amber-500 border-amber-500/40"><Sparkles className="w-2.5 h-2.5 mr-0.5 inline" />Featured</Badge>}
                  {l.sellerTier === "analyst" && <Badge variant="outline" className="rounded-none font-mono text-[9px] uppercase tracking-wider bg-sky-500/15 text-sky-500 border-sky-500/40"><Users className="w-2.5 h-2.5 mr-0.5 inline" />Verified analyst</Badge>}
                  {l.sellerTier === "featured" && <Badge variant="outline" className="rounded-none font-mono text-[9px] uppercase tracking-wider bg-amber-500/15 text-amber-500 border-amber-500/40"><Star className="w-2.5 h-2.5 mr-0.5 inline" />Featured author</Badge>}
                </div>
                <div className="font-medium truncate">{l.title}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{l.sellerName ?? "Author"}</div>
              </div>
              <div className="font-mono text-xl tabular-nums shrink-0">${(l.priceCents / 100).toFixed(0)}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CloseSlide() {
  return (
    <div className="max-w-3xl mx-auto text-center space-y-8">
      <div>
        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider mb-4">
          <Sparkles className="w-3 h-3 mr-1 inline text-amber-500" />
          That's the tour
        </Badge>
        <h1 className="font-serif text-5xl lg:text-6xl tracking-tight leading-[0.95] mb-4">
          Numbers tell one story. <span className="italic text-foreground/60">The next move tells another.</span>
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          You've seen the index, the proof, the disruption feed, the workbench, the patterns, and the marketplace.
          Pick one of these to go deeper — the live data is one click away.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link href="/workbench">
          <Card className="rounded-none border-border/60 hover:border-accent transition-colors cursor-pointer h-full">
            <CardContent className="p-5 text-left">
              <Lightbulb className="w-5 h-5 text-amber-500 mb-2" />
              <div className="font-serif text-lg mb-1">Open the Workbench</div>
              <div className="text-xs text-muted-foreground">Drag a capability. Ask Claude what to invent. 30 seconds in, you'll have ideas you wouldn't have had.</div>
              <ArrowRight className="w-3.5 h-3.5 mt-3" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/proof">
          <Card className="rounded-none border-border/60 hover:border-accent transition-colors cursor-pointer h-full">
            <CardContent className="p-5 text-left">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 mb-2" />
              <div className="font-serif text-lg mb-1">Read the proof</div>
              <div className="text-xs text-muted-foreground">Full backtest gallery with per-event accuracy and the methodology behind every number.</div>
              <ArrowRight className="w-3.5 h-3.5 mt-3" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/membership">
          <Card className="rounded-none border-border/60 hover:border-accent transition-colors cursor-pointer h-full">
            <CardContent className="p-5 text-left">
              <Rocket className="w-5 h-5 text-rose-500 mb-2" />
              <div className="font-serif text-lg mb-1">Apply for membership</div>
              <div className="text-xs text-muted-foreground">Full library, scenario modelling, API access, embeddable widgets, marketplace.</div>
              <ArrowRight className="w-3.5 h-3.5 mt-3" />
            </CardContent>
          </Card>
        </Link>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Or restart the tour ↑
      </p>
    </div>
  );
}
