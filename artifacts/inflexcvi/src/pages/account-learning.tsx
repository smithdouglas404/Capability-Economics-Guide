/**
 * /account/learning — the user's personal learning dashboard.
 *
 * Shows what the system has learned about the user over time:
 * - Recent interactions (page visits, AI streams, searches, etc.)
 * - Top industries and capabilities inferred from their activity
 * - AI generation history and feedback
 * - Learning progress stats
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import {
  Brain, Eye, Lightbulb, Sparkles, Clock, ArrowLeft, Loader2,
  TrendingUp, Database, Activity, ThumbsUp, ThumbsDown, Globe,
  Wifi, Search, FileText, UserCheck, Network, Zap,
  BarChart3, Target, RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchLearningProfile, type LearningProfileData } from "@/lib/learning";
import { usePersonalizedPage } from "@/lib/use-personalized-page";

const typeIcons: Record<string, typeof Brain> = {
  page_view: Eye,
  ai_stream: Sparkles,
  ai_feedback: ThumbsUp,
  search: Search,
  industry_select: Globe,
  capability_view: FileText,
  persona_change: UserCheck,
  export: FileText,
  upload: FileText,
};

function interactionIcon(type: string) {
  return typeIcons[type] ?? Activity;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AccountLearningPage() {
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const [data, setData] = useState<LearningProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoaded || !isSignedIn) return;
    void fetchLearningProfile()
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, [authLoaded, isSignedIn]);

  if (!authLoaded || loading) {
    return (
      <div className="container mx-auto px-4 py-10 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your learning profile…
      </div>
    );
  }
  if (!isSignedIn) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <h1 className="font-serif text-3xl tracking-tight mb-2">Learning Profile</h1>
        <p className="text-sm text-muted-foreground">Sign in to see what the system has learned about you.</p>
      </div>
    );
  }

  const profile = data?.profile;
  const interactions = data?.recentInteractions ?? [];

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>

      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="h-px w-5 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Learning</span>
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl tracking-tight flex items-center gap-3">
          <Brain className="w-7 h-7 text-foreground/60" />
          What the system remembers
        </h1>
        <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
          Every page you visit, AI brief you generate, and search you run teaches the system about what matters to you.
          This information helps tailor recommendations and briefs to your interests over time.
        </p>
      </div>

      {/* Stats grid */}
      {profile && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            icon={Sparkles}
            label="AI Briefs Generated"
            value={String(profile.totalAiGenerations)}
            color="text-accent"
          />
          <StatTile
            icon={Eye}
            label="Pages Visited"
            value={String(profile.totalPageViews)}
            color="text-foreground"
          />
          <StatTile
            icon={Globe}
            label="Industries Explored"
            value={String(profile.topIndustries.length)}
            color="text-primary"
          />
          <StatTile
            icon={Activity}
            label="Capabilities Viewed"
            value={String(profile.topCapabilities.length)}
            color="text-muted-foreground"
          />
        </div>
      )}

      {/* Top industries */}
      {profile && profile.topIndustries.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              Your Industries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {profile.topIndustries.map(ind => (
                <Link
                  key={ind.slug}
                  href={`/case-study/${ind.slug}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-border/60 hover:border-accent hover:bg-muted/30 rounded-sm text-sm transition-colors"
                >
                  {ind.name}
                  <Badge variant="outline" className="text-[10px] font-mono">{ind.count}</Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top capabilities */}
      {profile && profile.topCapabilities.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Capabilities You've Explored
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {profile.topCapabilities.map(cap => (
                <Link
                  key={cap.id}
                  href={`/capability/${cap.id}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-border/60 hover:border-accent hover:bg-muted/30 rounded-sm text-sm transition-colors"
                >
                  {cap.name}
                  <Badge variant="outline" className="text-[10px] font-mono">{cap.count}</Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* What's changed since last visit */}
      {profile && <WhatsChangedSection />}

      {/* Persona suggestion */}
      {profile && <PersonaSuggestionSection />}

      {/* Agent-pattern discoveries relevant to this user */}
      {profile && profile.topIndustries.length > 0 && (
        <AgentDiscoveriesSection industries={profile.topIndustries} />
      )}

      {/* Interaction timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            Activity Timeline
            <span className="text-xs text-muted-foreground font-normal">({interactions.length} events)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {interactions.length === 0 ? (
            <div className="p-6 text-center">
              <Brain className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No activity recorded yet. Browse the site and generate AI briefs to build your learning profile.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {interactions.slice(0, 50).map(ixn => {
                const Icon = interactionIcon(ixn.type);
                return (
                  <div key={ixn.id} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                    <div className="p-1.5 rounded-sm bg-muted/50 mt-0.5">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-foreground">{ixn.label}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[9px] uppercase tracking-wider font-mono py-0">
                          {ixn.type.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono whitespace-nowrap shrink-0">
                      {timeAgo(ixn.createdAt)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, sub = "", color }: {
  icon: typeof Brain;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Icon className={`w-3.5 h-3.5 ${color}`} aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
        <div className="text-2xl font-mono font-bold text-foreground">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Whats Changed Section ─────────────────────────────────────────────────

function WhatsChangedSection() {
  const personalized = usePersonalizedPage({ pageName: "account-learning" });
  const { whatsChanged } = personalized;

  if (!whatsChanged || !whatsChanged.hasChanges) return null;

  const stats = [
    { label: "New AI briefs", value: whatsChanged.newAiGenerations, icon: Sparkles },
    { label: "New page views", value: whatsChanged.newPageViews, icon: Eye },
    { label: "New capabilities", value: whatsChanged.newCapabilitiesSeen.length, icon: Activity },
    { label: "New industries", value: whatsChanged.newIndustriesSeen.length, icon: Globe },
  ].filter(s => s.value > 0);

  if (stats.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-accent" />
          Since your last visit
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map(s => (
            <div key={s.label} className="border border-border/40 p-3">
              <div className="flex items-center gap-1 mb-1">
                <s.icon className="w-3 h-3 text-accent" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</span>
              </div>
              <div className="text-lg font-mono font-medium text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Persona Suggestion Section ───────────────────────────────────────────

function PersonaSuggestionSection() {
  const personalized = usePersonalizedPage({ pageName: "account-learning" });
  const { personaSuggestion } = personalized;

  if (!personaSuggestion?.suggestion || !personaSuggestion.reason) return null;

  return (
    <Card className="border-amber-500/20 bg-amber-950/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-amber-300">
          <Lightbulb className="w-4 h-4 text-amber-400" />
          Persona Suggestion
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-amber-200/80 mb-2">
          {personaSuggestion.reason}
        </p>
        <p className="text-xs text-amber-400/60">
          Current: <Badge variant="outline" className="text-[10px]">{personaSuggestion.currentPersona ?? "None"}</Badge>
          &nbsp;→ Suggested: <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">{personaSuggestion.suggestion.toUpperCase()}</Badge>
        </p>
        <div className="mt-2">
          <Link
            href="/account"
            className="text-[11px] font-medium text-amber-400 hover:text-amber-300 transition-colors inline-flex items-center gap-1"
          >
            Update your persona <Target className="w-3 h-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Agent Discoveries Section ────────────────────────────────────────────

function AgentDiscoveriesSection({ industries }: { industries: Array<{ name: string; slug: string; count: number }> }) {
  const [patterns, setPatterns] = useState<Array<{ title: string; summary: string; category: string }> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try to fetch agent patterns from the agent memory endpoint
    // This is a best-effort display — if the endpoint doesn't exist or fails,
    // we show the fallback content.
    const fetchPatterns = async () => {
      try {
        // Check if there's a patterns endpoint for the user's top industry
        const res = await fetch(`/api/content/agent-patterns?industry=${industries[0].slug}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setPatterns(data);
        }
      } catch { /* ignore */ }
      setLoading(false);
    };
    void fetchPatterns();
  }, [industries]);

  const industry = industries[0];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Network className="w-4 h-4 text-indigo-400" />
          Agent Discoveries — {industry.name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground animate-pulse">Loading agent discoveries…</div>
        ) : patterns && patterns.length > 0 ? (
          <div className="space-y-3">
            {patterns.map((p, i) => (
              <div key={i} className="border border-border/40 p-3 rounded-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <Zap className="w-3 h-3 text-indigo-400" />
                  <span className="text-[10px] uppercase tracking-wider text-indigo-400/70">{p.category}</span>
                </div>
                <h4 className="text-sm font-medium text-foreground mb-0.5">{p.title}</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">{p.summary}</p>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-2">
              The autonomous CVI agent continuously researches {industry.name}, discovering macro events,
              disruption risks, peer benchmarks, and capability correlations.
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">7 agents active</Badge>
              <Badge variant="outline" className="text-[10px]">30min refresh cycle</Badge>
              <Badge variant="outline" className="text-[10px]">Mem0 + Letta memory</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/insights"
                className="text-[11px] font-medium text-accent hover:text-accent/70 inline-flex items-center gap-1"
              >
                <Lightbulb className="w-3 h-3" />
                View agent insights
              </Link>
              <Link
                href="/cvi"
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <BarChart3 className="w-3 h-3" />
                CVI dashboard
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
