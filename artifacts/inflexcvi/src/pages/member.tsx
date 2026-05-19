/**
 * /member/:slug — public member microsite. Full profile surface with cover
 * image, avatar, headline, location, status badges, about, experience
 * timeline, education, skills with endorsements, featured content (latest
 * uploaded analyses + marketplace listings), and recent posts/activity.
 *
 * Visual language is Capability Economics's own: serif headers, mono
 * eyebrow labels, accent color for highlights, card-based section layout.
 * Not a LinkedIn clone — a professional network surface in our brand.
 */
import { useEffect, useState, useCallback } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import {
  Globe, Linkedin, MessageCircle, MapPin, Briefcase, GraduationCap, Award,
  ThumbsUp, MessageSquare, Calendar, ArrowLeft, FileText, Share2, UserPlus, Check,
  Loader2, Building2, Sparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface MemberProfile {
  userId: string;
  slug: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  location: string | null;
  currentRole: string | null;
  openTo: string[];
  websiteUrl: string | null;
  linkedinUrl: string | null;
  industrySlugs: string[];
  capabilityTags: string[];
  createdAt: string;
}

interface Experience {
  id: number; company: string; title: string; location: string | null;
  employmentType: string | null; startDate: string; endDate: string | null;
  description: string | null;
}
interface Education {
  id: number; school: string; degree: string | null; field: string | null;
  startYear: number | null; endYear: number | null; activities: string | null;
}
interface Skill {
  id: number; name: string; endorsementCount: number;
}
interface Post {
  id: number; body: string; linkUrl: string | null; imageUrl: string | null;
  capabilityTags: string[]; industrySlugs: string[]; likeCount: number;
  commentCount: number; createdAt: string;
}

const OPEN_TO_LABELS: Record<string, { label: string; tone: string }> = {
  hiring: { label: "Hiring", tone: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  consulting: { label: "Open to consulting", tone: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  investing: { label: "Investing", tone: "bg-violet-500/15 text-violet-600 border-violet-500/30" },
  collaborating: { label: "Open to collaborate", tone: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
};

function formatDateRange(start: string, end: string | null): string {
  const fmt = (s: string): string => {
    const [y, m] = s.split("-");
    if (!m) return y ?? s;
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1] ?? "";
    return `${month} ${y}`;
  };
  return `${fmt(start)} — ${end ? fmt(end) : "Present"}`;
}

function durationOf(start: string, end: string | null): string {
  const startD = new Date(`${start}-01`);
  const endD = end ? new Date(`${end}-01`) : new Date();
  const months = (endD.getFullYear() - startD.getFullYear()) * 12 + (endD.getMonth() - startD.getMonth());
  if (months < 1) return "<1 mo";
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${months} mo`;
  if (rem === 0) return `${years} yr`;
  return `${years} yr ${rem} mo`;
}

export default function MemberPage() {
  const params = useParams();
  const slug = params.slug;
  const { user, isSignedIn } = useUser();
  const [, setLocation] = useLocation();

  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [experience, setExperience] = useState<Experience[]>([]);
  const [education, setEducation] = useState<Education[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<"none" | "pending" | "connected" | "self">("none");
  const [pendingRequestedByMe, setPendingRequestedByMe] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`/api/member/${slug}`)
      .then(r => { if (r.status === 404) { setNotFound(true); return null; } return r.ok ? r.json() : null; })
      .then((data: { profile: MemberProfile } | null) => { if (data?.profile) setProfile(data.profile); })
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!profile) return;
    const uid = profile.userId;
    void Promise.all([
      fetch(`/api/member/${uid}/experience`).then(r => r.ok ? r.json() : { experience: [] }),
      fetch(`/api/member/${uid}/education`).then(r => r.ok ? r.json() : { education: [] }),
      fetch(`/api/member/${uid}/skills`).then(r => r.ok ? r.json() : { skills: [] }),
      fetch(`/api/member/${uid}/posts`).then(r => r.ok ? r.json() : { posts: [] }),
    ]).then(([e, ed, s, p]) => {
      setExperience(e.experience ?? []);
      setEducation(ed.education ?? []);
      setSkills(s.skills ?? []);
      setPosts(p.posts ?? []);
    });
    // Connection state
    if (isSignedIn && uid !== user?.id) {
      void fetch(`/api/connections/status/${uid}`).then(r => r.ok ? r.json() : null).then((d: { status: string; requestedByMe?: boolean } | null) => {
        if (d) {
          setConnectionStatus(d.status as "none" | "pending" | "connected" | "self");
          setPendingRequestedByMe(!!d.requestedByMe);
        }
      });
    } else if (uid === user?.id) {
      setConnectionStatus("self");
    }
  }, [profile, isSignedIn, user?.id]);

  const handleConnect = useCallback(async () => {
    if (!profile) return;
    setConnecting(true);
    try {
      const r = await fetch("/api/connections/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId: profile.userId }),
      });
      if (r.ok) { setConnectionStatus("pending"); setPendingRequestedByMe(true); }
    } finally { setConnecting(false); }
  }, [profile]);

  const handleAccept = useCallback(async () => {
    if (!profile) return;
    setConnecting(true);
    try {
      const r = await fetch("/api/connections/accept", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId: profile.userId }),
      });
      if (r.ok) setConnectionStatus("connected");
    } finally { setConnecting(false); }
  }, [profile]);

  const handleEndorse = useCallback(async (skillId: number) => {
    const r = await fetch(`/api/skills/${skillId}/endorse`, { method: "POST" });
    if (r.ok) {
      setSkills(prev => prev.map(s => s.id === skillId ? { ...s, endorsementCount: s.endorsementCount + 1 } : s));
    }
  }, []);

  if (loading) return <div className="container mx-auto px-4 py-10 text-sm text-muted-foreground">Loading…</div>;
  if (notFound) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-2xl space-y-3">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Home
        </Link>
        <Card><CardContent className="py-8 text-center text-muted-foreground">No public profile for "{slug}".</CardContent></Card>
      </div>
    );
  }
  if (!profile) return null;

  const isSelf = connectionStatus === "self";

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>

      {/* ─── HERO: cover + avatar + identity ────────────────────────────── */}
      <Card className="overflow-hidden mb-6">
        <div className="relative">
          {/* Cover image — falls back to a serif-monogram gradient when none uploaded */}
          <div className="h-48 sm:h-56 w-full relative overflow-hidden">
            {profile.coverImageUrl ? (
              <img src={profile.coverImageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-foreground/85 to-accent/60 flex items-center justify-center">
                <span className="font-serif text-7xl text-background/30 italic">{profile.displayName.charAt(0)}</span>
              </div>
            )}
          </div>
          {/* Avatar — overlaps the cover bottom edge */}
          <div className="absolute -bottom-12 left-6 sm:left-8">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt={profile.displayName} className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-background shadow-md" />
            ) : (
              <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-muted border-4 border-background flex items-center justify-center font-serif text-3xl sm:text-4xl shadow-md">
                {profile.displayName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        </div>
        <CardContent className="pt-16 pb-6 px-6 sm:px-8">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-3xl sm:text-4xl tracking-tight">{profile.displayName}</h1>
              {profile.headline && <p className="text-base text-foreground/80 mt-1">{profile.headline}</p>}
              {profile.currentRole && <p className="text-sm text-muted-foreground mt-1">{profile.currentRole}</p>}
              <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-muted-foreground">
                {profile.location && (
                  <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {profile.location}</span>
                )}
                <span>Member since {new Date(profile.createdAt).toISOString().slice(0, 7)}</span>
                {profile.websiteUrl && (
                  <a href={profile.websiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                    <Globe className="w-3 h-3" /> Website
                  </a>
                )}
                {profile.linkedinUrl && (
                  <a href={profile.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                    <Linkedin className="w-3 h-3" /> Profile
                  </a>
                )}
              </div>
              {profile.openTo.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {profile.openTo.map(t => {
                    const meta = OPEN_TO_LABELS[t] ?? { label: t, tone: "bg-muted text-muted-foreground border-border/60" };
                    return (
                      <Badge key={t} className={`rounded-full border ${meta.tone} text-[10px] uppercase tracking-wider font-mono`}>
                        {meta.label}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              {isSelf && (
                <Button asChild variant="outline" size="sm">
                  <Link href="/account/profile">Edit profile</Link>
                </Button>
              )}
              {!isSelf && isSignedIn && (
                <>
                  <Button onClick={() => setLocation(`/inbox/${profile.userId}`)} size="sm" variant="outline">
                    <MessageCircle className="w-4 h-4 mr-1" /> Message
                  </Button>
                  {connectionStatus === "none" && (
                    <Button onClick={handleConnect} size="sm" disabled={connecting}>
                      {connecting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}
                      Connect
                    </Button>
                  )}
                  {connectionStatus === "pending" && pendingRequestedByMe && (
                    <Button size="sm" variant="outline" disabled>Request sent</Button>
                  )}
                  {connectionStatus === "pending" && !pendingRequestedByMe && (
                    <Button onClick={handleAccept} size="sm" disabled={connecting}>
                      {connecting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                      Accept request
                    </Button>
                  )}
                  {connectionStatus === "connected" && (
                    <Badge variant="outline" className="px-3 py-1.5"><Check className="w-3 h-3 mr-1" /> Connected</Badge>
                  )}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Two-column body ────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          {/* About */}
          {profile.bio && (
            <Section title="About" icon={<FileText className="w-4 h-4" />}>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{profile.bio}</ReactMarkdown>
              </div>
            </Section>
          )}

          {/* Experience */}
          <Section
            title="Experience"
            icon={<Briefcase className="w-4 h-4" />}
            empty={experience.length === 0}
            emptyLabel={isSelf ? "Add your work history in profile settings." : "No experience listed."}
          >
            <div className="space-y-5">
              {experience.map(e => (
                <div key={e.id} className="flex gap-3">
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{e.title}</div>
                    <div className="text-sm text-foreground/80">{e.company}{e.employmentType ? <span className="text-muted-foreground"> · {e.employmentType}</span> : null}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateRange(e.startDate, e.endDate)} <span className="opacity-60">· {durationOf(e.startDate, e.endDate)}</span>
                      {e.location ? <span className="opacity-60"> · {e.location}</span> : null}
                    </div>
                    {e.description && (
                      <p className="text-sm text-foreground/75 mt-1.5 whitespace-pre-wrap leading-relaxed">{e.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Education */}
          <Section
            title="Education"
            icon={<GraduationCap className="w-4 h-4" />}
            empty={education.length === 0}
            emptyLabel={isSelf ? "Add your education in profile settings." : "No education listed."}
          >
            <div className="space-y-5">
              {education.map(e => (
                <div key={e.id} className="flex gap-3">
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                    <GraduationCap className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{e.school}</div>
                    {(e.degree || e.field) && (
                      <div className="text-sm text-foreground/80">
                        {[e.degree, e.field].filter(Boolean).join(", ")}
                      </div>
                    )}
                    {(e.startYear || e.endYear) && (
                      <div className="text-xs text-muted-foreground">
                        {e.startYear ?? "—"} — {e.endYear ?? "—"}
                      </div>
                    )}
                    {e.activities && (
                      <p className="text-sm text-foreground/75 mt-1 leading-relaxed">{e.activities}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Skills */}
          <Section
            title="Skills"
            icon={<Award className="w-4 h-4" />}
            empty={skills.length === 0}
            emptyLabel={isSelf ? "Add skills in profile settings." : "No skills listed."}
          >
            <div className="grid sm:grid-cols-2 gap-2">
              {skills.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2 p-2.5 border border-border/60 rounded-md">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.endorsementCount} endorsement{s.endorsementCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  {!isSelf && isSignedIn && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleEndorse(s.id)}>
                      <ThumbsUp className="w-3 h-3 mr-1" /> Endorse
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {/* Activity / posts */}
          <Section
            title="Activity"
            icon={<MessageSquare className="w-4 h-4" />}
            empty={posts.length === 0}
            emptyLabel={isSelf ? "Write your first post from the feed." : "No posts yet."}
          >
            <div className="space-y-4">
              {posts.map(p => <PostCard key={p.id} post={p} authorName={profile.displayName} avatarUrl={profile.avatarUrl} />)}
            </div>
          </Section>
        </div>

        {/* ─── Right rail ──────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Industries */}
          {profile.industrySlugs.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Industries</div>
                <div className="flex flex-wrap gap-1.5">
                  {profile.industrySlugs.map(s => (
                    <Badge key={s} variant="outline" className="text-xs capitalize">{s.replace(/-/g, " ")}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Capability expertise */}
          {profile.capabilityTags.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Capability expertise</div>
                <div className="flex flex-wrap gap-1.5">
                  {profile.capabilityTags.map(t => (
                    <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-wider mb-1">Share</div>
              <button
                onClick={() => navigator.clipboard.writeText(window.location.href)}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Share2 className="w-3 h-3" /> Copy profile link
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, empty, emptyLabel, children }: {
  title: string;
  icon?: React.ReactNode;
  empty?: boolean;
  emptyLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          {icon}
          <h2 className="font-serif text-xl tracking-tight">{title}</h2>
        </div>
        {empty ? (
          <p className="text-sm text-muted-foreground italic">{emptyLabel ?? "Nothing here yet."}</p>
        ) : children}
      </CardContent>
    </Card>
  );
}

function PostCard({ post, authorName, avatarUrl }: { post: Post; authorName: string; avatarUrl: string | null }) {
  return (
    <div className="border border-border/60 rounded-md p-4">
      <div className="flex items-start gap-2 mb-2">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full border border-border" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">{authorName.charAt(0).toUpperCase()}</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{authorName}</div>
          <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <Calendar className="w-2.5 h-2.5" /> {new Date(post.createdAt).toISOString().slice(0, 10)}
          </div>
        </div>
      </div>
      <p className="text-sm whitespace-pre-wrap leading-relaxed">{post.body}</p>
      {post.linkUrl && (
        <a href={post.linkUrl} target="_blank" rel="noopener noreferrer" className="block mt-2 text-xs text-accent hover:underline truncate">
          {post.linkUrl}
        </a>
      )}
      {post.imageUrl && (
        <img src={post.imageUrl} alt="" className="rounded mt-2 max-h-80 object-cover w-full" />
      )}
      {(post.capabilityTags.length > 0 || post.industrySlugs.length > 0) && (
        <div className="flex flex-wrap gap-1 mt-2">
          {post.industrySlugs.map(s => <Badge key={`i-${s}`} variant="outline" className="text-[10px] capitalize">{s.replace(/-/g, " ")}</Badge>)}
          {post.capabilityTags.map(t => <Badge key={`c-${t}`} variant="secondary" className="text-[10px]">{t}</Badge>)}
        </div>
      )}
      <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><ThumbsUp className="w-3 h-3" /> {post.likeCount}</span>
        <span className="inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {post.commentCount}</span>
      </div>
    </div>
  );
}
