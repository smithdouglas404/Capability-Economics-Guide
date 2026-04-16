import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Shield, ArrowRight, Activity, TrendingUp, TrendingDown, Brain,
  CheckCircle2, AlertTriangle, RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  ResponsiveContainer, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, Line, ComposedChart,
} from "recharts";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const API_BASE = "/api";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.15 } },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

interface Metric {
  name: string;
  value: string;
  trend: "up" | "down" | "neutral";
}

interface Capability {
  id: number;
  capabilitySlug: string;
  capabilityName: string;
  description: string;
  traditionalView: string;
  economicView: string;
  metrics: Metric[];
  roiData: RoiRow[] | null;
}

interface RoiRow {
  year: string;
  traditionalCost: number;
  capabilityCost: number;
  valueGenerated: number;
}

interface StudyNarrative {
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
}

interface CaseStudyData {
  industry: { id: number; slug: string; name: string };
  capabilities: Capability[];
  study: StudyNarrative | null;
}

function TrendIcon({ trend }: { trend: "up" | "down" | "neutral" }) {
  if (trend === "up") return <TrendingUp className="w-5 h-5 mb-2 text-primary" aria-hidden="true" />;
  if (trend === "down") return <TrendingDown className="w-5 h-5 mb-2 text-muted-foreground" aria-hidden="true" />;
  return <Activity className="w-5 h-5 mb-2 text-muted-foreground" aria-hidden="true" />;
}

