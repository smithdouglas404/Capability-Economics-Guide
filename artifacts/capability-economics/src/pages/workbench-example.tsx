import { useState } from "react";
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
// Numbers (CEI, velocity, VC) are realistic but illustrative.

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

const FIXTURE: ExampleCard[] = [
  // ─── SCAN ───────────────────────────────────────────────────────────
  {
    id: "agentic-orch",
    lane: "scan",
    capabilityName: "Agentic AI orchestration",
    industry: "Technology",
    description: "Multi-step LLM agents that plan, call tools, recover from failure, and persist state across sessions to complete complex business workflows.",
    lifecycle: "emerging",
    cei: 64,
    velocity: 4.2,
    notes: "Tracking velocity carefully — this category did not exist 18 months ago.",
    insights: [
      {
        kind: "generate_applications",
        modelUsed: "anthropic/claude-sonnet-4.5",
        generatedAt: "2026-05-08T14:22:00Z",
        bullets: [
          "Insurance — adjudicate first-notice-of-loss claims end-to-end without a human until exception is flagged.",
          "Healthcare — pre-authorisation workflows that read the chart, call payer APIs, and queue the rejection appeal.",
          "Sales operations — ICP-to-outreach pipelines that research, write, send, and book meetings without an SDR.",
          "Legal — contract review agents that flag deviations from preferred terms and propose redlines.",
          "Manufacturing — supply-chain agents that watch supplier health and reroute purchase orders pre-emptively.",
          "Customer support — Tier-1 resolution agents that escalate only when the user's tone signals frustration.",
          "Compliance — quarterly attestation agents that gather evidence from 12 systems and assemble the binder.",
          "Personal finance — agents that audit subscriptions and renegotiate or cancel without owner involvement.",
          "Recruiting — sourcing agents that search five platforms, score candidates, and book screens.",
          "Field service — dispatch agents that triage incidents and pre-stage parts on the truck.",
        ],
      },
      {
        kind: "lifecycle_outlook",
        modelUsed: "anthropic/claude-sonnet-4.5",
        generatedAt: "2026-05-08T14:23:18Z",
        prose: "Leading. Velocity of +4.2 over the last window is unambiguously rising, and the macro events touching this capability are positive: agentic frameworks landing in OpenAI, Anthropic, and Google SDKs within a single quarter. The 12-24 month trajectory is continued sharp ascent with the substrate consolidating around two or three foundation-model providers. Successor risk: low for the orchestration layer itself; high for the per-vertical agent vendors who'll get compressed once the substrate adds reliability primitives natively.",
        bullets: [],
      },
    ],
  },
  {
    id: "rt-fraud",
    lane: "scan",
    capabilityName: "Real-time fraud detection in payment streams",
    industry: "FinTech",
    description: "Sub-100ms decisioning on streaming payment authorizations using a mix of supervised ML and graph features.",
    lifecycle: "mature",
    cei: 82,
    velocity: 0.4,
    insights: [
      {
        kind: "find_analogues",
        userPrompt: "healthcare claims",
        modelUsed: "anthropic/claude-sonnet-4.5",
        generatedAt: "2026-05-08T15:01:42Z",
        prose: "The analogous capability in healthcare claims is *real-time claims adjudication fraud detection* — and it sits at CEI ≈ 51, two full points behind payments. The white-space gap is 31 points, with $4B of VC flowing into healthcare claims-AI startups (Cohere Health, Anomaly Insurance, Itiliti Health) and 47 active companies. First move for an operator: build a graph-features layer over the payer-provider network that mirrors the network features Stripe Radar uses on payment graphs. The capabilities you'd cross-pollinate: payer-provider claims feeds (mature), graph databases (mature), behavioural scoring (mature in payments, emerging in claims). The bottleneck is data access — payer claims feeds require BAA-grade integrations that take 9-12 months to land. Operators who already have payer relationships win this market.",
        bullets: [],
      },
    ],
  },
  {
    id: "vec-retrieval",
    lane: "scan",
    capabilityName: "Vector retrieval at billion-document scale",
    industry: "Technology",
    description: "Approximate nearest neighbour search over embeddings, supporting billions of documents with sub-second p95 latency.",
    lifecycle: "adopted",
    cei: 71,
    velocity: 1.8,
    insights: [],
  },

  // ─── FRAME ──────────────────────────────────────────────────────────
  {
    id: "healthcare-claims-whitespace",
    lane: "frame",
    capabilityName: "Healthcare claims adjudication automation",
    industry: "Healthcare",
    description: "End-to-end automation of payer claims adjudication including pre-auth, eligibility, coding review, and rejection appeals.",
    lifecycle: "emerging",
    cei: 51,
    velocity: 2.6,
    notes: "31-pt gap vs. payments fraud. Worth investigating who owns the payer-relationship moat.",
    insights: [
      {
        kind: "what_to_invent",
        userPrompt: "healthcare claims market",
        modelUsed: "anthropic/claude-sonnet-4.5",
        generatedAt: "2026-05-08T15:48:11Z",
        bullets: [
          "Cross-payer claims agent platform — combines: payer API integrations (emerging), agentic AI orchestration (emerging, see above), graph databases (mature), workflow tooling (mature), HIPAA-compliant LLM substrate (emerging). New capability: 'payer-agnostic claims agent' — works against every major payer without per-payer training. Moat: the integration breadth itself + the audit trail of accepted appeals.",
          "Patient-side claims advocacy agent — combines: consumer chat UI (mature), payer plan summaries (data set, emerging), agentic orchestration. New capability: 'patient-side claims agent' — files appeals on behalf of patients against their own insurance. Moat: brand + the trust to be granted POA on insurance correspondence.",
          "Provider-side coding copilot — combines: medical coding NLP (adopted), agentic tool-use (emerging), EHR write-back (mature). New capability: 'real-time coding correction at the point of charting' — fixes coding mistakes BEFORE the claim is filed, eliminating downstream denials. Moat: EHR integration depth.",
        ],
      },
    ],
  },
  {
    id: "regulated-llm",
    lane: "frame",
    capabilityName: "HIPAA-compliant LLM inference substrate",
    industry: "Healthcare",
    description: "Foundation-model inference with audited PHI handling, BAA-grade vendor agreements, and inspectable redaction.",
    lifecycle: "emerging",
    cei: 47,
    velocity: 3.1,
    insights: [],
  },

  // ─── IDEATE ─────────────────────────────────────────────────────────
  {
    id: "patient-claims-agent",
    lane: "ideate",
    capabilityName: "Patient-side claims advocacy agent",
    industry: "Healthcare",
    description: "Concept: a B2C agent that reviews a patient's insurance denial, drafts the appeal letter, files it on the patient's behalf, and tracks the response.",
    lifecycle: "emerging",
    cei: 32,
    velocity: 5.4,
    notes: "Validated this with two friends who got insurance denials last quarter. Both said they'd pay $40 to make it go away.",
    insights: [
      {
        kind: "critique_idea",
        userPrompt: "Patient-side appeals agent — $40 per denial, success-fee 20% of recovered amount.",
        modelUsed: "anthropic/claude-sonnet-4.5",
        generatedAt: "2026-05-08T16:12:33Z",
        prose: "Pursue, with reshapes. (1) Displaceability: the incumbent is patient inertia, not a competitor — most denials go unappealed, which is exactly the gap you'd close. Displaceable. (2) Defensibility: the *capability* of running appeals is undefended, but the moat is in the appeal-data flywheel. Every appeal teaches the next one — model this as a precedent database, not a service business. (3) Time-to-traction: 4-6 months to first paying user is realistic if you buy denied-claim leads. The risk is regulatory: filing on behalf of a patient may require power-of-attorney or HIPAA authorization in many states. Get a healthcare lawyer to scope this before building. (4) Biggest failure mode: the success-fee model creates an adverse incentive — you only appeal the high-recovery cases and ignore the small-but-righteous ones. Patients smell that. Fixed fee + free for small claims is the brand-positive shape. Verdict: reshape from success-fee to subscription ($15/mo) with included appeals.",
        bullets: [],
      },
      {
        kind: "find_analogues",
        userPrompt: "consumer financial advocacy",
        modelUsed: "anthropic/claude-haiku-4.5",
        generatedAt: "2026-05-08T16:14:02Z",
        bullets: [
          "DoNotPay applied the same pattern to traffic tickets and subscription cancellations — proves consumers will hand over POA for adversarial financial workflows.",
          "Cushion did it for bank-fee disputes — got to $1B in fees recovered before pivoting; the pivot suggests the unit economics are thinner than they look.",
          "Bilt Rewards turned rent-payment into a loyalty surface — not analogous in mechanism but proves the pattern of inserting yourself into a forced consumer payment flow.",
        ],
      },
    ],
  },
  {
    id: "ehr-coding-copilot",
    lane: "ideate",
    capabilityName: "Real-time coding correction copilot in EHR",
    industry: "Healthcare",
    description: "Concept: a copilot embedded in Epic/Cerner that catches coding errors as the physician charts, before the claim is filed. Reduces denials at the source.",
    lifecycle: "emerging",
    cei: 28,
    velocity: 6.1,
    insights: [
      {
        kind: "what_to_invent",
        modelUsed: "anthropic/claude-sonnet-4.5",
        generatedAt: "2026-05-09T09:38:21Z",
        bullets: [
          "Cross-pollinate: medical coding NLP (adopted, ICD-10 mature) + agentic tool-use over EHR APIs (emerging) + denial-pattern dataset (proprietary, must be built). New capability: 'in-the-flow coding correction' — fires while the physician types the encounter note, suggests the higher-specificity code, surfaces the denial-risk delta in real time. The Uber-style invention is the FUSION of upstream coding + downstream denial intelligence — neither alone is the product.",
          "Moat: the EHR write-back permission is the hardest part. Vendors who get Epic to whitelist them are 3-5 years ahead of vendors building outside the EHR. Distribution-as-moat.",
          "First move: pilot with a single specialty (orthopaedic surgery has the worst denial economics) at a single mid-size health system. Get to $100k ARR with one customer before pitching the next.",
        ],
      },
    ],
  },

  // ─── VALIDATE ───────────────────────────────────────────────────────
  {
    id: "claims-pilot",
    lane: "validate",
    capabilityName: "Patient-side claims advocacy agent (pilot)",
    industry: "Healthcare",
    description: "Currently piloting with 47 users recruited from r/HealthInsurance. Filing real appeals on real denials. Subscription model, no success fee.",
    lifecycle: "emerging",
    cei: 35,
    velocity: 8.2,
    notes: "47 users, $15/mo, 64% retention at 60 days. First-pass appeal success rate 41% vs. 23% industry baseline. Talking to two health-tech accelerators about a $500k pre-seed.",
    insights: [
      {
        kind: "lifecycle_outlook",
        modelUsed: "anthropic/claude-sonnet-4.5",
        generatedAt: "2026-05-09T11:14:50Z",
        prose: "Leading. Velocity of +8.2 over the last window is among the fastest-rising signals in the platform. The 41% first-pass appeal success rate is the headline number for the pre-seed pitch — it's 1.8x the industry baseline and is durable under load (you've shown it across 47 users, not a curated three). The 12-24 month risk is that one of the integrated EHR vendors (Athenahealth most likely) builds the patient-facing equivalent natively and bundles it. Counter: lock in the appeal-precedent database as the moat now, before the EHRs realize this is a distinct product line.",
        bullets: [],
      },
    ],
  },
];

