import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useListIndustries, useGetIndustry, useGetCapability } from "@workspace/api-client-react";
import type { Industry, Capability, CapabilityMetric, CapabilityDependency, RoleMapping } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Shield, Heart, Landmark, Factory, Cpu, ShoppingCart,
  ChevronRight, ArrowLeft, BarChart3, GitBranch, Users,
  TrendingUp, TrendingDown, Minus, Loader2
} from "lucide-react";
import {
  ResponsiveContainer, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis
} from "recharts";

const iconMap: Record<string, React.ElementType> = {
  Shield, Heart, Landmark, Factory, Cpu, ShoppingCart,
};

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

function StrengthBadge({ strength }: { strength: string }) {
  const colors: Record<string, string> = {
    strong: "bg-emerald-100 text-emerald-700 border-emerald-200",
    moderate: "bg-amber-100 text-amber-700 border-amber-200",
    weak: "bg-slate-100 text-slate-500 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold ${colors[strength] || colors.moderate}`}>
      {strength}
    </span>
  );
}

function RelevanceBadge({ relevance }: { relevance: string }) {
  const colors: Record<string, string> = {
    high: "bg-primary/10 text-primary border-primary/20",
    medium: "bg-amber-100 text-amber-700 border-amber-200",
    low: "bg-slate-100 text-slate-500 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold ${colors[relevance] || colors.medium}`}>
      {relevance}
    </span>
  );
}

