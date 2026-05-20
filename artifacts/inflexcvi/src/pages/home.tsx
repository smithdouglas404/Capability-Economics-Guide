import { useEffect, useRef, useState } from "react";
import { motion, useInView, useMotionValue, useSpring, animate } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, ArrowUpRight, Clock, ExternalLink, TrendingUp, Minus, Sparkles, Brain, Activity, Network, Zap, Lightbulb, Target, Layers } from "lucide-react";
import AgentMemoryShowcase from "@/components/agent-memory-showcase";
import WhatIsCEModal from "@/components/what-is-ce-modal";
import { PersonaPicker } from "@/components/page-header";
import { useHasPickedPersona } from "@/lib/persona";
import { DvxChip } from "@/components/dvx-hero";
import { useAuth } from "@clerk/react";
import { usePersonalizedPage, getPersonalizedGreeting } from "@/lib/use-personalized-page";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EducationalContent {
  id: number;
  slug: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  keyTakeaways: string[];
  sources: { url: string; title: string }[];
  category: string;
  estimatedReadMinutes: number;
}

type SlotResponse = {
  source: "slot" | "fallback" | "empty";
  type: "case_study" | null;
  content: {
    industrySlug: string;
    industryName: string;
    title: string;
    executiveSummary: string;
  } | null;
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useSlot(slotKey: string) {
  const [state, setState] = useState<SlotResponse | null>(null);
  useEffect(() => {
    fetch(`/api/featured-content/${slotKey}`)
      .then(r => r.ok ? r.json() : null)
      .then((j: SlotResponse | null) => setState(j))
      .catch(() => setState(null));
  }, [slotKey]);
  return state;
}

// ─── Ticker row — top 8 capabilities by recent CVI velocity ─────────────────

type TickerItem = { capabilityName: string; valueText: string; direction: "up" | "down"; score?: number };

function TickerBar() {
  const [items, setItems] = useState<TickerItem[]>([]);
  useEffect(() => {
    fetch("/api/metrics/home-ticker")
      .then(r => r.ok ? r.json() : null)
      .then((d: { items: TickerItem[] } | null) => setItems(d?.items ?? []))
      .catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  const doubled = [...items, ...items];
  return (
    <div className="relative overflow-hidden border-t border-b border-border/40 bg-muted/20 py-2.5">
      <div className="ticker-track flex gap-0 whitespace-nowrap">
        {doubled.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-2 px-6 shrink-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {item.capabilityName}
            </span>
            <span className={`font-mono text-[10px] font-medium tracking-[0.12em] flex items-center gap-0.5 ${item.direction === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
              {item.direction === "up" ? <TrendingUp className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
              {item.valueText}
            </span>
            <span className="text-border/60 mx-1">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Educational Library ───────────────────────────────────────────────────

function EducationalLibrary() {
  const [items, setItems] = useState<EducationalContent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/educational-content")
      .then(r => r.ok ? r.json() : [])
      .then((d: EducationalContent[]) => { setItems(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading || items.length === 0) return null;

  return (
    <section className="border-t border-border/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-20 lg:py-28">
        <div className="grid lg:grid-cols-[220px_1fr] gap-10 lg:gap-16 mb-14">
          <div>
            <div className="inline-flex items-center gap-2 mb-4">
              <span className="h-px w-5 bg-accent" />
              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ Library</span>
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl leading-[1.05] sm:leading-[1.0] tracking-tight">
              Learn the<br /><em className="not-italic text-foreground/70">discipline.</em>
            </h2>
          </div>
          <p className="font-serif italic text-lg lg:text-xl text-foreground/60 leading-relaxed self-end max-w-2xl">
            The foundational ideas, frameworks, and primary sources behind capability economics — curated for executive reading.
          </p>
        </div>

        <div className="border-t border-border/40 divide-y divide-border/40">
          {items.map((entry, i) => (
            <Link key={entry.id} href="#" className="block group">
              <article
                data-testid={`edu-card-${entry.slug}`}
                className="grid lg:grid-cols-[48px_120px_1fr_80px] gap-x-8 gap-y-2 py-7 hover:bg-muted/20 transition-colors duration-200 px-3 -mx-3"
              >
                <div className="font-mono text-[10px] tabular-nums tracking-[0.2em] text-muted-foreground/60 pt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent pt-0.5">
                  {entry.category}
                </div>
                <div>
                  <h3 className="font-serif text-xl lg:text-2xl leading-tight tracking-tight group-hover:text-foreground/70 transition-colors">
                    {entry.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-2xl">
                    {entry.summary}
                  </p>
                  {entry.keyTakeaways.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                      {entry.keyTakeaways.slice(0, 3).map((t, ti) => (
                        <li key={ti} className="font-mono text-[10px] text-foreground/75 flex gap-1.5 before:content-['—'] before:text-muted-foreground">
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {entry.sources.length > 0 && (
                    <a
                      href={entry.sources[0].url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-accent inline-flex items-center gap-1.5 mt-3 transition-colors"
                    >
                      <ExternalLink className="w-2.5 h-2.5" /> {entry.sources[0].title}
                    </a>
                  )}
                </div>
                <div className="font-mono text-[10px] tabular-nums uppercase tracking-[0.18em] text-muted-foreground/60 inline-flex items-center gap-1.5 self-start justify-end">
                  <Clock className="w-2.5 h-2.5" />
                  {entry.estimatedReadMinutes}m
                </div>
              </article>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Learning Progress ──────────────────────────────────────────────────

function LearningProgress() {
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const personalized = usePersonalizedPage();
  const { learningProfile, whatsChanged } = personalized;

  const profile = learningProfile?.profile;
  const changes = whatsChanged;

  if (!isSignedIn || !profile) return null;

  const hasActivity = profile.totalAiGenerations > 0 || profile.totalPageViews > 0 || profile.topIndustries.length > 0;
  if (!hasActivity) return null;

  const greeting = getPersonalizedGreeting(learningProfile, changes);
  const newGens = changes?.newAiGenerations ?? 0;
  const newViews = changes?.newPageViews ?? 0;
  const newCaps = changes?.newCapabilitiesSeen ?? [];
  const hasNew = newGens > 0 || newViews > 0 || newCaps.length > 0;

  return (
    <section className="border-t border-border/40 bg-muted/5">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-10 sm:py-14"
      >
        <div className="flex flex-wrap items-start justify-between gap-6 mb-6">
          <div>
            <div className="inline-flex items-center gap-2 mb-3">
              <span className="h-px w-5 bg-accent" />
              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Your learning</span>
            </div>
            <h2 className="font-serif text-2xl sm:text-3xl tracking-tight flex items-center gap-2">
              <Brain className="w-5 h-5 text-foreground/50" />
              {greeting}
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              {hasNew
                ? `Since your last visit: ${newGens > 0 ? `${newGens} new brief${newGens > 1 ? "s" : ""}` : ""}${newGens > 0 && newViews > 0 ? " · " : ""}${newViews > 0 ? `${newViews} page${newViews > 1 ? "s" : ""}` : ""}${newCaps.length > 0 ? ` · explored ${newCaps.map(c => c.name).join(", ")}` : ""}`
                : "Your activity shapes how the AI tailors briefs and recommendations over time."}
            </p>
          </div>
          <Link
            href="/account/learning"
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent hover:text-accent/70 transition-colors shrink-0"
          >
            See full profile <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border border-border/50 bg-background p-4 relative">
            {newGens > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-accent animate-pulse" />
            )}
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-2">
              {profile.persona ? `${profile.persona.toUpperCase()} persona` : "No persona set"}
            </div>
            <div className="font-mono text-lg font-medium tabular-nums text-foreground">
              {profile.totalAiGenerations}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground mt-1">
              AI briefs generated
              {newGens > 0 && <span className="text-accent ml-1">(+{newGens} new)</span>}
            </div>
          </div>
          <div className="border border-border/50 bg-background p-4">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-2">Pages visited</div>
            <div className="font-mono text-lg font-medium tabular-nums text-foreground">
              {profile.totalPageViews}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground mt-1">
              Across all sessions
              {newViews > 0 && <span className="text-accent ml-1">(+{newViews} new)</span>}
            </div>
          </div>
          <div className="border border-border/50 bg-background p-4">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-2">Industries explored</div>
            <div className="font-mono text-lg font-medium tabular-nums text-foreground">
              {profile.topIndustries.length}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground mt-1">
              {profile.topIndustries.length > 0
                ? profile.topIndustries.slice(0, 2).map(i => i.name).join(", ")
                : "—"}
            </div>
          </div>
          <div className="border border-border/50 bg-background p-4">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-2">Capabilities viewed</div>
            <div className="font-mono text-lg font-medium tabular-nums text-foreground">
              {profile.topCapabilities.length}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground mt-1">
              {profile.topCapabilities.length > 0
                ? profile.topCapabilities.slice(0, 2).map(c => c.name).join(", ")
                : "—"}
            </div>
          </div>
        </div>

        {/* Continue where you left off */}
        {changes?.newInteractions && changes.newInteractions.length > 0 && (
          <div className="mt-5 border border-border/50 bg-background p-4">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-3 flex items-center gap-1.5">
              <Layers className="w-3 h-3" />
              Continue where you left off
            </div>
            <div className="flex flex-wrap gap-2">
              {changes.newInteractions.slice(0, 5).map(ixn => (
                <Link
                  key={ixn.id}
                  href={typeof ixn.metadata?.path === "string" ? ixn.metadata.path : "/"}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] border border-border/50 hover:border-accent hover:bg-muted/20 rounded-sm transition-colors"
                >
                  <span className="text-muted-foreground">{ixn.label}</span>
                  <ArrowRight className="w-2.5 h-2.5 text-accent" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Agent patterns related to user's interests */}
        {profile.topIndustries.length > 0 && (
          <AgentPatternsFor homeIndustries={profile.topIndustries} />
        )}

        {/* Industry chips */}
        {profile.topIndustries.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
           {profile.topIndustries.slice(0, 5).map(ind => (
              <Link
                key={ind.name}
                href={`/case-study/${ind.slug ?? ind.name.toLowerCase()}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider border border-border/50 hover:border-accent hover:bg-muted/30 rounded-sm transition-colors"
              >
                <Activity className="w-2.5 h-2.5 text-accent" />
                {ind.name}
              </Link>
            ))}
          </div>
        )}
      </motion.div>
    </section>
  );
}

