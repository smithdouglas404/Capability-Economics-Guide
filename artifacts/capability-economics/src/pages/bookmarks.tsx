import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Bookmark, Loader2, Trash2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const API_BASE = "/api";

type SavedView = {
  id: number;
  userId: string;
  slug: string;
  name: string;
  route: string;
  state: Record<string, unknown>;
  createdAt: string;
};

export default function BookmarksPage() {
  const [, navigate] = useLocation();
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/saved-views`, { credentials: "include" });
      if (res.status === 401) { setError("Sign in to view your bookmarks."); setViews([]); return; }
      const data = await res.json();
      setViews(data.views ?? []);
    } catch {
      setError("Failed to load bookmarks.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function remove(id: number) {
    if (!confirm("Delete this bookmark?")) return;
    await fetch(`${API_BASE}/saved-views/${id}`, { method: "DELETE", credentials: "include" });
    setViews((v) => (v ?? []).filter(x => x.id !== id));
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Academic · Bookmarks</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Bookmark className="w-8 h-8 text-primary" />
          Bookmarks
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Your saved views — index boards, screener filters, and other parameterized pages.
          Open one to restore the saved state.
        </p>
      </motion.div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Saved views</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${views?.length ?? 0} saved`}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground"><Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" />Loading…</p>
          ) : error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : !views || views.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bookmarks yet. Use the "Bookmark this view" button on the Index Board to save one.</p>
          ) : (
            <ul className="divide-y">
              {views.map(v => (
                <li key={v.id} className="py-3 flex items-center justify-between gap-4" data-testid={`view-${v.id}`}>
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{v.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{v.route} · saved {new Date(v.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => navigate(v.route)}>
                      <ExternalLink className="w-3.5 h-3.5 mr-1" />Open
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(v.id)}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
