import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { LayoutGrid, ArrowUp, ArrowDown, Bookmark, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API_BASE = "/api";

type Industry = { id: number; name: string };
type Capability = { id: number; name: string; industryId: number; isLeaf?: boolean; parentCapabilityId?: number | null };
type Component = { capabilityId: number; industryId: number; consensusScore: number; velocity: number; confidence: number };

function cellColor(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return "bg-muted text-muted-foreground";
  if (score >= 60) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  if (score >= 40) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-rose-500/15 text-rose-700 dark:text-rose-400";
}

export default function BoardPage() {
  const [, navigate] = useLocation();
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveOpen, setSaveOpen] = useState(false);
  const [bookmarkName, setBookmarkName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [iRes, cRes, kRes] = await Promise.all([
        fetch(`${API_BASE}/industries`).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/capabilities`).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/cei/components`).then(r => r.json()).catch(() => []),
      ]);
      if (cancelled) return;
      setIndustries(iRes.industries ?? iRes ?? []);
      setCapabilities(cRes.capabilities ?? cRes ?? []);
      setComponents(Array.isArray(kRes) ? kRes : (kRes.components ?? []));
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const visibleIndustries = useMemo(() => industries.slice(0, 6), [industries]);

  const capabilityRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ name: string; perIndustry: Map<number, number> }> = [];
    const byName = new Map<string, { name: string; perIndustry: Map<number, number> }>();
    for (const cap of capabilities) {
      if (cap.parentCapabilityId !== null && cap.parentCapabilityId !== undefined) continue;
      const key = cap.name.trim().toLowerCase();
      if (!byName.has(key)) {
        const row = { name: cap.name, perIndustry: new Map<number, number>() };
        byName.set(key, row);
        rows.push(row);
      }
      const row = byName.get(key)!;
      row.perIndustry.set(cap.industryId, cap.id);
      seen.add(key);
    }
    return rows.slice(0, 30);
  }, [capabilities]);

  const compIndex = useMemo(() => {
    const m = new Map<string, Component>();
    for (const c of components) m.set(`${c.capabilityId}:${c.industryId}`, c);
    return m;
  }, [components]);

  function lookupForIndustry(row: { name: string; perIndustry: Map<number, number> }, industryId: number): Component | undefined {
    const capId = row.perIndustry.get(industryId);
    if (!capId) return undefined;
    return compIndex.get(`${capId}:${industryId}`);
  }

  function onCellClick(capId: number | undefined, industryId: number) {
    if (!capId) return;
    navigate(`/lookup?capabilityId=${capId}&industryId=${industryId}`);
  }

  async function saveBookmark() {
    if (!bookmarkName.trim()) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      const slug = `board-${bookmarkName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
      const res = await fetch(`${API_BASE}/saved-views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          slug,
          name: bookmarkName.trim(),
          route: "/board",
          state: { industryIds: visibleIndustries.map(i => i.id) },
        }),
      });
      if (res.ok) {
        setSavedMsg("Saved to your bookmarks.");
        setBookmarkName("");
        setSaveOpen(false);
      } else if (res.status === 401) {
        setSavedMsg("Sign in to save bookmarks.");
      } else {
        setSavedMsg("Save failed.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8 flex items-start justify-between gap-4"
      >
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Academic · Index Board</p>
          <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
            <LayoutGrid className="w-8 h-8 text-primary" />
            Index Board
          </h1>
          <p className="text-muted-foreground max-w-3xl">
            Bloomberg-style live grid. Rows are capabilities, columns are industries. Color = consensus, arrow = velocity.
            Click a cell to drill into that capability + industry.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)} data-testid="bookmark-board">
          <Bookmark className="w-3.5 h-3.5 mr-1" />Bookmark this view
        </Button>
      </motion.div>

      {savedMsg && <p className="text-xs text-muted-foreground mb-3">{savedMsg}</p>}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg">Capability × Industry consensus</CardTitle>
          <CardDescription>
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-500/30 inline-block" /> 0–40</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/30 inline-block" /> 40–60</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/30 inline-block" /> 60–100</span>
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-16 text-center text-muted-foreground">
              <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
              Loading index…
            </div>
          ) : (
            <table className="w-full text-sm" data-testid="board-grid">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium sticky left-0 bg-muted/40">Capability</th>
                  {visibleIndustries.map(i => (
                    <th key={i.id} className="text-center px-3 py-3 font-medium min-w-[110px]">{i.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capabilityRows.map((row, idx) => (
                  <tr key={`${row.name}-${idx}`} className="border-t">
                    <td className="px-4 py-2 font-medium sticky left-0 bg-background">{row.name}</td>
                    {visibleIndustries.map(i => {
                      const capId = row.perIndustry.get(i.id);
                      const comp = lookupForIndustry(row, i.id);
                      const score = comp?.consensusScore ?? null;
                      const velocity = comp?.velocity ?? 0;
                      return (
                        <td key={i.id} className="px-1 py-1">
                          <button
                            type="button"
                            disabled={!capId || score === null}
                            onClick={() => onCellClick(capId, i.id)}
                            className={`w-full rounded px-2 py-2 font-mono text-xs flex items-center justify-center gap-1 transition-opacity ${cellColor(score)} ${capId && score !== null ? "hover:opacity-80 cursor-pointer" : "cursor-default opacity-60"}`}
                            data-testid={`cell-${capId ?? "x"}-${i.id}`}
                          >
                            <span>{score === null ? "—" : score.toFixed(0)}</span>
                            {score !== null && velocity > 0.001 && <ArrowUp className="w-3 h-3" />}
                            {score !== null && velocity < -0.001 && <ArrowDown className="w-3 h-3" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {capabilityRows.length === 0 && (
                  <tr>
                    <td colSpan={visibleIndustries.length + 1} className="px-4 py-12 text-center text-muted-foreground">
                      No capabilities loaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bookmark this board</DialogTitle>
            <DialogDescription>Saves the current industry selection so you can return to it from /bookmarks.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="bm-name">Name</Label>
            <Input id="bm-name" placeholder="Banking vs. Insurance — Q2"
              value={bookmarkName} onChange={(e) => setBookmarkName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button onClick={saveBookmark} disabled={saving || !bookmarkName.trim()}>
              {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Saving…</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
