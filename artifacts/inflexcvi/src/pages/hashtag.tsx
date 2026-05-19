/**
 * /hashtag/:tag — all posts whose body contains #tag, newest first.
 *
 * Standard discoverability surface for clicking a hashtag in any rendered
 * post on /feed or a profile activity stream.
 */
import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "wouter";
import { Hash, ArrowLeft, Loader2, ThumbsUp, MessageSquare, Bookmark, Share2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PostAuthor {
  userId: string; slug: string; displayName: string; avatarUrl: string | null; headline: string | null;
}
interface Post {
  id: number; authorUserId: string; body: string; linkUrl: string | null; imageUrl: string | null;
  capabilityTags: string[]; industrySlugs: string[]; likeCount: number; commentCount: number;
  createdAt: string; author: PostAuthor | null;
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

  const load = useCallback(async () => {
    if (!tag) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/hashtag/${tag}`);
      if (r.ok) { const d = await r.json() as { posts: Post[] }; setPosts(d.posts); }
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

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : posts.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">
          No posts tagged #{tag} yet. Be the first — write a post with #{tag} in it.
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
