/**
 * /hashtag/:tag — all posts whose body contains #tag, newest first.
 *
 * Standard discoverability surface for clicking a hashtag in any rendered
 * post on /feed or a profile activity stream.
 *
 * Capability-aware (2026-05-23): when the tag matches a capability slug or
 * name, a capability detail summary card is rendered above the post list
 * with a cross-link to /capability/:id.
 */
import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "wouter";
import { Hash, ArrowLeft, Loader2, ThumbsUp, MessageSquare, ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PostAuthor {
  userId: string; slug: string; displayName: string; avatarUrl: string | null; headline: string | null;
}
interface Post {
  id: number; authorUserId: string; body: string; linkUrl: string | null; imageUrl: string | null;
  capabilityTags: string[]; industrySlugs: string[]; likeCount: number; commentCount: number;
  createdAt: string; author: PostAuthor | null;
}

interface CapabilityMatch {
  id: number;
  slug: string;
  name: string;
  description: string;
  industryId: number;
  isLeaf: boolean;
  benchmarkScore: number;
  reviewStatus: string;
}

/** Render post body with @mentions and #hashtags as clickable spans. */
function renderBody(text: string): React.ReactNode {
  const parts = text.split(/(\s+)/);
  return parts.map((part, i) => {
    if (part.startsWith("@") && part.length > 1) {
      const handle = part.slice(1).replace(/[^a-z0-9-]/gi, "");
      if (!handle) return <span key={i}>{part}</span>;
      return <Link key={i} href={`/member/${handle}`} className="text-accent hover:underline">{part}</Link>;
    }
    if (part.startsWith("#") && part.length > 1) {
      const tag = part.slice(1).replace(/[^a-z0-9_-]/gi, "");
      if (!tag) return <span key={i}>{part}</span>;
      return <Link key={i} href={`/hashtag/${tag}`} className="text-accent hover:underline">{part}</Link>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function HashtagPage() {
  const params = useParams();
  const tag = params.tag ?? "";
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [capabilityMatch, setCapabilityMatch] = useState<CapabilityMatch | null>(null);

  const load = useCallback(async () => {
    if (!tag) return;
    setLoading(true);
    // Fire both lookups in parallel — the capability lookup is a 404 for
    // most tags and shouldn't block the post list.
    try {
      const [postsRes, capRes] = await Promise.all([
        fetch(`/api/hashtag/${tag}`),
        fetch(`/api/capabilities/by-slug/${encodeURIComponent(tag)}`),
      ]);
      if (postsRes.ok) {
        const d = await postsRes.json() as { posts: Post[] };
        setPosts(d.posts);
      }
      if (capRes.ok) {
        const d = await capRes.json() as { capability: CapabilityMatch };
        setCapabilityMatch(d.capability);
      } else {
        setCapabilityMatch(null);
      }
    } finally { setLoading(false); }
  }, [tag]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-4">
      <Link href="/feed" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Feed
      </Link>
      <div>
        <div className="inline-flex items-center gap-2 mb-2">
          <span className="h-px w-5 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ Hashtag</span>
        </div>
        <h1 className="font-serif text-4xl tracking-tight inline-flex items-center gap-2">
          <Hash className="w-6 h-6 text-accent" />{tag}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {loading ? "Loading…" : `${posts.length} post${posts.length === 1 ? "" : "s"} tagged #${tag}`}
        </p>
      </div>

      {/* Capability summary card — rendered when /hashtag/<term> aligns with
          a capability slug or display name. Cross-links to /capability/:id
          so the discoverability path "see a #fraud-detection post → learn
          about the capability" stays one click. */}
      {capabilityMatch && (
        <Link href={`/capability/${capabilityMatch.id}`} className="block">
          <Card className="border-accent/40 hover:border-accent transition-colors cursor-pointer">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="inline-flex items-center gap-2 mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-accent" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
                      Capability match
                    </span>
                  </div>
                  <h2 className="font-serif text-xl tracking-tight mb-1">{capabilityMatch.name}</h2>
                  <p className="text-sm text-muted-foreground line-clamp-3">{capabilityMatch.description}</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider">
                      {capabilityMatch.isLeaf ? "Leaf" : "Rollup"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider">
                      Benchmark {capabilityMatch.benchmarkScore.toFixed(0)}
                    </Badge>
                    {capabilityMatch.reviewStatus !== "approved" && (
                      <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider">
                        {capabilityMatch.reviewStatus}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-sm text-accent shrink-0 self-center">
                  <span className="hidden sm:inline">Open</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : posts.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">
          {capabilityMatch
            ? <>No posts tagged #{tag} yet — but the capability above is real. Be the first to start the discussion.</>
            : <>No posts tagged #{tag} yet. Be the first — write a post with #{tag} in it.</>}
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {posts.map(p => {
            const a = p.author;
            return (
              <Card key={p.id}>
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
                      <div className="text-[10px] text-muted-foreground">{new Date(p.createdAt).toISOString().slice(0, 16).replace("T", " ")}</div>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{renderBody(p.body)}</p>
                  {p.linkUrl && (
                    <a href={p.linkUrl} target="_blank" rel="noopener noreferrer" className="block mt-2 text-xs text-accent hover:underline truncate">
                      {p.linkUrl}
                    </a>
                  )}
                  {p.imageUrl && (
                    <img src={p.imageUrl} alt="" className="rounded mt-2 max-h-96 object-cover w-full" />
                  )}
                  {(p.industrySlugs.length > 0 || p.capabilityTags.length > 0) && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.industrySlugs.map(s => <Badge key={`i-${s}`} variant="outline" className="text-[10px] capitalize">{s.replace(/-/g, " ")}</Badge>)}
                      {p.capabilityTags.map(t => <Badge key={`c-${t}`} variant="secondary" className="text-[10px]">{t}</Badge>)}
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><ThumbsUp className="w-3 h-3" /> {p.likeCount}</span>
                    <span className="inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {p.commentCount}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