function AgentPatternsFor({ homeIndustries }: { homeIndustries: Array<{ name: string; slug: string; count: number }> }) {
  // Shown on the home page near LearningProgress — gives signed-in users a
  // taste of what the autonomous agent system has discovered in THEIR industries.
  // This is a visual placeholder that links to the full Insights page.
  if (homeIndustries.length === 0) return null;
  const industry = homeIndustries[0];
  return (
    <div className="mt-5 border border-border/50 bg-background p-4">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-3 flex items-center gap-1.5">
        <Network className="w-3 h-3" />
        Agent discoveries in {industry.name}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        The autonomous CVI agent scans Perplexity research, Mem0 memory patterns, and the 
        capability dependency graph — discovering macro events, disruption risks, and 
        peer-cohort benchmarks in your focus industries.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/insights"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider bg-accent/10 text-accent hover:bg-accent/20 rounded-sm transition-colors"
        >
          <Lightbulb className="w-2.5 h-2.5" />
          View agent insights
        </Link>
        <Link
          href="/cvi"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider border border-border/50 hover:border-accent rounded-sm transition-colors"
        >
          <Target className="w-2.5 h-2.5" />
          CVI dashboard
        </Link>
      </div>
    </div>
  );
}

// ─── Metric Tile ──────────────────────────────────────────────────────────