export default function KnowledgeGraph() {
  const [selectedIndustryId, setSelectedIndustryId] = useState<number | null>(null);
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<number | null>(null);

  const { data: industries, isLoading: loadingIndustries } = useListIndustries();
  const { data: industryDetail, isLoading: loadingIndustry } = useGetIndustry(selectedIndustryId!, {
    query: { enabled: !!selectedIndustryId } as any,
  });
  const { data: capabilityDetail, isLoading: loadingCapability } = useGetCapability(selectedCapabilityId!, {
    query: { enabled: !!selectedCapabilityId } as any,
  });

  if (selectedCapabilityId && capabilityDetail) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <section className="bg-muted/30 py-8 border-b">
          <div className="container mx-auto px-4 max-w-5xl">
            <Button variant="ghost" onClick={() => setSelectedCapabilityId(null)} className="mb-4 -ml-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to {industryDetail?.name}
            </Button>
            <h1 className="text-3xl md:text-4xl font-serif font-medium text-foreground">{capabilityDetail.name}</h1>
            <p className="text-lg text-muted-foreground mt-2">{capabilityDetail.description}</p>
          </div>
        </section>

        <div className="container mx-auto px-4 max-w-5xl py-8 space-y-8">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="rounded-none border-l-4 border-l-muted-foreground">
              <CardHeader><CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-sans">Traditional View</CardTitle></CardHeader>
              <CardContent><p className="text-foreground">{capabilityDetail.traditionalView}</p></CardContent>
            </Card>
            <Card className="rounded-none border-l-4 border-l-primary">
              <CardHeader><CardTitle className="text-sm uppercase tracking-wider text-primary font-sans">Economic View</CardTitle></CardHeader>
              <CardContent><p className="text-foreground">{capabilityDetail.economicView}</p></CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card className="rounded-none">
              <CardHeader>
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  Key Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {capabilityDetail.metrics.map((metric: CapabilityMetric) => (
                    <div key={metric.id} className="border-b border-border/50 pb-3 last:border-0 last:pb-0">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-semibold text-sm text-foreground">{metric.name}</span>
                        {metric.benchmarkValue != null && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-sm font-mono">
                            Benchmark: {metric.benchmarkValue} {metric.unit}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{metric.description}</p>
                    </div>
                  ))}
                  {capabilityDetail.metrics.length === 0 && (
                    <p className="text-sm text-muted-foreground">No metrics defined yet.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="rounded-none">
                <CardHeader>
                  <CardTitle className="font-serif text-lg flex items-center gap-2">
                    <GitBranch className="w-5 h-5 text-accent" />
                    Dependencies
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {capabilityDetail.dependencies.map((dep: CapabilityDependency) => (
                      <div key={dep.id} className="flex items-center justify-between">
                        <button
                          onClick={() => setSelectedCapabilityId(dep.dependsOnId)}
                          className="text-sm text-primary hover:underline cursor-pointer"
                        >
                          {dep.dependsOnName}
                        </button>
                        <StrengthBadge strength={dep.strength} />
                      </div>
                    ))}
                    {capabilityDetail.dependencies.length === 0 && (
                      <p className="text-sm text-muted-foreground">No dependencies mapped.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-none">
                <CardHeader>
                  <CardTitle className="font-serif text-lg flex items-center gap-2">
                    <Users className="w-5 h-5 text-primary" />
                    C-Suite Relevance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {capabilityDetail.roleMappings.map((rm: RoleMapping) => (
                      <div key={rm.roleId} className="border-b border-border/50 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-sm">{rm.roleTitle} — {rm.roleName}</span>
                          <RelevanceBadge relevance={rm.relevance} />
                        </div>
                        <p className="text-xs text-muted-foreground">{rm.perspective}</p>
                      </div>
                    ))}
                    {capabilityDetail.roleMappings.length === 0 && (
                      <p className="text-sm text-muted-foreground">No role mappings defined.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="rounded-none bg-muted/30">
            <CardHeader>
              <CardTitle className="font-serif text-lg">Benchmark Score</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${capabilityDetail.benchmarkScore}%` }}
                  />
                </div>
                <span className="font-mono text-lg font-semibold text-foreground">{capabilityDetail.benchmarkScore}/100</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Industry average maturity benchmark score</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (selectedIndustryId && industryDetail) {
    const radarData = industryDetail.capabilities.map((c: Capability) => ({
      name: c.name.length > 20 ? c.name.substring(0, 18) + "..." : c.name,
      benchmark: c.benchmarkScore,
    }));

    return (
      <div className="min-h-screen bg-background pb-24">
        <section className="bg-muted/30 py-8 border-b">
          <div className="container mx-auto px-4 max-w-5xl">
            <Button variant="ghost" onClick={() => { setSelectedIndustryId(null); setSelectedCapabilityId(null); }} className="mb-4 -ml-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" />
              All Industries
            </Button>
            <div className="flex items-center gap-4">
              {(() => { const Icon = iconMap[industryDetail.icon] || Shield; return <Icon className="w-10 h-10 text-primary" />; })()}
              <div>
                <h1 className="text-3xl md:text-4xl font-serif font-medium text-foreground">{industryDetail.name}</h1>
                <p className="text-muted-foreground">{industryDetail.capabilities.length} capabilities mapped</p>
              </div>
            </div>
            <p className="text-lg text-muted-foreground mt-4 max-w-3xl">{industryDetail.description}</p>
          </div>
        </section>

        <div className="container mx-auto px-4 max-w-5xl py-8">
          <div className="grid lg:grid-cols-3 gap-8 mb-8">
            <div className="lg:col-span-2">
              <h2 className="text-xl font-serif mb-4 text-foreground">Capability Map</h2>
              <motion.div variants={container} initial="hidden" animate="show" className="space-y-3">
                {industryDetail.capabilities.map((cap: Capability) => (
                  <motion.div key={cap.id} variants={item}>
                    <button
                      onClick={() => setSelectedCapabilityId(cap.id)}
                      className="w-full text-left bg-card border shadow-sm p-4 rounded-sm hover:border-primary/40 hover:shadow-md transition-all group cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{cap.name}</h3>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{cap.description}</p>
                        </div>
                        <div className="flex items-center gap-3 ml-4">
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Benchmark</div>
                            <div className="font-mono font-semibold text-foreground">{cap.benchmarkScore}</div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </div>
                    </button>
                  </motion.div>
                ))}
              </motion.div>
            </div>

            <div>
              <h2 className="text-xl font-serif mb-4 text-foreground">Industry Radar</h2>
              <Card className="rounded-none">
                <CardContent className="pt-6">
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
                        <PolarGrid stroke="hsl(var(--muted-foreground)/0.2)" />
                        <PolarAngleAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar name="Benchmark" dataKey="benchmark" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-center text-muted-foreground mt-2">Industry benchmark maturity scores</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <section className="bg-muted/30 py-16 border-b">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary mb-4">
            Knowledge Graph
          </div>
          <h1 className="text-3xl md:text-5xl font-serif font-medium tracking-tight mb-4 text-foreground">
            Industry Capability Explorer
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Explore the capability landscape across six key industries. Each industry has 8-12 core capabilities with benchmarks, metrics, dependencies, and C-suite relevance mappings.
          </p>
        </div>
      </section>

      <section className="py-12 container mx-auto px-4 max-w-5xl">
        {loadingIndustries ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {industries?.map((industry: Industry) => {
              const Icon = iconMap[industry.icon] || Shield;
              return (
                <motion.div key={industry.id} variants={item}>
                  <button
                    onClick={() => setSelectedIndustryId(industry.id)}
                    className="w-full text-left bg-card border shadow-sm p-6 rounded-sm hover:border-primary/40 hover:shadow-lg transition-all group cursor-pointer"
                  >
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Icon className="w-6 h-6" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-serif text-foreground mb-1">{industry.name}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-3">{industry.description}</p>
                        <div className="flex items-center gap-2 mt-4 text-primary text-sm font-medium">
                          {industry.capabilityCount} capabilities
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>
                    </div>
                  </button>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </section>
    </div>
  );
}
