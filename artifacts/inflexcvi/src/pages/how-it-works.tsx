/**
 * /how-it-works — visual 9-stage methodology infographic.
 *
 * Spec: deck p3 "The CE Workbench Way" — Bottom-up agentic methodology;
 * autonomous, continuous, persistent. Five cards in row 1 + four cards
 * in row 2, color-tinted by underlying engine (Perplexity / Claude / Mem0).
 * Legend at bottom.
 *
 * This is the *visual* counterpart to /methodology (which is the
 * white-paper text deep-dive). Different audience: this is the at-a-glance
 * "what does the engine do."
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Globe2, Search, Sigma, Calculator, Crosshair, Network, Users, Bell, BookOpen, Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";

type Source = "perplexity" | "claude" | "mem0";

interface Stage {
  num: string;
  title: string;
  subtitle: string;
  source: Source;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
}

const STAGES: Stage[] = [
  { num: "01", title: "Industry Scan",   subtitle: "Map capability landscape",      source: "perplexity", icon: Globe2,    href: "/knowledge-graph" },
  { num: "02", title: "Deep Research",   subtitle: "Perplexity multi-source",       source: "perplexity", icon: Search,    href: "/vcr" },
  { num: "03", title: "Triangulation",   subtitle: "Claude reasoning engine",       source: "claude",     icon: Sigma,     href: "/methodology" },
  { num: "04", title: "Scoring",         subtitle: "Bayesian consensus",            source: "claude",     icon: Calculator, href: "/methodology" },
  { num: "05", title: "Quadrant Map",    subtitle: "Hot / Emerging / Cooling",      source: "claude",     icon: Crosshair, href: "/console" },
  { num: "06", title: "Graph Build",     subtitle: "Dependencies + clusters",       source: "perplexity", icon: Network,   href: "/knowledge-graph" },
  { num: "07", title: "C-Suite Lens",    subtitle: "Role-specific perspectives",    source: "perplexity", icon: Users,     href: "/c-suite" },
  { num: "08", title: "Alert Engine",    subtitle: "Continuous monitoring",         source: "perplexity", icon: Bell,      href: "/insights" },
  { num: "09", title: "Memory",          subtitle: "Mem0 persistence",              source: "mem0",       icon: BookOpen,  href: "/agent-radar" },
];

const TONE: Record<Source, { ring: string; bg: string; num: string; dot: string; label: string }> = {
  perplexity: { ring: "border-blue-500/40",   bg: "bg-blue-500/5",   num: "text-blue-500",   dot: "bg-blue-500",   label: "Perplexity Research" },
  claude:     { ring: "border-amber-500/40",  bg: "bg-amber-500/5",  num: "text-amber-500",  dot: "bg-amber-500",  label: "Claude Reasoning" },
  mem0:       { ring: "border-violet-500/40", bg: "bg-violet-500/5", num: "text-violet-500", dot: "bg-violet-500", label: "Mem0 Memory" },
};

export default function HowItWorksPage() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl space-y-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>

      <PageHeader
        eyebrow="The Solution"
        title="The CE Workbench Way"
        descriptions={{
          default: "Nine-stage bottom-up agentic methodology — autonomous, continuous, persistent. Each stage is one node in the live research engine; the colored dots map each step to the underlying primitive (Perplexity / Claude / Mem0).",
          pe: "Diligence pipeline. Stages 01–05 produce the deal-ready capability scorecard; stages 06–08 run the watch-list and surface drift; stage 09 retains everything for the next deal.",
          vc: "Thesis pipeline. The bottom-up scan (01-02) replaces top-down sector funnels; the alert engine (08) flags new categories 3 quarters before consensus.",
          f500: "Strategy pipeline. The C-Suite Lens (07) translates the same capability gap into CEO / CFO / CTO / CHRO framings so the bench can argue the same number with one source of truth.",
          student: "Walk these stages in order; each one is a real service in the codebase. Click any stage to jump to where it's surfaced.",
          professor: "The methodology white paper at /methodology has the math; this is the operational view of the same engine.",
        }}
      />

      {/* Row 1 — 5 cards. Row 2 — 4 cards, centered. */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {STAGES.slice(0, 5).map(s => <StageCard key={s.num} stage={s} />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {STAGES.slice(5).map(s => <StageCard key={s.num} stage={s} />)}
        </div>
      </div>

      {/* Legend */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground mr-2">Engines</span>
          {(["perplexity", "claude", "mem0"] as Source[]).map(s => (
            <span key={s} className="inline-flex items-center gap-1.5 text-sm">
              <span className={`w-2.5 h-2.5 rounded-full ${TONE[s].dot}`} />
              <span>{TONE[s].label}</span>
            </span>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground leading-relaxed">
          Each stage is a live service in the codebase, not a slide. The full pipeline runs on a cron schedule;
          you can audit any score back through the triangulation, the cited sources, and the Bayesian posterior at{" "}
          <Link href="/methodology" className="text-accent hover:underline">/methodology</Link>{" "}and{" "}
          <Link href="/provenance" className="text-accent hover:underline">/provenance</Link>.
        </CardContent>
      </Card>

      <MethodologyQABox />
    </div>
  );
}

/**
 * Inline Q&A box — sends a question to /api/nl-query (the same Claude RAG
 * pipeline that powers the global nav search). Surfaced here so a reader can
 * stay on the page and ask a clarifying question about the methodology without
 * jumping into the full assistant surface.
 */
function MethodologyQABox() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask() {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const sessionToken = typeof window !== "undefined" ? localStorage.getItem("ce_session_token") ?? undefined : undefined;
      const res = await fetch("/api/nl-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, sessionToken }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { response?: string };
      setAnswer(data.response ?? "(no response)");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <h3 className="font-serif text-lg tracking-tight">Ask anything about the methodology</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Live Q&amp;A grounded in the engine&apos;s knowledge graph + cited sources. Try &ldquo;how is confidence computed?&rdquo; or &ldquo;what's the difference between a posterior mean and a benchmark score?&rdquo;
        </p>
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault();
            void ask();
          }}
        >
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="What would you like to know?"
            disabled={loading}
          />
          <Button type="submit" disabled={loading || !query.trim()}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Ask"}
          </Button>
        </form>
        {error && (
          <div className="border border-rose-500/30 bg-rose-500/[0.05] p-3 rounded-none space-y-1">
            <p className="text-xs text-rose-600 dark:text-rose-400">
              Couldn&apos;t reach the Q&amp;A service ({error}). The platform&apos;s synthesis agent may be cold-starting.
            </p>
            <p className="text-xs">
              Try again in a few seconds, or use the full assistant at{" "}
              <a href="/nl-query" className="underline">/nl-query</a> which has retry + history.
            </p>
          </div>
        )}
        {answer && (
          <div className="mt-2 px-4 py-3 rounded-none border border-border/60 bg-muted/40 text-sm leading-relaxed whitespace-pre-wrap">
            {answer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StageCard({ stage }: { stage: Stage }) {
  const tone = TONE[stage.source];
  const Icon = stage.icon;
  const inner = (
    <Card className={`border ${tone.ring} ${tone.bg} h-full transition-transform hover:scale-[1.01]`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className={`font-serif text-3xl tabular-nums ${tone.num}`}>{stage.num}</div>
          <Icon className={`w-4 h-4 ${tone.num}`} />
        </div>
        <div className="font-serif text-lg tracking-tight mt-2">{stage.title}</div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{stage.subtitle}</p>
        {stage.href && (
          <div className="mt-3 inline-flex items-center gap-1 text-[10px] text-muted-foreground-soft hover:text-foreground">
            <span className="font-mono uppercase tracking-wider">{stage.href}</span>
            <ArrowRight className="w-2.5 h-2.5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
  return stage.href ? <Link href={stage.href} className="block h-full">{inner}</Link> : inner;
}
