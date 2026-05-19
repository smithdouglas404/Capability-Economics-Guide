/**
 * /inbox + /inbox/:userId — member DMs.
 *
 * Move 7 of the strategic UX overhaul. Two-pane: conversation list on
 * the left (or top on mobile), active thread on the right. URL param
 * :userId opens a specific conversation.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useParams } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import { MessageCircle, Send, Loader2, ChevronLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Conversation {
  otherUserId: string;
  otherProfile: { userId: string; slug: string; displayName: string; avatarUrl: string | null } | null;
  lastMessage: { body: string; fromMe: boolean; createdAt: string };
  unreadCount: number;
}

interface Message {
  id: number;
  fromUserId: string;
  toUserId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function InboxPage() {
  const params = useParams();
  const activeUserId = params.userId;
  const { isSignedIn, user } = useUser();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [thread, setThread] = useState<Message[]>([]);
  const [otherProfile, setOtherProfile] = useState<Conversation["otherProfile"] | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const loadConvs = useCallback(async () => {
    if (!isSignedIn) return;
    setLoadingConvs(true);
    try {
      const r = await fetch("/api/messages/conversations");
      if (r.ok) {
        const d = await r.json() as { conversations: Conversation[] };
        setConversations(d.conversations);
      }
    } finally {
      setLoadingConvs(false);
    }
  }, [isSignedIn]);

  const loadThread = useCallback(async (uid: string) => {
    setLoadingThread(true);
    try {
      const r = await fetch(`/api/messages/with/${uid}`);
      if (r.ok) {
        const d = await r.json() as { messages: Message[]; otherProfile: Conversation["otherProfile"] };
        setThread(d.messages);
        setOtherProfile(d.otherProfile);
        // Mark read in the background — non-fatal if it fails.
        void fetch(`/api/messages/mark-read/${uid}`, { method: "PATCH" });
      }
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => { void loadConvs(); }, [loadConvs]);
  useEffect(() => {
    if (activeUserId) void loadThread(activeUserId);
    else { setThread([]); setOtherProfile(null); }
  }, [activeUserId, loadThread]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  const send = async (): Promise<void> => {
    if (!activeUserId || !draft.trim()) return;
    setSending(true);
    try {
      const r = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId: activeUserId, body: draft.trim() }),
      });
      if (r.ok) {
        setDraft("");
        await loadThread(activeUserId);
        await loadConvs();
      }
    } finally {
      setSending(false);
    }
  };

  if (!isSignedIn) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-md">
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <MessageCircle className="w-8 h-8 text-muted-foreground mx-auto" />
            <h3 className="font-serif text-xl">Sign in to access your inbox</h3>
            <SignInButton mode="modal"><Button>Sign in</Button></SignInButton>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <h1 className="font-serif text-3xl tracking-tight mb-4 flex items-center gap-2">
        <MessageCircle className="w-6 h-6" /> Inbox
      </h1>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4 h-[70vh]">
        {/* Conversation list */}
        <Card className={cn(activeUserId && "hidden lg:block")}>
          <CardContent className="p-0 overflow-y-auto h-full divide-y divide-border/40">
            {loadingConvs ? (
              <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">
                No conversations yet. Find members on the <Link href="/marketplace" className="text-primary hover:underline">marketplace</Link> or via member profiles.
              </div>
            ) : (
              conversations.map(c => {
                const initial = c.otherProfile?.displayName?.charAt(0).toUpperCase() ?? "?";
                const isActive = activeUserId === c.otherUserId;
                return (
                  <Link
                    key={c.otherUserId}
                    href={`/inbox/${c.otherUserId}`}
                    className={cn(
                      "flex items-start gap-2 p-3 hover:bg-muted/30 cursor-pointer",
                      isActive && "bg-muted/40",
                    )}
                  >
                    {c.otherProfile?.avatarUrl ? (
                      <img src={c.otherProfile.avatarUrl} alt="" className="w-9 h-9 rounded-full border border-border shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-sm font-medium shrink-0">{initial}</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium text-sm truncate">{c.otherProfile?.displayName ?? c.otherUserId}</span>
                        {c.unreadCount > 0 && (
                          <Badge className="text-[10px] bg-accent text-accent-foreground rounded-full px-1.5 py-0">{c.unreadCount}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.lastMessage.fromMe ? "You: " : ""}{c.lastMessage.body}
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Active thread */}
        <Card className={cn(!activeUserId && "hidden lg:flex")}>
          <CardContent className="p-0 flex flex-col h-full w-full">
            {activeUserId ? (
              <>
                <div className="flex items-center gap-2 p-3 border-b border-border/40">
                  <Button asChild variant="ghost" size="icon" className="lg:hidden h-8 w-8">
                    <Link href="/inbox"><ChevronLeft className="w-4 h-4" /></Link>
                  </Button>
                  {otherProfile && (
                    <Link href={`/member/${otherProfile.slug}`} className="flex items-center gap-2 hover:text-accent">
                      {otherProfile.avatarUrl ? (
                        <img src={otherProfile.avatarUrl} alt="" className="w-8 h-8 rounded-full border border-border" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">{otherProfile.displayName.charAt(0).toUpperCase()}</div>
                      )}
                      <span className="font-medium text-sm">{otherProfile.displayName}</span>
                    </Link>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {loadingThread ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : thread.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center pt-8">No messages yet — say hello.</p>
                  ) : (
                    thread.map(m => {
                      const fromMe = m.fromUserId === user?.id;
                      return (
                        <div key={m.id} className={cn("flex", fromMe ? "justify-end" : "justify-start")}>
                          <div className={cn(
                            "px-3 py-2 rounded-lg max-w-[80%] text-sm whitespace-pre-wrap",
                            fromMe ? "bg-accent text-accent-foreground" : "bg-muted text-foreground",
                          )}>
                            {m.body}
                            <div className={cn("text-[10px] mt-0.5 opacity-60", fromMe && "text-right")}>
                              {new Date(m.createdAt).toISOString().slice(11, 16)}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={threadEndRef} />
                </div>
                <form
                  className="border-t border-border/40 p-3 flex items-end gap-2"
                  onSubmit={e => { e.preventDefault(); void send(); }}
                >
                  <Textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Write a message…"
                    rows={2}
                    maxLength={4000}
                    onKeyDown={e => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    className="resize-none"
                  />
                  <Button type="submit" disabled={sending || !draft.trim()} size="icon" className="shrink-0">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
                Pick a conversation, or message a member from their profile.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
