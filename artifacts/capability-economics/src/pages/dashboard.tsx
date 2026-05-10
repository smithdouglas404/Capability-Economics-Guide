import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useGetDashboard, useListRoles, getGetDashboardQueryKey } from "@workspace/api-client-react";
import type { GapAnalysis, Assessment, DashboardDataRadarDataItem } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3, TrendingUp, TrendingDown, Target, Loader2,
  AlertTriangle, CheckCircle2, ArrowRight, Building2
} from "lucide-react";
import {
  ResponsiveContainer, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine
} from "recharts";
import { Link, useLocation } from "wouter";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const sessionToken = typeof window !== "undefined"
    ? localStorage.getItem("ce_session_token")
    : null;

  const { data: roles } = useListRoles();
  const dashboardParams = roleFilter !== "all" ? { roleSlug: roleFilter } : undefined;
  const { data: dashboard, isLoading, error } = useGetDashboard(
    sessionToken || "",
    dashboardParams,
    {
      query: { queryKey: getGetDashboardQueryKey(sessionToken || "", dashboardParams), enabled: !!sessionToken },
    }
  );

  if (!sessionToken) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full rounded-none shadow-lg mx-4">
          <CardHeader className="text-center">
            <Building2 className="w-12 h-12 text-primary mx-auto mb-4" />
            <CardTitle className="font-serif text-2xl">No Organization Found</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-muted-foreground mb-6">
              Create your organization and complete a capability assessment to view your personalized dashboard.
            </p>
            <Link href="/organization">
              <Button className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground">
                Get Started
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!dashboard || error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full rounded-none shadow-lg mx-4">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <p className="text-foreground font-semibold mb-2">Could not load dashboard</p>
            <p className="text-muted-foreground text-sm mb-4">Your session may have expired.</p>
            <Button onClick={() => { localStorage.removeItem("ce_session_token"); navigate("/organization"); }} variant="outline" className="rounded-none">
              Start Over
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { organization, summary, radarData, assessments } = dashboard;

  const gapChartData = assessments.map(a => ({
    name: a.capabilityName.length > 18 ? a.capabilityName.substring(0, 16) + "..." : a.capabilityName,
    maturity: a.maturityScore,
    benchmark: a.benchmarkScore,
    gap: a.benchmarkScore - a.maturityScore,
  }));

  return (
    <div className="min-h-screen bg-background pb-24">
      <section className="bg-muted/10 py-8 border-b border-border/40">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Personalized Dashboard</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-serif font-medium text-foreground">{organization.name}</h1>
              <p className="text-muted-foreground text-sm mt-1">{organization.industryName} &middot; {organization.size} organization &middot; {summary.assessedCapabilities} of {summary.totalCapabilities} capabilities assessed</p>
            </div>
            <div className="flex items-center gap-3">
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filter by Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Capabilities</SelectItem>
                  {roles?.map(role => (
                    <SelectItem key={role.slug} value={role.slug}>{role.title} — {role.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Link href="/organization">
                <Button variant="outline" className="rounded-none" size="sm">Edit Assessment</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 max-w-6xl py-8 space-y-8">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="rounded-none">
            <CardContent className="pt-6 text-center">
              <Target className="w-8 h-8 text-primary mx-auto mb-2" />
              <div className="text-3xl font-serif tracking-tight text-foreground">{summary.averageMaturity}</div>
              <div className="text-xs text-muted-foreground mt-1">Avg Maturity Score</div>
            </CardContent>
          </Card>
          <Card className="rounded-none">
            <CardContent className="pt-6 text-center">
              <BarChart3 className="w-8 h-8 text-accent mx-auto mb-2" />
              <div className="text-3xl font-serif tracking-tight text-foreground">{summary.averageBenchmark}</div>
              <div className="text-xs text-muted-foreground mt-1">Avg Benchmark</div>
            </CardContent>
          </Card>
          <Card className="rounded-none">
            <CardContent className="pt-6 text-center">
              {summary.averageMaturity >= summary.averageBenchmark ? (
                <TrendingUp className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              ) : (
                <TrendingDown className="w-8 h-8 text-rose-500 mx-auto mb-2" />
              )}
              <div className="text-3xl font-serif tracking-tight text-foreground">
                {summary.averageMaturity >= summary.averageBenchmark ? "+" : ""}
                {Math.round((summary.averageMaturity - summary.averageBenchmark) * 10) / 10}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Gap to Benchmark</div>
            </CardContent>
          </Card>
          <Card className="rounded-none">
            <CardContent className="pt-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-2" />
              <div className="text-3xl font-serif tracking-tight text-foreground">{summary.assessedCapabilities}/{summary.totalCapabilities}</div>
              <div className="text-xs text-muted-foreground mt-1">Assessed</div>
            </CardContent>
          </Card>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-8">
          <Card className="rounded-none">
            <CardHeader>
              <CardTitle className="font-serif text-lg tracking-tight">Maturity vs Benchmark Radar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData.map((d: DashboardDataRadarDataItem) => ({
                    ...d,
                    capability: d.capability.length > 20 ? d.capability.substring(0, 18) + "..." : d.capability,
                  }))} cx="50%" cy="50%" outerRadius="65%">
                    <PolarGrid stroke="hsl(var(--muted-foreground)/0.2)" />
                    <PolarAngleAxis dataKey="capability" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar name="Your Maturity" dataKey="maturity" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} />
                    <Radar name="Benchmark" dataKey="benchmark" stroke="hsl(var(--accent))" fill="hsl(var(--accent))" fillOpacity={0.1} strokeDasharray="5 5" />
                    <Legend />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none">
            <CardHeader>
              <CardTitle className="font-serif text-lg tracking-tight">Gap Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gapChartData} layout="vertical" margin={{ left: 10, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" domain={[-50, 50]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} width={120} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                      formatter={(value: number, name: string) => [Math.abs(value).toFixed(1), name === "gap" ? "Gap" : name]}
                    />
                    <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                    <Bar dataKey="gap" name="Gap to Benchmark" radius={[0, 4, 4, 0]}>
                      {gapChartData.map((entry: { gap: number }, index: number) => (
                        <Cell key={index} fill={entry.gap > 0 ? "hsl(0 84% 60%)" : "hsl(142 71% 45%)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          <Card className="rounded-none border-l-4 border-l-rose-500">
            <CardHeader>
              <CardTitle className="font-serif text-lg flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
                Top Capability Gaps
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {summary.topGaps.filter((g: GapAnalysis) => g.gap > 0).map((gap: GapAnalysis, i: number) => (
                  <div key={i} className="flex items-center justify-between border-b border-border/50 pb-3 last:border-0">
                    <div>
                      <div className="font-semibold text-sm text-foreground">{gap.capabilityName}</div>
                      <div className="text-xs text-muted-foreground">Score: {gap.maturityScore} / Benchmark: {gap.benchmarkScore}</div>
                    </div>
                    <div className="text-rose-500 font-mono font-semibold">-{gap.gap.toFixed(0)}</div>
                  </div>
                ))}
                {summary.topGaps.filter((g: GapAnalysis) => g.gap > 0).length === 0 && (
                  <p className="text-sm text-muted-foreground">No gaps found — you're meeting or exceeding all benchmarks!</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-l-4 border-l-emerald-500">
            <CardHeader>
              <CardTitle className="font-serif text-lg flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                Top Strengths
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {summary.topStrengths.filter((s: GapAnalysis) => s.gap <= 0).map((strength: GapAnalysis, i: number) => (
                  <div key={i} className="flex items-center justify-between border-b border-border/50 pb-3 last:border-0">
                    <div>
                      <div className="font-semibold text-sm text-foreground">{strength.capabilityName}</div>
                      <div className="text-xs text-muted-foreground">Score: {strength.maturityScore} / Benchmark: {strength.benchmarkScore}</div>
                    </div>
                    <div className="text-emerald-500 font-mono font-semibold">+{Math.abs(strength.gap).toFixed(0)}</div>
                  </div>
                ))}
                {summary.topStrengths.filter((s: GapAnalysis) => s.gap <= 0).length === 0 && (
                  <p className="text-sm text-muted-foreground">Complete more assessments to identify strengths.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-none">
          <CardHeader>
            <CardTitle className="font-serif text-lg tracking-tight">All Assessments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-semibold text-muted-foreground">Capability</th>
                    <th className="pb-3 font-semibold text-muted-foreground text-center">Your Score</th>
                    <th className="pb-3 font-semibold text-muted-foreground text-center">Benchmark</th>
                    <th className="pb-3 font-semibold text-muted-foreground text-center">Gap</th>
                    <th className="pb-3 font-semibold text-muted-foreground text-center">Investment</th>
                    <th className="pb-3 font-semibold text-muted-foreground text-center">Importance</th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((a: Assessment) => {
                    const gap = a.benchmarkScore - a.maturityScore;
                    return (
                      <tr key={a.id} className="border-b border-border/50 last:border-0">
                        <td className="py-3 font-medium text-foreground">{a.capabilityName}</td>
                        <td className="py-3 text-center font-mono">{a.maturityScore}</td>
                        <td className="py-3 text-center font-mono text-muted-foreground">{a.benchmarkScore}</td>
                        <td className={`py-3 text-center font-mono font-semibold ${gap > 0 ? "text-rose-500" : "text-emerald-500"}`}>
                          {gap > 0 ? `-${gap.toFixed(0)}` : `+${Math.abs(gap).toFixed(0)}`}
                        </td>
                        <td className="py-3 text-center">
                          <span className="inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold bg-muted text-muted-foreground capitalize">
                            {a.investmentLevel}
                          </span>
                        </td>
                        <td className="py-3 text-center">
                          <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold capitalize ${
                            a.strategicImportance === "critical" ? "bg-rose-50 text-rose-700 border-rose-200" :
                            a.strategicImportance === "high" ? "bg-amber-50 text-amber-700 border-amber-200" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {a.strategicImportance}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
