/**
 * AI tour guide — persistent chat panel that knows what page you're on and
 * who you are (persona). Lives in the root layout so it's available on
 * every page; floats in the bottom-right with a launcher button.
 *
 * Talks to /api/tour-guide/chat which streams responses through OpenRouter
 * via the Vercel AI SDK. System prompt is composed server-side from the
 * persona + the page context this component sends.
 *
 * Why this exists: the app has 68 pages and visitors can't tell what
 * they're for. The guide answers "what is this and what should I do?"
 * tailored to PE / VC / F500 / student / professor. Move 1 of the
 * strategic UX overhaul plan — see memory/strategic_ux_overhaul.md.
 */
import { useCallback, useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useChat } from "@ai-sdk/react";
import { MessageCircle, X, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePersona, PERSONA_META } from "@/lib/persona";
import { cn } from "@/lib/utils";

/**
 * Page → summary map. Keeps the system prompt grounded without requiring
 * each page to register itself. The guide can answer "what does this page
 * show" without the user having to explain. Extend as new pages get the
 * persona-aware treatment from Move 2.
 *
 * Keep summaries terse — these get pasted into every prompt; longer copy
 * burns context tokens without adding signal.
 */
const PAGE_CONTEXT: Record<string, { title: string; summary: string }> = {
  "/": { title: "Home", summary: "Capability Economics landing — overview of CVI, featured case study, ticker of top movers, educational library." },
  "/companies": { title: "Companies, Value-Chain & Quadrant", summary: "Deal sourcing layer — Moneyball composites of companies, value-chain stage profile (patents/VC/startups), hot/emerging/cooling/table-stakes quadrant." },
  "/alpha": { title: "Alpha", summary: "Seven forward-causal capability-level analyses — capital flow per stage, business case ROI, EV/CVI sensitivity, etc." },
  "/cvi": { title: "Capability Value Index Dashboard", summary: "Live composite index across industries — Bayesian triangulation of capability maturity scores with macro-event sidebar." },
  "/methodology": { title: "Methodology", summary: "How CVI is calculated — Bayesian posterior model, source weights, confidence formula, worked example." },
  "/capability/:id": { title: "Capability Detail", summary: "Single capability decomposed into sub-capabilities, sources, dependencies, peer benchmark, and dependency graph." },
  "/insights": { title: "Insights & Recommendations", summary: "AI-driven strategic recommendations grounded in live CVI movement and cross-agent synthesis." },
  "/scorecard": { title: "Capability Scorecard", summary: "Your organization vs industry benchmarks per capability — gap, EVaR, moat score, AI exposure." },
  "/disruption": { title: "Disruption Watch", summary: "Two feeds: capabilities flagged for active disruption + net-new capability categories under 24 months old." },
  "/vcr": { title: "Virtual Capability Engineer", summary: "Multi-day LangGraph research agent — give it a brief, get back a structured capability report with citations." },
  "/benchmarking": { title: "Competitive Benchmarking", summary: "Pick competitors + capabilities, get the side-by-side scoring matrix." },
  "/knowledge-graph": { title: "Knowledge Graph", summary: "Industry capability landscape — 8-12 core capabilities per industry with dependencies and C-suite mappings." },
  "/regulations": { title: "Regulations", summary: "Every active regulation (HIPAA, GDPR, SOX, …) mapped to the capabilities it requires with maturity gaps." },
  "/marketplace": { title: "Marketplace", summary: "Marketplace for capability research listings + reports — currently placeholder, real listings ship in Move 4." },
};

/** Returns context for the current path, with a default fallback so the guide
 *  still works on pages we haven't registered yet. */
function contextForPath(path: string): { title: string; summary: string } {
  if (PAGE_CONTEXT[path]) return PAGE_CONTEXT[path];
  // /capability/123 → match the /capability/:id template
  if (path.startsWith("/capability/")) return PAGE_CONTEXT["/capability/:id"];
  return {
    title: path,
    summary: "A page in the Capability Economics application. The user is currently here but we don't have a registered summary — ask what they want to know.",
  };
}

interface AITourGuideProps {
  /** Optional: pages that don't want the launcher (auth pages, embeds). */
  hidden?: boolean;
}

