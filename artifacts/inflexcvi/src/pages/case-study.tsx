import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowRight, ArrowLeft, TrendingUp, TrendingDown, Activity,
  CheckCircle2, AlertTriangle, RefreshCw, Brain,
} from "lucide-react";
import {
  ResponsiveContainer, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, Line, ComposedChart,
} from "recharts";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

const API_BASE = "/api";


const fade = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1 } },
};

interface Metric {
  name: string;
  value: string;
  trend: "up" | "down" | "neutral";
  detail?: string;
}

interface RoiRow {
  year: string;
  traditionalCost: number;
  capabilityCost: number;
  valueGenerated: number;
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

function TrendArrow({ trend }: { trend: "up" | "down" | "neutral" }) {
  if (trend === "up") return <TrendingUp className="w-3.5 h-3.5 text-accent" aria-hidden />;
  if (trend === "down") return <TrendingDown className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />;
  return <Activity className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />;
}

export default function CaseStudy() {
  const [, params] = useRoute<{ slug: string }>("/case-study/:slug");
  const slug = params?.slug ?? "";
  const [data, setData] = useState<CaseStudyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(false);
    (async () => {
      for (const url of [`${API_BASE}/case-studies/${slug}`, `${API_BASE}/case-study/${slug}`]) {
        try {
          const r = await fetch(url);
          if (r.ok) {
            const j = await r.json() as CaseStudyData;
            setData(j);
            setLoading(false);
            return;
          }
        } catch { /* try next */ }
      }
      setError(true);
      setLoading(false);
    })();
  }, [slug]);

  const roiData: RoiRow[] = data?.capabilities.find(c => c.roiData)?.roiData ?? [];
  const industryName = data?.industry?.name ?? (slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " "));

  return (
    <div className="min-h-screen bg-background">
      {/* Masthead */}
      <header className="border-b border-border/60">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-12 pb-16 lg:pt-16 lg:pb-24">
          <Link
            href="/case-studies"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-10"
          >
            <ArrowLeft className="w-3 h-3" /> All case studies
          </Link>

          <motion.div
            initial="hidden"
            animate="show"
            variants={fade}
          >
            <div className="inline-flex items-center gap-2 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              <span className="font-mono text-[13px] uppercase tracking-[0.28em] text-muted-foreground">Case Study — Industry Briefing</span>
            </div>
            <h1 className="font-serif text-5xl md:text-7xl lg:text-[5.5rem] leading-[0.95] tracking-tight max-w-5xl">
              {industryName}
            </h1>
            {data?.study?.executiveSummary && (
              <p className="font-serif italic text-xl lg:text-2xl text-foreground/60 leading-relaxed mt-8 max-w-3xl">
                {data.study.executiveSummary}
              </p>
            )}
          </motion.div>
        </div>
      </header>

      {/* § 01 — Capability Transformation */}
      <section className="border-b border-border/40">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
          <div className="grid lg:grid-cols-[260px_1fr] gap-10 lg:gap-16 mb-16">
            <div>
              <div className="inline-flex items-center gap-2 mb-4">
                <span className="h-px w-5 bg-accent" />
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ 01 — Reframing</span>
              </div>
              <h2 className="font-serif text-4xl lg:text-5xl leading-[1.0] tracking-tight">
                The capability<br /><em className="not-italic italic text-foreground/70">transformation.</em>
              </h2>
            </div>
            <p className="font-serif text-lg lg:text-xl text-foreground/75 leading-relaxed self-end max-w-2xl">
              Traditional accounting treats these functions as cost centers — budgets get trimmed uniformly when margins compress. Inflexcvi treats them as distinct economic engines, each with its own ROI curve, moat, and decay profile.
            </p>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
            </div>
          )}

          {!loading && error && (
            <div className="border border-dashed border-border/60 py-16 text-center">
              <AlertTriangle className="w-6 h-6 text-muted-foreground mx-auto mb-3" />
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Could not load case study data</p>
            </div>
          )}

          {!loading && !error && data?.capabilities.length === 0 && (
            <div className="border border-dashed border-border/60 py-16 text-center">
              <Brain className="w-6 h-6 text-muted-foreground/40 mx-auto mb-3" />
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">No content yet</p>
              <p className="text-xs text-muted-foreground">Admins can trigger generation from Admin → Content → Case Study.</p>
            </div>
          )}

          {!loading && !error && data && data.capabilities.length > 0 && (
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-80px" }}
              className="border-t border-border/40"
            >
              {data.capabilities.map((cap, capIndex) => (
                <motion.article
                  key={cap.capabilitySlug}
                  variants={fade}
                  className="grid lg:grid-cols-[80px_1fr_1fr] gap-x-8 gap-y-6 py-12 lg:py-14 border-b border-border/40"
                >
                  <div className="font-mono text-[10px] tabular-nums tracking-[0.22em] text-accent">
                    {String(capIndex + 1).padStart(2, "0")}
                  </div>

                  <div className="max-w-xl">
                    <h3 className="font-serif text-3xl lg:text-[2rem] leading-tight tracking-tight mb-3">
                      {cap.capabilityName}
                    </h3>
                    <p className="text-base text-muted-foreground leading-relaxed mb-6">{cap.description}</p>

                    <div className="space-y-4">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-1.5">
                          Traditional view
                        </div>
                        <p className="text-base text-foreground/75 leading-relaxed">{cap.traditionalView}</p>
                      </div>
                      <div className="pl-4 border-l-2 border-accent">
                        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent mb-1.5">
                          Economic view
                        </div>
                        <p className="text-base text-foreground leading-relaxed">{cap.economicView}</p>
                      </div>
                    </div>
                  </div>

                    <div>
                    <h4 className="font-serif text-lg lg:text-xl text-foreground mb-6">Economic impact measured</h4>
                    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-8">
                      {cap.metrics.map((metric, idx) => {
                        const cell = (
                          <div className={`${idx > 0 ? "sm:border-l sm:border-border/40 sm:pl-6" : ""} ${metric.detail ? "cursor-help" : ""}`}>
                            <div className="flex items-center gap-1.5 mb-2">
                              <TrendArrow trend={metric.trend} />
                              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground leading-snug">{metric.name}</span>
                            </div>
                            <dd className="font-serif text-xl lg:text-2xl text-foreground leading-tight tracking-tight">
                              {metric.value}
                            </dd>
                          </div>
                        );
                        if (!metric.detail) return <div key={idx}>{cell}</div>;
                        return (
                          <HoverCard key={idx} openDelay={120} closeDelay={80}>
                            <HoverCardTrigger asChild>{cell}</HoverCardTrigger>
                            <HoverCardContent align="start" className="w-80">
                              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{metric.name}</div>
                              <p className="text-sm text-foreground/85 leading-relaxed">{metric.detail}</p>
                            </HoverCardContent>
                          </HoverCard>
                        );
                      })}
                    </dl>
                  </div>
                </motion.article>
              ))}
            </motion.div>
          )}
        </div>
      </section>

      {/* § 02 — Strategic Briefing */}
      {!loading && !error && data?.study && (
        <section className="border-b border-border/40 bg-muted/10">
          <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
            <div className="grid lg:grid-cols-[260px_1fr] gap-10 lg:gap-16 mb-16">
              <div>
                <div className="inline-flex items-center gap-2 mb-4">
                  <span className="h-px w-5 bg-accent" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ 02 — Strategic Briefing</span>
                </div>
                <h2 className="font-serif text-4xl lg:text-5xl leading-[1.05] tracking-tight">
                  {data.study.title}
                </h2>
              </div>
              <p className="font-serif text-lg lg:text-xl text-foreground/80 leading-relaxed self-end max-w-3xl whitespace-pre-line">
                {data.study.situation}
              </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-x-12 gap-y-16 border-t border-border/40 pt-12">
              <div>
                <div className="inline-flex items-center gap-2 mb-6">
                  <span className="h-px w-5 bg-accent" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" /> Strategic challenges</span>
                </div>
                <ol className="space-y-5">
                  {data.study.challenges.map((c, i) => (
                    <li key={i} className="grid grid-cols-[36px_1fr] gap-3 pb-5 border-b border-border/40 last:border-b-0">
                      <span className="font-mono text-[9px] tabular-nums tracking-[0.22em] text-muted-foreground/60 pt-0.5">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-serif text-base lg:text-lg text-foreground leading-relaxed">{c}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <div className="inline-flex items-center gap-2 mb-6">
                  <span className="h-px w-5 bg-accent" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" /> Recommendations</span>
                </div>
                <div className="space-y-6">
                  {data.study.recommendations.map((r, i) => (
                    <div key={i} className="grid grid-cols-[36px_1fr] gap-3 pb-6 border-b border-border/40 last:border-b-0">
                      <span className="font-mono text-[9px] tabular-nums tracking-[0.22em] text-muted-foreground/60 pt-0.5">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <div className="font-serif text-lg lg:text-xl text-foreground leading-snug mb-1.5">{r.title}</div>
                        <p className="text-base text-muted-foreground leading-relaxed mb-2">{r.rationale}</p>
                        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
                          Impact — <span className="font-sans normal-case tracking-normal text-sm text-foreground/80">{r.impact}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {data.study.kpis.length > 0 && (
              <div className="mt-16 pt-12 border-t border-border/40">
                <div className="inline-flex items-center gap-2 mb-8">
                  <span className="h-px w-5 bg-accent" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">5-Year KPI targets</span>
                </div>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
                  {data.study.kpis.map((k, i) => (
                    <div key={i} className="border-t border-border/40 pt-4">
                      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground mb-2">
                        {k.name}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-0.5">Now</div>
                          <div className="font-mono tabular-nums text-base text-muted-foreground">{k.baseline}</div>
                        </div>
                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent mb-0.5">Target</div>
                          <div className="font-mono tabular-nums text-base text-foreground">{k.target}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.study.fiveYearOutlook && (
              <div className="mt-16 pt-12 border-t border-border/40 max-w-3xl">
                <div className="inline-flex items-center gap-2 mb-4">
                  <span className="h-px w-5 bg-accent" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">5-Year outlook</span>
                </div>
                <p className="font-serif text-lg lg:text-xl text-foreground/85 leading-relaxed whitespace-pre-line">
                  {data.study.fiveYearOutlook}
                </p>
              </div>
            )}

            {data.study.sources.length > 0 && (
              <div className="mt-16 pt-8 border-t border-border/40">
                <div className="inline-flex items-center gap-2 mb-3">
                  <span className="h-px w-4 bg-border/60" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">Sources</span>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {data.study.sources.map((s, i) => (
                    <a
                      key={i}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-foreground/80 hover:text-accent underline underline-offset-4 decoration-border hover:decoration-accent"
                    >
                      {s.title}
                    </a>
                  ))}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground mt-4">
                  Generated {new Date(data.study.generatedAt).toLocaleDateString()} · {data.study.model}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* § 03 — ROI of Capability Investment */}
      {!loading && !error && roiData.length > 0 && (
        <section className="bg-foreground text-background border-b border-background/15">
          <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start">
              <div>
                <div className="inline-flex items-center gap-2 mb-5">
                  <span className="h-px w-5 bg-accent" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ 03 — Returns</span>
                </div>
                <h2 className="font-serif text-4xl lg:text-5xl leading-[1.0] tracking-tight mb-8">
                  The ROI of capability<br /><em className="not-italic italic text-background/70">investment.</em>
                </h2>
                <div className="space-y-5 font-serif text-lg lg:text-xl text-background/75 leading-relaxed">
                  <p>
                    Treating capabilities as economic assets requires an initial capital outlay — technology, talent upskilling, process re-engineering.
                  </p>
                  <p>
                    Unlike a traditional project that simply depreciates, a fortified capability generates compounding value over time. Investment costs typically rise above the traditional baseline in years one and two, then exponential value generation takes over as the capability matures.
                  </p>
                </div>
              </div>

              <div>
                <div className="inline-flex items-center gap-2 mb-6">
                  <span className="h-px w-4 bg-background/30" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-background/50">5-year capability valuation ($M)</span>
                </div>
                <div className="h-[340px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={roiData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                      <XAxis dataKey="year" stroke="rgba(255,255,255,0.4)" tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 11 }} />
                      <YAxis stroke="rgba(255,255,255,0.4)" tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 11 }} />
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: "hsl(var(--foreground))", border: "1px solid rgba(255,255,255,0.2)", color: "white", fontSize: 12 }}
                        itemStyle={{ color: "white" }}
                      />
                      <Legend wrapperStyle={{ paddingTop: "12px", color: "white", fontSize: 11 }} />
                      <Bar dataKey="valueGenerated" name="Value Generated" fill="hsl(var(--accent))" />
                      <Line type="monotone" dataKey="capabilityCost" name="Capability Cost" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                      <Line type="monotone" dataKey="traditionalCost" name="Traditional Baseline" stroke="rgba(255,255,255,0.4)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* § Next */}
      <section className="border-t border-border/40">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="grid lg:grid-cols-[260px_1fr] gap-10 lg:gap-16 items-end">
            <div>
              <div className="inline-flex items-center gap-2 mb-4">
                <span className="h-px w-5 bg-accent" />
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ Next</span>
              </div>
              <h2 className="font-serif text-4xl lg:text-5xl leading-[1.0] tracking-tight">
                See how this<br /><em className="not-italic italic text-foreground/70">impacts leadership.</em>
              </h2>
            </div>
            <div className="flex flex-col gap-4">
              <p className="font-serif italic text-lg text-foreground/60 leading-relaxed max-w-2xl">
                Inflexcvi requires cross-functional alignment. See how different executives view these exact same capabilities.
              </p>
              <Link
                href="/c-suite"
                data-testid="case-cta-csuite"
                className="inline-flex h-11 items-center px-7 font-mono text-[11px] uppercase tracking-[0.18em] bg-foreground text-background hover:bg-foreground/90 transition-colors w-fit gap-2 group"
              >
                C-Suite perspectives
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
