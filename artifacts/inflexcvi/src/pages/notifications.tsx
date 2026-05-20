/**
 * /notifications — full notifications list page. Bell icon in nav links
 * here with an unread badge.
 */
import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import { Bell, UserPlus, ThumbsUp, MessageSquare, Share2, AtSign, Award, Loader2, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface NotifActor {
  userId: string; slug: string; displayName: string; avatarUrl: string | null;
}
interface Notif {
  id: number; type: string; actorUserId: string | null;
  targetType: string | null; targetId: number | null; body: string;
  readAt: string | null; createdAt: string; actor: NotifActor | null;
}

const TYPE_ICON: Record<string, typeof Bell> = {
  connection_request: UserPlus,
  connection_accepted: UserPlus,
  post_like: ThumbsUp,
  post_comment: MessageSquare,
  post_share: Share2,
  mention: AtSign,
  recommendation: Award,
  skill_endorsement: Award,
};

export default function NotificationsPage() {
  const { isSignedIn, isLoaded } = useUser();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    try {
      const r = await fetch("/api/me/notifications");
      if (r.ok) { const d = await r.json() as { notifications: Notif[] }; setNotifs(d.notifications); }
      // Mark all as read in the background so the bell unread count clears.
      void fetch("/api/me/notifications/read-all", { method: "PATCH" });
    } finally { setLoading(false); }
  }, [isSignedIn]);

  useEffect(() => { void load(); }, [load]);

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-md">
        <Card><CardContent className="py-10 text-center space-y-3">
          <Bell className="w-8 h-8 text-muted-foreground mx-auto" />
          <h3 className="font-serif text-xl">Sign in to see notifications</h3>
          <SignInButton mode="modal"><Button>Sign in</Button></SignInButton>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-4">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5" /> Home
      </Link>
      <div className="flex items-end justify-between">
        <h1 className="font-serif text-3xl tracking-tight inline-flex items-center gap-2">
          <Bell className="w-6 h-6" /> Notifications
        </h1>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : notifs.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">
          No notifications yet. Connection requests, post likes, mentions, and recommendations will show up here.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {notifs.map(n => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            const isUnread = !n.readAt;
            return (
              <Card key={n.id} className={isUnread ? "border-accent/40 bg-accent/5" : ""}>
                <CardContent className="p-3 flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isUnread ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      {n.actor?.avatarUrl ? (
                        <img src={n.actor.avatarUrl} alt="" className="w-6 h-6 rounded-full border border-border shrink-0 mt-0.5" />
                      ) : null}
                      <div className="flex-1 min-w-0">
                        {n.actor ? (
                          <Link href={`/member/${n.actor.slug}`} className="font-medium text-sm hover:text-accent">{n.actor.displayName}</Link>
                        ) : null}
                        <p className="text-sm text-foreground/85">{n.body}</p>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{new Date(n.createdAt).toISOString().slice(0, 16).replace("T", " ")}</div>
                      </div>
                    </div>
                  </div>
                  {isUnread && <span className="w-2 h-2 rounded-full bg-accent shrink-0 mt-2" aria-label="unread" />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
