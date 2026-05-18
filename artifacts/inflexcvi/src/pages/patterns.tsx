import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Zap,
  Target,
  Compass,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const API_BASE = "/api";

interface Pattern {
  id: number;
  slug: string;
  title: string;
  headline: string;
  disruptorCompany: string;
  incumbentsDisplaced: string[];
  industriesAffected: string[];
  existingCapabilitiesUsed: string[];
  newCapabilityCreated: string;
  crossIndustryAnalogues: string[];
  narrative: string;
  whatToLookFor: string[];
  sources: Array<{ url: string; title: string }>;
  coverImageUrl: string | null;
  featured: boolean;
  publishedAt: string;
  updatedAt: string;
}

export default function PatternsPage() {
  const [, params] = useRoute<{ slug: string }>("/patterns/:slug");
  const [patterns, setPatterns] = useState<Pattern[] | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(params?.slug ?? null);
  const [active, setActive] = useState<Pattern | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/patterns`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: { patterns: Pattern[] }) => {
        setPatterns(d.patterns);
        if (params?.slug) {
          const found = d.patterns.find(p => p.slug === params.slug);
          setActive(found ?? null);
          setActiveSlug(params.slug);
        }
      })
      .catch(e => setErr(e instanceof Error ? e.message : "Failed to load patterns"))
      .finally(() => setLoading(false));
  }, [params?.slug]);

  if (loading) {
    return <div className="p-8 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading patterns…</div>;
  }
  if (err) {
    return <div className="container mx-auto px-4 py-8 max-w-3xl"><div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-4 py-3 text-sm">{err}</div></div>;
  }

  // Detail view
  if (active) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-4xl space-y-6">
        <Link href="/patterns" onClick={() => { setActive(null); setActiveSlug(null); }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" />
          All patterns
        </Link>

        <div>
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider mb-2">
            <Sparkles className="w-3 h-3 mr-1 inline" />
            Design-thinking pattern
          </Badge>
          <h1 className="font-serif text-4xl tracking-tight leading-tight">{active.title}</h1>
          <p className="text-lg text-muted-foreground mt-2 leading-relaxed">{active.headline}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card className="rounded-none border-border/60">
            <CardContent className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1 flex items-center gap-1"><Zap className="w-3 h-3" /> Disruptor</div>
              <div className="font-medium">{active.disruptorCompany}</div>
            </CardContent>
          </Card>
          <Card className="rounded-none border-border/60">
            <CardContent className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1 flex items-center gap-1"><Target className="w-3 h-3" /> Displaced</div>
              <div className="text-sm">{active.incumbentsDisplaced.join(", ") || "—"}</div>
            </CardContent>
          </Card>
          <Card className="rounded-none border-border/60">
            <CardContent className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1 flex items-center gap-1"><Compass className="w-3 h-3" /> Industries</div>
              <div className="text-sm">{active.industriesAffected.join(" · ") || "—"}</div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-none border-border/60">
          <CardContent className="p-5 space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">New capability created</div>
            <p className="font-serif text-xl">{active.newCapabilityCreated}</p>
            <div className="pt-2 border-t border-border/40 mt-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">By cross-pollinating</div>
              <ul className="text-sm space-y-1">
                {active.existingCapabilitiesUsed.map((c, i) => (
                  <li key={i} className="flex items-start gap-2"><ArrowRight className="w-3 h-3 mt-1 text-muted-foreground shrink-0" /><span>{c}</span></li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-none border-border/60">
          <CardContent className="p-5">
            <h2 className="font-serif text-2xl tracking-tight mb-3">Narrative</h2>
            <div className="text-sm leading-relaxed whitespace-pre-wrap">{active.narrative}</div>
          </CardContent>
        </Card>

        {active.crossIndustryAnalogues.length > 0 && (
          <Card className="rounded-none border-border/60">
            <CardContent className="p-5">
              <h2 className="font-serif text-2xl tracking-tight mb-3">Cross-industry analogues</h2>
              <ul className="space-y-1.5 text-sm">
                {active.crossIndustryAnalogues.map((a, i) => (
                  <li key={i} className="flex items-start gap-2"><ArrowRight className="w-3 h-3 mt-1 text-muted-foreground shrink-0" /><span>{a}</span></li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {active.whatToLookFor.length > 0 && (
          <Card className="rounded-none border-amber-500/40 bg-amber-500/[0.03]">
            <CardContent className="p-5">
              <h2 className="font-serif text-2xl tracking-tight mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                What to look for
              </h2>
              <ul className="space-y-1.5 text-sm">
                {active.whatToLookFor.map((w, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="font-mono text-amber-500 shrink-0">{i + 1}.</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground italic mt-4">Take these to the <Link href="/workbench" className="text-primary hover:underline">Capability Workbench</Link> and run "what to invent" against your industry.</p>
            </CardContent>
          </Card>
        )}

        {active.sources.length > 0 && (
          <Card className="rounded-none border-border/60">
            <CardContent className="p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Sources</div>
              <ul className="space-y-1">
                {active.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Index view
  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Home
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-amber-500" />
          <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">Design-thinking patterns</Badge>
        </div>
        <h1 className="font-serif text-4xl tracking-tight">Patterns that invented new capabilities</h1>
        <p className="text-base text-muted-foreground mt-3 max-w-3xl leading-relaxed">
          Disruption isn't about doing X better. The most consequential market shifts came from operators who
          combined several mature capabilities into a NEW capability that no incumbent had reason to attempt.
          Read these to prime your own ideation, then take the patterns into the{" "}
          <Link href="/workbench" className="text-primary hover:underline">Capability Workbench</Link>.
        </p>
      </div>

      {patterns && patterns.length === 0 && (
        <Card className="rounded-none border-border/60">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No patterns published yet. An admin can seed flagship exemplars via <code className="font-mono text-xs bg-muted px-1">POST /api/admin/patterns/seed</code>.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {patterns?.map(p => (
          <Link key={p.id} href={`/patterns/${p.slug}`}>
            <Card className={`rounded-none border-border/60 hover:border-primary transition-colors cursor-pointer h-full ${p.featured ? "ring-1 ring-amber-500/40" : ""}`}>
              <CardContent className="p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider">
                    {p.disruptorCompany}
                  </Badge>
                  {p.featured && (
                    <Badge variant="outline" className="rounded-none font-mono text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-500 border-amber-500/40">
                      <Sparkles className="w-3 h-3 mr-1 inline" />
                      Featured
                    </Badge>
                  )}
                </div>
                <h2 className="font-serif text-xl tracking-tight">{p.title}</h2>
                <p className="text-sm text-muted-foreground leading-snug line-clamp-3">{p.headline}</p>
                <div className="pt-2 border-t border-border/40 mt-2">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">New capability invented</div>
                  <div className="text-sm font-medium line-clamp-2">{p.newCapabilityCreated}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
