import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Loader2,
  CheckCircle2,
  Lightbulb,
  Telescope,
  Layers,
  Building2,
  Wand2,
  FastForward,
  Eye,
  Target,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useAuth, useUser } from "@clerk/react";
import { PERSONAS, PERSONA_META, usePersona, type Persona } from "@/lib/persona";

const API_BASE = "/api";

interface Industry {
  id: number;
  name: string;
  slug: string;
}

interface OnboardingStartResp {
  boardId: number;
  boardName: string;
  cardCount: number;
  firstInsightGenerated: boolean;
  firstInsightId: number | null;
  insightError: string | null;
  industryName: string;
}

interface PreviewCapability {
  id: number;
  name: string;
  description: string | null;
  score: number | null;
  isLeaf: boolean;
}

interface PreviewResp {
  industryName: string;
  cviPreview: number | null;
  capabilities: PreviewCapability[];
}

interface SuggestResp {
  suggestedIndustry: Industry | null;
  answer: string | null;
}

/**
 * Goal options surfaced in Step 3. Persona-aware: each role sees a different
 * curated list whose phrasing maps onto how they'd describe success.
 * The selected string is passed verbatim to the board description and to the
 * concierge as a `goal` signal.
 */
const GOAL_PRESETS: Record<Persona, string[]> = {
  pe: [
    "Diligence a target's gap-to-leader",
    "Build an IC memo around cost-to-close",
    "Pressure-test an exit-multiple thesis",
  ],
  vc: [
    "Find where value is migrating in this sector",
    "Map startups onto the hottest capability nodes",
    "Stress-test a thesis with capability data",
  ],
  f500: [
    "See where we're behind our peers",
    "Sequence a build-vs-buy roadmap",
    "Pick capabilities to invest in next quarter",
  ],
  student: [
    "Learn the methodology through one industry",
    "Walk through a guided case study",
    "Map textbook ideas onto real capability data",
  ],
  professor: [
    "Pull a citable case for class",
    "Replicate the methodology on a known industry",
    "Build a problem set from real capability scores",
  ],
};

/**
 * Default-pick heuristic for "skip ahead": when the user hits "I'll set this
 * up later", pick the first goal preset for their persona (or a sensible
 * neutral default if no persona is set). Keeps the flow non-blocking.
 */
function defaultGoalFor(persona: Persona | null): string {
  if (persona) return GOAL_PRESETS[persona][0];
  return "Explore the highest-signal capabilities in this industry";
}

type Step = "role" | "industry" | "goal" | "preview" | "generating" | "ready" | "skipped";
const STEP_ORDER: Step[] = ["role", "industry", "goal", "preview"];
const STEP_LABELS: Record<Step, string> = {
  role: "Tell us about your role",
  industry: "Pick your industry",
  goal: "What does success look like",
  preview: "Preview your dashboard",
  generating: "Setting up your board",
  ready: "Your board is ready",
  skipped: "Already set up",
};

