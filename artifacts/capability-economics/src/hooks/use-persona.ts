import { useEffect, useState, useCallback } from "react";
import { useUser, useAuth } from "@clerk/react";
import { DEFAULT_PERSONA_SLUG, PERSONA_SLUGS, type PersonaSlug } from "@/lib/persona-nav";

type PersonaState = {
  loading: boolean;
  activePersonaSlug: PersonaSlug;
  explicitlySet: boolean;
};

let cachedSlug: PersonaSlug | null = null;
const subscribers = new Set<(slug: PersonaSlug) => void>();

function setCachedSlug(slug: PersonaSlug) {
  if (cachedSlug === slug) return;
  cachedSlug = slug;
  subscribers.forEach((cb) => cb(slug));
}

function isPersonaSlug(v: unknown): v is PersonaSlug {
  return typeof v === "string" && (PERSONA_SLUGS as readonly string[]).includes(v);
}

export function usePersona(): PersonaState & {
  setPersona: (slug: PersonaSlug) => Promise<void>;
} {
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [state, setState] = useState<PersonaState>({
    loading: true,
    activePersonaSlug: cachedSlug ?? DEFAULT_PERSONA_SLUG,
    explicitlySet: false,
  });

  // Subscribe to cross-component updates so a switch in one place updates all consumers.
  useEffect(() => {
    const cb = (slug: PersonaSlug) => setState((s) => ({ ...s, activePersonaSlug: slug }));
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { setState({ loading: false, activePersonaSlug: DEFAULT_PERSONA_SLUG, explicitlySet: false }); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/me/persona", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) {
          if (!cancelled) setState({ loading: false, activePersonaSlug: DEFAULT_PERSONA_SLUG, explicitlySet: false });
          return;
        }
        const data = await res.json();
        const slug = isPersonaSlug(data.activePersonaSlug) ? data.activePersonaSlug : DEFAULT_PERSONA_SLUG;
        setCachedSlug(slug);
        if (!cancelled) setState({ loading: false, activePersonaSlug: slug, explicitlySet: !!data.explicitlySet });
      } catch {
        if (!cancelled) setState({ loading: false, activePersonaSlug: DEFAULT_PERSONA_SLUG, explicitlySet: false });
      }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn, isLoaded, getToken]);

  const setPersona = useCallback(async (slug: PersonaSlug) => {
    const token = await getToken();
    const res = await fetch("/api/me/persona", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ slug }),
    });
    if (!res.ok) throw new Error(`Persona switch failed: ${res.status}`);
    setCachedSlug(slug);
    setState((s) => ({ ...s, activePersonaSlug: slug, explicitlySet: true }));
  }, [getToken]);

  return { ...state, setPersona };
}
