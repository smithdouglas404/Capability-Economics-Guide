/**
 * FourLensesGrid — single capability gap shown through four C-suite cards
 * (CEO Strategic Imperative, CFO P&L Impact, CTO Technical Debt,
 * CHRO Talent Strategy) with priority chip per role.
 *
 * Spec from the deck "Same Gap, Four Lenses" — renders all four personas
 * side-by-side instead of a tabbed switcher so the user can read the
 * different framings of one gap at a glance.
 *
 * Backend: GET /api/capabilities/:id/recommendations?persona=<p> exists
 * already; we fetch all four in parallel and render the 2×2 grid.
 */
import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface LensCardData {
  slug: "ceo" | "cfo" | "cto" | "chro";
  label: string;
  framingTitle: string;
  tone: "blue" | "amber" | "violet" | "slate";
}

const LENSES: LensCardData[] = [
  { slug: "ceo",  label: "CEO",  framingTitle: "Strategic Imperative", tone: "blue" },
  { slug: "cfo",  label: "CFO",  framingTitle: "P&L Impact",            tone: "amber" },
  { slug: "cto",  label: "CTO",  framingTitle: "Technical Debt",        tone: "blue" },
  { slug: "chro", label: "CHRO", framingTitle: "Talent Strategy",       tone: "slate" },
];

const TONE_CLASSES: Record<LensCardData["tone"], { label: string; border: string; bg: string; chip: string }> = {
  blue:   { label: "text-blue-500",   border: "border-blue-500/30",   bg: "bg-blue-500/5",   chip: "bg-blue-500/15 text-blue-500 border-blue-500/40" },
  amber:  { label: "text-amber-500",  border: "border-amber-500/30",  bg: "bg-amber-500/5",  chip: "bg-amber-500/15 text-amber-500 border-amber-500/40" },
  violet: { label: "text-violet-500", border: "border-violet-500/30", bg: "bg-violet-500/5", chip: "bg-violet-500/15 text-violet-500 border-violet-500/40" },
  slate:  { label: "text-foreground/70", border: "border-border/60",  bg: "bg-muted/20",     chip: "bg-muted text-foreground/80 border-border/60" },
};

interface RecResp {
  capabilityId: number; persona: string; body: string; headline: string | null; cached: boolean;
}

/** Heuristic priority extraction from the LLM body. Looks for "critical" /
 *  "urgent" / "high" / "medium" / "low" tokens; falls back to "High" when
 *  the recommendation is freshly generated for a non-stable score. */
function priorityFor(body: string, persona: string): "Critical" | "High" | "Medium" | "Low" {
  const b = body.toLowerCase();
  if (/(critical|urgent|imminent|emergency|existential)/i.test(b)) return "Critical";
  if (/(high priority|near-term|6.?month|q[12]|immediately)/i.test(b)) return "High";
  if (/(low priority|long-term|monitor|watch)/i.test(b)) return "Low";
  if (persona === "ceo" || persona === "cfo") return "High";
  return "Medium";
}

function priorityChipTone(p: "Critical" | "High" | "Medium" | "Low"): string {
  switch (p) {
    case "Critical": return "bg-rose-500/15 text-rose-500 border-rose-500/40";
    case "High":     return "bg-amber-500/15 text-amber-500 border-amber-500/40";
    case "Medium":   return "bg-blue-500/15 text-blue-500 border-blue-500/40";
    case "Low":      return "bg-muted text-muted-foreground border-border/60";
  }
}

export function FourLensesGrid({ capabilityId, capabilityName }: { capabilityId: number; capabilityName?: string }) {
  const [recs, setRecs] = useState<Partial<Record<LensCardData["slug"], RecResp>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all(LENSES.map(async l => {
      const r = await fetch(`/api/capabilities/${capabilityId}/recommendations?persona=${l.slug}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${l.slug}`);
      const j = await r.json() as RecResp;
      return [l.slug, j] as const;
    }))
      .then(rows => { if (!cancelled) setRecs(Object.fromEntries(rows) as Partial<Record<LensCardData["slug"], RecResp>>); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [capabilityId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Translating the gap for CEO / CFO / CTO / CHRO…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-rose-500/30 bg-rose-500/5">
        <CardContent className="p-4 text-sm text-rose-500 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ C-Suite Intelligence</span>
        </div>
        {capabilityName && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-500 px-3 py-1 rounded-md">
            Gap: {capabilityName}
          </Badge>
        )}
      </div>
      <h2 className="font-serif text-3xl tracking-tight">Same Gap, Four Lenses</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {LENSES.map(l => {
          const rec = recs[l.slug];
          const tone = TONE_CLASSES[l.tone];
          const priority = rec ? priorityFor(rec.body, l.slug) : "Medium";
          return (
            <Card key={l.slug} className={`border ${tone.border} ${tone.bg}`}>
              <CardContent className="p-5">
                <div className={`font-mono text-sm uppercase tracking-[0.2em] font-medium ${tone.label}`}>{l.label}</div>
                <div className="font-serif text-xl tracking-tight mt-1">{l.framingTitle}</div>
                {rec ? (
                  <p className="text-sm text-foreground/80 leading-relaxed mt-3 italic">
                    "{rec.headline ? `${rec.headline}. ` : ""}{rec.body}"
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground mt-3 italic">Generating framing…</p>
                )}
                <div className="mt-4 flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${priority === "Critical" ? "bg-rose-500" : priority === "High" ? "bg-amber-500" : priority === "Medium" ? "bg-blue-500" : "bg-muted-foreground"}`} />
                  <span className="text-xs">
                    Priority: <span className={`font-medium ${priorityChipTone(priority).split(" ")[1]}`}>{priority}</span>
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
