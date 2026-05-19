/**
 * Persona system — every visitor self-identifies as one of five roles on
 * first visit (or skips, in which case we render `default` copy). The role
 * is stored in localStorage under `ce_persona` so subsequent visits remember
 * the choice; pages read it to render persona-tailored descriptions, and
 * Move 3 (artifact exports) re-uses it to pick the right narrative tone.
 *
 * The whole point of this system is the user's strategic ask 2026-05-19:
 * the same dashboard view is wrong for a PE associate, a VC partner,
 * a Fortune 500 CTO, a student, or a professor. Persona-aware framing
 * gives each one a sentence at the top of every page that says
 * "here's what this means *for you*."
 *
 * Adding a new persona:
 *   1. Add to the `PERSONAS` array below
 *   2. Update every PageHeader callsite's `descriptions` map to include
 *      a copy variant for it (TS will flag missing ones if you make the
 *      field required — currently we render `default` when a persona's
 *      copy is missing, so it's safe-by-default)
 */
import { useEffect, useState, useSyncExternalStore } from "react";

export const PERSONAS = ["pe", "vc", "f500", "student", "professor"] as const;
export type Persona = typeof PERSONAS[number];

export interface PersonaMeta {
  id: Persona;
  label: string;
  blurb: string;
  emoji: string;
}

export const PERSONA_META: Record<Persona, PersonaMeta> = {
  pe: {
    id: "pe",
    label: "Private Equity",
    blurb: "Gap-to-leader, cost-to-close, exit-multiple sensitivity for diligence and IC memos.",
    emoji: "💼",
  },
  vc: {
    id: "vc",
    label: "Venture Capital",
    blurb: "Where value is migrating in a sector and which startups sit on the hot nodes.",
    emoji: "🚀",
  },
  f500: {
    id: "f500",
    label: "Fortune 500",
    blurb: "Where you're behind your peers, your build-vs-buy roadmap, capabilities to invest in.",
    emoji: "🏢",
  },
  student: {
    id: "student",
    label: "Student",
    blurb: "Learn capability economics through guided paths, glossary, and worked examples.",
    emoji: "🎓",
  },
  professor: {
    id: "professor",
    label: "Professor",
    blurb: "Citable methodology, replication datasets, and ready-to-assign case studies.",
    emoji: "📚",
  },
};

const STORAGE_KEY = "ce_persona";

function readPersona(): Persona | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return (PERSONAS as readonly string[]).includes(raw) ? (raw as Persona) : null;
  } catch {
    return null;
  }
}

function subscribePersona(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent): void => {
    if (e.key === STORAGE_KEY) callback();
  };
  const customHandler = (): void => callback();
  window.addEventListener("storage", handler);
  window.addEventListener("ce-persona-changed", customHandler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("ce-persona-changed", customHandler);
  };
}

/**
 * Reactive persona accessor. Returns the current value plus a setter that
 * writes to localStorage and notifies every other usePersona() subscriber
 * on the page so the entire UI re-renders coherently when the user picks
 * a new role from the header chip.
 */
export function usePersona(): {
  persona: Persona | null;
  setPersona: (p: Persona | null) => void;
} {
  const persona = useSyncExternalStore(subscribePersona, readPersona, () => null);
  const setPersona = (p: Persona | null): void => {
    if (typeof window === "undefined") return;
    try {
      if (p === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, p);
      window.dispatchEvent(new Event("ce-persona-changed"));
    } catch {
      // localStorage disabled — degrade silently to a session-only choice
    }
  };
  return { persona, setPersona };
}

/**
 * Convenience: has the user *ever* picked a persona? Used by home.tsx to
 * decide whether to show the first-visit modal.
 *
 * Returns null during SSR/initial hydration so the modal doesn't flash
 * before localStorage is readable.
 */
export function useHasPickedPersona(): boolean | null {
  const [state, setState] = useState<boolean | null>(null);
  useEffect(() => {
    setState(readPersona() !== null);
    const onChange = (): void => setState(readPersona() !== null);
    window.addEventListener("ce-persona-changed", onChange);
    return () => window.removeEventListener("ce-persona-changed", onChange);
  }, []);
  return state;
}