export default function InsuranceExample() {
  const [data, setData] = useState<CaseStudyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/case-study/insurance`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<CaseStudyData>; })
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const roiData: RoiRow[] = data?.capabilities.find(c => c.roiData)?.roiData ?? [];

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <section className="bg-muted/30 py-16 border-b">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex items-center gap-4 mb-6">
            <Shield className="w-12 h-12 text-primary" />
            <div>
              <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Industry Case Study</div>
              <h1 className="text-3xl md:text-5xl font-serif font-medium text-foreground">Property &amp; Casualty Insurance</h1>
            </div>
          </div>
          <p className="text-xl text-muted-foreground leading-relaxed">
            {data?.study?.executiveSummary ?? "Insurance is fundamentally a business of capabilities. Carriers don't sell physical products; they sell promises. The economic value of an insurer is entirely dictated by how well they execute core capabilities like underwriting and claims processing."}
          </p>
        </div>
      </section>

      {/* The Transformation */}
      <section className="py-16 container mx-auto px-4 max-w-5xl">
        <div className="mb-12">
          <h2 className="text-2xl font-serif mb-4 text-foreground">The Capability Transformation</h2>
          <p className="text-lg text-muted-foreground">
            A mid-sized P&amp;C carrier was struggling with profitability. Their traditional budgeting process simply cut costs 5% across the board.
            By shifting to Capability Economics, they mapped their operations into distinct economic engines and reinvested capital into the areas that drove the highest returns.
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-5 h-5 text-primary/40 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center py-16 text-center border border-dashed rounded-sm">
            <AlertTriangle className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Could not load case study data. Please check the API server.</p>
          </div>
        )}

        {!loading && !error && data?.capabilities.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center border border-dashed rounded-sm">
            <Brain className="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground font-medium mb-1">No case study content yet</p>
            <p className="text-xs text-muted-foreground">
              Trigger an agent run from the CEI Dashboard — the agent will generate this content automatically.
            </p>
          </div>
        )}

        {!loading && !error && data && data.capabilities.length > 0 && (
          <motion.div
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="space-y-12"
          >
            {data.capabilities.map((cap) => (
              <motion.div
                key={cap.capabilitySlug}
                variants={item}
                className="grid md:grid-cols-12 gap-6 bg-card border shadow-sm p-6 md:p-8 rounded-sm"
              >
                {/* Capability Description */}
                <div className="md:col-span-5 border-r md:pr-8 border-border">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 rounded-lg bg-primary/10 text-primary">
                      <Shield className="w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-serif text-foreground">{cap.capabilityName}</h3>
                  </div>
                  <p className="text-muted-foreground text-sm mb-6">{cap.description}</p>

                  <div className="space-y-4">
                    <div className="bg-muted p-4 rounded-sm border-l-2 border-muted-foreground">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Traditional View</div>
                      <div className="text-sm text-foreground">{cap.traditionalView}</div>
                    </div>
                    <div className="bg-primary/5 p-4 rounded-sm border-l-2 border-primary">
                      <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">Economic View</div>
                      <div className="text-sm text-foreground">{cap.economicView}</div>
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                <div className="md:col-span-7 md:pl-4 flex flex-col justify-center">
                  <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-6">Economic Impact Measured</h4>
                  <div className="grid sm:grid-cols-3 gap-4">
                    {cap.metrics.map((metric, idx) => (
                      <div key={idx} className="bg-background border rounded-sm p-4 text-center flex flex-col items-center justify-center">
                        <TrendIcon trend={metric.trend} />
                        <div className="text-xl font-serif text-foreground mb-1">{metric.value}</div>
                        <div className="text-xs text-muted-foreground font-medium">{metric.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </section>

      {/* AI-Generated Strategic Narrative */}
      {!loading && !error && data?.study && (
        <section className="py-16 bg-muted/30 border-y">
          <div className="container mx-auto px-4 max-w-5xl space-y-12">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Strategic Briefing</div>
              <h2 className="text-3xl font-serif text-foreground mb-4">{data.study.title}</h2>
              <p className="text-lg text-muted-foreground whitespace-pre-line">{data.study.situation}</p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-xl font-serif text-foreground mb-4 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-primary" /> Strategic Challenges</h3>
                <ul className="space-y-3">
                  {data.study.challenges.map((c, i) => (
                    <li key={i} className="flex gap-3 text-sm text-foreground"><span className="text-primary font-bold">{i + 1}.</span><span>{c}</span></li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xl font-serif text-foreground mb-4 flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-primary" /> Recommendations</h3>
                <div className="space-y-4">
                  {data.study.recommendations.map((r, i) => (
                    <div key={i} className="bg-card border p-4 rounded-sm">
                      <div className="font-serif text-foreground mb-1">{r.title}</div>
                      <div className="text-xs text-muted-foreground mb-2">{r.rationale}</div>
                      <div className="text-xs text-primary font-medium">Impact: {r.impact}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-serif text-foreground mb-4">5-Year KPI Targets</h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.study.kpis.map((k, i) => (
                  <div key={i} className="bg-card border p-4 rounded-sm">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{k.name}</div>
                    <div className="text-sm text-muted-foreground"><span className="font-mono">Now:</span> {k.baseline}</div>
                    <div className="text-sm text-primary"><span className="font-mono">Target:</span> {k.target}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xl font-serif text-foreground mb-4">5-Year Outlook</h3>
              <p className="text-base text-muted-foreground whitespace-pre-line">{data.study.fiveYearOutlook}</p>
            </div>

            {data.study.sources.length > 0 && (
              <div className="pt-6 border-t">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Sources</div>
                <div className="flex flex-wrap gap-2">
                  {data.study.sources.map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">{s.title}</a>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground mt-2">Generated {new Date(data.study.generatedAt).toLocaleDateString()} via {data.study.model}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Financial Visualization */}
      {!loading && !error && roiData.length > 0 && (
        <section className="py-16 bg-foreground text-background">
          <div className="container mx-auto px-4 max-w-5xl">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-3xl font-serif mb-6 text-background">The ROI of Capability Investment</h2>
                <div className="space-y-4 text-muted/80 text-lg">
                  <p>
                    Treating capabilities as economic assets requires an initial capital outlay — often in the form of technology, talent upskilling, and process re-engineering.
                  </p>
                  <p>
                    Unlike a traditional "IT Project" that simply depreciates, a fortified capability generates compounding value over time.
                    The carrier's investment in precision underwriting initially increased costs relative to the traditional baseline, but drove exponential value through better risk selection and higher conversion rates over 5 years.
                  </p>
                </div>
              </div>

              <div className="bg-background/10 p-6 rounded-sm backdrop-blur-sm">
                <h3 className="text-center font-serif text-xl text-background mb-6">5-Year Capability Valuation ($M)</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={roiData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                      <XAxis dataKey="year" stroke="rgba(255,255,255,0.5)" tick={{ fill: "rgba(255,255,255,0.7)" }} />
                      <YAxis stroke="rgba(255,255,255,0.5)" tick={{ fill: "rgba(255,255,255,0.7)" }} />
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: "hsl(var(--foreground))", border: "1px solid rgba(255,255,255,0.2)", color: "white" }}
                        itemStyle={{ color: "white" }}
                      />
                      <Legend wrapperStyle={{ paddingTop: "20px", color: "white" }} />
                      <Bar dataKey="valueGenerated" name="Value Generated" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                      <Line type="monotone" dataKey="capabilityCost" name="Capability Cost" stroke="hsl(var(--accent))" strokeWidth={3} dot={{ r: 4, fill: "hsl(var(--accent))" }} />
                      <Line type="monotone" dataKey="traditionalCost" name="Traditional Cost Baseline" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-16 text-center">
        <div className="container mx-auto px-4 max-w-2xl">
          <h2 className="text-2xl font-serif mb-6 text-foreground">See How This Impacts Leadership</h2>
          <p className="text-muted-foreground mb-8 text-lg">
            Capability Economics requires cross-functional alignment. See how different executives view these exact same capabilities.
          </p>
          <Link href="/c-suite">
            <Button size="lg" className="h-12 px-8 text-base bg-primary hover:bg-primary/90 text-primary-foreground rounded-none" data-testid="case-cta-csuite">
              Explore C-Suite Perspectives
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