function MetricTile({ label, value, sub, accent = false, delay = 0 }: {
  label: string; value: string; sub: string; accent?: boolean; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
      className={`p-4 border ${accent ? "border-accent/30 bg-accent/5" : "border-border/50 bg-muted/30"}`}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-2">{label}</div>
      <div className={`font-mono text-xl font-medium tabular-nums tracking-tight ${accent ? "text-accent" : "text-foreground"}`}>{value}</div>
      <div className="font-mono text-[11px] text-muted-foreground mt-1 leading-snug">{sub}</div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

// Live aggregates from /api/metrics/*. Replaces previously hardcoded
// hero-tile and principle-row values (PLAN.md items 2, 3).
type PrincipleStats = { avgAnnualMarginCapturedUsdMm: number; avgAnnualMarginCapturedFormatted: string; medianMarginStructurePct: number; sampleSize: number };
type HomeTiles = {
  valueUnlocked: { amountUsdMm: number; formatted: string };
  topROI: { capabilityName: string; annualMarginUsdMm: number; formatted: string } | null;
  quarterlyDelta: { pts: number; direction: "up" | "down" } | null;
};
type CviCurrent = { overallIndex: number };

export default function Home() {
  const heroSlot = useSlot("homepage_hero");
  const cardSlot = useSlot("homepage_case_card");
  const hasPickedPersona = useHasPickedPersona();
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  // Show the persona picker exactly once: first visit, after the hydration
  // check returns false (and never if the user already picked or skipped).
  useEffect(() => {
    if (hasPickedPersona === false) setPersonaPickerOpen(true);
  }, [hasPickedPersona]);

  // Featured case study — driven by the admin "Feature" toggle (PATCH
  // /api/admin/case-studies/:id/feature, surfaced in /admin/case-studies).
  // The server endpoint /api/featured-case-study ALWAYS returns a row when
  // any case study exists in the DB (orders by isFeatured DESC, generatedAt
  // DESC, limit 1) — so featuredCS is the durable source of truth for the
  // homepage's industry context. No hardcoded "Insurance" defaults: if no
  // case study exists yet the hero/card sections just don't render.
  const [featuredCS, setFeaturedCS] = useState<{ industrySlug: string; industryName: string; title?: string; executiveSummary?: string } | null>(null);
  useEffect(() => {
    fetch("/api/featured-case-study")
      .then(r => r.ok ? r.json() : null)
      .then((d: { featured: { industrySlug: string; industryName: string; title: string; executiveSummary: string } | null } | null) => {
        if (d?.featured) setFeaturedCS(d.featured);
      })
      .catch(() => {});
  }, []);

  // Hero industry: prefer the admin-pinned slot, otherwise mirror the
  // featured case study. Empty strings while data is loading — link sites
  // below guard against this with `heroReady`/`cardReady` truthiness
  // checks, so we never render a broken `/case-study/` URL.
  const hero = heroSlot?.content;
  const heroSlug = hero?.industrySlug ?? featuredCS?.industrySlug ?? "";
  const heroName = hero?.industryName ?? featuredCS?.industryName ?? "";
  const heroHref = heroSlug ? `/case-study/${heroSlug}` : "#";
  const heroReady = !!heroSlug;

  // Analogy card: featured case study first, then admin-pinned card slot,
  // then mirror the hero industry (which itself derives from featuredCS).
  const card = cardSlot?.content;
  const cardSlug = featuredCS?.industrySlug ?? card?.industrySlug ?? heroSlug;
  const cardName = featuredCS?.industryName ?? card?.industryName ?? heroName;
  const cardBlurb = featuredCS?.executiveSummary ?? card?.executiveSummary ?? "";
  const cardHref = cardSlug ? `/case-study/${cardSlug}` : "#";
  const cardReady = !!cardSlug;

  // ── Live metrics for hero tiles + principle stats ──────────────────────
  const [principleStats, setPrincipleStats] = useState<PrincipleStats | null>(null);
  const [homeTiles, setHomeTiles] = useState<HomeTiles | null>(null);
  const [cviCurrent, setCviCurrent] = useState<CviCurrent | null>(null);
  const [capCount, setCapCount] = useState<number | null>(null);
  const [economicsBreakdown, setEconomicsBreakdown] = useState<{
    companyName: string;
    eventTitle: string;
    costBreakdown: Array<{ label: string; amountUsdMm: number }>;
    valueGeneratedUsdMm: number;
    unlockedUsdMm: number;
  } | null>(null);

  useEffect(() => {
    fetch("/api/metrics/principle-stats")
      .then(r => r.ok ? r.json() : null)
      .then((d: PrincipleStats | null) => setPrincipleStats(d))
      .catch(() => {});
    fetch("/api/metrics/home-tiles")
      .then(r => r.ok ? r.json() : null)
      .then((d: HomeTiles | null) => setHomeTiles(d))
      .catch(() => {});
    fetch("/api/cvi/current")
      .then(r => r.ok ? r.json() : null)
      .then((d: CviCurrent | null) => setCviCurrent(d))
      .catch(() => {});
    fetch("/api/capabilities")
      .then(r => r.ok ? r.json() : [])
      .then((d: unknown[]) => setCapCount(Array.isArray(d) ? d.length : null))
      .catch(() => {});
  }, []);

  // Fetch the analogy card's economics breakdown for the featured case study.
  // economicsBreakdown is null until populated with real public-company
  // financials (see docs/Must Fix/PLAN.md item #4). When null, the analogy
  // card falls back to a simpler layout that doesn't show invented numbers.
  useEffect(() => {
    if (!cardSlug) return;
    fetch(`/api/case-study/${cardSlug}/economics-breakdown`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { economicsBreakdown: typeof economicsBreakdown } | null) => {
        setEconomicsBreakdown(d?.economicsBreakdown ?? null);
      })
      .catch(() => {});
  }, [cardSlug]);

  const traditionalCost = economicsBreakdown?.costBreakdown?.[0];
  const capabilityCost = economicsBreakdown?.costBreakdown?.[1];
  const valueGenerated = economicsBreakdown?.valueGeneratedUsdMm;
  const unlocked = economicsBreakdown?.unlockedUsdMm;

  const principles = [
    {
      id: "01",
      title: "Identify",
      body: "Isolate the specific combinations of people, process, and technology that create distinct value in the market.",
      stat: "3–8",
      statSub: "core capabilities per org",
    },
    {
      id: "02",
      title: "Measure",
      body: "Quantify the baseline cost, performance, and revenue impact of each capability using hard economic metrics.",
      stat: principleStats ? principleStats.avgAnnualMarginCapturedFormatted : "—",
      statSub: principleStats ? `avg annual margin captured per capability (n=${principleStats.sampleSize})` : "loading…",
    },
    {
      id: "03",
      title: "Optimize",
      body: "Direct capital and leadership attention to the capabilities that drive the highest return on strategic investment.",
      stat: principleStats ? `${principleStats.medianMarginStructurePct.toFixed(0)}%` : "—",
      statSub: "median capability margin structure",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <PersonaPicker open={personaPickerOpen} onClose={() => setPersonaPickerOpen(false)} />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative border-b border-border/40 overflow-hidden">
        <div className="absolute inset-0 hero-grid-bg pointer-events-none" aria-hidden />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 pt-14 pb-0 lg:pt-20">
          {/* Eyebrow */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex items-center gap-3 mb-8"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Vol. I — The Briefing</span>
          </motion.div>

          <div className="grid lg:grid-cols-[1fr_380px] gap-0 lg:gap-20 items-end">
            {/* Left: Headline */}
            <div className="pb-16 lg:pb-20">
              <div className="overflow-hidden mb-1">
                <motion.h1
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
                  className="font-serif text-[clamp(3rem,8vw,6.5rem)] leading-[0.92] tracking-tight"
                >
                  Master the value
                </motion.h1>
              </div>
              <div className="overflow-hidden mb-8">
                <motion.h1
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.9, delay: 0.07, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
                  className="font-serif italic text-[clamp(3rem,8vw,6.5rem)] leading-[0.92] tracking-tight text-foreground/70"
                >
                  of what you can do.
                </motion.h1>
              </div>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.6, ease: "easeOut" }}
                className="font-serif text-lg lg:text-xl text-foreground/60 leading-relaxed max-w-xl italic mb-4"
              >
                The world's first probabilistic capability index — and the design-thinking workbench that helps you invent the capabilities your industry doesn't have yet. Numbers tell one story; the next move tells another.
              </motion.p>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45, duration: 0.5 }}
                className="flex flex-wrap items-center gap-2 mb-6 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground"
              >
                <Link href="/proof" className="border border-border/60 px-2 py-1 hover:border-accent hover:text-accent transition-colors">Proof: backtests</Link>
                <Link href="/workbench" className="border border-border/60 px-2 py-1 hover:border-accent hover:text-accent transition-colors">Ideate: workbench</Link>
                <Link href="/disruption" className="border border-border/60 px-2 py-1 hover:border-accent hover:text-accent transition-colors">Disruption watch</Link>
                <Link href="/patterns" className="border border-border/60 px-2 py-1 hover:border-accent hover:text-accent transition-colors">Patterns</Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.4 }}
                className="mb-8"
              >
                <WhatIsCEModal />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55, duration: 0.5, ease: "easeOut" }}
                className="flex flex-col sm:flex-row gap-3"
              >
                <Link
                  href="/workbench"
                  data-testid="hero-cta-workbench"
                  className="inline-flex h-11 items-center justify-center px-7 font-mono text-[11px] uppercase tracking-[0.18em] bg-foreground text-background hover:bg-foreground/90 transition-colors group gap-2"
                >
                  Open the Workbench
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <Link
                  href="/c-suite"
                  data-testid="hero-cta-csuite"
                  className="inline-flex h-11 items-center justify-center px-7 font-mono text-[11px] uppercase tracking-[0.18em] border border-border hover:border-accent/50 hover:text-accent transition-colors group gap-2"
                >
                  C-Suite Perspectives
                  <ArrowUpRight className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
                </Link>
                <Link
                  href={heroHref}
                  data-testid="hero-cta-case-study"
                  className="inline-flex h-11 items-center justify-center px-7 font-mono text-[11px] uppercase tracking-[0.18em] border border-border hover:border-accent/50 hover:text-accent transition-colors group gap-2"
                >
                  {heroName} Case Study
                  <ArrowUpRight className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
                </Link>
              </motion.div>
            </div>

            {/* Right: Data panel */}
            <aside className="hidden lg:flex flex-col gap-2 pb-10 self-end">
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-1 flex items-center gap-2">
                <span className="h-px w-4 bg-border/60" />
                Live capability indices
              </div>
              <MetricTile
                label="Featured industry"
                value={heroName}
                sub={hero?.executiveSummary ? hero.executiveSummary.slice(0, 60) + "…" : "Read the full case study"}
                delay={0.3}
              />
              <div className="grid grid-cols-2 gap-2">
                <MetricTile
                  label="Avg CVI Score"
                  value={cviCurrent ? cviCurrent.overallIndex.toFixed(1) : "—"}
                  sub={homeTiles?.quarterlyDelta
                    ? `${homeTiles.quarterlyDelta.direction === "up" ? "↑" : "↓"} ${Math.abs(homeTiles.quarterlyDelta.pts)} pts this quarter`
                    : "live composite"}
                  delay={0.4}
                />
                <MetricTile
                  label="Top capability margin"
                  value={homeTiles?.topROI ? homeTiles.topROI.formatted : "—"}
                  sub={homeTiles?.topROI ? homeTiles.topROI.capabilityName : "loading…"}
                  accent
                  delay={0.45}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MetricTile
                  label="Capabilities tracked"
                  value={capCount !== null ? `${capCount}` : "—"}
                  sub="Live capability ontology"
                  delay={0.5}
                />
                <MetricTile
                  label="Value unlocked"
                  value={homeTiles ? homeTiles.valueUnlocked.formatted : "—"}
                  sub="Annual margin captured (sum)"
                  delay={0.55}
                />
              </div>
              <Link
                href={heroHref}
                className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground hover:text-accent inline-flex items-center gap-1.5 mt-1 transition-colors"
              >
                Read {heroName} analysis <ArrowRight className="w-2.5 h-2.5" />
              </Link>
            </aside>
          </div>
        </div>

        <TickerBar />

        {/* Move 5: Disruption Index chip — surfaces the DVX score on the home
            hero next to the velocity ticker, paired with a link to the full
            Disruption Index page so visitors discover it organically. */}
        <div className="border-t border-border/40 bg-muted/10 py-3 px-4 sm:px-6 lg:px-10 flex flex-wrap items-center justify-between gap-3">
          <DvxChip />
          <Link href="/disruption" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            View Disruption Index → <ArrowRight className="w-2.5 h-2.5" />
          </Link>
        </div>
      </section>

      {/* ── § 00 WHAT YOU CAN DO ──────────────────────────────────────────
          Move 10 (Phase 2). New visitors land here unsure what the platform
          actually does for them. Five action cards point at the marketplace +
          network + analysis surfaces so each persona finds their wedge in
          one scroll. */}
      <section className="border-b border-border/40 bg-muted/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-20">
          <div className="mb-8">
            <div className="inline-flex items-center gap-2 mb-3">
              <span className="h-px w-5 bg-accent" />
              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ What you can do here</span>
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl tracking-tight">Five ways to use this platform</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
              Capability Economics is a marketplace + network + analysis suite. Pick the door that fits why you came.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Link href="/upload" className="block p-4 border border-border/60 rounded-lg hover:border-accent hover:bg-muted/30 transition-colors">
              <Sparkles className="w-5 h-5 text-accent mb-2" />
              <h3 className="font-serif text-base mb-1">Upload your plan</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">Drop a PDF; we extract capability claims and match them to the live graph.</p>
            </Link>
            <Link href="/marketplace" className="block p-4 border border-border/60 rounded-lg hover:border-accent hover:bg-muted/30 transition-colors">
              <span className="text-xl">🏪</span>
              <h3 className="font-serif text-base mb-1 mt-2">Browse the marketplace</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">Cited research, datasets, and templates authored by platform members.</p>
            </Link>
            <Link href="/disruption" className="block p-4 border border-border/60 rounded-lg hover:border-accent hover:bg-muted/30 transition-colors">
              <span className="text-xl">⚡</span>
              <h3 className="font-serif text-base mb-1 mt-2">Disruption Index</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">DVX score per industry — what's at active risk and what's net-new.</p>
            </Link>
            <Link href="/forum/banking" className="block p-4 border border-border/60 rounded-lg hover:border-accent hover:bg-muted/30 transition-colors">
              <span className="text-xl">💬</span>
              <h3 className="font-serif text-base mb-1 mt-2">Join the discussion</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">Per-industry forums and DMs with other capability strategists.</p>
            </Link>
            <Link href="/provenance" className="block p-4 border border-border/60 rounded-lg hover:border-accent hover:bg-muted/30 transition-colors">
              <span className="text-xl">📚</span>
              <h3 className="font-serif text-base mb-1 mt-2">See our sources</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">World Bank, Foundry, WEF, EDGAR. Not just an LLM wrapper.</p>
            </Link>
          </div>
        </div>
      </section>

      {/* ── § 01 PREMISE ─────────────────────────────────────────────────── */}
      <section className="border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-20 lg:py-28">
          <div className="grid lg:grid-cols-[220px_1fr] gap-10 lg:gap-16 mb-16">
            <div>
              <div className="inline-flex items-center gap-2 mb-4">
                <span className="h-px w-5 bg-accent" />
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ 01 — Premise</span>
              </div>
              <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl leading-[1.05] sm:leading-[1.0] tracking-tight">
                What is<br /><em className="not-italic italic text-foreground/70">capability economics?</em>
              </h2>
            </div>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
              className="font-serif text-xl lg:text-2xl text-foreground/75 leading-relaxed self-end max-w-3xl"
            >
              Think of a capability as a muscle your organization has built — like{" "}
              <em>rapid order fulfillment</em> or <em>precision underwriting</em>.
              Inflexcvi stops treating these muscles as operational processes,
              and starts treating them as{" "}
              <span className="text-foreground font-medium not-italic border-b border-accent/60">economic assets</span>{" "}
              that can be measured, valued, and invested in.
            </motion.p>
          </div>

          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.13 } } }}
            className="grid lg:grid-cols-3 border-t border-border/40"
          >
            {principles.map((p, i) => (
              <motion.div
                key={p.id}
                variants={{
                  hidden: { opacity: 0, y: 24 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
                }}
                className={`py-10 lg:py-12 ${i > 0 ? "lg:border-l lg:border-border/40 border-t lg:border-t-0 border-border/40 lg:px-10" : "lg:pr-10"}`}
              >
                <div className="font-mono text-[10px] tabular-nums tracking-[0.24em] text-accent mb-5">{p.id}</div>
                <div className="font-mono text-3xl lg:text-4xl font-light tabular-nums text-foreground/25 mb-1">{p.stat}</div>
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground mb-5">{p.statSub}</div>
                <h3 className="font-serif text-3xl lg:text-[2rem] leading-tight tracking-tight mb-3">{p.title}</h3>
                <p className="text-sm text-foreground/60 leading-relaxed">{p.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── § 02 ANALOGY ─────────────────────────────────────────────────── */}
      <section className="border-b border-border/40 bg-muted/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-20 lg:py-28">
          <div className="grid lg:grid-cols-[1fr_420px] gap-14 lg:gap-20 items-start">
            <div>
              <div className="inline-flex items-center gap-2 mb-5">
                <span className="h-px w-5 bg-accent" />
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ 02 — Analogy</span>
              </div>
              <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl leading-[1.05] sm:leading-[1.0] tracking-tight mb-8">
                The real estate<br /><em className="not-italic italic text-foreground/70">parallel.</em>
              </h2>
              <div className="space-y-5 font-serif text-lg text-foreground/70 leading-relaxed">
                <p>
                  Imagine you own a commercial building. Without knowing the square footage,
                  the rental yield per floor, or the HVAC maintenance costs — you cannot make
                  smart renovation decisions.
                </p>
                <p>
                  Most companies treat their capabilities exactly like that: opaque. They know
                  the total IT budget, but not the yield from customer onboarding versus product development.
                </p>
              </div>
              <blockquote className="font-serif text-xl text-foreground leading-relaxed mt-8 pl-5 border-l-2 border-accent">
                Inflexcvi is the blueprint and the ledger — so you renovate the floors that generate the highest returns.
              </blockquote>
            </div>

            <div className="lg:sticky lg:top-24 space-y-3">
              {economicsBreakdown && traditionalCost && capabilityCost && valueGenerated != null && unlocked != null ? (
                <>
                  <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground mb-1 flex items-center gap-2">
                    <span className="h-px w-4 bg-border/60" />
                    {economicsBreakdown.companyName} — {economicsBreakdown.eventTitle}
                  </div>
                  <div className="border border-border/50 bg-background p-6 lg:p-7">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-1.5">Traditional view</div>
                        <div className="font-serif text-2xl lg:text-3xl tracking-tight">{traditionalCost.label}</div>
                      </div>
                      <div className="font-mono text-2xl lg:text-3xl font-light tabular-nums text-foreground/40">${traditionalCost.amountUsdMm.toFixed(1)}M</div>
                    </div>
                    <div className="h-2 bg-border/40 rounded-sm overflow-hidden">
                      <div className="h-full w-full bg-muted-foreground/20 rounded-sm" />
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground mt-2">Opaque cost center — no sub-allocation visibility</div>
                  </div>
                  <div className="border border-accent/30 bg-accent/[0.04] p-6 lg:p-7 relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent" />
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-accent mb-1.5">Capability view</div>
                        <div className="font-serif text-2xl lg:text-3xl tracking-tight">{capabilityCost.label}</div>
                      </div>
                      <div className="font-mono text-2xl lg:text-3xl font-light tabular-nums text-foreground/60">${capabilityCost.amountUsdMm.toFixed(1)}M</div>
                    </div>
                    <div className="mb-3">
                      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5 flex justify-between">
                        <span>Retained value generated</span>
                        <span className="text-accent">${valueGenerated.toFixed(1)}M</span>
                      </div>
                      <div className="h-2 bg-border/40 rounded-sm overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: "80%" }}
                          viewport={{ once: true }}
                          transition={{ duration: 1.2, delay: 0.3, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
                          className="h-full bg-accent rounded-sm"
                        />
                      </div>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {(valueGenerated / capabilityCost.amountUsdMm).toFixed(1)}× return on capability investment
                    </div>
                  </div>
                  <div className="border border-border/40 bg-background p-4 flex items-center justify-between">
                    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Value unlocked with visibility</span>
                    <span className="font-serif text-xl text-accent font-medium">+${unlocked.toFixed(1)}M</span>
                  </div>
                </>
              ) : (
                // Fallback when no case study has an economics breakdown yet:
                // render the analogy as a directional callout linking to the
                // real case study, without inventing dollar values.
                <Link href={cardHref} className="block border border-border/50 bg-background p-6 lg:p-8 hover:border-accent/40 transition-colors group">
                  <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground mb-3">Featured case study — {cardName}</div>
                  <div className="font-serif text-xl lg:text-2xl tracking-tight mb-3">{card?.title ?? `${cardName} capability transformation`}</div>
                  <div className="text-sm text-foreground/70 leading-relaxed line-clamp-4 mb-4">
                    {cardBlurb}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent inline-flex items-center gap-1.5 group-hover:translate-x-0.5 transition-transform">
                    Read full case study <ArrowRight className="w-3 h-3" />
                  </div>
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── EDUCATIONAL LIBRARY ───────────────────────────────────────────── */}
      <EducationalLibrary />

      {/* ── AGENT MEMORY SHOWCASE ─────────────────────────────────────────── */}
      <AgentMemoryShowcase />

      {/* ── LEARNING PROGRESS (signed-in users only) ─────────────────────── */}
      <LearningProgress />

      {/* ── § NEXT — CTA ─────────────────────────────────────────────────── */}
      <section className="relative bg-foreground text-background overflow-hidden">
        <div className="absolute inset-0 cta-grid-bg pointer-events-none opacity-[0.04]" aria-hidden />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-20 lg:py-28">
          <div className="grid lg:grid-cols-[220px_1fr] gap-10 lg:gap-16 mb-14">
            <div>
              <div className="inline-flex items-center gap-2 mb-4">
                <span className="h-px w-5 bg-accent" />
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ Next</span>
              </div>
              <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl leading-[1.05] sm:leading-[1.0] tracking-tight">
                Continue your<br /><em className="not-italic italic text-background/60">briefing.</em>
              </h2>
            </div>
            <p className="font-serif italic text-lg text-background/60 leading-relaxed self-end max-w-2xl">
              Two paths through the framework — by industry vertical, or by the executive seat where the decisions are made.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 border-t border-background/15">
            <Link
              href={cardHref}
              data-testid="nav-card-case-study"
              className="group block lg:border-r border-background/15 py-12 lg:px-10 lg:py-14"
            >
              <div className="font-mono text-[9px] tabular-nums tracking-[0.24em] text-accent mb-5">01 — Industry</div>
              <h3 className="font-serif text-3xl lg:text-4xl leading-tight tracking-tight mb-3 group-hover:text-accent transition-colors duration-200">
                {cardName} case study
              </h3>
              <p className="text-sm text-background/55 leading-relaxed max-w-md mb-6 line-clamp-3">{cardBlurb}</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-background/60 group-hover:text-accent inline-flex items-center gap-2 transition-colors duration-200">
                Read the case <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>

            <Link
              href="/c-suite"
              data-testid="nav-card-csuite"
              className="group block py-12 border-t lg:border-t-0 border-background/15 lg:px-10 lg:py-14"
            >
              <div className="font-mono text-[9px] tabular-nums tracking-[0.24em] text-accent mb-5">02 — Role</div>
              <h3 className="font-serif text-3xl lg:text-4xl leading-tight tracking-tight mb-3 group-hover:text-accent transition-colors duration-200">
                C-Suite perspectives
              </h3>
              <p className="text-sm text-background/55 leading-relaxed max-w-md mb-6">
                How different executives leverage capability economics to drive strategy — by seat, by question, by lever.
              </p>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-background/60 group-hover:text-accent inline-flex items-center gap-2 transition-colors duration-200">
                Browse perspectives <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
