/**
 * ReturningUserBar — a subtle top-of-page banner for returning signed-in users.
 *
 * Shows:
 *  - Personalized greeting with stats
 *  - What's changed since last visit (new briefs, new pages visited)
 *  - New capabilities/industries discovered
 *  - Persona evolution nudge when applicable
 *
 * Only renders for signed-in users with activity history.
 * Appears consistently across all pages for a unified learning-loop experience.
 */
import { useState } from "react";
import { useAuth } from "@clerk/react";
import type { PersonalizedPageData } from "@/lib/use-personalized-page";
import { getPersonalizedGreeting, timeAgo } from "@/lib/use-personalized-page";
import { useLocation } from "wouter";
import { Sparkles, X, Info } from "lucide-react";

const PERSONA_LABELS: Record<string, string> = {
  pe: "PE Investor",
  vc: "VC Analyst",
  f500: "F500 Strategist",
  student: "Student",
  professor: "Professor",
};

interface ReturningUserBarProps {
  personalized: PersonalizedPageData;
  /** Optional: total page views / AI gens to show in greeting */
  compact?: boolean;
}

export function ReturningUserBar({ personalized, compact }: ReturningUserBarProps) {
  const { isSignedIn } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [, setLocation] = useLocation();

  const { learningProfile, whatsChanged, personaSuggestion, isLoading } = personalized;

  // Only show for signed-in users with data
  if (!isSignedIn || isLoading || dismissed) return null;
  if (!learningProfile && !whatsChanged) return null;

  const profile = learningProfile?.profile;
  const hasAnyData = (profile?.totalAiGenerations ?? 0) > 0 || (profile?.totalPageViews ?? 0) > 0;
  if (!hasAnyData) return null;

  const greeting = getPersonalizedGreeting(learningProfile, whatsChanged);
  const lastVisit = profile?.lastVisitedAt ? timeAgo(profile.lastVisitedAt) : null;
  const currentPersona = profile?.persona ? PERSONA_LABELS[profile.persona] ?? profile.persona : null;

  const newGens = whatsChanged?.newAiGenerations ?? 0;
  const newViews = whatsChanged?.newPageViews ?? 0;
  const newCaps = whatsChanged?.newCapabilitiesSeen ?? [];
  const newIndustries = whatsChanged?.newIndustriesSeen ?? [];
  const hasNewActivity = newGens > 0 || newViews > 0 || newCaps.length > 0 || newIndustries.length > 0;

  return (
    <div className="relative overflow-hidden rounded-xl border border-indigo-500/20 bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-indigo-950/40 mb-6">
      {/* Subtle glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.08),transparent_60%)]" />

      <div className="relative px-5 py-4">
        {/* Top row: greeting + dismiss */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-indigo-200">
                {greeting}
              </span>
              {lastVisit && (
                <span className="text-xs text-indigo-400/70">
                  last active {lastVisit}
                </span>
              )}
              {currentPersona && (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-medium text-indigo-300 tracking-wide uppercase">
                  {currentPersona}
                </span>
              )}
            </div>

            {/* What's changed since last visit */}
            {hasNewActivity && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-indigo-300/80">
                {newGens > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-yellow-400" />
                    {newGens} new AI brief{newGens > 1 ? "s" : ""}
                  </span>
                )}
                {newViews > 0 && (
                  <span>
                    {newViews} page{newViews > 1 ? "s" : ""} visited
                  </span>
                )}
                {newCaps.length > 0 && (
                  <span>
                    explored {newCaps.map(c => c.name).join(", ")}
                  </span>
                )}
                {newIndustries.length > 0 && (
                  <span>
                    discovered {newIndustries.map(i => i.name).join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded-md p-1 text-indigo-400/60 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick-action links */}
        {!compact && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {newGens > 0 && (
              <QuickLink
                label={`View ${newGens} recent brief${newGens > 1 ? "s" : ""}`}
                onClick={() => setLocation("/insights")}
              />
            )}
            {newCaps.length > 0 && (
              <QuickLink
                label={`Explore ${newCaps[0].name}${newCaps.length > 1 ? ` +${newCaps.length - 1} more` : ""}`}
                onClick={() => setLocation("/capability/" + newCaps[0].id)}
              />
            )}
            <QuickLink
              label="Learning dashboard"
              onClick={() => setLocation("/account/learning")}
            />
          </div>
        )}

        {/* Persona evolution nudge */}
        {personaSuggestion?.suggestion && personaSuggestion.reason && (
          <PersonaNudge
            suggestion={personaSuggestion.suggestion}
            reason={personaSuggestion.reason}
            currentPersona={currentPersona}
          />
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function QuickLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-200 transition-colors"
    >
      {label}
    </button>
  );
}

function PersonaNudge({
  suggestion,
  reason,
  currentPersona,
}: {
  suggestion: string;
  reason: string;
  currentPersona: string | null;
}) {
  const [, setLocation] = useLocation();
  const newLabel = PERSONA_LABELS[suggestion] ?? suggestion;
  const [dismissedNudge, setDismissedNudge] = useState(false);

  if (dismissedNudge) return null;

  return (
    <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-950/20 px-3 py-2">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-amber-300">
            Consider switching to {newLabel}
          </p>
          <p className="mt-0.5 text-[11px] text-amber-400/70">{reason}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={() => {
                setDismissedNudge(true);
                setLocation("/account/learning");
              }}
              className="text-[11px] font-medium text-amber-400 hover:text-amber-300 transition-colors"
            >
              Switch persona
            </button>
            <button
              onClick={() => setDismissedNudge(true)}
              className="text-[11px] text-amber-500/60 hover:text-amber-400 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