export default function WorkbenchExamplePage() {
  const [activeCardId, setActiveCardId] = useState<string | null>("patient-claims-agent");
  const activeCard = FIXTURE.find(c => c.id === activeCardId) ?? null;
  const cardsByLane = (lane: Lane) => FIXTURE.filter(c => c.lane === lane);

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
                    <div className="font-mono text-[9px] text-muted-foreground tracking-wider mt-0.5">{lane.description}</div>
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
                        <div className="font-mono text-[9px] text-muted-foreground mt-0.5 truncate">{card.industry}</div>
                        <div className="flex items-center gap-1 mt-1">
                          <Badge variant="outline" className={`rounded-none font-mono text-[8px] uppercase tracking-wider px-1 py-0 ${LIFECYCLE_TONE[card.lifecycle]}`}>
                            {card.lifecycle}
                          </Badge>
                          {card.cei !== null && (
                            <span className="font-mono text-[10px] tabular-nums ml-auto">{card.cei}</span>
                          )}
                        </div>
                        {card.insights.length > 0 && (
                          <div className="font-mono text-[9px] text-muted-foreground mt-1 inline-flex items-center gap-1">
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
                    <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">CEI {activeCard.cei}</Badge>
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
                            <span className="font-mono text-[9px] text-muted-foreground">{ins.modelUsed.replace(/^anthropic\//, "")}</span>
                          </div>
                          {ins.userPrompt && (
                            <div className="font-mono text-[9px] text-muted-foreground italic">prompt: {ins.userPrompt}</div>
                          )}
                          {ins.bullets.length > 0 ? (
                            <ol className="list-decimal list-outside ml-4 space-y-0.5 text-xs leading-relaxed">
                              {ins.bullets.map((b, j) => <li key={j}>{b}</li>)}
                            </ol>
                          ) : ins.prose ? (
                            <p className="text-xs leading-relaxed whitespace-pre-wrap">{ins.prose}</p>
                          ) : null}
                          <div className="font-mono text-[9px] text-muted-foreground">{new Date(ins.generatedAt).toLocaleDateString()}</div>
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
