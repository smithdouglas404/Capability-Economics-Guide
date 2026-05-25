import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity, Users, DollarSign, Brain, RefreshCw, Play,
  CheckCircle, Clock, AlertCircle, Database, Cpu,
  FileText, Lightbulb, Trophy, BookOpen, Network, Mic, File, Briefcase,
  ChevronUp, ChevronDown, Minus, Zap, Building2, GitBranch, Layers,
  LayoutDashboard, ShieldCheck, Gift, CreditCard, BookMarked, BookOpenCheck,
  Settings, Store, ShieldAlert,
} from "lucide-react";
import { SyntheticAgentBadge } from "@/components/synthetic-agent-badge";
import { AdminCommandPalette, AdminCommandHint } from "@/components/admin-command-palette";
import EducationalContentAdmin from "@/components/educational-content-admin";
import CaseStudyAdmin from "@/components/case-study-admin";
import EnrichmentAdmin from "@/components/enrichment-admin";
import MembershipAdmin from "@/components/membership-admin";
import KycAdmin from "@/components/kyc-admin";
import PaymentApprovals, { usePaymentApprovalsData } from "@/components/payment-approvals";
import ManualCompForm from "@/components/manual-comp-form";
import MembersList from "@/components/members-list";
import AuditLogViewer from "@/components/audit-log-viewer";
import MarketplaceModeration from "@/components/marketplace-moderation";
import FeaturedContentScheduler from "@/components/featured-content-scheduler";
import FoundrySyncPanel from "@/components/foundry-sync-panel";
import ProductsAdmin from "@/components/products-admin";
import ApiVolumePanel from "@/components/api-volume-panel";
import AgentsControlPanel from "@/components/agents-control-panel";

const API_BASE = "/api";

