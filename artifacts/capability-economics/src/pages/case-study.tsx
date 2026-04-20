import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  AlertTriangle, ArrowLeft, BookOpen, Brain, Loader2, RefreshCw, Sparkles, Target, TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const API_BASE = "/api";

type Metric = { name: string; value: string; trend: "up" | "down" | "neutral" };

type RoiRow = { year: string; traditionalCost: number; capabilityCost: number; valueGenerated: number };

type Capability = {
  id: number;
  capabilitySlug: string;
  capabilityName: string;
  description: string;
  traditionalView: string;
  economicView: string;
  metrics: Metric[];
  roiData: RoiRow[] | null;
};

type StudyNarrative = {
  id: number;
  title: string;
  executiveSummary: string;
  situation: string;
  challenges: string[];
  recommendations: { title: string; rationale: string; impact: string }[];
  fiveYearOutlook: string;
  kpis: { name: string; baseline: string; target: string }[];
  sources: { url: string; title: string }[];
  generatedAt: string;
  model: string;
};

type CaseStudyData = {
  industry: { id: number; slug: string; name: string };
  capabilities: Capability[];
  study: StudyNarrative | null;
};

export default function CaseStudy() {
  const [, params] = useRoute<{ slug: string }>("/case-study/:slug");
  const slug = params?.slug;
  const [data, setData] = useState<CaseStudyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    // Try the newer /case-studies/:slug endpoint first, fall back to /case-study/:slug.
    const fetchOne = async () => {
      for (const url of [`${API_BASE}/case-studies/${slug}`, `${API_BASE}/case-study/${slug}`]) {
        try {
          const r = await fetch(url);
          if (r.ok) {
            const j = await r.json() as CaseStudyData;
            setData(j);
            return;
          }
        } catch { /* try next */ }
      }
      setError(`No case study found for "${slug}".`);
    };
    fetchOne().finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-3xl text-center">
        <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{error ?? "No case study available."}</p>
        <Button asChild variant="outline" className="mt-4 rounded-none">
          <Link href="/case-studies"><ArrowLeft className="w-4 h-4" /> <span className="ml-1">All case studies</span></Link>
        </Button>
      </div>
    );
  }

  const { industry, study, capabilities } = data;
  const generatedAt = study?.generatedAt ? new Date(study.generatedAt).toLocaleDateString() : null;

  return (
    <div className="min-h-screen bg-background pb-24">
      <section className="bg-muted/30 py-16 border-b">
        <div className="container mx-auto px-4 max-w-5xl">
          <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
            <Link href="/case-studies"><ArrowLeft className="w-4 h-4" /> <span className="ml-1">All case studies</span></Link>
          </Button>
          <div className="flex items-start gap-4 mb-6">
            <BookOpen className="w-12 h-12 text-primary shrink-0 mt-1" />
            <div>
              <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Industry case study</div>
              <h1 className="text-3xl md:text-5xl font-serif font-medium text-foreground">{study?.title ?? industry.name}</h1>
              {generatedAt && <p className="text-xs text-muted-foreground mt-2">Generated {generatedAt}{study?.model ? ` via ${study.model}` : ""}</p>}
            </div>
          </div>
          {study?.executiveSummary && (
            <p className="text-xl text-muted-foreground leading-relaxed">{study.executiveSummary}</p>
          )}
        </div>
      </section>

      {/* Situation + challenges */}
      {study?.situation && (
        <section className="py-12 container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-serif mb-4 text-foreground">The situation</h2>
          <p className="text-lg text-muted-foreground leading-relaxed whitespace-pre-wrap">{study.situation}</p>

          {study.challenges.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-serif mb-3 flex items-center gap-2"><Target className="w-5 h-5 text-primary" /> Key challenges</h3>
              <ul className="space-y-2">
                {study.challenges.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-muted-foreground leading-relaxed">
                    <span className="text-primary font-semibold mt-0.5">{i + 1}.</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Capability transformation */}
      {capabilities.length > 0 && (
        <section className="py-12 container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-serif mb-4 text-foreground flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" /> Capability transformation
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Traditional accounting treats these as cost centers. Capability Economics treats them as economic engines — each with distinct ROI.
          </p>
          <div className="space-y-6">
            {capabilities.map(cap => (
              <Card key={cap.id} className="rounded-none">
                <CardContent className="p-6">
                  <h3 className="text-lg font-serif mb-2">{cap.capabilityName}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{cap.description}</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="border border-border p-4">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Traditional view</div>
                      <p className="text-sm text-foreground/80">{cap.traditionalView}</p>
                    </div>
                    <div className="border border-primary/40 bg-primary/5 p-4">
                      <div className="text-xs uppercase tracking-wider text-primary mb-1">Economic view</div>
                      <p className="text-sm text-foreground">{cap.economicView}</p>
                    </div>
                  </div>

                  {cap.metrics.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {cap.metrics.map((m, i) => (
                        <div key={i} className="border-l-2 border-primary/40 pl-3">
                          <div className="text-xs uppercase tracking-wider text-muted-foreground">{m.name}</div>
                          <div className="text-lg font-mono font-semibold flex items-center gap-1">
                            {m.trend === "up" && <TrendingUp className="w-4 h-4 text-emerald-600" />}
                            {m.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Recommendations */}
      {study?.recommendations && study.recommendations.length > 0 && (
        <section className="py-12 container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-serif mb-6 text-foreground">Recommendations</h2>
          <div className="space-y-4">
            {study.recommendations.map((r, i) => (
              <Card key={i} className="rounded-none">
                <CardContent className="p-6">
                  <h3 className="text-lg font-serif mb-2">{r.title}</h3>
                  <p className="text-sm text-muted-foreground mb-3"><strong className="text-foreground">Rationale: </strong>{r.rationale}</p>
                  <p className="text-sm text-muted-foreground"><strong className="text-foreground">Expected impact: </strong>{r.impact}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* KPIs */}
      {study?.kpis && study.kpis.length > 0 && (
        <section className="py-12 container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-serif mb-6 text-foreground">Track these KPIs</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">Metric</th>
                  <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">Baseline</th>
                  <th className="px-4 py-2 text-left text-xs uppercase tracking-wider text-muted-foreground">Target</th>
                </tr>
              </thead>
              <tbody>
                {study.kpis.map((k, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-4 py-3 font-medium">{k.name}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono">{k.baseline}</td>
                    <td className="px-4 py-3 text-primary font-mono font-semibold">{k.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Five year outlook */}
      {study?.fiveYearOutlook && (
        <section className="py-12 container mx-auto px-4 max-w-5xl">
          <h2 className="text-2xl font-serif mb-4 text-foreground flex items-center gap-2"><Brain className="w-6 h-6 text-primary" /> Five-year outlook</h2>
          <p className="text-lg text-muted-foreground leading-relaxed whitespace-pre-wrap">{study.fiveYearOutlook}</p>
        </section>
      )}

      {/* Sources */}
      {study?.sources && study.sources.length > 0 && (
        <section className="py-12 container mx-auto px-4 max-w-5xl border-t">
          <h2 className="text-lg font-serif mb-4 text-foreground">Sources</h2>
          <ul className="space-y-1 text-sm">
            {study.sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{s.title}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Empty state */}
      {!study && capabilities.length === 0 && (
        <section className="py-16 container mx-auto px-4 max-w-3xl text-center">
          <div className="border border-dashed p-12 rounded-sm">
            <RefreshCw className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground font-medium mb-1">This industry hasn't been analyzed yet.</p>
            <p className="text-xs text-muted-foreground">An admin can generate a case study for this industry from the admin dashboard.</p>
          </div>
        </section>
      )}
    </div>
  );
}
