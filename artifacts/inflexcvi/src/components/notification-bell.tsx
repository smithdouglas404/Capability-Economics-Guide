/**
 * Notification bell with unread count badge for the header. Polls the
 * unread-count endpoint every 60s when signed in. Click → /notifications.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Bell } from "lucide-react";
import { useUser } from "@clerk/react";

export function NotificationBell() {
  const { isSignedIn } = useUser();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    const fetchUnread = async (): Promise<void> => {
      try {
        const r = await fetch("/api/me/notifications/unread-count");
        if (!r.ok) return;
        const d = await r.json() as { unreadCount: number };
        if (!cancelled) setUnread(d.unreadCount);
      } catch { /* ignore */ }
    };
    void fetchUnread();
    const handle = setInterval(fetchUnread, 60_000);
    return () => { cancelled = true; clearInterval(handle); };
  }, [isSignedIn]);

  if (!isSignedIn) return null;

  return (
    <Link href="/notifications" className="relative inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-muted transition-colors" title="Notifications">
      <Bell className="w-4 h-4 text-muted-foreground" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-medium flex items-center justify-center tabular-nums">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
