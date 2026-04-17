import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity, Users, DollarSign, Brain, RefreshCw, Play,
  CheckCircle, Clock, AlertCircle, Database, Cpu, BarChart3,
  FileText, Lightbulb, Trophy, BookOpen, Network, UserSquare2,
  Mic, File, Briefcase, ChevronUp, ChevronDown, Minus,
  Zap, Building2, GitBranch, Layers,
} from "lucide-react";
import EducationalContentAdmin from "@/components/educational-content-admin";
import CaseStudyAdmin from "@/components/case-study-admin";
import EnrichmentAdmin from "@/components/enrichment-admin";
import MembershipAdmin from "@/components/membership-admin";

const API_BASE = "/api";

function useApi<T>(url: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}${url}`);
      setData(await res.json());
      setLastFetched(new Date());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { data, loading, refetch: fetch_, lastFetched };
}

function StatCard({ title, value, sub, icon: Icon, color = "text-foreground" }: {
  title: string; value: string | number; sub?: string;
  icon: React.ElementType; color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">{title}</p>
            <p className={`text-3xl font-bold font-mono ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-muted">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    complete: { label: "Complete", className: "bg-green-500/10 text-green-600 border border-green-500/20" },
    analyzing: { label: "Analyzing", className: "bg-blue-500/10 text-blue-600 border border-blue-500/20" },
    clarifying: { label: "Clarifying", className: "bg-yellow-500/10 text-yellow-600 border border-yellow-500/20" },
    error: { label: "Error", className: "bg-red-500/10 text-red-600 border border-red-500/20" },
  };
  const s = map[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.className}`}>{s.label}</span>;
}

function FreshnessBadge({ latest, staleDays }: { latest: string | null; staleDays: number }) {
  if (!latest) return <span className="px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">No data</span>;
  const age = (Date.now() - new Date(latest).getTime()) / (1000 * 60 * 60 * 24);
  const fresh = age < staleDays;
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${fresh ? "bg-green-500/10 text-green-600 border border-green-500/20" : "bg-amber-500/10 text-amber-600 border border-amber-500/20"}`}>
      {fresh ? `Fresh (${age < 1 ? "<1" : Math.floor(age)}d)` : `Stale (${Math.floor(age)}d)`}
    </span>
  );
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type Overview = {
  assessments: { total: number; completed: number; last24h: number; last7d: number; last30d: number };
  agent: { total: number; lastRun: string; memories: number };
  costs: { daily: number; weekly: number; monthly: number; allTime: number } | null;
};

type Assessment = {
  sessionId: string; companyName: string | null; industry: string | null;
  status: string; confidenceScore: number | null; createdAt: string;
  hasVoice: boolean; hasDocument: boolean; hasJobPosting: boolean;
  opportunity: string | null;
};

type Industry = { id: number; name: string; slug: string };
type ContentMap = Record<number, { latest: string; count: number }>;
type ContentData = {
  industries: Industry[];
  content: {
    insights: ContentMap; leaderboard: ContentMap; whitePapers: ContentMap;
    ontology: ContentMap; caseStudy: ContentMap;
    csuite: { latest: string | null; count: number };
  };
};

type AgentRun = {
  id: number; status: string; startedAt: string;
  perplexityCalls: number; capabilitiesResearched: number;
};

type ModelEntry = { task: string; model: string; reason: string };

const MODEL_COLORS: Record<string, string> = {
  "z-ai/glm-5.1": "bg-purple-500/10 text-purple-600 border border-purple-500/20",
  "anthropic/claude-sonnet-4.5": "bg-blue-500/10 text-blue-600 border border-blue-500/20",
  "deepseek/deepseek-chat": "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
  "anthropic/claude-haiku-4.5": "bg-orange-500/10 text-orange-600 border border-orange-500/20",
};

