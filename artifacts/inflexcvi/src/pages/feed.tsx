/**
 * /feed — member activity feed. Posts from accepted connections + posts
 * tagged with industries on the user's profile. Composer at top, scrollable
 * post stream below with like / comment / share interactions.
 *
 * Visual language is our own (serif headers, mono eyebrows, accent color,
 * card-based stacks). Standard social feed semantics — not a clone of any
 * specific service.
 */
import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import { ThumbsUp, MessageSquare, Send, Loader2, Image as ImageIcon, Link2, Sparkles } from "lucide-react";
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

export default function FeedPage() {
  const { user, isSignedIn, isLoaded } = useUser();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  // Composer state
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
      const r = await fetch("/api/feed");
      if (r.ok) { const d = await r.json() as { posts: Post[] }; setPosts(d.posts); }
    } finally { setLoading(false); }
  }, [isSignedIn]);

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
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Network"
        title="Your feed"
        descriptions={{
          default: "Posts from your connections and members in industries you follow. Compose your own posts to share capability research, marketplace launches, or thread invitations.",
          pe: "What your network's saying. Watch for capability shifts your portfolio cos should know about; reshare the analyses worth sending to a CEO.",
          vc: "Where founders + operators are talking. Posts tagged to your industries give you signal before the deck shows up in your inbox.",
          f500: "Industry pulse from peers, not press releases. The capability tags filter signal from noise — focus on what your team is graded on.",
          student: "Public reasoning by people doing the work. Comment to learn; post your own analyses to start your professional footprint.",
          professor: "Class-ready material. Many posts here are short-form capability analyses suitable for discussion sections.",
        }}
      />

      {/* Composer */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Textarea
            placeholder={`Share an update, ${user?.firstName || "member"}…`}
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={3}
            maxLength={8000}
            className="resize-none"
          />
          {showLinkInput && (
            <Input placeholder="https://… (optional)" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} />
          )}
          {showImageInput && (
            <Input placeholder="https://image-url.jpg (optional)" value={imageUrl} onChange={e => setImageUrl(e.target.value)} />
          )}
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
          No posts yet. Connect with members or follow industries to start populating your feed.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {posts.map(p => (
            <FeedPostCard key={p.id} post={p} onLike={() => handleLike(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedPostCard({ post, onLike }: { post: Post; onLike: () => void }) {
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
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{post.body}</p>
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
        <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/40 text-xs">
          <Button size="sm" variant="ghost" onClick={onLike}><ThumbsUp className="w-3.5 h-3.5 mr-1" /> {post.likeCount > 0 ? post.likeCount : ""}</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowComments(o => !o)}><MessageSquare className="w-3.5 h-3.5 mr-1" /> {post.commentCount > 0 ? post.commentCount : ""}</Button>
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
