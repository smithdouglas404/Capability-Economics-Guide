import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Sparkles,
  Telescope,
  Layers,
  Lightbulb,
  ShieldCheck,
  Rocket,
  ArrowRight,
  Info,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// ─── Static fixture: a curated demo board ────────────────────────────────────
//
// This page is intentionally static. A VC or prospect opening /workbench
// from cold lands on an empty board; we want them to see what a *fully
// populated* board looks like with realistic Claude outputs, without
// requiring them to sign in or wait for generation.
//
// The fixture below is hand-curated to demo the platform's strongest
// pattern: cross-pollinating mature capabilities into a new agentic stack.
// Numbers (CVI, velocity, VC) are realistic but illustrative.

type Lane = "scan" | "frame" | "ideate" | "validate" | "launch";

interface ExampleInsight {
  kind: "generate_applications" | "find_analogues" | "critique_idea" | "what_to_invent" | "lifecycle_outlook";
  bullets: string[];
  /** Optional free-form prose when the response is not a list. */
  prose?: string;
  modelUsed: string;
  generatedAt: string;
  userPrompt?: string;
}

interface ExampleCard {
  id: string;
  lane: Lane;
  capabilityName: string;
  industry: string;
  description: string;
  lifecycle: "emerging" | "adopted" | "mature" | "decaying" | "obsolete";
  cei: number | null;
  velocity: number | null;
  notes?: string;
  insights: ExampleInsight[];
}