export function AITourGuide({ hidden = false }: AITourGuideProps) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { persona } = usePersona();
  const [learningContext, setLearningContext] = useState<{
    lastVisitedAt: string | null;
    totalAiGenerations: number;
    topIndustries: string[];
  } | null>(null);

  // Load learning context for returning-user greeting
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await fetch("/api/me/learning-profile", { credentials: "include" });
        if (res.ok) {
          const j = await res.json() as { profile: { lastVisitedAt: string | null; totalAiGenerations: number; topIndustries: Array<{ name: string }> } };
          setLearningContext({
            lastVisitedAt: j.profile.lastVisitedAt,
            totalAiGenerations: j.profile.totalAiGenerations,
            topIndustries: (j.profile.topIndustries ?? []).map((i: { name: string }) => i.name),
          });
        }
      } catch { /* ignore */ }
    })();
  }, [open]);

  // useChat manages messages + streaming. Body is recomputed on every send,
  // not just on mount — so as the user navigates around the app the guide
  // sees fresh page context for each new question.
  const pageContext = useMemo(() => contextForPath(location), [location]);

  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: "/api/tour-guide/chat",
    body: {
      persona,
      pageContext: { path: location, ...pageContext },
      learningContext: learningContext ?? undefined,
    },
  });

  const personaLabel = persona ? PERSONA_META[persona].label : null;
  const personaEmoji = persona ? PERSONA_META[persona].emoji : "✨";

  const handleSuggestion = useCallback((q: string) => {
    // Manually trigger by setting input + immediately submitting via the
    // form ref. Cheaper than rolling our own send pipeline.
    handleInputChange({ target: { value: q } } as unknown as React.ChangeEvent<HTMLInputElement>);
    setTimeout(() => {
      const form = document.getElementById("tour-guide-form") as HTMLFormElement | null;
      form?.requestSubmit();
    }, 50);
  }, [handleInputChange]);

  if (hidden) return null;

  return (
    <>
      {/* Launcher button — floats bottom-right when panel is closed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 bg-foreground text-background hover:bg-foreground/90 px-4 py-3 rounded-full shadow-2xl font-medium text-sm transition-all hover:scale-105"
          aria-label="Open AI tour guide"
        >
          <Sparkles className="w-4 h-4" />
          <span>Ask the guide</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-[400px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-background border border-border rounded-lg shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 bg-foreground text-background flex items-center justify-center rounded-md">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <div className="font-serif text-sm leading-tight">Tour guide</div>
                <div className="text-[10px] text-muted-foreground leading-tight">
                  {personaLabel ? <>Reading for {personaEmoji} {personaLabel}</> : <>No persona — generic answers</>}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} className="h-7 w-7">
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Currently on <span className="font-medium text-foreground">{pageContext.title}</span>.
                  Ask me anything about what you're looking at.
                </div>
                <div className="grid gap-2">
                  {suggestionsFor(persona).map(s => (
                    <button
                      key={s}
                      onClick={() => handleSuggestion(s)}
                      className="text-left text-xs px-3 py-2 border border-border/60 hover:border-accent hover:bg-muted/30 rounded-md transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map(m => (
                <div
                  key={m.id}
                  className={cn(
                    "text-sm leading-relaxed",
                    m.role === "user" ? "text-foreground" : "text-foreground/85",
                  )}
                >
                  <div className={cn(
                    "text-[10px] uppercase tracking-wider mb-0.5",
                    m.role === "user" ? "text-accent" : "text-muted-foreground",
                  )}>
                    {m.role === "user" ? "You" : "Guide"}
                  </div>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                Thinking...
              </div>
            )}
            {error && (
              <div className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 px-3 py-2 rounded-md">
                {error.message || "Something went wrong"}
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            id="tour-guide-form"
            onSubmit={handleSubmit}
            className="flex items-center gap-2 px-3 py-2 border-t border-border/60"
          >
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              placeholder="Ask about this page..."
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
              autoFocus
            />
            <Button type="submit" size="icon" disabled={isLoading || !input.trim()} className="h-7 w-7 shrink-0">
              <Send className="w-3.5 h-3.5" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}

/** Persona-tailored starter suggestions shown before the first message. */
function suggestionsFor(persona: string | null): string[] {
  switch (persona) {
    case "pe":
      return [
        "What's the IC-memo takeaway from this page?",
        "Which capability gaps on this page have the highest EVaR?",
        "How would I size a deal off these numbers?",
      ];
    case "vc":
      return [
        "What thesis does this page support?",
        "Which startups operate at the hot nodes here?",
        "What question should I ask a founder about this?",
      ];
    case "f500":
      return [
        "Where am I behind my peers on this page?",
        "What's my build/buy/partner posture per row?",
        "Which gap should I close first?",
      ];
    case "student":
      return [
        "Explain the key concept on this page",
        "Walk me through a worked example",
        "What jargon do I need to know here?",
      ];
    case "professor":
      return [
        "What's the citable methodology behind these numbers?",
        "Could this page be assigned to students?",
        "How do I export this data for a class?",
      ];
    default:
      return [
        "What is this page for?",
        "What should I do with this?",
        "How does the math work?",
      ];
  }
}
