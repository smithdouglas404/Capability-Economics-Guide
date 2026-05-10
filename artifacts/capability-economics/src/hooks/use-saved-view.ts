/**
 * Generic per-dashboard view persistence hook.
 *
 * Caller owns the shape of `state` — this hook just round-trips it as opaque
 * JSON. Each saved view has a name; one view per dashboard may be marked as
 * the default (auto-loaded on mount).
 *
 * The hook is unauthenticated-safe: when there's no signed-in user, the
 * server responds 401 and we silently treat that as "no saved views" so
 * dashboards still render their built-in defaults for anonymous visitors.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SavedView<S> = {
  id: number;
  name: string;
  isDefault: boolean;
  stateJson: S;
  createdAt: string;
  updatedAt: string;
};

type ServerView = {
  id: number;
  userId: string;
  dashboardKey: string;
  name: string;
  isDefault: boolean;
  stateJson: unknown;
  createdAt: string;
  updatedAt: string;
};

export type UseSavedViewResult<S> = {
  views: SavedView<S>[];
  defaultView: SavedView<S> | null;
  loading: boolean;
  error: string | null;
  /** True once the initial fetch has settled — gate "apply default" effects on this. */
  ready: boolean;
  save: (name: string, state: S, opts?: { isDefault?: boolean }) => Promise<SavedView<S> | null>;
  rename: (id: number, name: string) => Promise<void>;
  updateState: (id: number, state: S) => Promise<void>;
  setDefault: (id: number | null) => Promise<void>;
  remove: (id: number) => Promise<void>;
};

export function useSavedView<S>(dashboardKey: "cei" | "alpha" | "knowledge-graph" | "companies"): UseSavedViewResult<S> {
  const [views, setViews] = useState<SavedView<S>[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aborted = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/me/dashboard-views?dashboard=${encodeURIComponent(dashboardKey)}`, { credentials: "include" });
      if (r.status === 401 || r.status === 403) {
        if (!aborted.current) setViews([]);
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { views: ServerView[] };
      if (aborted.current) return;
      setViews(data.views.map((v) => ({
        id: v.id,
        name: v.name,
        isDefault: v.isDefault,
        stateJson: v.stateJson as S,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })));
    } catch (e) {
      if (!aborted.current) setError(e instanceof Error ? e.message : "Failed to load views");
    } finally {
      if (!aborted.current) { setLoading(false); setReady(true); }
    }
  }, [dashboardKey]);

  useEffect(() => {
    aborted.current = false;
    void refresh();
    return () => { aborted.current = true; };
  }, [refresh]);

  const save = useCallback(async (name: string, state: S, opts?: { isDefault?: boolean }) => {
    const r = await fetch(`/api/me/dashboard-views`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dashboardKey, name, stateJson: state, isDefault: opts?.isDefault ?? false }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setError(body.message || `Failed to save (HTTP ${r.status})`);
      return null;
    }
    setError(null);
    await refresh();
    return (await r.json()) as SavedView<S>;
  }, [dashboardKey, refresh]);

  const updateGeneric = useCallback(async (id: number, body: Record<string, unknown>) => {
    const r = await fetch(`/api/me/dashboard-views/${id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      setError(b.message || `Failed to update (HTTP ${r.status})`);
      return;
    }
    setError(null);
    await refresh();
  }, [refresh]);

  const rename = useCallback((id: number, name: string) => updateGeneric(id, { name }), [updateGeneric]);
  const updateState = useCallback((id: number, state: S) => updateGeneric(id, { stateJson: state }), [updateGeneric]);
  const setDefault = useCallback(async (id: number | null) => {
    if (id == null) {
      // Clear default by setting current default's flag false.
      const cur = views.find((v) => v.isDefault);
      if (!cur) return;
      await updateGeneric(cur.id, { isDefault: false });
    } else {
      await updateGeneric(id, { isDefault: true });
    }
  }, [updateGeneric, views]);
  const remove = useCallback(async (id: number) => {
    const r = await fetch(`/api/me/dashboard-views/${id}`, { method: "DELETE", credentials: "include" });
    if (!r.ok && r.status !== 404) { setError(`Failed to delete (HTTP ${r.status})`); return; }
    setError(null);
    await refresh();
  }, [refresh]);

  const defaultView = views.find((v) => v.isDefault) ?? null;
  return { views, defaultView, loading, error, ready, save, rename, updateState, setDefault, remove };
}
