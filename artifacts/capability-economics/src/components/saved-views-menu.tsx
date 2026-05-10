/**
 * Compact dropdown for saving, loading, and managing dashboard views.
 * Used in the header strip of each dashboard.
 */
import { useState } from "react";
import { Bookmark, BookmarkPlus, Check, Loader2, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import type { UseSavedViewResult } from "@/hooks/use-saved-view";

type Props<S> = {
  viewsApi: UseSavedViewResult<S>;
  /** Current in-memory dashboard state (whatever the dashboard hands us). */
  currentState: S;
  /** Apply a saved view to the dashboard. */
  onApply: (state: S) => void;
  /** Optional id of the currently-applied saved view, for the active checkmark. */
  activeViewId?: number | null;
  /** Disable the menu (e.g. when not signed in). */
  disabled?: boolean;
};

export function SavedViewsMenu<S>({ viewsApi, currentState, onApply, activeViewId, disabled }: Props<S>) {
  const { views, loading, ready, error, save, remove, setDefault } = viewsApi;
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const r = await save(name.trim(), currentState, { isDefault: makeDefault });
      if (r) {
        setSaveOpen(false);
        setName("");
        setMakeDefault(false);
        onApply(r.stateJson);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled} className="h-8 gap-1.5">
            <Bookmark className="h-3.5 w-3.5" />
            <span className="text-xs">Views</span>
            {views.length > 0 && (
              <span className="ml-0.5 rounded-sm bg-muted px-1 text-[10px] tabular-nums">{views.length}</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">Saved views</DropdownMenuLabel>
          {loading && !ready && (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          {ready && views.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              No saved views yet. Save the current layout to recall it later.
            </div>
          )}
          {views.map((v) => (
            <div
              key={v.id}
              className="group flex items-center gap-1 px-1 py-0.5 hover:bg-muted/50 rounded-sm"
            >
              <button
                onClick={() => onApply(v.stateJson)}
                className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left text-sm"
              >
                {activeViewId === v.id ? (
                  <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <span className="truncate">{v.name}</span>
                {v.isDefault && <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" aria-label="Default" />}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void setDefault(v.isDefault ? null : v.id); }}
                className="p-1 opacity-40 hover:opacity-100"
                title={v.isDefault ? "Clear default" : "Set as default"}
              >
                <Star className={`h-3.5 w-3.5 ${v.isDefault ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); if (confirm(`Delete view "${v.name}"?`)) void remove(v.id); }}
                className="p-1 opacity-40 hover:opacity-100 hover:text-rose-600"
                title="Delete view"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); setSaveOpen(true); }}
            className="text-sm cursor-pointer"
          >
            <BookmarkPlus className="h-3.5 w-3.5 mr-2" /> Save current view…
          </DropdownMenuItem>
          {error && <div className="px-2 py-1 text-[11px] text-rose-600">{error}</div>}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogTrigger asChild><span /></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
            <DialogDescription>
              Captures the current filters, tabs, and selections. Up to 10 views per dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Healthcare focus, Q3 review…"
                maxLength={80}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
              <span>Load this view automatically on next visit</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Save view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
