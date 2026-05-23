/**
 * /feed — three-column member activity feed.
 *
 *   Left rail: mini profile card + your stats + quick links
 *   Center: composer + post stream
 *   Right rail: "People you may know" suggestions + "Saved posts" shortcut
 *
 * Built in our brand language. Standard three-column social-network pattern
 * found across many platforms.
 */
import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import {
  ThumbsUp, MessageSquare, Send, Loader2, Image as ImageIcon, Link2,
  Sparkles, Bookmark, Share2, MoreHorizontal, UserPlus, Activity,
  Users, Eye, FileText, ArrowRight, Target,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";

interface PostAuthor {
  userId: string; slug: string; displayName: string; avatarUrl: string | null; headline: string | null;
}
interface Post {
  id: number; authorUserId: string; body: string; linkUrl: string | null; imageUrl: string | null;
  capabilityTags: string[]; industrySlugs: string[]; likeCount: number; commentCount: number;
  createdAt: string; author: PostAuthor | null;
}

interface ProfileStats {
  profileViews: number; connections: number; posts: number;
}
interface Suggestion {
  userId: string; slug: string; displayName: string; headline: string | null;
  avatarUrl: string | null; industrySlugs: string[]; capabilityTags: string[];
}

/** Tiny mini-profile sidebar card showing the signed-in user. */
function MiniProfile({ stats }: { stats: ProfileStats | null }) {
  const { user } = useUser();
  const [profile, setProfile] = useState<{ slug: string; displayName: string; headline: string | null; avatarUrl: string | null; coverImageUrl: string | null } | null>(null);
  useEffect(() => {
    fetch("/api/me/profile").then(r => r.ok ? r.json() : null).then(d => { if (d?.profile) setProfile(d.profile); });
  }, []);
  if (!profile) return null;
  return (
    <Card className="overflow-hidden">
      <div className="h-16 relative overflow-hidden">
        {profile.coverImageUrl ? (
          <img src={profile.coverImageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-foreground/85 to-accent/60" />
        )}
      </div>
      <CardContent className="pt-0 -mt-7 pb-4 text-center">
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt="" className="w-14 h-14 rounded-full border-4 border-background mx-auto" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-muted border-4 border-background mx-auto flex items-center justify-center font-medium">
            {profile.displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <Link href={`/member/${profile.slug}`} className="block font-medium text-sm hover:text-accent mt-2 truncate">
          {profile.displayName}
        </Link>
        {profile.headline && <p className="text-[11px] text-muted-foreground line-clamp-2 px-2">{profile.headline}</p>}
      </CardContent>
      {stats && (
        <div className="border-t border-border/40 divide-y divide-border/40">
          <Link href={`/member/${profile.slug}`} className="flex items-center justify-between px-4 py-2 text-xs hover:bg-muted/30">
            <span className="text-muted-foreground inline-flex items-center gap-1.5"><Eye className="w-3 h-3" /> Profile views</span>
            <span className="font-medium tabular-nums">{stats.profileViews}</span>
          </Link>
          <Link href="/network" className="flex items-center justify-between px-4 py-2 text-xs hover:bg-muted/30">
            <span className="text-muted-foreground inline-flex items-center gap-1.5"><Users className="w-3 h-3" /> Connections</span>
            <span className="font-medium tabular-nums">{stats.connections}</span>
          </Link>
          <Link href={`/member/${profile.slug}`} className="flex items-center justify-between px-4 py-2 text-xs hover:bg-muted/30">
            <span className="text-muted-foreground inline-flex items-center gap-1.5"><FileText className="w-3 h-3" /> Your posts</span>
            <span className="font-medium tabular-nums">{stats.posts}</span>
          </Link>
        </div>
      )}
      <div className="border-t border-border/40 p-3 space-y-1">
        <Link href="/account/profile" className="block text-xs text-muted-foreground hover:text-foreground py-1">Edit your profile</Link>
        <Link href="/network" className="block text-xs text-muted-foreground hover:text-foreground py-1">Manage connections</Link>
        <Link href="/search/members" className="block text-xs text-muted-foreground hover:text-foreground py-1">Find members</Link>
      </div>
    </Card>
  );
}

/** Right-rail "People you may know" suggestion card list. */
function SuggestionsRail() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch("/api/me/people-you-may-know").then(r => r.ok ? r.json() : null).then((d: { suggestions: Suggestion[] } | null) => {
      if (d?.suggestions) setSuggestions(d.suggestions);
    }).finally(() => setLoading(false));
  }, []);
  const connect = async (uid: string): Promise<void> => {
    await fetch("/api/connections/request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: uid }),
    });
    setRequestedIds(prev => new Set([...prev, uid]));
  };
  const dismiss = (uid: string): void => setHiddenIds(prev => new Set([...prev, uid]));
  const visible = suggestions.filter(s => !hiddenIds.has(s.userId)).slice(0, 6);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">People you may know</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-xs text-muted-foreground">No suggestions right now.</p>
        ) : (
          visible.map(s => (
            <div key={s.userId} className="flex items-start gap-2">
              {s.avatarUrl ? (
                <img src={s.avatarUrl} alt="" className="w-9 h-9 rounded-full border border-border shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">{s.displayName.charAt(0).toUpperCase()}</div>
              )}
              <div className="flex-1 min-w-0">
                <Link href={`/member/${s.slug}`} className="font-medium text-xs hover:text-accent block truncate">{s.displayName}</Link>
                {s.headline && <p className="text-[10px] text-muted-foreground truncate">{s.headline}</p>}
                <div className="flex items-center gap-1 mt-1.5">
                  {requestedIds.has(s.userId) ? (
                    <span className="text-[10px] text-muted-foreground">Request sent</span>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => connect(s.userId)}>
                        <UserPlus className="w-2.5 h-2.5 mr-0.5" /> Connect
                      </Button>
                      <button onClick={() => dismiss(s.userId)} className="text-[10px] text-muted-foreground hover:text-foreground">Hide</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <Link href="/search/members" className="text-[11px] text-accent hover:underline inline-flex items-center gap-1">
          Find more members <ArrowRight className="w-2.5 h-2.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

type FeedFilterMode = "default" | "followed-capabilities";

export default function FeedPage() {
  const { user, isSignedIn, isLoaded } = useUser();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  // Capability-keyed filter — flips the GET /api/feed query to narrow to posts
  // tagged with capabilities the caller follows (profile.capabilityTags).
  const [filterMode, setFilterMode] = useState<FeedFilterMode>("default");
  const [followedCapabilities, setFollowedCapabilities] = useState<string[]>([]);

  // Composer
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [industryInput, setIndustryInput] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [showImageInput, setShowImageInput] = useState(false);
  const [posting, setPosting] = useState(false);

  const loadFeed = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    try {
      const feedUrl = filterMode === "followed-capabilities"
        ? "/api/feed?filter=followed-capabilities"
        : "/api/feed";
      const [feedR, statsR, savedR] = await Promise.all([
        fetch(feedUrl),
        fetch("/api/me/profile-stats"),
        fetch("/api/me/saved-posts"),
      ]);
      if (feedR.ok) {
        const d = await feedR.json() as { posts: Post[]; followedCapabilities?: string[] };
        setPosts(d.posts);
        if (Array.isArray(d.followedCapabilities)) setFollowedCapabilities(d.followedCapabilities);
      }
      if (statsR.ok) { setStats(await statsR.json()); }
      if (savedR.ok) {
        const d = await savedR.json() as { saved: Array<{ id: number }> };
        setSavedIds(new Set(d.saved.map(s => s.id)));
      }
    } finally { setLoading(false); }
  }, [isSignedIn, filterMode]);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  const submit = async (): Promise<void> => {
    if (body.trim().length < 1) return;
    setPosting(true);
    try {
      const r = await fetch("/api/posts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          linkUrl: linkUrl.trim() || undefined,
          imageUrl: imageUrl.trim() || undefined,
          industrySlugs: industryInput.split(",").map(s => s.trim()).filter(Boolean),
          capabilityTags: [],
        }),
      });
      if (r.ok) {
        setBody(""); setLinkUrl(""); setImageUrl(""); setIndustryInput("");
        setShowLinkInput(false); setShowImageInput(false);
        await loadFeed();
      }
    } finally { setPosting(false); }
  };

  const handleLike = async (postId: number): Promise<void> => {
    const r = await fetch(`/api/posts/${postId}/react`, { method: "POST" });
    if (r.ok) {
      const d = await r.json() as { reacted: boolean };
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, likeCount: d.reacted ? p.likeCount + 1 : Math.max(0, p.likeCount - 1) } : p));
    }
  };
  const handleSave = async (postId: number): Promise<void> => {
    if (savedIds.has(postId)) {
      await fetch(`/api/me/saved-posts/${postId}`, { method: "DELETE" });
      setSavedIds(prev => { const n = new Set(prev); n.delete(postId); return n; });
    } else {
      await fetch(`/api/me/saved-posts/${postId}`, { method: "POST" });
      setSavedIds(prev => new Set([...prev, postId]));
    }
  };
  const handleShare = async (postId: number): Promise<void> => {
    await fetch(`/api/posts/${postId}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  };

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-md">
        <Card><CardContent className="py-10 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-accent mx-auto" />
          <h3 className="font-serif text-xl">Sign in to see your feed</h3>
          <p className="text-sm text-muted-foreground">Posts from your connections + members in your industries land here.</p>
          <SignInButton mode="modal"><Button>Sign in</Button></SignInButton>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="grid lg:grid-cols-[240px_1fr_280px] gap-5">
        {/* ─── LEFT RAIL ─── */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <MiniProfile stats={stats} />
        </aside>

        {/* ─── CENTER FEED ─── */}
        <main className="space-y-4 min-w-0">
          <PageHeader
            eyebrow="Network"
            title="Your feed"
            descriptions={{
              default: "Posts from your connections and members in industries you follow. Share capability research, marketplace launches, or thread invitations.",
              pe: "What your network's saying — capability shifts your portfolio cos should know about.",
              vc: "Where founders + operators are talking. Posts tagged to your industries give you signal before the deck shows up in your inbox.",
              f500: "Industry pulse from peers, not press releases.",
              student: "Public reasoning by people doing the work. Comment to learn; post your own analyses to start your professional footprint.",
              professor: "Class-ready material — short-form capability analyses suitable for discussion sections.",
            }}
          />

          {/* Capability filter strip — flips the feed to "Posts about
              capabilities you follow" (matches profile.capabilityTags). */}
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setFilterMode("default")}
              className={`px-3 py-1.5 rounded-sm border transition-colors ${
                filterMode === "default"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:border-primary/50"
              }`}
            >
              All recent
            </button>
            <button
              onClick={() => setFilterMode("followed-capabilities")}
              disabled={followedCapabilities.length === 0 && filterMode !== "followed-capabilities"}
              className={`px-3 py-1.5 rounded-sm border transition-colors inline-flex items-center gap-1.5 ${
                filterMode === "followed-capabilities"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:border-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
              }`}
              title={followedCapabilities.length === 0 ? "Follow capabilities on your profile to enable this filter" : ""}
            >
              <Target className="w-3 h-3" />
              Posts about capabilities you follow
              {followedCapabilities.length > 0 && (
                <span className={`text-[10px] font-mono ${filterMode === "followed-capabilities" ? "opacity-80" : "text-muted-foreground"}`}>
                  ({followedCapabilities.length})
                </span>
              )}
            </button>
          </div>

          {/* Composer */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-2">
                {user?.imageUrl ? (
                  <img src={user.imageUrl} alt="" className="w-10 h-10 rounded-full border border-border shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-medium shrink-0">{user?.firstName?.[0]?.toUpperCase() ?? "M"}</div>
                )}
                <Textarea
                  placeholder={`Share an update, ${user?.firstName || "member"}…`}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={3}
                  maxLength={8000}
                  className="resize-none flex-1"
                />
              </div>
              {showLinkInput && <Input placeholder="https://… (optional)" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} />}
              {showImageInput && <Input placeholder="https://image-url.jpg" value={imageUrl} onChange={e => setImageUrl(e.target.value)} />}
              <Input
                placeholder="Industry tags (comma-separated, e.g. banking, insurance)"
                value={industryInput}
                onChange={e => setIndustryInput(e.target.value)}
                className="text-sm"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setShowLinkInput(o => !o)}><Link2 className="w-3.5 h-3.5 mr-1" /> Link</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowImageInput(o => !o)}><ImageIcon className="w-3.5 h-3.5 mr-1" /> Image</Button>
                </div>
                <Button size="sm" onClick={submit} disabled={posting || body.trim().length < 1}>
                  {posting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                  Post
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Feed */}
          {loading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading feed…</div>
          ) : posts.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">
              {filterMode === "followed-capabilities"
                ? followedCapabilities.length === 0
                  ? "Follow capabilities on your profile to populate this view."
                  : "No recent posts tagged with capabilities you follow."
                : "No posts yet. Connect with members or follow industries to populate your feed."}
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {posts.map(p => (
                <FeedPostCard
                  key={p.id} post={p}
                  saved={savedIds.has(p.id)}
                  onLike={() => handleLike(p.id)}
                  onSave={() => handleSave(p.id)}
                  onShare={() => handleShare(p.id)}
                />
              ))}
            </div>
          )}
        </main>

        {/* ─── RIGHT RAIL ─── */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <SuggestionsRail />
          <Card>
            <CardContent className="p-3 space-y-2 text-xs">
              <Link href="/feed/saved" className="flex items-center gap-2 hover:text-foreground text-muted-foreground py-1">
                <Bookmark className="w-3 h-3" /> Saved posts
              </Link>
              <Link href="/forum/banking" className="flex items-center gap-2 hover:text-foreground text-muted-foreground py-1">
                <MessageSquare className="w-3 h-3" /> Forums
              </Link>
              <Link href="/marketplace" className="flex items-center gap-2 hover:text-foreground text-muted-foreground py-1">
                <Sparkles className="w-3 h-3" /> Marketplace
              </Link>
              <Link href="/notifications" className="flex items-center gap-2 hover:text-foreground text-muted-foreground py-1">
                <Activity className="w-3 h-3" /> Notifications
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function renderBodyWithTags(text: string): React.ReactNode {
  // Render @mentions as links to /member/:handle and #hashtags as accent-colored chips.
  const parts = text.split(/(\s+)/);
  return parts.map((part, i) => {
    if (part.startsWith("@") && part.length > 1) {
      const handle = part.slice(1).replace(/[^a-z0-9-]/gi, "");
      return <Link key={i} href={`/member/${handle}`} className="text-accent hover:underline">{part}</Link>;
    }
    if (part.startsWith("#") && part.length > 1) {
      return <span key={i} className="text-accent">{part}</span>;
    }
    return <span key={i}>{part}</span>;
  });
}

function FeedPostCard({ post, saved, onLike, onSave, onShare }: {
  post: Post; saved: boolean;
  onLike: () => void; onSave: () => void; onShare: () => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const a = post.author;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3 mb-3">
          {a?.avatarUrl ? (
            <img src={a.avatarUrl} alt="" className="w-10 h-10 rounded-full border border-border shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-medium shrink-0">
              {(a?.displayName ?? "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <Link href={a ? `/member/${a.slug}` : "#"} className="font-medium text-sm hover:text-accent">{a?.displayName ?? "Member"}</Link>
            {a?.headline && <div className="text-[11px] text-muted-foreground truncate">{a.headline}</div>}
            <div className="text-[10px] text-muted-foreground">{new Date(post.createdAt).toISOString().slice(0, 16).replace("T", " ")}</div>
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7"><MoreHorizontal className="w-3.5 h-3.5" /></Button>
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{renderBodyWithTags(post.body)}</p>
        {post.linkUrl && (
          <a href={post.linkUrl} target="_blank" rel="noopener noreferrer" className="block mt-2 text-xs text-accent hover:underline truncate">
            {post.linkUrl}
          </a>
        )}
        {post.imageUrl && (
          <img src={post.imageUrl} alt="" className="rounded mt-2 max-h-96 object-cover w-full" />
        )}
        {(post.industrySlugs.length > 0 || post.capabilityTags.length > 0) && (
          <div className="flex flex-wrap gap-1 mt-2">
            {post.industrySlugs.map(s => <Badge key={`i-${s}`} variant="outline" className="text-[10px] capitalize">{s.replace(/-/g, " ")}</Badge>)}
            {post.capabilityTags.map(t => <Badge key={`c-${t}`} variant="secondary" className="text-[10px]">{t}</Badge>)}
          </div>
        )}
        {(post.likeCount > 0 || post.commentCount > 0) && (
          <div className="flex items-center justify-between mt-3 text-[11px] text-muted-foreground">
            <span>{post.likeCount > 0 ? `${post.likeCount} like${post.likeCount === 1 ? "" : "s"}` : ""}</span>
            <span>{post.commentCount > 0 ? `${post.commentCount} comment${post.commentCount === 1 ? "" : "s"}` : ""}</span>
          </div>
        )}
        <div className="grid grid-cols-4 gap-1 mt-2 pt-2 border-t border-border/40 text-xs">
          <Button size="sm" variant="ghost" onClick={onLike}><ThumbsUp className="w-3.5 h-3.5 mr-1" /> Like</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowComments(o => !o)}><MessageSquare className="w-3.5 h-3.5 mr-1" /> Comment</Button>
          <Button size="sm" variant="ghost" onClick={onShare}><Share2 className="w-3.5 h-3.5 mr-1" /> Share</Button>
          <Button size="sm" variant="ghost" onClick={onSave} className={saved ? "text-accent" : ""}>
            <Bookmark className={`w-3.5 h-3.5 mr-1 ${saved ? "fill-current" : ""}`} /> {saved ? "Saved" : "Save"}
          </Button>
        </div>
        {showComments && <PostComments postId={post.id} />}
      </CardContent>
    </Card>
  );
}

function PostComments({ postId }: { postId: number }) {
  const { isSignedIn } = useUser();
  const [comments, setComments] = useState<Array<{ id: number; authorUserId: string; body: string; createdAt: string }>>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/posts/${postId}/comments`);
    if (r.ok) { const d = await r.json() as { comments: typeof comments }; setComments(d.comments); }
  }, [postId]);
  useEffect(() => { void load(); }, [load]);
  const submit = async (): Promise<void> => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await fetch(`/api/posts/${postId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: draft.trim() }) });
      setDraft("");
      await load();
    } finally { setPosting(false); }
  };
  return (
    <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
      {comments.map(c => (
        <div key={c.id} className="text-xs bg-muted/30 rounded p-2">
          <div className="text-muted-foreground mb-0.5">{new Date(c.createdAt).toISOString().slice(0, 16).replace("T", " ")}</div>
          <p className="whitespace-pre-wrap">{c.body}</p>
        </div>
      ))}
      {isSignedIn && (
        <div className="flex gap-2">
          <Input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Write a comment…" maxLength={4000}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }}} />
          <Button size="sm" onClick={submit} disabled={posting || !draft.trim()}><Send className="w-3.5 h-3.5" /></Button>
        </div>
      )}
    </div>
  );
}