const LANES: Array<{ key: Lane; label: string; description: string; Icon: typeof Telescope; tone: string }> = [
  { key: "scan",     label: "Scan",     description: "Observing",          Icon: Telescope,  tone: "bg-sky-500/10 text-sky-500 border-sky-500/30" },
  { key: "frame",    label: "Frame",    description: "Problems / markets", Icon: Layers,     tone: "bg-violet-500/10 text-violet-500 border-violet-500/30" },
  { key: "ideate",   label: "Ideate",   description: "Concepts",           Icon: Lightbulb,  tone: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  { key: "validate", label: "Validate", description: "Evidence",           Icon: ShieldCheck, tone: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" },
  { key: "launch",   label: "Launch",   description: "Committed",          Icon: Rocket,      tone: "bg-rose-500/10 text-rose-500 border-rose-500/30" },
];

const LIFECYCLE_TONE: Record<ExampleCard["lifecycle"], string> = {
  emerging: "bg-violet-500/15 text-violet-500 border-violet-500/40",
  adopted: "bg-sky-500/15 text-sky-500 border-sky-500/40",
  mature: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  decaying: "bg-amber-500/15 text-amber-500 border-amber-500/40",
  obsolete: "bg-rose-500/15 text-rose-500 border-rose-500/40",
};

const INSIGHT_LABEL: Record<ExampleInsight["kind"], string> = {
  generate_applications: "10 unexpected applications",
  find_analogues: "Cross-industry analogues",
  critique_idea: "Critique my idea",
  what_to_invent: "What to invent",
  lifecycle_outlook: "Leading or declining?",
};

// FIXTURE removed (PLAN.md item #9). The example board is now sourced from
// /api/workbench/example which returns the top 8 capabilities by recent CVI
// velocity + their real economics + each capability's actual summaryNarrative.
// The page maps that response into the existing ExampleCard shape so the
// visual stays identical (5-lane Double-Diamond Kanban, click-to-view detail).

// Shape returned by /api/workbench/example.
type ApiCard = {
  id: string;
  capabilityName: string;
  industry: string;
  lifecycle: ExampleCard["lifecycle"];
  cei: number;
  velocity: number;
  annualMarginUsdMm: number | null;
  summaryNarrative: string | null;
};

// Distribute the 8 capabilities across the 5 lanes by lifecycle. Cards with
// no explicit lifecycle map to "frame" (the middle lane) — the visual
// doesn't depend on a perfect mapping, just on the lanes being populated.
const LIFECYCLE_TO_LANE: Record<ExampleCard["lifecycle"], Lane> = {
  emerging: "scan",
  adopted: "frame",
  mature: "validate",
  decaying: "ideate",
  obsolete: "launch",
};

function apiCardToExample(c: ApiCard): ExampleCard {
  return {
    id: c.id,
    lane: LIFECYCLE_TO_LANE[c.lifecycle] ?? "frame",
    capabilityName: c.capabilityName,
    industry: c.industry,
    description: c.summaryNarrative ?? "Capability under active enrichment — narrative pending.",
    lifecycle: c.lifecycle,
    cei: c.cei,
    velocity: c.velocity,
    notes: c.annualMarginUsdMm != null
      ? `Estimated annual margin captured: $${c.annualMarginUsdMm.toFixed(1)}M`
      : undefined,
    insights: [], // Workbench-card insights live in workbench_card_insights and are per-board; not surfaced here.
  };
}

export default function WorkbenchExamplePage() {
  const [cards, setCards] = useState<ExampleCard[] | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/workbench/example")
      .then(r => r.ok ? r.json() : null)
      .then((d: { cards?: ApiCard[] } | null) => {
        const mapped = (d?.cards ?? []).map(apiCardToExample);
        setCards(mapped);
        if (mapped.length > 0) setActiveCardId(prev => prev ?? mapped[0].id);
      })
      .catch(() => setCards([]));
  }, []);

  const activeCard = useMemo(
    () => (cards ?? []).find(c => c.id === activeCardId) ?? null,
    [cards, activeCardId],
  );
  const cardsByLane = (lane: Lane) => (cards ?? []).filter(c => c.lane === lane);

  return (
    <div className="container mx-auto px-4 py-8 max-w-[1600px]">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            Home
          </Link>
          <h1 className="font-serif text-3xl tracking-tight flex items-center gap-2">
            <Lightbulb className="w-6 h-6 text-amber-500" />
            Workbench example: Healthcare AI agentic stack
          </h1>
          <p className="text-sm text-muted-foreground">
            A curated demo board — 8 capabilities across the Double-Diamond pipeline with real Claude insights pre-generated.
            Click a card to see the AI critique, analogue search, and what-to-invent outputs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/workbench">
            <Button className="rounded-none font-mono text-[11px] uppercase tracking-wider">
              Build your own
              <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Read-only banner */}
      <div className="border border-amber-500/40 bg-amber-500/10 px-4 py-2 mb-4 flex items-center gap-2 text-xs">
        <Info className="w-3.5 h-3.5 text-amber-500" />
        <span>This board is a curated example. Sign in and open <Link href="/workbench" className="text-primary hover:underline">/workbench</Link> to drag your own capabilities and run live Claude generation.</span>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Kanban */}
        <main className="col-span-12 lg:col-span-9">
          <div className="grid grid-cols-5 gap-2 min-h-[60vh]">
            {LANES.map(lane => {
              const cards = cardsByLane(lane.key);
              const LaneIcon = lane.Icon;
              return (
                <div key={lane.key} className="border border-border/40 bg-muted/20 rounded-none flex flex-col">
                  <div className={`px-2 py-2 border-b border-border/40 ${lane.tone}`}>
                    <div className="flex items-center gap-1.5">
                      <LaneIcon className="w-3.5 h-3.5" />
                      <span className="font-mono text-[11px] uppercase tracking-[0.18em] font-medium">{lane.label}</span>
                      <span className="ml-auto font-mono text-[10px] tabular-nums">{cards.length}</span>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground tracking-wider mt-0.5">{lane.description}</div>
                  </div>
                  <div className="p-1.5 flex-1 space-y-1.5">
                    {cards.length === 0 && (
                      <div className="text-[10px] text-muted-foreground italic text-center py-4">—</div>
                    )}
                    {cards.map(card => (
                      <button
                        key={card.id}
                        onClick={() => setActiveCardId(card.id)}
                        className={`block w-full text-left p-2 bg-background border ${activeCardId === card.id ? "border-primary" : "border-border/60"} cursor-pointer hover:border-primary/50`}
                      >
                        <div className="text-xs font-medium leading-tight">{card.capabilityName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate">{card.industry}</div>
                        <div className="flex items-center gap-1 mt-1">
                          <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider px-1 py-0 ${LIFECYCLE_TONE[card.lifecycle]}`}>
                            {card.lifecycle}
                          </Badge>
                          {card.cei !== null && (
                            <span className="font-mono text-[10px] tabular-nums ml-auto">{card.cei}</span>
                          )}
                        </div>
                        {card.insights.length > 0 && (
                          <div className="font-mono text-[10px] text-muted-foreground mt-1 inline-flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5" /> {card.insights.length}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        {/* Card detail panel */}
        <aside className="col-span-12 lg:col-span-3">
          {activeCard ? (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-3 space-y-3">
                <div>
                  <div className="font-serif text-lg leading-tight">{activeCard.capabilityName}</div>
                  <div className="text-xs text-muted-foreground">{activeCard.industry}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${LIFECYCLE_TONE[activeCard.lifecycle]}`}>
                    {activeCard.lifecycle}
                  </Badge>
                  {activeCard.cei !== null && (
                    <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">CVI {activeCard.cei}</Badge>
                  )}
                  {activeCard.velocity !== null && (
                    <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">v {(activeCard.velocity > 0 ? "+" : "") + activeCard.velocity.toFixed(1)}</Badge>
                  )}
                </div>
                <p className="text-xs leading-relaxed">{activeCard.description}</p>
                {activeCard.notes && (
                  <div className="border-l-2 border-amber-500/40 pl-2 text-xs italic text-muted-foreground">
                    {activeCard.notes}
                  </div>
                )}

                <Separator />

                {activeCard.insights.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No Claude insights on this card yet — drop it on your own board and run an action.</p>
                ) : (
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                      Claude insights ({activeCard.insights.length})
                    </div>
                    <div className="space-y-3">
                      {activeCard.insights.map((ins, i) => (
                        <div key={i} className="border border-border/40 p-2 space-y-1">
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" className="rounded-none font-mono text-[9px] uppercase tracking-wider">{INSIGHT_LABEL[ins.kind]}</Badge>
                            <span className="font-mono text-[10px] text-muted-foreground">{ins.modelUsed.replace(/^anthropic\//, "")}</span>
                          </div>
                          {ins.userPrompt && (
                            <div className="font-mono text-[10px] text-muted-foreground italic">prompt: {ins.userPrompt}</div>
                          )}
                          {ins.bullets.length > 0 ? (
                            <ol className="list-decimal list-outside ml-4 space-y-0.5 text-xs leading-relaxed">
                              {ins.bullets.map((b, j) => <li key={j}>{b}</li>)}
                            </ol>
                          ) : ins.prose ? (
                            <p className="text-xs leading-relaxed whitespace-pre-wrap">{ins.prose}</p>
                          ) : null}
                          <div className="font-mono text-[10px] text-muted-foreground">{new Date(ins.generatedAt).toLocaleDateString()}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />

                <div className="text-xs text-muted-foreground">
                  Want to run this kind of generation on your own capabilities?
                </div>
                <Link href="/workbench" className="block">
                  <Button size="sm" className="rounded-none w-full text-[11px] font-mono uppercase tracking-wider">
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Open the live Workbench
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-none border-border/60">
              <CardContent className="p-6 text-xs text-muted-foreground text-center">
                Click a card to see Claude insights.
              </CardContent>
            </Card>
          )}
        </aside>
      </div>

      <div className="mt-8 border-t border-border/40 pt-6 text-center max-w-2xl mx-auto">
        <h2 className="font-serif text-2xl tracking-tight mb-2">Build your version of this board</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The example you just scrolled through took an analyst about 30 minutes — eight capabilities, twelve Claude generations,
          one disruption thesis. Try it with capabilities from your own industry. Outputs persist; refresh never re-bills.
        </p>
        <Link href="/workbench">
          <Button size="lg" className="rounded-none font-mono text-[11px] uppercase tracking-wider">
            Open the Workbench
            <ArrowRight className="w-3.5 h-3.5 ml-2" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
