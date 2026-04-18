import { useState } from "react";
import { motion } from "framer-motion";
import { useListProjects, useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import type { TechnologyProject, ProjectCapabilityImpact, ProjectExecutiveInsight, ProjectRisk } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Brain, Zap, Cloud, NetworkIcon, Server, Database,
  ArrowLeft, ChevronRight, Loader2, TrendingUp, Clock,
  DollarSign, AlertTriangle, Shield, Target, Users,
  BarChart3, CheckCircle2, XCircle, ExternalLink, BookOpen,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Legend
} from "recharts";

const iconMap: Record<string, React.ElementType> = {
  Brain, Zap, Cloud, Network: NetworkIcon, Server, Database,
};

const categoryColors: Record<string, string> = {
  "Artificial Intelligence": "bg-purple-100 text-purple-700 border-purple-200",
  "Application Modernization": "bg-blue-100 text-blue-700 border-blue-200",
  "Mainframe Modernization": "bg-orange-100 text-orange-700 border-orange-200",
  "Data Modernization": "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const complexityColors: Record<string, string> = {
  medium: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const severityColors: Record<string, string> = {
  medium: "border-l-amber-400",
  high: "border-l-orange-500",
  critical: "border-l-red-600",
};

const severityBadge: Record<string, string> = {
  medium: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const roleIcons: Record<string, React.ElementType> = {
  CFO: DollarSign,
  CEO: Target,
  CIO: Server,
};

const roleColors: Record<string, string> = {
  CFO: "border-l-amber-500",
  CEO: "border-l-blue-500",
  CIO: "border-l-purple-500",
};

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

export default function Projects() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"impact" | "executive" | "risks">("impact");

  const { data: projects, isLoading: loadingProjects } = useListProjects();
  const { data: projectDetail, isLoading: loadingDetail } = useGetProject(selectedProjectId ?? 0, { industryId: undefined }, {
    query: { queryKey: getGetProjectQueryKey(selectedProjectId ?? 0), enabled: !!selectedProjectId },
  });

  if (selectedProjectId && projectDetail) {
    const project = projectDetail.project;
    const Icon = iconMap[project.icon] || Brain;

    const impactChartData = projectDetail.capabilityImpacts.map((imp: ProjectCapabilityImpact) => ({
      name: imp.capabilityName.length > 18 ? imp.capabilityName.substring(0, 16) + "..." : imp.capabilityName,
      current: imp.currentBenchmark,
      projected: imp.projectedScore,
      uplift: imp.maturityUplift,
    }));

    const radarData = projectDetail.capabilityImpacts.map((imp: ProjectCapabilityImpact) => ({
      capability: imp.capabilityName.length > 15 ? imp.capabilityName.substring(0, 13) + "..." : imp.capabilityName,
      before: imp.currentBenchmark,
      after: imp.projectedScore,
    }));

    const avgUplift = projectDetail.capabilityImpacts.length > 0
      ? Math.round(projectDetail.capabilityImpacts.reduce((sum: number, i: ProjectCapabilityImpact) => sum + i.maturityUplift, 0) / projectDetail.capabilityImpacts.length * 10) / 10
      : 0;

    const avgTimeToImpact = projectDetail.capabilityImpacts.length > 0
      ? Math.round(projectDetail.capabilityImpacts.reduce((sum: number, i: ProjectCapabilityImpact) => sum + i.timeToImpactMonths, 0) / projectDetail.capabilityImpacts.length)
      : 0;

    const criticalRisks = projectDetail.risks.filter((r: ProjectRisk) => r.severity === "critical").length;

    return (
      <div className="min-h-screen bg-background pb-24">
        <section className="bg-muted/30 py-8 border-b">
          <div className="container mx-auto px-4 max-w-6xl">
            <Button variant="ghost" onClick={() => { setSelectedProjectId(null); setActiveTab("impact"); }} className="mb-4 -ml-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" />
              All Projects
            </Button>
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-primary/10 text-primary">
                <Icon className="w-8 h-8" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-3xl md:text-4xl font-serif font-medium text-foreground">{project.name}</h1>
                  <span className={`inline-flex items-center rounded-sm border px-2.5 py-0.5 text-xs font-semibold ${categoryColors[project.category] || "bg-muted text-muted-foreground"}`}>
                    {project.category}
                  </span>
                </div>
                <p className="text-lg text-muted-foreground max-w-3xl">{project.description}</p>
                {project.source && project.source !== "manual" && (
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 font-semibold">
                      <BookOpen className="w-3 h-3" />
                      Sourced via {project.source === "perplexity" ? "Perplexity research" : project.source}
                    </span>
                    {project.researchedAt && (
                      <span className="text-muted-foreground">
                        researched {new Date(project.researchedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-4 mt-4">
                  <div className="flex items-center gap-1.5 text-sm">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Timeline:</span>
                    <span className="font-semibold">{project.typicalTimeline}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <DollarSign className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Investment:</span>
                    <span className="font-semibold">{project.investmentRange}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Complexity:</span>
                    <span className={`px-2 py-0.5 rounded-sm text-xs font-semibold ${complexityColors[project.complexityLevel] || ""}`}>{project.complexityLevel}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <Button variant={activeTab === "impact" ? "default" : "outline"} size="sm" className="rounded-sm" onClick={() => setActiveTab("impact")}>
                <TrendingUp className="w-4 h-4 mr-2" />
                Capability Impact
              </Button>
              <Button variant={activeTab === "executive" ? "default" : "outline"} size="sm" className="rounded-sm" onClick={() => setActiveTab("executive")}>
                <Users className="w-4 h-4 mr-2" />
                Executive Agenda
              </Button>
              <Button variant={activeTab === "risks" ? "default" : "outline"} size="sm" className="rounded-sm" onClick={() => setActiveTab("risks")}>
                <AlertTriangle className="w-4 h-4 mr-2" />
                Risk of Inaction
              </Button>
            </div>
          </div>
        </section>

        <div className="container mx-auto px-4 max-w-6xl py-8">
          {activeTab === "impact" && (
            <div className="space-y-8">
              <div className="grid md:grid-cols-4 gap-4">
                <Card className="rounded-none bg-primary/5 border-primary/20">
                  <CardContent className="pt-6 text-center">
                    <div className="text-3xl font-mono font-bold text-primary">{projectDetail.capabilityImpacts.length}</div>
                    <div className="text-sm text-muted-foreground mt-1">Capabilities Impacted</div>
                  </CardContent>
                </Card>
                <Card className="rounded-none bg-emerald-50 border-emerald-200">
                  <CardContent className="pt-6 text-center">
                    <div className="text-3xl font-mono font-bold text-emerald-700">+{avgUplift}</div>
                    <div className="text-sm text-muted-foreground mt-1">Avg Maturity Uplift</div>
                  </CardContent>
                </Card>
                <Card className="rounded-none bg-amber-50 border-amber-200">
                  <CardContent className="pt-6 text-center">
                    <div className="text-3xl font-mono font-bold text-amber-700">{avgTimeToImpact}mo</div>
                    <div className="text-sm text-muted-foreground mt-1">Avg Time to Impact</div>
                  </CardContent>
                </Card>
                <Card className="rounded-none bg-red-50 border-red-200">
                  <CardContent className="pt-6 text-center">
                    <div className="text-3xl font-mono font-bold text-red-700">{criticalRisks}</div>
                    <div className="text-sm text-muted-foreground mt-1">Critical Risks</div>
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-none">
                <CardHeader>
                  <CardTitle className="font-serif text-lg">Business Case</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-foreground leading-relaxed">{project.businessCase}</p>
                </CardContent>
              </Card>

              {project.citations && project.citations.length > 0 && (
                <Card className="rounded-none">
                  <CardHeader>
                    <CardTitle className="font-serif text-lg flex items-center gap-2">
                      <BookOpen className="w-4 h-4" /> Sources & Citations
                    </CardTitle>
                    <CardDescription>
                      Research backing this project profile
                      {project.researchedAt && (
                        <> — fetched {new Date(project.researchedAt).toLocaleDateString()}</>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ol className="space-y-2 text-sm">
                      {project.citations.map((url: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-muted-foreground font-mono text-xs mt-0.5">[{idx + 1}]</span>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline break-all flex items-start gap-1"
                          >
                            <span>{url}</span>
                            <ExternalLink className="w-3 h-3 mt-1 shrink-0" />
                          </a>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              )}

              <div className="grid lg:grid-cols-2 gap-8">
                <Card className="rounded-none">
                  <CardHeader>
                    <CardTitle className="font-serif text-lg">Capability Impact Overlay</CardTitle>
                    <CardDescription>Current benchmark vs. projected score after project implementation</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[350px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={impactChartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground)/0.15)" />
                          <XAxis type="number" domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                          <YAxis type="category" dataKey="name" width={130} tick={{ fill: 'hsl(var(--foreground))', fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 4, fontSize: 12 }}
                            formatter={(value: number, name: string) => [value, name === "current" ? "Current Benchmark" : "Projected Score"]}
                          />
                          <Bar dataKey="current" name="Current" fill="hsl(var(--muted-foreground)/0.3)" radius={[0, 2, 2, 0]} />
                          <Bar dataKey="projected" name="Projected" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-none">
                  <CardHeader>
                    <CardTitle className="font-serif text-lg">Before & After Radar</CardTitle>
                    <CardDescription>Maturity profile transformation across impacted capabilities</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[350px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="60%">
                          <PolarGrid stroke="hsl(var(--muted-foreground)/0.2)" />
                          <PolarAngleAxis dataKey="capability" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                          <Radar name="Before" dataKey="before" stroke="hsl(var(--muted-foreground))" fill="hsl(var(--muted-foreground))" fillOpacity={0.15} />
                          <Radar name="After" dataKey="after" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.25} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div>
                <h2 className="text-xl font-serif mb-4 text-foreground">Detailed Capability Impacts</h2>
                <div className="space-y-3">
                  {projectDetail.capabilityImpacts.map((imp: ProjectCapabilityImpact) => (
                    <Card key={imp.id} className="rounded-none">
                      <CardContent className="py-4">
                        <div className="flex items-start gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-1">
                              <h3 className="font-semibold text-foreground">{imp.capabilityName}</h3>
                              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-sm">{imp.industryName}</span>
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">{imp.impactDescription}</p>
                          </div>
                          <div className="flex gap-4 text-right shrink-0">
                            <div>
                              <div className="text-xs text-muted-foreground">Uplift</div>
                              <div className="font-mono font-bold text-emerald-600">+{imp.maturityUplift}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Timeline</div>
                              <div className="font-mono font-semibold">{imp.timeToImpactMonths}mo</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Projected</div>
                              <div className="font-mono font-bold text-primary">{imp.projectedScore}</div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "executive" && (
            <div className="space-y-8">
              <div className="bg-muted/40 border rounded-sm p-6 mb-6">
                <h2 className="text-lg font-serif mb-2 text-foreground">Why This Matters for the C-Suite</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Each technology project impacts the executive agenda differently. The CFO needs financial justification, the CEO needs strategic alignment, and the CIO needs architectural clarity. Without addressing all three perspectives, projects stall in committee, get underfunded, or lack executive sponsorship.
                </p>
              </div>

              {(["CEO", "CFO", "CIO"] as const).map((role) => {
                const insight = projectDetail.executiveInsights.find((i: ProjectExecutiveInsight) => i.role === role);
                if (!insight) return null;
                const RoleIcon = roleIcons[role] || Users;
                return (
                  <Card key={role} className={`rounded-none border-l-4 ${roleColors[role]}`}>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-muted">
                          <RoleIcon className="w-5 h-5" />
                        </div>
                        <div>
                          <CardTitle className="font-serif text-lg">{role} — {insight.agendaTitle}</CardTitle>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Agenda Context</h4>
                        <p className="text-foreground leading-relaxed">{insight.agendaDescription}</p>
                      </div>

                      <div className="bg-muted/40 rounded-sm p-4">
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Key Metrics to Track</h4>
                        <div className="grid md:grid-cols-2 gap-2">
                          {insight.keyMetrics.split("|").map((metric: string, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 text-sm">
                              <BarChart3 className="w-3.5 h-3.5 text-primary shrink-0" />
                              <span className="text-foreground">{metric.trim()}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Decision Framework</h4>
                        <p className="text-sm text-foreground leading-relaxed bg-card border rounded-sm p-4">{insight.decisionFramework}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              <Card className="rounded-none bg-primary/5 border-primary/20">
                <CardContent className="py-6">
                  <h3 className="font-serif text-lg mb-2 text-foreground">What Happens Without Executive Alignment?</h3>
                  <div className="grid md:grid-cols-3 gap-4 mt-4">
                    <div className="flex gap-3">
                      <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Without CFO Buy-In</p>
                        <p className="text-xs text-muted-foreground mt-1">Projects are underfunded, lack financial accountability, and get cut in the next budget cycle.</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Without CEO Sponsorship</p>
                        <p className="text-xs text-muted-foreground mt-1">Projects lack strategic priority, compete for resources with pet projects, and die in committee.</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Without CIO Architecture</p>
                        <p className="text-xs text-muted-foreground mt-1">Projects create technical debt, fail to scale, and undermine the enterprise architecture.</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "risks" && (
            <div className="space-y-8">
              <div className="bg-red-50 border border-red-200 rounded-sm p-6 mb-6">
                <h2 className="text-lg font-serif mb-2 text-foreground flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  Risk of Not Identifying These Gaps
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  When organizations fail to map technology projects to capability economics, they make invisible bets. The risks below represent what happens when {project.name.toLowerCase()} is delayed or deprioritized without understanding the capability impact.
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-4 mb-6">
                {["critical", "high", "medium"].map(sev => {
                  const count = projectDetail.risks.filter((r: ProjectRisk) => r.severity === sev).length;
                  return (
                    <Card key={sev} className="rounded-none">
                      <CardContent className="pt-6 text-center">
                        <div className={`text-3xl font-mono font-bold ${sev === "critical" ? "text-red-700" : sev === "high" ? "text-orange-600" : "text-amber-600"}`}>{count}</div>
                        <div className="text-sm text-muted-foreground mt-1 capitalize">{sev} Severity Risks</div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="space-y-4">
                {projectDetail.risks.map((risk: ProjectRisk) => (
                  <Card key={risk.id} className={`rounded-none border-l-4 ${severityColors[risk.severity] || ""}`}>
                    <CardContent className="py-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-foreground">{risk.riskCategory}</span>
                          <span className={`px-2 py-0.5 rounded-sm text-xs font-semibold ${severityBadge[risk.severity] || ""}`}>
                            {risk.severity}
                          </span>
                        </div>
                      </div>

                      <p className="text-sm text-foreground leading-relaxed mb-4">{risk.description}</p>

                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="bg-red-50/80 border border-red-100 rounded-sm p-3">
                          <div className="flex items-center gap-2 mb-1.5">
                            <XCircle className="w-4 h-4 text-red-500" />
                            <span className="text-xs font-semibold text-red-700 uppercase tracking-wider">Consequence of Inaction</span>
                          </div>
                          <p className="text-xs text-foreground leading-relaxed">{risk.consequence}</p>
                        </div>
                        <div className="bg-emerald-50/80 border border-emerald-100 rounded-sm p-3">
                          <div className="flex items-center gap-2 mb-1.5">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Mitigation Path</span>
                          </div>
                          <p className="text-xs text-foreground leading-relaxed">{risk.mitigationPath}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const categories = projects ? [...new Set(projects.map((p: TechnologyProject) => p.category))] : [];

  return (
    <div className="min-h-screen bg-background pb-24">
      <section className="bg-muted/30 py-16 border-b">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-primary/10 text-primary mb-4">
            Project Overlays
          </div>
          <h1 className="text-3xl md:text-5xl font-serif font-medium tracking-tight mb-4 text-foreground">
            Technology Project Impact Analysis
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl">
            Explore how major technology initiatives overlay on capability economics. Each project shows its impact on organizational capabilities, the information needed to drive the CFO, CEO, and CIO agenda, and the risks of not having these gaps identified.
          </p>
        </div>
      </section>

      <section className="py-12 container mx-auto px-4 max-w-5xl">
        {loadingProjects ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-10">
            {categories.map((category) => (
              <div key={category}>
                <h2 className="text-xl font-serif mb-4 text-foreground flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-sm border px-2.5 py-0.5 text-xs font-semibold ${categoryColors[category] || "bg-muted"}`}>
                    {category}
                  </span>
                </h2>
                <motion.div variants={container} initial="hidden" animate="show" className="grid md:grid-cols-2 gap-6">
                  {projects?.filter((p: TechnologyProject) => p.category === category).map((project: TechnologyProject) => {
                    const Icon = iconMap[project.icon] || Brain;
                    return (
                      <motion.div key={project.id} variants={item}>
                        <button
                          onClick={() => setSelectedProjectId(project.id)}
                          className="w-full text-left bg-card border shadow-sm p-6 rounded-sm hover:border-primary/40 hover:shadow-lg transition-all group cursor-pointer"
                        >
                          <div className="flex items-start gap-4">
                            <div className="p-3 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                              <Icon className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                              <h3 className="text-lg font-serif text-foreground mb-1 group-hover:text-primary transition-colors">{project.name}</h3>
                              <p className="text-sm text-muted-foreground line-clamp-2">{project.description}</p>
                              <div className="flex items-center gap-4 mt-4">
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Clock className="w-3.5 h-3.5" />
                                  {project.typicalTimeline}
                                </div>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <DollarSign className="w-3.5 h-3.5" />
                                  {project.investmentRange}
                                </div>
                                <div className="flex items-center gap-1 text-xs text-primary font-medium">
                                  <TrendingUp className="w-3.5 h-3.5" />
                                  {project.impactedCapabilityCount} capabilities
                                </div>
                              </div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
                          </div>
                        </button>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
