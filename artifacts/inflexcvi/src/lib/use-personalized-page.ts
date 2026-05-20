/**
 * usePersonalizedPage — shared hook for loading personalized user context
 * across every page. Handles the common pattern of:
 *  1. Fetching the learning profile (top industries, persona, stats)
 *  2. Fetching "what's changed since your last visit"
 *  3. Fetching persona evolution suggestions
 *
 * Each page passes metadata about the current view so the hook can log
 * page-specific interactions automatically.
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { fetchLearningProfile, logInteraction, type LearningProfileData } from "./learning";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WhatsChanged {
  isNewUser: boolean;
  hasChanges: boolean;
  lastVisitedAt: string | null;
  newInteractions: Array<{
    id: number;
    type: string;
    label: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  newCapabilitiesSeen: Array<{ id: number; name: string; count: number }>;
  newIndustriesSeen: Array<{ slug: string; name: string; count: number }>;
  newAiGenerations: number;
  newPageViews: number;
  feedbackLiked: number;
  feedbackDisliked: number;
}

export interface PersonaSuggestion {
  suggestion: string | null;
  reason: string | null;
  currentPersona: string | null;
}

export interface PersonalizedPageData {
  /** The user's full learning profile (null while loading) */
  learningProfile: LearningProfileData | null;
  /** What's changed since last visit (null while loading) */
  whatsChanged: WhatsChanged | null;
  /** Persona evolution suggestion (null while loading) */
  personaSuggestion: PersonaSuggestion | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** Error message if any fetch failed */
  error: string | null;
  /** Force refresh all data */
  refresh: () => void;
}

const API_BASE = "/api";

async function fetchWhatsChanged(): Promise<WhatsChanged | null> {
  try {
    const res = await fetch(`${API_BASE}/me/learning/whats-changed`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return await res.json() as WhatsChanged;
  } catch {
    return null;
  }
}

async function fetchPersonaSuggestion(): Promise<PersonaSuggestion | null> {
  try {
    const res = await fetch(`${API_BASE}/me/learning/suggest-persona`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return null;
    return await res.json() as PersonaSuggestion;
  } catch {
    return null;
  }
}

/**
 * usePersonalizedPage — the one hook every page uses to get personalized context.
 *
 * @param pageMetadata - Optional metadata about the current page (for auto-logging)
 * @returns PersonalizedPageData with learning profile, what's changed, and persona suggestion
 */
export function usePersonalizedPage(pageMetadata?: {
  pageName?: string;
  industrySlug?: string;
  industryName?: string;
  capabilityId?: number;
  capabilityName?: string;
}): PersonalizedPageData {
  const { isSignedIn } = useAuth();
  const [learningProfile, setLearningProfile] = useState<LearningProfileData | null>(null);
  const [whatsChanged, setWhatsChanged] = useState<WhatsChanged | null>(null);
  const [personaSuggestion, setPersonaSuggestion] = useState<PersonaSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([
      fetchLearningProfile(),
      fetchWhatsChanged(),
      fetchPersonaSuggestion(),
    ]).then(([profile, changes, suggestion]) => {
      if (cancelled) return;
      if (profile) setLearningProfile(profile);
      if (changes) setWhatsChanged(changes);
      if (suggestion) setPersonaSuggestion(suggestion);
      setIsLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setError("Failed to load personalized data");
        setIsLoading(false);
      }
    });

    // Log page interaction if metadata provided
    if (pageMetadata?.pageName) {
      if (pageMetadata.capabilityId) {
        void logInteraction("capability_view", pageMetadata.capabilityName ?? pageMetadata.pageName, {
          capability_id: pageMetadata.capabilityId,
          capability_name: pageMetadata.capabilityName,
          page: pageMetadata.pageName,
        });
      } else if (pageMetadata.industrySlug) {
        void logInteraction("industry_select", pageMetadata.industryName ?? pageMetadata.pageName, {
          industry_slug: pageMetadata.industrySlug,
          industry_name: pageMetadata.industryName,
          page: pageMetadata.pageName,
        });
      }
    }

    return () => { cancelled = true; };
  }, [isSignedIn, refreshKey, pageMetadata?.pageName, pageMetadata?.industrySlug, pageMetadata?.capabilityId]);

  return {
    learningProfile,
    whatsChanged,
    personaSuggestion,
    isLoading,
    error,
    refresh,
  };
}

/**
 * Returns a friendly greeting based on the learning profile and what's changed.
 */
export function getPersonalizedGreeting(
  profile: LearningProfileData | null,
  changes: WhatsChanged | null,
): string {
  if (!profile) return "Welcome back";

  const topIndustry = profile.profile.topIndustries?.[0];
  const genCount = profile.profile.totalAiGenerations ?? 0;
  const newGens = changes?.newAiGenerations ?? 0;

  if (changes?.isNewUser) {
    if (topIndustry) return `Welcome — let's explore ${topIndustry.name}`;
    return "Welcome to Capability Economics";
  }

  if (newGens > 0 && topIndustry) {
    return `You generated ${newGens} new brief${newGens > 1 ? "s" : ""} since last visit · focused on ${topIndustry.name}`;
  }

  if (genCount > 0 && topIndustry) {
    return `Welcome back · ${genCount} brief${genCount > 1 ? "s" : ""} generated · exploring ${topIndustry.name}`;
  }

  if (topIndustry) return `Welcome back — ${topIndustry.name} is your focus`;

  return "Welcome back";
}

/**
 * Returns a relative time string like "2 hours ago", "3 days ago"
 */
export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
