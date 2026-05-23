import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Sparkles, Loader2 } from "lucide-react";

const STORAGE_KEY = "ce_qa_history";
const MAX_HISTORY = 5;

interface QAResponse {
  query: string;
  response: string;
  durationMs: number;
}

/**
 * Platform-wide conversational Q&A. Slash-key activated (`/`) or click.
 * Hits /api/nl-query with the user's session context. Renders the answer
 * inline; preserves the last 5 queries client-side for one-click recall.
 *
 * Promotes /nl-query from an isolated page to a global navigation primitive.
 */
export function GlobalQABar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<QAResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load history on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Slash-key activates the bar from anywhere except inputs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // Reset on close
      setAnswer(null);
      setError(null);
      setQuery("");
    }
  }, [open]);

  const submit = async (q?: string) => {
    const askQuery = (q ?? query).trim();
    if (!askQuery) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const sessionToken = typeof window !== "undefined" ? (localStorage.getItem("ce_session_token") ?? "") : "";
      const res = await fetch("/api/nl-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query: askQuery, sessionToken: sessionToken || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as QAResponse;
      setAnswer(data);
      // Update history
      const next = [askQuery, ...history.filter(h => h !== askQuery)].slice(0, MAX_HISTORY);
      setHistory(next);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      setQuery(askQuery);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground bg-muted/40 border border-border hover:bg-muted hover:text-foreground transition-colors rounded-none min-w-[14rem]"
        data-testid="global-qa-trigger"
        title="Ask anything (press /)"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="flex-1 text-left">Ask the platform…</span>
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-background border border-border">/</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl rounded-none">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent" />
              Ask anything
            </DialogTitle>
            <DialogDescription className="text-xs">
              Grounded against your industry, watchlist, and the live capability graph.
              Try "highest AI displacement risk in Healthcare," "strongest moats in Banking," or "what's changed for me this week."
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="What's going on in my industry?"
                className="flex-1"
                data-testid="global-qa-input"
              />
              <Button type="submit" disabled={busy || !query.trim()} className="rounded-none">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Ask"}
              </Button>
            </div>

            {!busy && !answer && history.length > 0 && (
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">Recent</div>
                <div className="flex flex-wrap gap-1.5">
                  {history.map((h, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { setQuery(h); submit(h); }}
                      className="px-2 py-1 text-xs border border-border bg-muted/30 hover:bg-muted truncate max-w-[16rem] text-left"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 border border-destructive/30 bg-destructive/[0.06] text-sm">
                {error}
              </div>
            )}

            {answer && (
              <div className="border-l-2 border-l-accent bg-muted/20 p-4 max-h-[50vh] overflow-y-auto">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  Answer · {(answer.durationMs / 1000).toFixed(1)}s
                </div>
                <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans">{answer.response}</pre>
              </div>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