const CONTENT_TYPES = [
  { key: "insights", label: "Insights", icon: Lightbulb, staleDays: 2, perIndustry: true },
  { key: "leaderboard", label: "Leaderboard", icon: Trophy, staleDays: 7, perIndustry: true },
  { key: "whitePapers", label: "White Papers", icon: BookOpen, staleDays: 15, perIndustry: true },
  { key: "ontology", label: "Ontology", icon: Network, staleDays: 90, perIndustry: true },
  { key: "caseStudy", label: "Case Study", icon: FileText, staleDays: 2, perIndustry: true },
];

export default function AdminDashboard() {
  const { data: overview, loading: ovLoading, refetch: refetchOv } = useApi<Overview>("/admin/overview");
  const { data: assessments, loading: assLoading, refetch: refetchAss } = useApi<Assessment[]>("/admin/assessments");
  const { data: content, loading: contentLoading, refetch: refetchContent } = useApi<ContentData>("/admin/content");
  const { data: agentRuns, loading: runsLoading, refetch: refetchRuns } = useApi<AgentRun[]>("/admin/agent-runs");
  const { data: models } = useApi<ModelEntry[]>("/admin/models");

  const { data: enrichStatus, loading: enrichLoading, refetch: refetchEnrich } = useApi<{
    quadrants: number; valueChainStages: number; companies: number; companyMappings: number;
  }>("/enrichment/status");

  const { data: enrichRuns, refetch: refetchEnrichRuns } = useApi<Array<{
    id: number; startedAt: string; completedAt: string | null; status: string;
    quadrantsClassified: number; valueChainStagesCreated: number;
    companiesProfiled: number; companyMappingsCreated: number;
    durationMs: number | null; errors: string[] | null;
  }>>("/enrichment/runs?limit=10");

  const [triggering, setTriggering] = useState<string | null>(null);
  const [enrichRunning, setEnrichRunning] = useState(false);
  const [enrichResult, setEnrichResult] = useState<{
    quadrantsClassified: number; valueChainStagesCreated: number;
    companiesProfiled: number; companyMappingsCreated: number;
    errors: string[]; durationMs: number;
  } | null>(null);
  const [sortField, setSortField] = useState<"createdAt" | "companyName" | "status">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const triggerEnrichment = async () => {
    setEnrichRunning(true);
    setEnrichResult(null);
    try {
      const res = await fetch(`${API_BASE}/enrichment/run`, { method: "POST" });
      const result = await res.json();
      setEnrichResult(result);
      refetchEnrich();
      refetchEnrichRuns();
    } catch (e) {
      console.error(e);
    } finally {
      setEnrichRunning(false);
    }
  };

  const triggerTool = async (tool: string, industrySlug?: string) => {
    const key = `${tool}-${industrySlug ?? "all"}`;
    setTriggering(key);
    try {
      await fetch(`${API_BASE}/admin/trigger/${tool}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industrySlug }),
      });
      setTimeout(() => { refetchContent(); refetchRuns(); }, 2000);
    } finally {
      setTimeout(() => setTriggering(null), 1500);
    }
  };

  const refetchAll = () => { refetchOv(); refetchAss(); refetchContent(); refetchRuns(); };

  const sorted = [...(assessments ?? [])].sort((a, b) => {
    const av = a[sortField] ?? "";
    const bv = b[sortField] ?? "";
    return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const SortIcon = ({ field }: { field: string }) => {
    if (field !== sortField) return <Minus className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const toggleSort = (field: typeof sortField) => {
    if (field === sortField) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  return (
    <div className="min-h-screen bg-background p-6 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">Platform monitoring, content management &amp; cost tracking</p>
        </div>
        <Button variant="outline" onClick={refetchAll} className="gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh All
        </Button>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard title="Total Assessments" value={overview?.assessments.total ?? "—"} sub={`${overview?.assessments.last24h ?? 0} today`} icon={Users} />
        <StatCard title="Completed" value={overview?.assessments.completed ?? "—"} sub={`${overview?.assessments.last7d ?? 0} this week`} icon={CheckCircle} color="text-green-600" />
        <StatCard title="Monthly LLM Cost" value={overview?.costs ? `$${overview.costs.monthly.toFixed(4)}` : "—"} sub={`$${overview?.costs?.daily.toFixed(4) ?? "—"}/day`} icon={DollarSign} color="text-blue-600" />
        <StatCard title="All-Time Spend" value={overview?.costs ? `$${overview.costs.allTime.toFixed(3)}` : "—"} sub="via OpenRouter" icon={BarChart3} />
        <StatCard title="Agent Runs" value={overview?.agent.total ?? "—"} sub={timeAgo(overview?.agent.lastRun ?? null)} icon={Activity} color="text-purple-600" />
        <StatCard title="Memory Items" value={overview?.agent.memories ?? "—"} sub="Mem0 Cloud" icon={Brain} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
        {/* Assessment Table */}
        <div className="xl:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5" /> Assessment Monitor
                <span className="text-sm font-normal text-muted-foreground ml-2">({assessments?.length ?? 0} total)</span>
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={refetchAss} disabled={assLoading}>
                <RefreshCw className={`w-3 h-3 ${assLoading ? "animate-spin" : ""}`} />
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {[
                        { label: "Company", field: "companyName" as const },
                        { label: "Industry", field: null },
                        { label: "Status", field: "status" as const },
                        { label: "Confidence", field: null },
                        { label: "Enrichment", field: null },
                        { label: "Date", field: "createdAt" as const },
                      ].map(col => (
                        <th
                          key={col.label}
                          className={`px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider ${col.field ? "cursor-pointer hover:text-foreground select-none" : ""}`}
                          onClick={() => col.field && toggleSort(col.field)}
                        >
                          <div className="flex items-center gap-1">
                            {col.label}
                            {col.field && <SortIcon field={col.field} />}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {assLoading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                    ) : sorted.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No assessments yet</td></tr>
                    ) : sorted.map(a => (
                      <tr key={a.sessionId} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium max-w-[160px]">
                          <div className="truncate">{a.companyName ?? <span className="text-muted-foreground italic">Anonymous</span>}</div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{a.industry ?? "—"}</td>
                        <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                        <td className="px-4 py-3 font-mono">
                          {a.confidenceScore != null ? (
                            <span className={`${a.confidenceScore >= 70 ? "text-green-600" : a.confidenceScore >= 50 ? "text-yellow-600" : "text-muted-foreground"}`}>
                              {a.confidenceScore}%
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {a.hasVoice && <span title="Voice"><Mic className="w-3.5 h-3.5 text-blue-500" /></span>}
                            {a.hasDocument && <span title="Document"><File className="w-3.5 h-3.5 text-purple-500" /></span>}
                            {a.hasJobPosting && <span title="Job posting"><Briefcase className="w-3.5 h-3.5 text-orange-500" /></span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{timeAgo(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cost + Agent Panel */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="w-5 h-5" /> OpenRouter Costs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview?.costs ? (
                <>
                  {[
                    { label: "Today", value: overview.costs.daily },
                    { label: "This week", value: overview.costs.weekly },
                    { label: "This month", value: overview.costs.monthly },
                    { label: "All time", value: overview.costs.allTime },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{row.label}</span>
                      <span className="font-mono font-semibold text-foreground">${row.value.toFixed(4)}</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-border">
                    <p className="text-xs text-muted-foreground">Est. per assessment: <span className="font-mono font-semibold text-foreground">~$0.03</span></p>
                    <p className="text-xs text-muted-foreground">Agent baseline/month: <span className="font-mono font-semibold text-foreground">~$5–8</span></p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Loading cost data...</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5" /> Recent Agent Runs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {runsLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : !agentRuns?.length ? (
                <p className="text-sm text-muted-foreground">No runs yet</p>
              ) : agentRuns.slice(0, 6).map(run => (
                <div key={run.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {run.status === "complete" ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> :
                     run.status === "error" ? <AlertCircle className="w-3.5 h-3.5 text-red-500" /> :
                     <Clock className="w-3.5 h-3.5 text-yellow-500" />}
                    <span className="text-muted-foreground text-xs">{timeAgo(run.startedAt)}</span>
                  </div>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>{run.perplexityCalls} Perplexity</span>
                    <span>{run.capabilitiesResearched} caps</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Content Management */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="w-5 h-5" /> Content Management
            <span className="text-sm font-normal text-muted-foreground ml-2">Freshness per industry · click to regenerate</span>
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => triggerTool("run-agent")} disabled={!!triggering} className="gap-1.5">
              <Play className="w-3 h-3" /> Run Full Agent Cycle
            </Button>
            <Button size="sm" variant="ghost" onClick={refetchContent} disabled={contentLoading}>
              <RefreshCw className={`w-3 h-3 ${contentLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {contentLoading ? (
            <p className="text-sm text-muted-foreground">Loading content data...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Industry</th>
                    {CONTENT_TYPES.map(ct => (
                      <th key={ct.key} className="px-4 py-2 text-center text-xs font-medium text-muted-foreground uppercase">
                        <div className="flex items-center justify-center gap-1">
                          <ct.icon className="w-3 h-3" />
                          {ct.label}
                        </div>
                      </th>
                    ))}
                    <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground uppercase">C-Suite</th>
                  </tr>
                </thead>
                <tbody>
                  {content?.industries.map(ind => (
                    <tr key={ind.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">{ind.name}</td>
                      {CONTENT_TYPES.map(ct => {
                        const entry = (content.content[ct.key as keyof typeof content.content] as ContentMap)[ind.id];
                        const key = `${ct.key}-${ind.slug}`;
                        const toolMap: Record<string, string> = {
                          insights: "generate-insights", leaderboard: "generate-leaderboard",
                          whitePapers: "generate-white-papers", ontology: "generate-ontology",
                          caseStudy: "generate-case-study",
                        };
                        return (
                          <td key={ct.key} className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1.5">
                              <FreshnessBadge latest={entry?.latest ?? null} staleDays={ct.staleDays} />
                              {entry && <span className="text-xs text-muted-foreground">{entry.count} items</span>}
                              <Button
                                size="sm" variant="ghost"
                                className="h-6 text-xs px-2"
                                disabled={triggering === key}
                                onClick={() => triggerTool(toolMap[ct.key], ind.slug)}
                              >
                                {triggering === key ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                              </Button>
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-1.5">
                          <FreshnessBadge latest={content?.content.csuite.latest ?? null} staleDays={2} />
                          <span className="text-xs text-muted-foreground">{content?.content.csuite.count ?? 0} roles</span>
                          <Button
                            size="sm" variant="ghost" className="h-6 text-xs px-2"
                            disabled={triggering === "csuite-all"}
                            onClick={() => triggerTool("generate-csuite")}
                          >
                            {triggering === "csuite-all" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enrichment Pipeline */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="w-5 h-5" /> Capability Enrichment Pipeline
            <span className="text-sm font-normal text-muted-foreground ml-2">Perplexity research → GLM 5.1 synthesis</span>
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={triggerEnrichment}
              disabled={enrichRunning}
              className="gap-1.5"
            >
              {enrichRunning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {enrichRunning ? "Enriching..." : "Enrich Now"}
            </Button>
            <Button size="sm" variant="ghost" onClick={refetchEnrich} disabled={enrichLoading}>
              <RefreshCw className={`w-3 h-3 ${enrichLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Layers className="w-5 h-5 text-purple-500" />
              <div>
                <p className="text-2xl font-bold font-mono">{enrichStatus?.quadrants ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Quadrant Classifications</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <GitBranch className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-2xl font-bold font-mono">{enrichStatus?.valueChainStages ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Value Chain Stages</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Building2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="text-2xl font-bold font-mono">{enrichStatus?.companies ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Company Profiles</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Network className="w-5 h-5 text-orange-500" />
              <div>
                <p className="text-2xl font-bold font-mono">{enrichStatus?.companyMappings ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Company↔Capability Mappings</p>
              </div>
            </div>
          </div>

          {enrichResult && (
            <div className="p-4 rounded-lg border border-border bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium">Enrichment Complete — {(enrichResult.durationMs / 1000).toFixed(1)}s</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <span className="text-muted-foreground">+{enrichResult.quadrantsClassified} quadrants</span>
                <span className="text-muted-foreground">+{enrichResult.valueChainStagesCreated} stages</span>
                <span className="text-muted-foreground">+{enrichResult.companiesProfiled} companies</span>
                <span className="text-muted-foreground">+{enrichResult.companyMappingsCreated} mappings</span>
              </div>
              {enrichResult.errors.length > 0 && (
                <div className="mt-2 text-xs text-red-500">
                  {enrichResult.errors.length} error(s): {enrichResult.errors[0]}
                  {enrichResult.errors.length > 1 && ` (+${enrichResult.errors.length - 1} more)`}
                </div>
              )}
            </div>
          )}

          {enrichRunning && (
            <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-muted/30">
              <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
              <div>
                <p className="text-sm font-medium">Running enrichment across all industries...</p>
                <p className="text-xs text-muted-foreground">Perplexity research → GLM 5.1 synthesis → DB insert (this may take 2-5 minutes)</p>
              </div>
            </div>
          )}

          {enrichRuns && enrichRuns.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Run History
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-1.5 text-left font-medium">Started</th>
                      <th className="py-1.5 text-left font-medium">Status</th>
                      <th className="py-1.5 text-right font-medium">Quadrants</th>
                      <th className="py-1.5 text-right font-medium">Stages</th>
                      <th className="py-1.5 text-right font-medium">Companies</th>
                      <th className="py-1.5 text-right font-medium">Mappings</th>
                      <th className="py-1.5 text-right font-medium">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichRuns.map((run) => (
                      <tr key={run.id} className="border-b border-border/50">
                        <td className="py-1.5">{new Date(run.startedAt).toLocaleString()}</td>
                        <td className="py-1.5">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${
                            run.status === "completed" ? "bg-green-500/10 text-green-600" :
                            run.status === "running" ? "bg-blue-500/10 text-blue-600" :
                            run.status === "completed_with_errors" ? "bg-yellow-500/10 text-yellow-600" :
                            "bg-red-500/10 text-red-600"
                          }`}>
                            {run.status === "running" && <RefreshCw className="w-3 h-3 animate-spin" />}
                            {run.status === "completed" && <CheckCircle className="w-3 h-3" />}
                            {run.status === "completed_with_errors" && <AlertCircle className="w-3 h-3" />}
                            {run.status}
                          </span>
                        </td>
                        <td className="py-1.5 text-right font-mono">{run.quadrantsClassified}</td>
                        <td className="py-1.5 text-right font-mono">{run.valueChainStagesCreated}</td>
                        <td className="py-1.5 text-right font-mono">{run.companiesProfiled}</td>
                        <td className="py-1.5 text-right font-mono">{run.companyMappingsCreated}</td>
                        <td className="py-1.5 text-right font-mono">
                          {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Model Routing */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cpu className="w-5 h-5" /> Model Routing
            <span className="text-sm font-normal text-muted-foreground ml-2">All calls via OpenRouter</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Task</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Model</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(models ?? []).map((m, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{m.task}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${MODEL_COLORS[m.model] ?? "bg-muted text-muted-foreground"}`}>
                        {m.model}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 space-y-6">
        <EnrichmentAdmin />
        <MembershipAdmin />
        <EducationalContentAdmin />
        <CaseStudyAdmin />
      </div>
    </div>
  );
}
