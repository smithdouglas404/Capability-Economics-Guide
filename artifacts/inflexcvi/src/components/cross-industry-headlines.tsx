import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";

interface KGHeadline {
  title: string;
  detail: string;
  tone: "neutral" | "positive" | "negative";
}

/**
 * Cross-industry pattern engine — pulled from
 * GET /api/knowledge-graph/headlines. Computes 3–5 dynamic insights
 * server-side from capability_alpha quadrants, regulations counts, and
 * recent macro events. Renders above the four tabs on /knowledge-graph
 * to set the lens before the user drills in.
 */
export function CrossIndustryHeadlines() {
  const [headlines, setHeadlines] = useState<KGHeadline[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;
    setLoading(true);
    fetch("/api/knowledge-graph/headlines")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { headlines: KGHeadline[] }) => {
        if (abort) return;
        setHeadlines(Array.isArray(d.headlines) ? d.headlines : []);
      })
      .catch((e) => {
        if (abort) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!abort) setLoading(false);
      });
    return () => {
      abort = true;
    };
  }, []);

  if (loading) {
    return (
      <Card className="rounded-none border-l-4 border-l-accent bg-card mt-6">
        <CardContent className="pt-5 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Computing cross-industry patterns…
        </CardContent>
      </Card>
    );
  }
  if (error || !headlines || headlines.length === 0) return null;

  const toneIcon = (tone: KGHeadline["tone"]) => {
    if (tone === "positive") return <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />;
    if (tone === "negative") return <TrendingDown className="w-3.5 h-3.5 text-rose-600" />;
    return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
  };
  const toneBorder = (tone: KGHeadline["tone"]) =>
    tone === "positive"
      ? "border-l-emerald-500"
      : tone === "negative"
        ? "border-l-rose-500"
        : "border-l-muted-foreground/40";

  return (
    <Card className="rounded-none border-l-4 border-l-accent bg-card mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          Cross-Industry Headlines
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-normal">
            live · computed now
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-2">
          {headlines.map((h, i) => (
            <li
              key={i}
              className={`border-l-2 ${toneBorder(h.tone)} pl-3 py-1`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">{toneIcon(h.tone)}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground leading-snug">{h.title}</div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{h.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