export default function OnboardingPage() {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [, setLocation] = useLocation();
  const { persona, setPersona } = usePersona();

  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<number | null>(null);
  const [goal, setGoal] = useState<string>("");
  const [freeText, setFreeText] = useState<string>("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionMsg, setSuggestionMsg] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("role");
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [result, setResult] = useState<OnboardingStartResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState("Creating your board…");

  const authedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const token = await getToken();
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
    });
  }, [getToken]);

  // Initial load: industries + onboarding state.
  useEffect(() => {
    if (!isLoaded) return;
    if (!user) return;
    fetch(`${API_BASE}/industries`).then(r => r.ok ? r.json() : []).then((d: Industry[]) => {
      const sorted = [...(d ?? [])].sort((a, b) => a.name.localeCompare(b.name));
      setIndustries(sorted);
      if (sorted.length > 0) setIndustryId(prev => prev ?? sorted[0].id);
    }).catch(() => {});

    void (async () => {
      try {
        const r = await authedFetch(`${API_BASE}/onboarding/state`);
        if (r.ok) {
          const j = await r.json() as { completed: boolean; boardCount: number };
          if (j.completed) setStep("skipped");
        }
      } catch {
        // Ignore — show the onboarding flow.
      }
    })();
  }, [isLoaded, user, authedFetch]);

  // Live-fetch preview whenever the user lands on the preview step OR
  // changes the industry while on the preview step. Cancels stale requests
  // by ignoring responses for industries the user has already moved past.
  useEffect(() => {
    if (step !== "preview" || !industryId) return;
    let cancelled = false;
    setPreviewLoading(true);
    void (async () => {
      try {
        const r = await authedFetch(`${API_BASE}/onboarding/preview?industryId=${industryId}`);
        if (cancelled) return;
        if (r.ok) {
          const j = await r.json() as PreviewResp;
          setPreview(j);
        }
      } catch {
        // Preview is non-essential — silent failure keeps the flow alive.
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, industryId, authedFetch]);

  const stepIdx = STEP_ORDER.indexOf(step);
  const progressPct = stepIdx >= 0
    ? Math.round(((stepIdx + 1) / STEP_ORDER.length) * 100)
    : 100;

  const goalPresets = useMemo(() => persona ? GOAL_PRESETS[persona] : null, [persona]);

  /** Send the free-form description through the concierge workflow. */
  async function runSuggest() {
    if (freeText.trim().length < 8) return;
    setSuggesting(true);
    setSuggestionMsg(null);
    try {
      const r = await authedFetch(`${API_BASE}/onboarding/suggest`, {
        method: "POST",
        body: JSON.stringify({ description: freeText.trim(), persona }),
      });
      if (r.ok) {
        const j = await r.json() as SuggestResp;
        if (j.suggestedIndustry) {
          setIndustryId(j.suggestedIndustry.id);
          setSuggestionMsg(
            j.answer
              ? `Concierge picked ${j.suggestedIndustry.name}. ${j.answer.slice(0, 240)}`
              : `Matched to ${j.suggestedIndustry.name}.`,
          );
        } else if (j.answer) {
          setSuggestionMsg(j.answer.slice(0, 280));
        } else {
          setSuggestionMsg("Couldn't auto-match an industry — pick one below.");
        }
      } else {
        setSuggestionMsg("Suggestion service unavailable — pick an industry manually.");
      }
    } catch {
      setSuggestionMsg("Suggestion service unavailable — pick an industry manually.");
    } finally {
      setSuggesting(false);
    }
  }

  function next() {
    const i = STEP_ORDER.indexOf(step);
    if (i >= 0 && i < STEP_ORDER.length - 1) setStep(STEP_ORDER[i + 1]);
  }
  function back() {
    const i = STEP_ORDER.indexOf(step);
    if (i > 0) setStep(STEP_ORDER[i - 1]);
  }

  /** Skip to the end: keep whatever choices the user has already made, fill
   * any gaps with sensible defaults, and run the generate step. */
  function skipToEnd() {
    if (!industryId && industries.length > 0) setIndustryId(industries[0].id);
    const effectiveGoal = goal.trim() || defaultGoalFor(persona);
    setGoal(effectiveGoal);
    // Defer one tick so industryId state lands before start().
    setTimeout(() => { void start(effectiveGoal); }, 0);
  }

  async function start(effectiveGoal?: string) {
    if (!industryId) return;
    setStep("generating");
    setErr(null);
    setProgressMsg("Creating your board…");

    const interval = window.setInterval(() => {
      setProgressMsg(p => {
        if (p.startsWith("Creating")) return "Picking the top 5 capabilities in your industry…";
        if (p.startsWith("Picking")) return "Asking Claude for a lifecycle outlook on the first capability…";
        if (p.startsWith("Asking")) return "Almost there…";
        return p;
      });
    }, 4000);

    try {
      const r = await authedFetch(`${API_BASE}/onboarding/start`, {
        method: "POST",
        body: JSON.stringify({
          industryId,
          persona,
          goal: (effectiveGoal ?? goal).trim() || null,
          freeFormDescription: freeText.trim() || null,
        }),
      });
      window.clearInterval(interval);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as OnboardingStartResp;
      setResult(j);
      setStep("ready");
      window.setTimeout(() => {
        setLocation(`/workbench?board=${j.boardId}`);
      }, 4000);
    } catch (e) {
      window.clearInterval(interval);
      setErr(e instanceof Error ? e.message : "Failed to start onboarding");
      setStep("preview");
    }
  }

  if (!isLoaded) {
    return <div className="p-8 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }
  if (!user) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <h1 className="font-serif text-3xl tracking-tight mb-2">Welcome to Inflexcvi</h1>
        <p className="text-sm text-muted-foreground mb-4">Sign in to set up your first workbench board.</p>
        <Link href="/sign-in"><Button>Sign in</Button></Link>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Layout: progress rail + per-step card + persistent skip-to-end button.
  // ──────────────────────────────────────────────────────────────────────
  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl space-y-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Home
        </Link>
        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider mb-2">
          <Sparkles className="w-3 h-3 mr-1 inline text-amber-500" />
          90-second guided onboarding
        </Badge>
        <h1 className="font-serif text-4xl tracking-tight leading-tight">Let's get you on the workbench.</h1>
        <p className="text-base text-muted-foreground mt-2 max-w-2xl">
          Five quick choices and a live preview before we generate your board. Skip ahead any time.
        </p>
      </div>

      {/* Progress rail — visible during the guided steps. */}
      {stepIdx >= 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Step {stepIdx + 1} of {STEP_ORDER.length} — {STEP_LABELS[step]}
            </p>
            <button
              onClick={skipToEnd}
              disabled={!industryId}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-40 inline-flex items-center gap-1"
            >
              <FastForward className="w-3 h-3" />
              I'll set this up later
            </button>
          </div>
          <Progress value={progressPct} className="h-1 rounded-none" />
        </div>
      )}

      {step === "skipped" && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <h2 className="font-serif text-xl tracking-tight">You're already set up</h2>
            </div>
            <p className="text-sm text-muted-foreground">You have one or more workbench boards already. Skip ahead to start working on them.</p>
            <Link href="/workbench"><Button className="rounded-none">Open the workbench <ArrowRight className="w-3.5 h-3.5 ml-1" /></Button></Link>
          </CardContent>
        </Card>
      )}

      {/* STEP 1 — ROLE / PERSONA + optional free-form concierge ───────── */}
      {step === "role" && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-serif text-xl tracking-tight">Who are you reading this as?</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              We use this to reframe every page in the language of your job. You can change it any time from the header chip.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {PERSONAS.map(p => {
                const meta = PERSONA_META[p];
                const active = persona === p;
                return (
                  <button
                    key={p}
                    onClick={() => setPersona(p)}
                    className={`p-3 text-left border transition-colors ${active ? "border-primary bg-primary/5" : "border-border/40 hover:border-primary/40"}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg leading-none">{meta.emoji}</span>
                      <span className="font-medium text-sm">{meta.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">{meta.blurb}</p>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-border/40 pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Wand2 className="w-3.5 h-3.5 text-amber-500" />
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Or just describe what you're working on
                </p>
              </div>
              <Textarea
                value={freeText}
                onChange={e => setFreeText(e.target.value)}
                placeholder="e.g. I'm a CFO at a regional bank looking at digital-banking risk."
                rows={3}
                className="text-sm"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={runSuggest}
                  disabled={suggesting || freeText.trim().length < 8}
                  className="rounded-none"
                  size="sm"
                >
                  {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Wand2 className="w-3.5 h-3.5 mr-1" />}
                  Ask the concierge
                </Button>
                {suggestionMsg && (
                  <p className="text-xs text-muted-foreground italic flex-1 line-clamp-2 min-w-[200px]">{suggestionMsg}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={next} className="rounded-none">
                Continue <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 2 — INDUSTRY ─────────────────────────────────────────────── */}
      {step === "industry" && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-serif text-xl tracking-tight">Pick your industry</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              You can create more boards later for other industries.
            </p>
            {suggestionMsg && (
              <div className="border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground italic">
                Concierge suggestion: {suggestionMsg}
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[360px] overflow-y-auto">
              {industries.map(i => (
                <button
                  key={i.id}
                  onClick={() => setIndustryId(i.id)}
                  className={`p-3 text-left text-sm border ${industryId === i.id ? "border-primary bg-primary/5" : "border-border/40 hover:border-primary/40"} transition-colors`}
                >
                  {i.name}
                </button>
              ))}
              {industries.length === 0 && (
                <p className="text-sm text-muted-foreground col-span-3">No industries loaded yet — try refreshing.</p>
              )}
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={back} className="rounded-none"><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back</Button>
              <Button onClick={next} disabled={!industryId} className="rounded-none">
                Continue <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 3 — GOAL ─────────────────────────────────────────────────── */}
      {step === "goal" && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-serif text-xl tracking-tight">What does success look like?</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Pick the framing closest to your job. We'll seed your board around it. You can rewrite it in your own words if none fit.
            </p>
            {goalPresets && (
              <div className="space-y-2">
                {goalPresets.map(g => (
                  <button
                    key={g}
                    onClick={() => setGoal(g)}
                    className={`block w-full p-3 text-left text-sm border ${goal === g ? "border-primary bg-primary/5" : "border-border/40 hover:border-primary/40"} transition-colors`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Or describe it in your own words
              </p>
              <Textarea
                value={goal}
                onChange={e => setGoal(e.target.value)}
                placeholder="e.g. Decide whether to acquire CompanyX next quarter."
                rows={2}
                className="text-sm"
              />
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={back} className="rounded-none"><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back</Button>
              <Button onClick={next} className="rounded-none">
                Preview <Eye className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 4 — LIVE PREVIEW ─────────────────────────────────────────── */}
      {step === "preview" && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-serif text-xl tracking-tight">Here's what you'll land on</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              The five highest-signal capabilities for {preview?.industryName ?? "your industry"}. We'll generate a Claude lifecycle outlook on the first one before redirecting you.
            </p>

            {previewLoading && (
              <div className="border border-border/40 p-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading preview…
              </div>
            )}

            {!previewLoading && preview && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3 border border-border/40 p-4">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Industry</div>
                    <div className="font-medium text-sm">{preview.industryName}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Mini CVI</div>
                    <div className="font-serif text-2xl tracking-tight">
                      {preview.cviPreview ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Cards seeded</div>
                    <div className="font-serif text-2xl tracking-tight">{preview.capabilities.length}</div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Key capabilities
                  </p>
                  {preview.capabilities.map((c, i) => (
                    <div key={c.id} className="flex items-start gap-3 border border-border/40 p-3">
                      <div className="font-mono text-[10px] text-muted-foreground w-6 pt-0.5">{String(i + 1).padStart(2, "0")}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        {c.description && (
                          <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{c.description}</div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-serif text-lg tracking-tight">{c.score ?? "—"}</div>
                        <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                          {c.isLeaf ? "leaf" : "rollup"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {goal && (
                  <div className="border border-border/40 px-3 py-2 text-sm">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mr-2">Goal</span>
                    <span className="italic">{goal}</span>
                  </div>
                )}
              </div>
            )}

            {err && <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-3 py-2 text-sm font-mono">{err}</div>}

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={back} className="rounded-none"><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back</Button>
              <Button onClick={() => start()} disabled={!industryId} className="rounded-none">
                Generate my board <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Typical: 8-25 seconds while Claude generates the first insight.
            </p>
          </CardContent>
        </Card>
      )}

      {/* GENERATING ────────────────────────────────────────────────────── */}
      {step === "generating" && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-10 text-center space-y-4">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-amber-500" />
            <h2 className="font-serif text-2xl tracking-tight">Setting up your board</h2>
            <p className="text-sm text-muted-foreground">{progressMsg}</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Do not refresh — this runs once
            </p>
          </CardContent>
        </Card>
      )}

      {/* READY ─────────────────────────────────────────────────────────── */}
      {step === "ready" && result && (
        <Card className="rounded-none border-emerald-500/40 bg-emerald-500/[0.04]">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <h2 className="font-serif text-2xl tracking-tight">Your board is ready</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Industry</div>
                <div className="font-medium">{result.industryName}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Cards seeded</div>
                <div className="font-medium">{result.cardCount}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">First Claude insight</div>
                <div className="font-medium">{result.firstInsightGenerated ? "Generated ✓" : `Skipped${result.insightError ? ` (${result.insightError.slice(0, 60)}…)` : ""}`}</div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Taking you to the workbench in 4 seconds…</p>
            <Link href={`/workbench?board=${result.boardId}`}>
              <Button className="rounded-none">Take me to my board <ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* What we'll do — collapsed informational footer during the guided
       * steps so the user sees the value-prop without it dominating. */}
      {stepIdx >= 0 && (
        <Card className="rounded-none border-border/40 bg-muted/20">
          <CardContent className="p-4 space-y-2">
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-2"><Layers className="w-3 h-3 mt-0.5 shrink-0" /><span>Create a board with the 5 highest-signal capabilities in your industry</span></li>
              <li className="flex items-start gap-2"><Telescope className="w-3 h-3 mt-0.5 shrink-0" /><span>Run them through Scan → Frame → Ideate → Validate → Launch</span></li>
              <li className="flex items-start gap-2"><Lightbulb className="w-3 h-3 mt-0.5 shrink-0" /><span>Pre-generate a Claude lifecycle outlook on the first card</span></li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
