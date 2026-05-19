/**
 * Learning & personalization frontend utilities.
 *
 * These hooks auto-log user interactions (page views, AI stream triggers, etc.)
 * so the server can build a learning profile that the AI references across
 * sessions. Also syncs persona selection from localStorage to the server.
 */
import { useEffect, useCallback, useRef } from "react";
import { usePersona, type Persona } from "@/lib/persona";
import { useAuth } from "@clerk/react";
import { useLocation } from "wouter";

const API_BASE = "/api";

/**
 * Log an interaction event to the server. Returns the log entry ID.
 * Safe to call without auth — server returns 401 silently for unauthenticated
 * users, and we don't need to handle it here.
 */
export async function logInteraction(
  type: string,
  label: string,
  metadata: Record<string, unknown> = {},
): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE}/me/log-interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ type, label, metadata }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { id: number };
    return json.id;
  } catch {
    return null;
  }
}

/**
 * Submit thumbs-up/down feedback on an AI generation.
 */
export async function submitFeedback(
  interactionLogId: number,
  liked: boolean,
  comment?: string,
  endpoint?: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/me/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ interactionLogId, liked, comment, endpoint }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sync the user's persona from localStorage to the server-side learning profile.
 * Call this whenever the persona changes (via setPersona).
 */
export async function syncPersona(persona: Persona | null): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/me/learning/sync-persona`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ persona }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch the learning profile for the current user.
 */
export interface LearningProfileData {
  profile: {
    id: number;
    userId: string;
    persona: string | null;
    topIndustries: Array<{ slug: string; name: string; count: number }>;
    topCapabilities: Array<{ id: number; name: string; count: number }>;
    topTopics: Array<{ topic: string; count: number }>;
    totalAiGenerations: number;
    totalPageViews: number;
    lastVisitedAt: string | null;
    onboardingCompleted: boolean;
  };
  recentInteractions: Array<{
    id: number;
    type: string;
    label: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}

export async function fetchLearningProfile(): Promise<LearningProfileData | null> {
  try {
    const res = await fetch(`${API_BASE}/me/learning-profile`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return await res.json() as LearningProfileData;
  } catch {
    return null;
  }
}

/**
 * Auto-log hook — logs page views on navigation and provides a wrapper for
 * AI stream triggers. Drop this into the root layout or each page.
 *
 * Usage: In any React component:
 *   const { onPageVisit, onAiStream } = useAutoLog();
 *   // Page visits are logged automatically via the useEffect
 *   // When user triggers an AI stream:
 *   const logId = await onAiStream("insights", { industryId: 1 });
 */
export function useAutoLog() {
  const { userId, isSignedIn } = useAuth();
  const { persona } = usePersona();
  const [location] = useLocation();
  const lastPathRef = useRef("");

  // Auto-log page views on every navigation change
  useEffect(() => {
    if (!isSignedIn) return;
    if (location === lastPathRef.current) return;
    lastPathRef.current = location;

    // Derive a human-readable page title from the path
    const path = location.replace(/\/$/, "") || "/";
    let label = path;
    if (path === "/") label = "Home";
    else if (path.startsWith("/capability/")) label = "Capability detail";
    else if (path.startsWith("/account/")) label = `Account — ${path.split("/").pop()}`;
    else if (path.startsWith("/forum/")) label = `Forum — ${path.split("/").pop()}`;
    else if (path.startsWith("/case-study/")) label = `Case study — ${path.split("/").pop()}`;
    else label = path.split("/").filter(Boolean).map(s => s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())).join(" · ");

    void logInteraction("page_view", label, { path, persona });
  }, [location, isSignedIn, persona]);

  /**
   * Call this after triggering an AI stream to log it to the user's history.
   * Returns the log entry ID so it can be used for feedback.
   */
  const onAiStream = useCallback(
    async (endpoint: string, metadata: Record<string, unknown> = {}): Promise<number | null> => {
      if (!isSignedIn) return null;
      const label = metadata.label as string ?? `Generated AI brief on ${location}`;
      return logInteraction("ai_stream", label, { ...metadata, endpoint, path: location, persona });
    },
    [isSignedIn, location, persona],
  );

  return { onAiStream };
}
