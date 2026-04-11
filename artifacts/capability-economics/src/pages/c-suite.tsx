import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase, Cog, CircleDollarSign, MonitorSmartphone, Database,
  Megaphone, Users, Lightbulb, ChevronRight, CheckCircle2, Target,
  Brain, RefreshCw, AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";

const API_BASE = "/api";

const ROLE_ICONS: Record<string, typeof Briefcase> = {
  ceo:  Briefcase,
  coo:  Cog,
  cfo:  CircleDollarSign,
  cto:  MonitorSmartphone,
  cio:  Database,
  cmo:  Megaphone,
  chro: Users,
  cpo:  Lightbulb,
};

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
  const { perspective, loading: perspLoading, error: perspError } = usePerspective(activeSlug);
  const ActiveIcon = activeSlug ? (ROLE_ICONS[activeSlug] ?? Briefcase) : Briefcase;

  return (
    <div className="min-h-screen bg-background pt-8 pb-24">
      <div className="container mx-auto px-4">

        <div className="max-w-3xl mb-12">
          <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary/10 text-primary mb-4">
            Interactive Hub
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-medium tracking-tight mb-4 text-foreground">
            C-Suite Perspectives
          </h1>
          <p className="text-lg text-muted-foreground">
            Capability Economics isn't just for finance. Explore how different executive roles leverage this discipline to drive strategic alignment, allocate resources, and measure success.
          </p>
        </div>

        {rolesLoading && (
          <div className="flex items-center justify-center py-24">
            <Brain className="w-6 h-6 text-primary/40 animate-pulse" />
          </div>
        )}

        {rolesError && (
          <div className="flex flex-col items-center py-16 text-center">
            <AlertTriangle className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Could not load roles. Please check the API server.</p>
          </div>
        )}

        {!rolesLoading && !rolesError && roles.length > 0 && (
          <div className="grid lg:grid-cols-12 gap-8">

            {/* Sidebar */}
            <div className="lg:col-span-4 lg:col-start-1 xl:col-span-3">
              <div className="sticky top-24 space-y-2">
                {roles.map((role) => {
                  const Icon = ROLE_ICONS[role.slug] ?? Briefcase;
                  const isActive = activeSlug === role.slug;
                  return (
                    <button
                      key={role.slug}
                      onClick={() => setActiveSlug(role.slug)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-md transition-all text-left group ${
                        isActive
                          ? "bg-background shadow-sm border text-primary"
                          : "hover:bg-muted text-muted-foreground"
                      }`}
                      data-testid={`role-selector-${role.slug}`}
                    >
                      <div className={`p-2 rounded-md ${isActive ? "bg-primary/10" : "bg-muted group-hover:bg-background"}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className={`font-semibold ${isActive ? "text-foreground" : ""}`}>{role.title}</div>
                        <div className="text-xs truncate opacity-80">{role.name}</div>
                      </div>
                      {isActive && <ChevronRight className="w-4 h-4 opacity-50" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Main Content */}
            <div className="lg:col-span-8 xl:col-span-9">
              <AnimatePresence mode="wait">
                {activeRole && (
                  <motion.div
                    key={activeRole.slug}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    {/* Header Card */}
                    <Card className="rounded-none border-t-4 border-t-primary border-x-0 border-b-0 shadow-sm">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-4 mb-6">
                          <div className="p-4 rounded-lg bg-primary/10 text-primary">
                            <ActiveIcon className="w-8 h-8" />
                          </div>
                          <div>
                            <h2 className="text-2xl font-serif text-foreground">{activeRole.name}</h2>
                            <div className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
                              <Target className="w-4 h-4" />
                              Primary Focus: {activeRole.focus}
                            </div>
                          </div>
                        </div>

                        {perspLoading && (
                          <div className="flex items-center gap-3 py-8 text-muted-foreground">
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span className="text-sm">Loading perspective…</span>
                          </div>
                        )}

                        {!perspLoading && (perspError || !perspective) && (
                          <div className="py-8 text-center border border-dashed rounded-sm">
                            <Brain className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
                            <p className="text-sm text-muted-foreground mb-1 font-medium">No content generated yet</p>
                            <p className="text-xs text-muted-foreground">
                              Trigger an agent run from the CEI Dashboard — the agent will generate this content automatically.
                            </p>
                          </div>
                        )}

                        {!perspLoading && perspective && (
                          <div className="grid md:grid-cols-2 gap-8">
                            <div>
                              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-4">Key Capabilities Managed</h3>
                              <ul className="space-y-3">
                                {perspective.capabilities.map((cap, i) => (
                                  <li key={i} className="flex items-start gap-2 text-foreground">
                                    <CheckCircle2 className="w-5 h-5 shrink-0 text-primary" />
                                    <span>{cap}</span>
                                  </li>
                                ))}
                              </ul>

                              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mt-8 mb-4">Economic Metrics</h3>
                              <div className="flex flex-wrap gap-2">
                                {perspective.metrics.map((metric, i) => (
                                  <span key={i} className="inline-flex items-center rounded-sm border px-2.5 py-0.5 text-xs font-semibold bg-muted text-muted-foreground">
                                    {metric}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="bg-muted/30 rounded-lg p-4 flex flex-col items-center justify-center">
                              <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-2 self-start w-full">Capability Radar</h3>
                              <div className="h-[200px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={perspective.chartData}>
                                    <PolarGrid stroke="hsl(var(--muted-foreground)/0.2)" />
                                    <PolarAngleAxis dataKey="subject" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                    <Radar name={activeRole.title} dataKey="A" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} />
                                  </RadarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Scenario & Questions */}
                    {!perspLoading && perspective && (
                      <div className="grid md:grid-cols-2 gap-6">
                        <Card className="rounded-none bg-background shadow-sm">
                          <CardHeader>
                            <CardTitle className="font-serif text-lg flex items-center gap-2">
                              <Lightbulb className="w-5 h-5 text-accent" />
                              In Action: A Scenario
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-muted-foreground leading-relaxed text-sm">
                              {perspective.scenario}
                            </p>
                          </CardContent>
                        </Card>

                        <Card className="rounded-none bg-background shadow-sm border-l-4 border-l-primary">
                          <CardHeader>
                            <CardTitle className="font-serif text-lg flex items-center gap-2">
                              <Target className="w-5 h-5 text-primary" />
                              Key Questions They Ask
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <ul className="space-y-4 text-sm">
                              {perspective.questions.map((q, i) => (
                                <li key={i} className="text-foreground border-b border-border/50 pb-2 last:border-0 last:pb-0">
                                  "{q}"
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
