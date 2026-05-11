import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth, useUser } from "@clerk/react";

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

type Step = "pick_industry" | "generating" | "ready" | "skipped";

export default function OnboardingPage() {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [, setLocation] = useLocation();
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<number | null>(null);
  const [step, setStep] = useState<Step>("pick_industry");
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

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) return;
    fetch(`${API_BASE}/industries`).then(r => r.ok ? r.json() : []).then((d: Industry[]) => {
      const sorted = [...(d ?? [])].sort((a, b) => a.name.localeCompare(b.name));
      setIndustries(sorted);
      if (sorted.length > 0) setIndustryId(sorted[0].id);
    }).catch(() => {});

    // If the user already has boards, they shouldn't see onboarding — bounce
    // to /workbench.
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

  async function start() {
    if (!industryId) return;
    setStep("generating");
    setErr(null);
    setProgressMsg("Creating your board…");

    // Sequence of progress hints — the actual server work is one POST,
    // but we cycle messages while it runs (typical 8-25s for Claude).
    const interval = window.setInterval(() => {
      setProgressMsg(prev => {
        if (prev.startsWith("Creating")) return "Picking the top 5 capabilities in your industry…";
        if (prev.startsWith("Picking")) return "Asking Claude for a lifecycle outlook on the first capability…";
        if (prev.startsWith("Asking")) return "Almost there…";
        return prev;
      });
    }, 4000);

    try {
      const r = await authedFetch(`${API_BASE}/onboarding/start`, {
        method: "POST",
        body: JSON.stringify({ industryId }),
      });
      window.clearInterval(interval);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as OnboardingStartResp;
      setResult(j);
      setStep("ready");
      // Auto-redirect after 4s. User can also click "Take me to my board" sooner.
      window.setTimeout(() => {
        setLocation(`/workbench?board=${j.boardId}`);
      }, 4000);
    } catch (e) {
      window.clearInterval(interval);
      setErr(e instanceof Error ? e.message : "Failed to start onboarding");
      setStep("pick_industry");
    }
  }

  if (!isLoaded) {
    return <div className="p-8 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }
  if (!user) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <h1 className="font-serif text-3xl tracking-tight mb-2">Welcome to Capability Economics</h1>
        <p className="text-sm text-muted-foreground mb-4">Sign in to set up your first workbench board.</p>
        <Link href="/sign-in"><Button>Sign in</Button></Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl space-y-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Home
        </Link>
        <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider mb-2">
          <Sparkles className="w-3 h-3 mr-1 inline text-amber-500" />
          90-second onboarding
        </Badge>
        <h1 className="font-serif text-4xl tracking-tight leading-tight">Let's get you on the workbench.</h1>
        <p className="text-base text-muted-foreground mt-2 max-w-2xl">
          Pick the industry you care about. We'll seed a board with the five highest-signal capabilities
          and ask Claude for a lifecycle outlook on the first one — so you land on something real, not an empty kanban.
        </p>
      </div>

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

      {step === "pick_industry" && (
        <>
          <Card className="rounded-none border-border/60">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <h2 className="font-serif text-xl tracking-tight">Step 1 — pick an industry</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Choose the industry you want to ideate against. You can create more boards later for other industries.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
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
            </CardContent>
          </Card>

          <Card className="rounded-none border-border/60">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h2 className="font-serif text-xl tracking-tight">Step 2 — we'll do the rest</h2>
              </div>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2"><Layers className="w-3.5 h-3.5 mt-1 text-muted-foreground shrink-0" /><span>Create a board named "Welcome — [Industry] starter board"</span></li>
                <li className="flex items-start gap-2"><Telescope className="w-3.5 h-3.5 mt-1 text-muted-foreground shrink-0" /><span>Add the 5 highest-signal capabilities (top CEI × confidence, leaf preferred)</span></li>
                <li className="flex items-start gap-2"><Lightbulb className="w-3.5 h-3.5 mt-1 text-muted-foreground shrink-0" /><span>Generate a Claude lifecycle outlook on the first card so you land on real content</span></li>
              </ul>
              {err && <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-3 py-2 text-sm font-mono">{err}</div>}
              <Button onClick={start} disabled={!industryId} className="rounded-none">
                Start onboarding <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Typical: 8-25 seconds while Claude generates the first insight.
              </p>
            </CardContent>
          </Card>
        </>
      )}

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
    </div>
  );
}
