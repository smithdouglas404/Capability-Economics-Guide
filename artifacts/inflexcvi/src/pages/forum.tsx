/**
 * /forum/:industrySlug — thread list for one industry.
 * /forum/thread/:id — single thread + replies.
 *
 * Move 8 of the strategic UX overhaul — community discussion primitive.
 * Two views in one component file, selected via the :id param when
 * present.
 */
import { useEffect, useState, useCallback } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import { MessageSquare, Lock, Plus, ArrowLeft, Loader2, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface ThreadListItem {
  id: number;
  title: string;
  body: string;
  authorUserId: string;
  authorDisplayName: string | null;
  lockedAt: string | null;
  postCount: number;
  lastPostAt: string;
  createdAt: string;
}

interface ThreadDetail {
  id: number;
  industrySlug: string;
  industryName: string;
  title: string;
  body: string;
  authorUserId: string;
  authorDisplayName: string | null;
  lockedAt: string | null;
  postCount: number;
  lastPostAt: string;
  createdAt: string;
}

interface Post {
  id: number;
  threadId: number;
  authorUserId: string;
  authorDisplayName: string | null;
  body: string;
  createdAt: string;
}

export default function ForumPage() {
  // Two layouts in one file: when params has industrySlug we're on the list view,
  // when params has the thread id we're in detail view. Wouter routes both to
  // this component with different params.
  const params = useParams();
  if (params.id) return <ThreadDetailView threadId={Number(params.id)} />;
  return <ThreadListView industrySlug={params.industrySlug ?? ""} />;
}

function ThreadListView({ industrySlug }: { industrySlug: string }) {
  const { isSignedIn } = useUser();
  const [, setLocation] = useLocation();
  const [industryName, setIndustryName] = useState<string>(industrySlug);
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!industrySlug) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/forums/${industrySlug}/threads`);
      if (r.ok) {
        const d = await r.json() as { industry: { name: string }; threads: ThreadListItem[] };
        setIndustryName(d.industry.name);
        setThreads(d.threads);
      }
    } finally { setLoading(false); }
  }, [industrySlug]);

  useEffect(() => { void load(); }, [load]);

  const createThread = async (): Promise<void> => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/forums/${industrySlug}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, body: newBody }),
      });
      if (r.ok) {
        const d = await r.json() as { thread: ThreadListItem };
        setLocation(`/forum/thread/${d.thread.id}`);
      }
    } finally { setSubmitting(false); }
  };

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">§ Forum</span>
          </div>
          <h1 className="font-serif text-3xl tracking-tight capitalize">{industryName} discussion</h1>
          <p className="text-sm text-muted-foreground mt-1">Community threads for {industryName.toLowerCase()} — ask, debate, share. Moderated by the original author per thread.</p>
        </div>
        {isSignedIn ? (
          <Button onClick={() => setComposerOpen(o => !o)}>
            <Plus className="w-4 h-4 mr-1" />
            {composerOpen ? "Cancel" : "New thread"}
          </Button>
        ) : (
          <SignInButton mode="modal"><Button variant="outline">Sign in to post</Button></SignInButton>
        )}
      </div>

      {composerOpen && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Start a thread</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Thread title" value={newTitle} onChange={e => setNewTitle(e.target.value)} maxLength={280} />
            <Textarea placeholder="What do you want to discuss? Markdown OK." rows={6} value={newBody} onChange={e => setNewBody(e.target.value)} maxLength={8000} />
            <div className="flex items-center justify-end">
              <Button onClick={createThread} disabled={submitting || newTitle.trim().length < 4 || newBody.trim().length < 4}>
                {submitting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Post thread
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : threads.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">
          No threads yet. {isSignedIn ? "Start the first one." : "Sign in to start the first one."}
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {threads.map(t => (
            <Link key={t.id} href={`/forum/thread/${t.id}`} className="block">
              <Card className="hover:border-accent transition-colors cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-medium text-base truncate flex-1">{t.title}</h3>
                    {t.lockedAt && <Badge variant="outline" className="text-[10px]"><Lock className="w-2.5 h-2.5 mr-0.5" /> Locked</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{t.body}</p>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{t.authorDisplayName ?? "Unknown"}</span>
                    <span className="inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {t.postCount}</span>
                    <span>· last activity {new Date(t.lastPostAt).toISOString().slice(0, 10)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadDetailView({ threadId }: { threadId: number }) {
  const { isSignedIn, user } = useUser();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [posting, setPosting] = useState(false);
  const [locking, setLocking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/forums/threads/${threadId}`);
      if (r.ok) {
        const d = await r.json() as { thread: ThreadDetail; posts: Post[] };
        setThread(d.thread);
        setPosts(d.posts);
      }
    } finally { setLoading(false); }
  }, [threadId]);

  useEffect(() => { void load(); }, [load]);

  const sendReply = async (): Promise<void> => {
    if (!reply.trim()) return;
    setPosting(true);
    try {
      const r = await fetch(`/api/forums/threads/${threadId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      if (r.ok) {
        setReply("");
        await load();
      }
    } finally { setPosting(false); }
  };

  const toggleLock = async (): Promise<void> => {
    setLocking(true);
    try {
      await fetch(`/api/forums/threads/${threadId}/lock`, { method: "PATCH" });
      await load();
    } finally { setLocking(false); }
  };

  if (loading) return <div className="container mx-auto px-4 py-10 text-sm text-muted-foreground">Loading…</div>;
  if (!thread) return <div className="container mx-auto px-4 py-10 text-sm text-muted-foreground">Thread not found.</div>;

  const isOP = user?.id === thread.authorUserId;

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl space-y-6">
      <Link href={`/forum/${thread.industrySlug}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> {thread.industryName} threads
      </Link>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-serif text-2xl tracking-tight">{thread.title}</h1>
              <div className="text-xs text-muted-foreground mt-1">
                <span>{thread.authorDisplayName ?? "Unknown"}</span>
                <span> · {new Date(thread.createdAt).toISOString().slice(0, 10)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {thread.lockedAt && <Badge variant="outline"><Lock className="w-3 h-3 mr-0.5" /> Locked</Badge>}
              {isOP && (
                <Button variant="ghost" size="sm" onClick={toggleLock} disabled={locking}>
                  {thread.lockedAt ? "Unlock" : "Lock"}
                </Button>
              )}
            </div>
          </div>
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{thread.body}</p>
        </CardContent>
      </Card>

      {posts.length > 0 && (
        <div className="space-y-3">
          {posts.map(p => (
            <Card key={p.id}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1.5">
                  <span className="font-medium text-foreground">{p.authorDisplayName ?? "Unknown"}</span>
                  <span> · {new Date(p.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{p.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {thread.lockedAt ? (
        <Card><CardContent className="py-4 text-sm text-muted-foreground text-center">
          <Lock className="w-4 h-4 inline-block mr-1" /> This thread is locked. No new replies.
        </CardContent></Card>
      ) : isSignedIn ? (
        <Card>
          <CardContent className="p-3">
            <Textarea
              placeholder="Reply…"
              rows={3}
              value={reply}
              onChange={e => setReply(e.target.value)}
              maxLength={8000}
              className="resize-none"
            />
            <div className="flex items-center justify-end mt-2">
              <Button onClick={sendReply} disabled={posting || reply.trim().length < 4}>
                {posting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                Reply
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card><CardContent className="py-4 text-sm text-muted-foreground text-center">
          <SignInButton mode="modal"><Button variant="outline" size="sm">Sign in to reply</Button></SignInButton>
        </CardContent></Card>
      )}
    </div>
  );
}
