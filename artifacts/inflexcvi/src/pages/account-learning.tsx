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
  Wifi, Search, FileText, UserCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchLearningProfile, type LearningProfileData } from "@/lib/learning";

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

      {/* Personal stats */}
      {profile && profile.lastVisitedAt && (
        <Card>
          <CardContent className="pt-5 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              Last visit: {new Date(profile.lastVisitedAt).toLocaleString()}
            </div>
            {profile.persona && (
              <Badge variant="outline" className="rounded-sm">
                <UserCheck className="w-3 h-3 mr-1" />
                Persona: {profile.persona}
              </Badge>
            )}
          </CardContent>
        </Card>
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

function StatTile({ icon: Icon, label, value, color }: {
  icon: typeof Brain;
  label: string;
  value: string;
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
      </CardContent>
    </Card>
  );
}
