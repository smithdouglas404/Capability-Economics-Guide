/**
 * /notifications — full notifications list page. Bell icon in nav links
 * here with an unread badge.
 *
 * Layout: topic-grouped, not chronological. Notifications are bucketed
 * by `targetType` (regulation / capability / connection / post / etc.)
 * with each group expandable. Empty groups collapse out.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import {
  Bell, UserPlus, ThumbsUp, MessageSquare, Share2, AtSign, Award,
  Loader2, ArrowLeft, ChevronDown, ChevronRight, Network, Layers,
  ShieldAlert, FileText, Megaphone, Inbox,
} from "lucide-react";
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

// Topic metadata for the targetType buckets. Order here = display order.
// Anything not listed falls into the "other" bucket at the bottom.
const TOPIC_META: Record<string, { label: string; icon: typeof Bell; tone: string }> = {
  capability:  { label: "Capabilities",  icon: Layers,      tone: "text-amber-700"   },
  regulation:  { label: "Regulations",   icon: ShieldAlert, tone: "text-rose-700"    },
  connection:  { label: "Connections",   icon: Network,     tone: "text-sky-700"     },
  post:        { label: "Posts",         icon: FileText,    tone: "text-violet-700"  },
  mention:     { label: "Mentions",      icon: AtSign,      tone: "text-emerald-700" },
  recommendation: { label: "Recommendations", icon: Award,  tone: "text-amber-700"   },
  announcement: { label: "Announcements", icon: Megaphone,  tone: "text-blue-700"    },
};
const TOPIC_ORDER = ["capability", "regulation", "connection", "post", "mention", "recommendation", "announcement"];
const FALLBACK_TOPIC = { label: "Other", icon: Inbox, tone: "text-muted-foreground" };

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

  // Bucket notifications by targetType. Items with no targetType fall
  // into the FALLBACK_TOPIC ("Other") bucket. Within each bucket items
  // stay in their original (server-sorted, newest-first) order.
  const groups = useMemo(() => {
    const map = new Map<string, Notif[]>();
    for (const n of notifs) {
      const key = (n.targetType && TOPIC_META[n.targetType]) ? n.targetType : "_other";
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    const ordered: { key: string; label: string; icon: typeof Bell; tone: string; items: Notif[]; unread: number }[] = [];
    for (const key of TOPIC_ORDER) {
      const items = map.get(key);
      if (items && items.length) {
        const meta = TOPIC_META[key];
        ordered.push({ key, ...meta, items, unread: items.filter(i => !i.readAt).length });
      }
    }
    const otherItems = map.get("_other");
    if (otherItems && otherItems.length) {
      ordered.push({ key: "_other", ...FALLBACK_TOPIC, items: otherItems, unread: otherItems.filter(i => !i.readAt).length });
    }
    return ordered;
  }, [notifs]);

  // Default: groups with unread items expanded, others collapsed.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isCollapsed = (key: string, defaultCollapsed: boolean) =>
    key in collapsed ? collapsed[key] : defaultCollapsed;

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
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground italic">
            Grouped by topic — expand a section to see its items. Newest first within each group.
          </p>
          {groups.map(group => {
            const GroupIcon = group.icon;
            // Auto-expand groups with unread items; user toggles override.
            const collapsedNow = isCollapsed(group.key, group.unread === 0);
            return (
              <div key={group.key} className="border rounded-sm bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setCollapsed(c => ({ ...c, [group.key]: !collapsedNow }))}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left"
                  aria-expanded={!collapsedNow}
                >
                  {collapsedNow
                    ? <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <GroupIcon className={`w-4 h-4 shrink-0 ${group.tone}`} />
                  <span className="font-medium text-sm flex-1">{group.label}</span>
                  {group.unread > 0 && (
                    <span className="bg-accent text-accent-foreground text-[10px] font-mono px-1.5 py-0.5 rounded-sm">{group.unread} new</span>
                  )}
                  <span className="text-xs text-muted-foreground font-mono">{group.items.length}</span>
                </button>
                {!collapsedNow && (
                  <div className="divide-y border-t">
                    {group.items.map(n => {
                      const Icon = TYPE_ICON[n.type] ?? Bell;
                      const isUnread = !n.readAt;
                      return (
                        <div key={n.id} className={`p-3 flex items-start gap-3 ${isUnread ? "bg-accent/5" : ""}`}>
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
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