function useApi<T>(url: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}${url}`, { credentials: "include" });
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
          <div className="p-2 rounded-none bg-muted">
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
  "anthropic/claude-sonnet-4.6": "bg-blue-500/10 text-blue-600 border border-blue-500/20",
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

/** Small red-dot badge, shown in the tab trigger next to "Approvals" when there are pending requests. */
function PendingDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-2 min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-semibold">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function AdminDashboard() {
  const [tab, setTab] = useState<string>(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      return window.location.hash.replace(/^#/, "") || "overview";
    }
    return "overview";
  });
  const [navOpen, setNavOpen] = useState(false); // mobile sidebar drawer

  // Sync URL hash <-> tab state so the ⌘K command palette can deep-link
  // into a section (palette navigates to "/admin#system" etc.).
  useEffect(() => {
    function onHash() {
      const h = window.location.hash.replace(/^#/, "");
      if (h) setTab(h);
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash.replace(/^#/, "") !== tab) {
      window.history.replaceState(null, "", `#${tab}`);
    }
  }, [tab]);

  const { data: overview, refetch: refetchOv } = useApi<Overview>("/admin/overview");
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

  // Lift the payment summary so the tab label can show a pending-count badge without
  // the PaymentApprovals component being mounted on every tab.
  const paymentsData = usePaymentApprovalsData();
  const pendingCount = paymentsData.summary?.byStatus.pending ?? 0;

  // Pending platform-signup requests (human-in-the-loop sign-up approval queue).
  const [pendingSignupCount, setPendingSignupCount] = useState(0);
  useEffect(() => {
    const load = () => fetch("/api/admin/platform-signups/pending-count", { credentials: "include" })
      .then(r => r.ok ? r.json() : { count: 0 })
      .then((j: { count: number }) => setPendingSignupCount(Number(j.count ?? 0)))
      .catch(() => setPendingSignupCount(0));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

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
      const res = await fetch(`${API_BASE}/enrichment/run`, { method: "POST", credentials: "include" });
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
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industrySlug }),
      });
      setTimeout(() => { refetchContent(); refetchRuns(); }, 2000);
    } finally {
      setTimeout(() => setTriggering(null), 1500);
    }
  };

  const refetchAll = () => {
    refetchOv(); refetchAss(); refetchContent(); refetchRuns();
    paymentsData.refetch();
  };

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

  // Sidebar nav config — drives the left rail. Each entry maps to a Tabs
  // value below so the existing TabsContent blocks light up unchanged.
  const NAV_ITEMS: Array<{ value: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }> = [
    { value: "overview",    label: "Overview",     icon: LayoutDashboard },
    { value: "approvals",   label: "Approvals",    icon: ShieldCheck, badge: pendingCount },
    { value: "members",     label: "Members",      icon: Gift },
    { value: "tiers",       label: "Tiers",        icon: CreditCard },
    { value: "kyc",         label: "KYC",          icon: ShieldCheck },
    { value: "content",     label: "Content",      icon: BookMarked },
    { value: "enrichment",  label: "Enrichment",   icon: Zap },
    { value: "products",    label: "Products",     icon: Layers },
    { value: "assessments", label: "Assessments",  icon: Users },
    { value: "marketplace", label: "Marketplace",  icon: Store },
    { value: "agents",      label: "Agents & LLM", icon: Cpu },
    { value: "system",      label: "System",       icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background">
      <AdminCommandPalette />
      <div className="max-w-screen-2xl mx-auto flex flex-col lg:flex-row">
        {/* ── Sidebar (persistent on lg+, drawer below) ─────────────── */}
        <aside className={`${navOpen ? "block" : "hidden"} lg:block lg:w-56 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto border-r border-border/40 bg-muted/20`}>
          <div className="px-4 py-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent mb-1">Admin</div>
            <div className="font-serif text-lg leading-tight">Dashboard</div>
          </div>
          <nav className="px-2 pb-4 space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.value;
              return (
                <button
                  key={item.value}
                  onClick={() => { setTab(item.value); setNavOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-none text-sm font-medium transition-colors ${
                    active
                      ? "bg-foreground text-background"
                      : "text-foreground/70 hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? "" : "text-muted-foreground"}`} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge != null && item.badge > 0 && (
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-none ${active ? "bg-background/20 text-background" : "bg-amber-500/20 text-amber-700 dark:text-amber-400"}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Main pane ──────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="flex items-center justify-between mb-6 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => setNavOpen(v => !v)} className="lg:hidden p-2 rounded-none border border-border" aria-label="Toggle navigation">
                <Layers className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <h1 className="text-2xl font-serif tracking-tight text-foreground truncate">
                  {NAV_ITEMS.find(n => n.value === tab)?.label ?? "Admin"}
                </h1>
                <p className="text-muted-foreground text-xs hidden sm:block">
                  Platform monitoring, member approvals, content management &amp; system health.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AdminCommandHint />
              <Button variant="outline" size="sm" onClick={refetchAll} className="gap-2 rounded-none">
                <RefreshCw className="w-4 h-4" /> Refresh
              </Button>
            </div>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            {/* TabsList kept rendered but visually hidden — Radix Tabs needs
                triggers to exist for keyboard navigation + a11y. We drive
                the active value via the sidebar buttons. */}
            <TabsList className="sr-only" aria-label="Sections">
              {NAV_ITEMS.map(item => (
                <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>
              ))}
            </TabsList>

        {/* ─────────────────────── Overview tab ─────────────────────── */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard title="Pending Approvals" value={pendingCount} sub={pendingCount > 0 ? "Needs review" : "All clear"} icon={Clock} color={pendingCount > 0 ? "text-amber-600" : "text-foreground"} />
            <StatCard title="Active Members" value={paymentsData.summary?.byStatus.active ?? "—"} sub="Billing current" icon={CheckCircle} color="text-emerald-600" />
            <StatCard title="Total Assessments" value={overview?.assessments.total ?? "—"} sub={`${overview?.assessments.last24h ?? 0} today`} icon={Users} />
            <StatCard title="Monthly LLM Cost" value={overview?.costs ? `$${overview.costs.monthly.toFixed(4)}` : "—"} sub={`$${overview?.costs?.daily.toFixed(4) ?? "—"}/day`} icon={DollarSign} color="text-blue-600" />
            <StatCard title="Agent Runs" value={overview?.agent.total ?? "—"} sub={timeAgo(overview?.agent.lastRun ?? null)} icon={Activity} color="text-purple-600" />
            <StatCard title="Memory Items" value={overview?.agent.memories ?? "—"} sub="Mem0 Cloud" icon={Brain} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Quick links to other tabs */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <LayoutDashboard className="w-5 h-5" /> Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <button onClick={() => setTab("approvals")} className="w-full text-left p-3 border border-border hover:bg-muted/50 flex items-center justify-between transition-colors">
                  <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-600" /> Review pending approvals</span>
                  <span className="text-xs font-mono text-muted-foreground">{pendingCount} pending</span>
                </button>
                <button onClick={() => setTab("members")} className="w-full text-left p-3 border border-border hover:bg-muted/50 flex items-center justify-between transition-colors">
                  <span className="flex items-center gap-2"><Gift className="w-4 h-4 text-primary" /> Grant membership manually</span>
                  <span className="text-xs text-muted-foreground">Comp / upgrade</span>
                </button>
                <button onClick={() => setTab("tiers")} className="w-full text-left p-3 border border-border hover:bg-muted/50 flex items-center justify-between transition-colors">
                  <span className="flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> Edit tier pricing &amp; features</span>
                </button>
                <button onClick={() => setTab("enrichment")} className="w-full text-left p-3 border border-border hover:bg-muted/50 flex items-center justify-between transition-colors">
                  <span className="flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Trigger capability enrichment</span>
                </button>
                <Link href="/admin/regulations" className="w-full text-left p-3 border border-border hover:bg-muted/50 flex items-center justify-between transition-colors">
                  <span className="flex items-center gap-2"><Layers className="w-4 h-4 text-primary" /> Regulations editor</span>
                  <span className="text-xs text-muted-foreground">Edit regs + requirements live (no deploy)</span>
                </Link>
                <Link href="/admin/platform-signups" className="w-full text-left p-3 border border-border hover:bg-muted/50 flex items-center justify-between transition-colors">
                  <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-600" /> Platform sign-up requests</span>
                  <span className="text-xs font-mono text-muted-foreground flex items-center gap-2">
                    {pendingSignupCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-amber-500/15 text-amber-600 font-semibold">
                        {pendingSignupCount}
                      </span>
                    )}
                    {pendingSignupCount > 0 ? "pending" : "All clear"}
                  </span>
                </Link>
                <Link href="/admin/source-quality" className="w-full text-left p-3 border border-border hover:bg-muted/50 flex items-center justify-between transition-colors">
                  <span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-600" /> Source quality audit</span>
                  <span className="text-xs text-muted-foreground">Stale / single-source / no consulting</span>
                </Link>
                <Link href="/admin/agent/proposals" className="w-full text-left p-3 border border-border hover:bg-muted/50 flex items-center justify-between transition-colors">
                  <span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-violet-600" /> Agent proposal queue</span>
                  <span className="text-xs text-muted-foreground">Review &amp; approve agent actions</span>
                </Link>
                <Link href="/admin/economic-rules" className="w-full text-left p-3 border border-border hover:bg-muted/50 flex items-center justify-between transition-colors">
                  <span className="flex items-center gap-2"><Zap className="w-4 h-4 text-emerald-600" /> Economic rules</span>
                  <span className="text-xs text-muted-foreground">Tune CVI/DVX thresholds</span>
                </Link>
              </CardContent>
            </Card>

            {/* Cost panel */}
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

            {/* Recent agent runs */}
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
        </TabsContent>

        {/* ─────────────────────── Approvals tab ─────────────────────── */}
        <TabsContent value="approvals">
          <PaymentApprovals onChange={refetchAll} />
        </TabsContent>

        {/* ─────────────────────── Members tab ─────────────────────── */}
        <TabsContent value="members" className="space-y-6">
          <MembersList onMutated={() => paymentsData.refetch()} />
          <ManualCompForm onGranted={() => paymentsData.refetch()} />
          <p className="text-xs text-muted-foreground">
            Click any row above to view full membership detail, change their tier, put them on hold, or grant credits.
            For pending approval workflow (invoice / crypto requests), use the <button onClick={() => setTab("approvals")} className="underline hover:text-foreground">Approvals</button> tab.
          </p>
        </TabsContent>

        {/* ─────────────────────── Tiers tab ─────────────────────── */}
        <TabsContent value="tiers">
          <MembershipAdmin />
        </TabsContent>

        {/* ─────────────────────── KYC tab ─────────────────────── */}
        <TabsContent value="kyc">
          <KycAdmin />
        </TabsContent>

        {/* ─────────────────────── Content tab ─────────────────────── */}
        <TabsContent value="content" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="w-5 h-5" /> Content Freshness
                <span className="text-sm font-normal text-muted-foreground ml-2">Click to regenerate per industry</span>
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

          <FeaturedContentScheduler />
          <EducationalContentAdmin />
          <CaseStudyAdmin />
        </TabsContent>

        {/* ─────────────────────── Enrichment tab ─────────────────────── */}
        <TabsContent value="enrichment" className="space-y-6">
          <Card>
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
                <div className="flex items-center gap-3 p-3 rounded-none bg-muted/50">
                  <Layers className="w-5 h-5 text-purple-500" />
                  <div>
                    <p className="text-2xl font-bold font-mono">{enrichStatus?.quadrants ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">Quadrant Classifications</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-none bg-muted/50">
                  <GitBranch className="w-5 h-5 text-blue-500" />
                  <div>
                    <p className="text-2xl font-bold font-mono">{enrichStatus?.valueChainStages ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">Value Chain Stages</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-none bg-muted/50">
                  <Building2 className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold font-mono">{enrichStatus?.companies ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">Company Profiles</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-none bg-muted/50">
                  <Network className="w-5 h-5 text-orange-500" />
                  <div>
                    <p className="text-2xl font-bold font-mono">{enrichStatus?.companyMappings ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">Company↔Capability Mappings</p>
                  </div>
                </div>
              </div>

              {enrichResult && (
                <div className="p-4 rounded-none border border-border bg-muted/30">
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
                <div className="flex items-center gap-3 p-4 rounded-none border border-border bg-muted/30">
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

          <EnrichmentAdmin />
        </TabsContent>

        <TabsContent value="products" className="space-y-6">
          <ProductsAdmin />
        </TabsContent>

        {/* ─────────────────────── Assessments tab ─────────────────────── */}
        <TabsContent value="assessments">
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
        </TabsContent>

        {/* ─────────────────────── Marketplace tab ─────────────────────── */}
        <TabsContent value="marketplace">
          <MarketplaceModeration />
        </TabsContent>

        {/* ─────────────────── Agents & LLM tab ─────────────────────── */}
        <TabsContent value="agents" className="space-y-6">
          <AgentsControlPanel />
        </TabsContent>

        {/* ─────────────────────── System tab ─────────────────────── */}
        <TabsContent value="system" className="space-y-6">
          <ApiVolumePanel />
          <RuntimeTuningPanel />
          <SyntheticAgentsPanel />
          <BotWorkflowsPanel />
          <FoundrySyncPanel />
          <AuditLogViewer />
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <BookOpenCheck className="w-5 h-5" /> Integrations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between p-2 border border-border">
                <span className="font-mono text-xs">Clerk auth</span>
                <span className="text-emerald-600">Configured</span>
              </div>
              <div className="flex items-center justify-between p-2 border border-border">
                <span className="font-mono text-xs">Stripe (cards)</span>
                <span className="text-muted-foreground">Check STRIPE_SECRET_KEY</span>
              </div>
              <div className="flex items-center justify-between p-2 border border-border">
                <span className="font-mono text-xs">NOWPayments (crypto)</span>
                <span className="text-muted-foreground">Webhook at <code className="px-1 py-0.5 bg-muted rounded text-xs">/api/payments/nowpayments/webhook</code></span>
              </div>
              <div className="flex items-center justify-between p-2 border border-border">
                <span className="font-mono text-xs">Didit (KYC)</span>
                <span className="text-muted-foreground">See KYC tab</span>
              </div>
              <div className="flex items-center justify-between p-2 border border-border">
                <span className="font-mono text-xs">OpenRouter (LLM)</span>
                <span className="text-emerald-600">Active</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}

type TuningResponse = {
  tuning: {
    routineIntervalHours: number;
    detailBackfillLimit: number;
    agentPerplexityCap: number;
    defaultBotBudgetUsdCap: number;
    updatedAt: string;
    updatedBy: string | null;
  };
  defaults: {
    routineIntervalHours: number;
    detailBackfillLimit: number;
    agentPerplexityCap: number;
    defaultBotBudgetUsdCap: number;
  };
};

function RuntimeTuningPanel() {
  const { data, loading, refetch } = useApi<TuningResponse>("/admin/agent-tuning");
  const [draft, setDraft] = useState<{ routineIntervalHours: string; detailBackfillLimit: string; agentPerplexityCap: string; defaultBotBudgetUsdCap: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.tuning && draft == null) {
      setDraft({
        routineIntervalHours: String(data.tuning.routineIntervalHours),
        detailBackfillLimit: String(data.tuning.detailBackfillLimit),
        agentPerplexityCap: String(data.tuning.agentPerplexityCap),
        defaultBotBudgetUsdCap: String(data.tuning.defaultBotBudgetUsdCap),
      });
    }
  }, [data, draft]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        routineIntervalHours: Number(draft.routineIntervalHours),
        detailBackfillLimit: Number(draft.detailBackfillLimit),
        agentPerplexityCap: Number(draft.agentPerplexityCap),
        defaultBotBudgetUsdCap: Number(draft.defaultBotBudgetUsdCap),
      };
      const res = await fetch(`${API_BASE}/admin/agent-tuning`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setDraft(null);
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (!data?.tuning) return;
    setDraft({
      routineIntervalHours: String(data.tuning.routineIntervalHours),
      detailBackfillLimit: String(data.tuning.detailBackfillLimit),
      agentPerplexityCap: String(data.tuning.agentPerplexityCap),
      defaultBotBudgetUsdCap: String(data.tuning.defaultBotBudgetUsdCap),
    });
    setError(null);
  };

  const restoreDefaults = () => {
    if (!data?.defaults) return;
    setDraft({
      routineIntervalHours: String(data.defaults.routineIntervalHours),
      detailBackfillLimit: String(data.defaults.detailBackfillLimit),
      agentPerplexityCap: String(data.defaults.agentPerplexityCap),
      defaultBotBudgetUsdCap: String(data.defaults.defaultBotBudgetUsdCap),
    });
    setError(null);
  };

  const dirty = !!(data?.tuning && draft && (
    Number(draft.routineIntervalHours) !== data.tuning.routineIntervalHours ||
    Number(draft.detailBackfillLimit) !== data.tuning.detailBackfillLimit ||
    Number(draft.agentPerplexityCap) !== data.tuning.agentPerplexityCap ||
    Number(draft.defaultBotBudgetUsdCap) !== data.tuning.defaultBotBudgetUsdCap
  ));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Settings className="w-5 h-5" /> Runtime Tuning
          <span className="text-sm font-normal text-muted-foreground ml-2">
            {data?.tuning?.updatedAt ? `Last changed ${timeAgo(data.tuning.updatedAt)}${data.tuning.updatedBy ? ` by ${data.tuning.updatedBy}` : ""}` : "Using code defaults"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !draft ? (
          <p className="text-sm text-muted-foreground">Initializing…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label htmlFor="routineIntervalHours" className="text-xs">Routine cycle interval (hours)</Label>
                <Input id="routineIntervalHours" type="number" step="0.25" min="0.25" max="720"
                  value={draft.routineIntervalHours}
                  onChange={(e) => setDraft({ ...draft, routineIntervalHours: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Default {data?.defaults.routineIntervalHours}h. Range 0.25–720h.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="detailBackfillLimit" className="text-xs">Detail-backfill caps per cycle</Label>
                <Input id="detailBackfillLimit" type="number" step="1" min="0" max="500"
                  value={draft.detailBackfillLimit}
                  onChange={(e) => setDraft({ ...draft, detailBackfillLimit: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Default {data?.defaults.detailBackfillLimit}. Each cap ≈ $0.06. 0 disables the sweep.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="agentPerplexityCap" className="text-xs">Perplexity calls per agent run</Label>
                <Input id="agentPerplexityCap" type="number" step="1" min="0" max="100"
                  value={draft.agentPerplexityCap}
                  onChange={(e) => setDraft({ ...draft, agentPerplexityCap: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Default {data?.defaults.agentPerplexityCap}. Runaway-loop circuit breaker.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="defaultBotBudgetUsdCap" className="text-xs">Default bot monthly budget (USD)</Label>
                <Input id="defaultBotBudgetUsdCap" type="number" step="1" min="0" max="10000"
                  value={draft.defaultBotBudgetUsdCap}
                  onChange={(e) => setDraft({ ...draft, defaultBotBudgetUsdCap: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Default ${data?.defaults.defaultBotBudgetUsdCap}. Applied to new bots; per-bot overrides in roster.</p>
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <div className="flex items-center gap-2">
              <Button onClick={handleSave} disabled={saving || !dirty}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button variant="outline" onClick={reset} disabled={saving || !dirty}>
                Reset
              </Button>
              <Button variant="ghost" onClick={restoreDefaults} disabled={saving}>
                Restore defaults
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Synthetic Agents Panel (bot roster) ────────────────────────────────

type BotsResponse = {
  bots: Array<{
    id: number;
    personaKey: string;
    displayName: string;
    email: string;
    title: string | null;
    status: "active" | "paused" | "disabled";
    clerkUserId: string;
    monthlyBudgetUsdCap: number;
    lastActedAt: string | null;
    addressLine1: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
  }>;
  availablePersonas: Array<{ key: string; displayName: string; title: string; entityName: string }>;
  allPersonas: Array<{ key: string; displayName: string }>;
  systemBudget: {
    capCents: number;
    mtdCents: number;
    remainingCents: number;
    perBot: Array<{ botId: number; capCents: number; mtdCents: number; pctUsed: number; overBudget: boolean }>;
  };
};

function SyntheticAgentsPanel() {
  const { data, loading, refetch } = useApi<BotsResponse>("/admin/bots");
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingBudgetForId, setEditingBudgetForId] = useState<number | null>(null);
  const [budgetDraft, setBudgetDraft] = useState<string>("");

  const provision = async (personaKey: string) => {
    setProvisioning(personaKey);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/bots/provision`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaKey }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Provision failed");
    } finally {
      setProvisioning(null);
    }
  };

  const patchStatus = async (botId: number, status: "active" | "paused" | "disabled") => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/bots/${botId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status change failed");
    }
  };

  const saveBudget = async (botId: number) => {
    setError(null);
    try {
      const n = Number(budgetDraft);
      if (!(n >= 0 && n <= 10000)) throw new Error("Budget must be 0–10000 USD");
      const res = await fetch(`${API_BASE}/admin/bots/${botId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyBudgetUsdCap: n }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setEditingBudgetForId(null);
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Budget save failed");
    }
  };

  const triggerTick = async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/bots/tick`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tick failed");
    }
  };

  const budgetMapById = new Map((data?.systemBudget?.perBot ?? []).map(b => [b.botId, b]));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Brain className="w-5 h-5" /> Synthetic Agents
          {data && (
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {data.bots.filter(b => b.status === "active").length} active / {data.bots.length} total · system MTD ${(data.systemBudget.mtdCents / 100).toFixed(2)} / ${(data.systemBudget.capCents / 100).toFixed(2)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {data && data.bots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bots yet. Spawn one below to start populating the platform with persona-driven activity.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2 text-left">Persona</th>
                      <th className="px-3 py-2 text-left">Identity</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">MTD spend</th>
                      <th className="px-3 py-2 text-left">Last active</th>
                      <th className="px-3 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.bots ?? []).map(bot => {
                      const budget = budgetMapById.get(bot.id);
                      const pct = budget ? Math.min(100, Math.round(budget.pctUsed * 100)) : 0;
                      const barColor = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
                      return (
                        <tr key={bot.id} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-3 py-3">
                            <div className="font-medium">{bot.displayName}</div>
                            <div className="text-xs text-muted-foreground">{bot.title}</div>
                            <div className="mt-1"><SyntheticAgentBadge personaDisplay={bot.personaKey.replace(/_/g, " ")} size="sm" /></div>
                          </td>
                          <td className="px-3 py-3 text-xs">
                            <div className="text-muted-foreground">{bot.email}</div>
                            <div className="text-muted-foreground">{bot.city}{bot.region ? `, ${bot.region}` : ""} {bot.country}</div>
                            <div className="font-mono text-[11px] text-muted-foreground-soft">{bot.clerkUserId}</div>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              bot.status === "active" ? "bg-green-500/10 text-green-600" :
                              bot.status === "paused" ? "bg-amber-500/10 text-amber-600" :
                              "bg-muted text-muted-foreground"
                            }`}>{bot.status}</span>
                          </td>
                          <td className="px-3 py-3 text-xs">
                            {editingBudgetForId === bot.id ? (
                              <div className="flex items-center gap-1">
                                <Input type="number" min="0" max="10000" step="1" className="w-20 h-7 text-xs"
                                  value={budgetDraft}
                                  onChange={(e) => setBudgetDraft(e.target.value)}
                                />
                                <Button size="sm" onClick={() => saveBudget(bot.id)} className="h-7">Save</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditingBudgetForId(null)} className="h-7">×</Button>
                              </div>
                            ) : (
                              <>
                                <div className="text-foreground">${(budget?.mtdCents ?? 0) / 100} <span className="text-muted-foreground">/ ${bot.monthlyBudgetUsdCap}</span></div>
                                <div className="w-full bg-muted h-1 mt-1 rounded">
                                  <div className={`h-1 rounded ${barColor}`} style={{ width: `${pct}%` }} />
                                </div>
                                <button
                                  className="text-[10px] text-muted-foreground hover:underline mt-1"
                                  onClick={() => { setEditingBudgetForId(bot.id); setBudgetDraft(String(bot.monthlyBudgetUsdCap)); }}
                                >Edit cap</button>
                              </>
                            )}
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{timeAgo(bot.lastActedAt)}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1">
                              {bot.status === "active" && (
                                <Button size="sm" variant="outline" onClick={() => patchStatus(bot.id, "paused")} className="h-7 text-xs">Pause</Button>
                              )}
                              {bot.status === "paused" && (
                                <Button size="sm" variant="outline" onClick={() => patchStatus(bot.id, "active")} className="h-7 text-xs">Resume</Button>
                              )}
                              {bot.status !== "disabled" && (
                                <Button size="sm" variant="ghost" onClick={() => patchStatus(bot.id, "disabled")} className="h-7 text-xs text-red-600">Disable</Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {data && data.availablePersonas.length > 0 && (
              <div className="border-t border-border pt-4">
                <div className="text-xs uppercase text-muted-foreground mb-2">Add new bot</div>
                <div className="flex flex-wrap gap-2">
                  {data.availablePersonas.map(p => (
                    <Button
                      key={p.key}
                      size="sm"
                      variant="outline"
                      disabled={provisioning === p.key}
                      onClick={() => provision(p.key)}
                      className="text-xs"
                    >
                      {provisioning === p.key ? `Provisioning ${p.displayName}…` : `+ ${p.displayName} (${p.title})`}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button size="sm" variant="ghost" onClick={triggerTick} className="text-xs">Fire tick now</Button>
              <Button size="sm" variant="ghost" onClick={() => refetch()} className="text-xs">Refresh</Button>
            </div>

            <BotActivityFeed />
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface BotActivityResp {
  actions: Array<{
    id: number;
    botId: number;
    botName: string | null;
    personaKey: string | null;
    actionType: string;
    targetType: string | null;
    targetId: string | null;
    summary: string | null;
    costCents: number;
    succeeded: boolean;
    errorMessage: string | null;
    createdAt: string;
  }>;
}

function BotActivityFeed() {
  const { data, loading, refetch } = useApi<BotActivityResp>("/admin/bots/activity?limit=30");
  const totalCostCents = (data?.actions ?? []).reduce((a, b) => a + (b.succeeded ? b.costCents : 0), 0);
  return (
    <div className="border-t border-border pt-4 mt-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase text-muted-foreground font-mono tracking-[0.18em]">
          Recent activity {data && `· last 30 · $${(totalCostCents / 100).toFixed(2)}`}
        </div>
        <Button size="sm" variant="ghost" onClick={() => refetch()} className="h-6 text-[10px]">Refresh</Button>
      </div>
      {loading && !data ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : !data || data.actions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No bot actions yet — fire a tick or wait for the hourly run.</p>
      ) : (
        <div className="max-h-80 overflow-y-auto border border-border/60">
          <table className="w-full text-xs">
            <tbody>
              {data.actions.map(a => (
                <tr key={a.id} className={`border-b border-border/40 ${a.succeeded ? "" : "bg-red-500/5"}`}>
                  <td className="px-2 py-1.5 align-top whitespace-nowrap text-muted-foreground font-mono text-[10px]">
                    {new Date(a.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-2 py-1.5 align-top whitespace-nowrap">
                    <span className="font-medium">{a.botName ?? `bot#${a.botId}`}</span>
                  </td>
                  <td className="px-2 py-1.5 align-top whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${
                      a.actionType === "deep_dive" ? "bg-purple-500/10 text-purple-600 border border-purple-500/20" :
                      a.actionType === "assessment" ? "bg-blue-500/10 text-blue-600 border border-blue-500/20" :
                      a.actionType === "marketplace_list" ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" :
                      a.actionType === "comment" ? "bg-amber-500/10 text-amber-600 border border-amber-500/20" :
                      a.actionType === "reflection" ? "bg-pink-500/10 text-pink-600 border border-pink-500/20" :
                      a.actionType === "budget_skip" ? "bg-red-500/10 text-red-600 border border-red-500/20" :
                      "bg-muted text-muted-foreground border border-border"
                    }`}>{a.actionType.replace(/_/g, " ")}</span>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground truncate max-w-md" title={a.summary ?? a.errorMessage ?? ""}>
                    {a.summary ?? a.errorMessage ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 align-top whitespace-nowrap text-right font-mono text-[10px] tabular-nums">
                    ${(a.costCents / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ─────────────────────── Bot Workflows Panel ───────────────────────
// Calls GET /admin/bot-workflows, POST /admin/bot-workflows/trigger,
// GET /admin/bot-workflows/:runId. Surfaces the multi-step LangGraph
// workflows that run alongside the per-action bot loop.

interface WorkflowDef {
  key: string;
  label: string;
  cadence: string;
  scope: "per-bot" | "system-wide";
  appliesToPersonas: string[];
  description: string;
  estimatedCostCents: number;
}

interface WorkflowRun {
  id: number;
  botId: number | null;
  workflowKey: string;
  trigger: string;
  status: string;
  costCents: number;
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  artifactIds: Record<string, number[]>;
}

interface WorkflowsResp {
  definitions: WorkflowDef[];
  recentRuns: WorkflowRun[];
}

interface WorkflowStep {
  id: number;
  stepName: string;
  stepIndex: number;
  status: string;
  costCents: number;
  durationMs: number;
  payload: Record<string, unknown>;
  errorMessage: string | null;
  startedAt: string;
}

interface RunDetailResp {
  run: WorkflowRun & { state: Record<string, unknown> };
  steps: WorkflowStep[];
}

function workflowStatusClass(status: string): string {
  switch (status) {
    case "completed":         return "bg-green-500/10 text-green-600";
    case "in_progress":       return "bg-blue-500/10 text-blue-600";
    case "pending":           return "bg-muted text-muted-foreground";
    case "failed":            return "bg-red-500/10 text-red-600";
    case "budget_exhausted":  return "bg-amber-500/10 text-amber-600";
    case "no_op":             return "bg-muted text-muted-foreground";
    default:                  return "bg-muted text-muted-foreground";
  }
}

function BotWorkflowsPanel() {
  const { data, loading, refetch } = useApi<WorkflowsResp>("/admin/bot-workflows");
  const [triggering, setTriggering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetailResp | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const triggerWorkflow = async (workflowKey: string, botId: number | null) => {
    setTriggering(workflowKey);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/bot-workflows/trigger`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowKey, botId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trigger failed");
    } finally {
      setTriggering(null);
    }
  };

  const loadRunDetail = async (runId: number) => {
    setLoadingDetail(true);
    setRunDetail(null);
    setExpandedRunId(runId);
    try {
      const res = await fetch(`${API_BASE}/admin/bot-workflows/${runId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRunDetail(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load detail failed");
    } finally {
      setLoadingDetail(false);
    }
  };

  const collapseDetail = () => {
    setExpandedRunId(null);
    setRunDetail(null);
  };

  const totalCostCents = (data?.recentRuns ?? []).reduce((a, r) => a + r.costCents, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <GitBranch className="w-5 h-5" /> Bot Workflows
          {data && (
            <span className="text-sm font-normal text-muted-foreground ml-2">
              {data.definitions.length} registered · {data.recentRuns.length} recent runs · ${(totalCostCents / 100).toFixed(2)} total
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {error && <p className="text-sm text-red-600">{error}</p>}

            {/* Registered workflows */}
            <div>
              <div className="text-xs uppercase text-muted-foreground font-mono tracking-[0.18em] mb-2">
                Registered workflows
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2 text-left">Workflow</th>
                      <th className="px-3 py-2 text-left">Scope</th>
                      <th className="px-3 py-2 text-left">Cadence</th>
                      <th className="px-3 py-2 text-left">Personas</th>
                      <th className="px-3 py-2 text-left">Est. cost</th>
                      <th className="px-3 py-2 text-left">Trigger</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.definitions ?? []).map((d) => (
                      <tr key={d.key} className="border-b border-border/50 hover:bg-muted/20 align-top">
                        <td className="px-3 py-3">
                          <div className="font-medium">{d.label}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-1">{d.key}</div>
                          <div className="text-xs text-muted-foreground mt-1 max-w-md">{d.description}</div>
                        </td>
                        <td className="px-3 py-3 text-xs">
                          <span className={`px-2 py-0.5 rounded text-xs ${d.scope === "system-wide" ? "bg-purple-500/10 text-purple-600" : "bg-blue-500/10 text-blue-600"}`}>
                            {d.scope}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-xs font-mono">{d.cadence}</td>
                        <td className="px-3 py-3 text-xs">
                          {d.scope === "system-wide" ? (
                            <span className="text-muted-foreground italic">all</span>
                          ) : (
                            <span className="text-xs">{d.appliesToPersonas.join(", ")}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs font-mono">${(d.estimatedCostCents / 100).toFixed(2)}</td>
                        <td className="px-3 py-3">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={triggering === d.key || d.scope === "per-bot"}
                            onClick={() => triggerWorkflow(d.key, null)}
                            className="h-7 text-xs"
                            title={d.scope === "per-bot" ? "Per-bot workflows fire on scheduler tick; use the Synthetic Agents panel to manage bot state" : "Trigger this system workflow now"}
                          >
                            {triggering === d.key ? "Triggering…" : "Trigger now"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent runs */}
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase text-muted-foreground font-mono tracking-[0.18em]">
                  Recent runs {data && `· last ${data.recentRuns.length}`}
                </div>
                <Button size="sm" variant="ghost" onClick={() => refetch()} className="h-6 text-[10px]">Refresh</Button>
              </div>
              {(data?.recentRuns ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No workflow runs yet. They will start appearing once the scheduler's 30-min tick fires due workflows.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                        <th className="px-3 py-2 text-left">Run</th>
                        <th className="px-3 py-2 text-left">Workflow</th>
                        <th className="px-3 py-2 text-left">Trigger</th>
                        <th className="px-3 py-2 text-left">Status</th>
                        <th className="px-3 py-2 text-left">Cost</th>
                        <th className="px-3 py-2 text-left">Duration</th>
                        <th className="px-3 py-2 text-left">Artifacts</th>
                        <th className="px-3 py-2 text-left">Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.recentRuns ?? []).map((r) => {
                        const artifactCount = Object.values(r.artifactIds ?? {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
                        const isExpanded = expandedRunId === r.id;
                        return (
                          <>
                            <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20">
                              <td className="px-3 py-3 text-xs font-mono">#{r.id}</td>
                              <td className="px-3 py-3 text-xs">
                                <div>{r.workflowKey}</div>
                                {r.botId !== null && <div className="text-muted-foreground">bot #{r.botId}</div>}
                              </td>
                              <td className="px-3 py-3 text-xs font-mono">{r.trigger}</td>
                              <td className="px-3 py-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${workflowStatusClass(r.status)}`}>
                                  {r.status}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-xs font-mono">${(r.costCents / 100).toFixed(2)}</td>
                              <td className="px-3 py-3 text-xs font-mono">{r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                              <td className="px-3 py-3 text-xs">{artifactCount}</td>
                              <td className="px-3 py-3 text-xs text-muted-foreground">{timeAgo(r.startedAt)}</td>
                            </tr>
                            <tr key={`${r.id}-actions`} className="border-b border-border/30">
                              <td colSpan={8} className="px-3 py-1 text-right">
                                {isExpanded ? (
                                  <Button size="sm" variant="ghost" onClick={collapseDetail} className="h-6 text-[10px]">
                                    Hide trace
                                  </Button>
                                ) : (
                                  <Button size="sm" variant="ghost" onClick={() => loadRunDetail(r.id)} className="h-6 text-[10px]">
                                    Show step trace
                                  </Button>
                                )}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${r.id}-detail`}>
                                <td colSpan={8} className="px-3 py-3 bg-muted/30">
                                  {loadingDetail ? (
                                    <p className="text-xs text-muted-foreground">Loading trace…</p>
                                  ) : runDetail && runDetail.run.id === r.id ? (
                                    <div className="space-y-3">
                                      {runDetail.run.errorMessage && (
                                        <div className="text-xs text-red-600 font-mono">Error: {runDetail.run.errorMessage}</div>
                                      )}
                                      <div className="text-xs uppercase text-muted-foreground font-mono tracking-[0.15em]">
                                        Step trace ({runDetail.steps.length} steps)
                                      </div>
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-[10px] uppercase text-muted-foreground border-b border-border/50">
                                            <th className="px-2 py-1 text-left">#</th>
                                            <th className="px-2 py-1 text-left">Step</th>
                                            <th className="px-2 py-1 text-left">Status</th>
                                            <th className="px-2 py-1 text-left">Cost</th>
                                            <th className="px-2 py-1 text-left">Duration</th>
                                            <th className="px-2 py-1 text-left">Payload</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {runDetail.steps.map((s) => (
                                            <tr key={s.id} className="border-b border-border/30 align-top">
                                              <td className="px-2 py-2 font-mono">{s.stepIndex}</td>
                                              <td className="px-2 py-2 font-mono">{s.stepName}</td>
                                              <td className="px-2 py-2">
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] ${workflowStatusClass(s.status === "ok" ? "completed" : s.status)}`}>
                                                  {s.status}
                                                </span>
                                              </td>
                                              <td className="px-2 py-2 font-mono">${(s.costCents / 100).toFixed(2)}</td>
                                              <td className="px-2 py-2 font-mono">{s.durationMs}ms</td>
                                              <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground max-w-md">
                                                {Object.keys(s.payload).length > 0 ? (
                                                  <pre className="whitespace-pre-wrap break-words">{JSON.stringify(s.payload, null, 2)}</pre>
                                                ) : "—"}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className="text-xs text-muted-foreground">No detail loaded.</p>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
