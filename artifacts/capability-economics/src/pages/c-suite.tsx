import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, AlertTriangle, Brain } from "lucide-react";
import { ResponsiveContainer, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";

import { MobileNotice } from "@/components/mobile";
const API_BASE = "/api";

interface Role {
  id: number;
  slug: string;
  title: string;
  name: string;
  focus: string;
}

interface Perspective {
  id: number;
  scenario: string;
  questions: string[];
  capabilities: string[];
  metrics: string[];
  chartData: { subject: string; A: number; fullMark: number }[];
  generatedAt: string;
}

function useRoles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/csuite`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<Role[]>; })
      .then(data => { setRoles(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  return { roles, loading, error };
}

function usePerspective(slug: string | null) {
  const [perspective, setPerspective] = useState<Perspective | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(false);
    fetch(`${API_BASE}/csuite/${slug}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<{ role: Role; perspective: Perspective | null }>; })
      .then(data => { setPerspective(data.perspective); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [slug]);

  return { perspective, loading, error };
}

export default function CSuite() {
  const { roles, loading: rolesLoading, error: rolesError } = useRoles();
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  useEffect(() => {
    if (roles.length > 0 && !activeSlug) setActiveSlug(roles[0].slug);
  }, [roles, activeSlug]);

  const activeRole = roles.find(r => r.slug === activeSlug) ?? null;
  const activeIndex = activeRole ? roles.findIndex(r => r.slug === activeRole.slug) : -1;
  const { perspective, loading: perspLoading, error: perspError } = usePerspective(activeSlug);

  return (
    <div className="min-h-screen bg-background">
      <MobileNotice />
      {/* Masthead */}
      <header className="border-b border-border/60">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-12 pb-12 lg:pt-16 lg:pb-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="grid lg:grid-cols-[1fr_auto] gap-10 lg:gap-16 items-end"
          >
            <div>
              <div className="inline-flex items-center gap-2 mb-5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Vol. I — C-Suite Perspectives</span>
              </div>
              <h1 className="font-serif text-5xl lg:text-7xl leading-[0.95] tracking-tight max-w-4xl">
                The framework,<br /><span className="italic text-foreground/70">by the seat.</span>
              </h1>
            </div>
            <p className="font-serif italic text-lg lg:text-xl text-foreground/60 leading-relaxed max-w-md">
              Capability economics isn't just for finance. Each executive role pulls a different lever — same framework, different question.
            </p>
          </motion.div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-12 lg:py-16">
        {rolesLoading && (
          <div className="flex items-center justify-center py-32">
            <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
          </div>
        )}

        {rolesError && (
          <div className="border border-dashed border-border/60 py-16 text-center">
            <AlertTriangle className="w-6 h-6 text-muted-foreground mx-auto mb-3" />
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Could not load roles</p>
          </div>
        )}

        {!rolesLoading && !rolesError && roles.length > 0 && (
          <div className="grid lg:grid-cols-[280px_1fr] gap-10 lg:gap-16">
            {/* Index sidebar */}
            <aside>
              <div className="lg:sticky lg:top-24">
                <div className="inline-flex items-center gap-2 mb-4 pb-3 border-b border-border/40 w-full">
                  <span className="h-px w-4 bg-accent" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-accent">Index</span>
                </div>
                <ol>
                  {roles.map((role, i) => {
                    const isActive = activeSlug === role.slug;
                    return (
                      <li key={role.slug}>
                        <button
                          onClick={() => setActiveSlug(role.slug)}
                          data-testid={`role-selector-${role.slug}`}
                          className={`w-full grid grid-cols-[36px_1fr] gap-3 py-3.5 border-b border-border/40 text-left transition-colors group ${
                            isActive ? "bg-muted/30" : "hover:bg-muted/20"
                          }`}
                        >
                          <span className={`font-mono text-[9px] tabular-nums tracking-[0.22em] pt-0.5 ${isActive ? "text-accent" : "text-muted-foreground/60"}`}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span>
                            <span className={`font-serif text-lg leading-tight block ${isActive ? "text-foreground" : "text-foreground/65 group-hover:text-foreground"}`}>
                              {role.title}
                            </span>
                            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5 block">
                              {role.name}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </aside>

            {/* Active role panel */}
            <main>
              <AnimatePresence mode="wait">
                {activeRole && (
                  <motion.div
                    key={activeRole.slug}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {/* Role header */}
                    <div className="pb-12 border-b border-border/40">
                      <div className="inline-flex items-center gap-2 mb-5">
                        <span className="h-px w-5 bg-accent" />
                        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
                          {String(activeIndex + 1).padStart(2, "0")} — {activeRole.title}
                        </span>
                      </div>
                      <h2 className="font-serif text-5xl lg:text-6xl leading-[0.95] tracking-tight mb-6">
                        {activeRole.name}
                      </h2>
                      <div className="font-serif italic text-lg lg:text-xl text-foreground/60 leading-relaxed max-w-2xl">
                        Primary focus — <span className="not-italic text-foreground/80">{activeRole.focus}</span>
                      </div>
                    </div>

                    {perspLoading && (
                      <div className="flex items-center gap-3 py-16 text-muted-foreground">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Loading perspective…</span>
                      </div>
                    )}

                    {!perspLoading && (perspError || !perspective) && (
                      <div className="border border-dashed border-border/60 py-16 text-center mt-12">
                        <div className="inline-flex items-center gap-2 mb-3">
                          <RefreshCw className="w-4 h-4 text-muted-foreground/60 animate-spin" />
                          <Brain className="w-5 h-5 text-muted-foreground/50" />
                        </div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Regenerating perspective</p>
                        <p className="text-xs text-muted-foreground max-w-md mx-auto">
                          The agent is preparing this {activeRole.title} viewpoint with fresh research. New perspectives publish automatically as the agent finishes — refresh in a moment.
                        </p>
                      </div>
                    )}

                    {!perspLoading && perspective && (
                      <>
                        {/* Scenario pull-quote */}
                        <div className="py-12 border-b border-border/40">
                          <div className="inline-flex items-center gap-2 mb-5">
                            <span className="h-px w-5 bg-accent" />
                            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ In action — a scenario</span>
                          </div>
                          <p className="font-serif text-2xl lg:text-3xl leading-[1.25] tracking-tight text-foreground/85 max-w-3xl">
                            {perspective.scenario}
                          </p>
                        </div>

                        {/* Capabilities + Radar */}
                        <div className="grid lg:grid-cols-[1fr_360px] gap-12 lg:gap-16 py-12 border-b border-border/40">
                          <div>
                            <div className="inline-flex items-center gap-2 mb-6">
                              <span className="h-px w-5 bg-accent" />
                              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Key capabilities managed</span>
                            </div>
                            <ul className="space-y-0">
                               {perspective.capabilities.map((cap, i) => (
                                 <li key={i} className="grid grid-cols-[36px_1fr] gap-3 py-3 border-b border-border/40 last:border-b-0">
                                   <span className="font-mono text-[9px] tabular-nums tracking-[0.22em] text-muted-foreground/60 pt-0.5">
                                     {String(i + 1).padStart(2, "0")}
                                   </span>
                                   <span className="font-serif text-lg leading-snug text-foreground/80">{cap}</span>
                                 </li>
                               ))}
                            </ul>

                            <div className="inline-flex items-center gap-2 mt-10 mb-4">
                              <span className="h-px w-5 bg-accent" />
                              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Economic metrics tracked</span>
                            </div>
                            <div className="flex flex-wrap gap-x-1 gap-y-2">
                              {perspective.metrics.map((metric, i) => (
                                <span
                                  key={i}
                                  className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/80 px-2.5 py-1 border border-border/60"
                                >
                                  {metric}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="inline-flex items-center gap-2 mb-4">
                              <span className="h-px w-4 bg-border/60" />
                              <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-muted-foreground">Capability radar</span>
                            </div>
                            <div className="h-[280px] w-full border border-border/40 p-2">
                              <ResponsiveContainer width="100%" height="100%">
                                <RadarChart cx="50%" cy="50%" outerRadius="72%" data={perspective.chartData}>
                                  <PolarGrid stroke="hsl(var(--muted-foreground) / 0.18)" />
                                  <PolarAngleAxis dataKey="subject" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                  <Radar
                                    name={activeRole.title}
                                    dataKey="A"
                                    stroke="hsl(var(--accent))"
                                    fill="hsl(var(--accent))"
                                    fillOpacity={0.18}
                                    strokeWidth={1.5}
                                  />
                                </RadarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </div>

                        {/* Questions they ask */}
                        <div className="py-12">
                          <div className="inline-flex items-center gap-2 mb-6">
                            <span className="h-px w-5 bg-accent" />
                            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Key questions they ask</span>
                          </div>
                          <ul className="space-y-0 max-w-3xl">
                            {perspective.questions.map((q, i) => (
                              <li key={i} className="grid grid-cols-[36px_1fr] gap-3 py-5 border-b border-border/40 last:border-b-0">
                                <span className="font-mono text-[9px] tabular-nums tracking-[0.22em] text-muted-foreground/60 pt-1">
                                  {String(i + 1).padStart(2, "0")}
                                </span>
                                <span className="font-serif italic text-lg lg:text-xl leading-relaxed text-foreground/85">
                                  &ldquo;{q}&rdquo;
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
