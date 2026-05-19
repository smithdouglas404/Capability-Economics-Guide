/**
 * /network — manage your connections.
 *
 * Three tabs: Connected, Pending (incoming requests waiting for your accept),
 * Sent (outgoing requests you've sent that haven't been accepted).
 *
 * Visual language is our own (serif headers, mono eyebrow labels, card-based
 * stacks). Standard connections management — not a clone of any service.
 */
import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { useUser, SignInButton } from "@clerk/react";
import { Users, Check, X, Loader2, MessageCircle, UserCheck, Clock, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

interface OtherProfile {
  userId: string; slug: string; displayName: string; avatarUrl: string | null; headline: string | null;
}
interface Connection {
  id: number; userA: string; userB: string; requestedBy: string;
  status: string; createdAt: string; acceptedAt: string | null;
  otherUserId: string; otherProfile: OtherProfile | null;
}

export default function NetworkPage() {
  const { isSignedIn, isLoaded } = useUser();
  const [accepted, setAccepted] = useState<Connection[]>([]);
  const [incoming, setIncoming] = useState<Connection[]>([]);
  const [outgoing, setOutgoing] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"accepted" | "incoming" | "outgoing">("accepted");

  const load = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    try {
      const r = await fetch("/api/connections");
      if (r.ok) {
        const d = await r.json() as { accepted: Connection[]; incoming: Connection[]; outgoing: Connection[] };
        setAccepted(d.accepted); setIncoming(d.incoming); setOutgoing(d.outgoing);
        if (d.incoming.length > 0 && tab === "accepted" && d.accepted.length === 0) setTab("incoming");
      }
    } finally { setLoading(false); }
  }, [isSignedIn, tab]);

  useEffect(() => { void load(); }, [load]);

  const handleAccept = async (c: Connection): Promise<void> => {
    await fetch("/api/connections/accept", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromUserId: c.otherUserId }),
    });
    await load();
  };

  const handleDecline = async (c: Connection): Promise<void> => {
    await fetch(`/api/connections/${c.otherUserId}`, { method: "DELETE" });
    await load();
  };

  const handleRemove = async (c: Connection): Promise<void> => {
    if (!window.confirm(`Remove ${c.otherProfile?.displayName ?? "this connection"}?`)) return;
    await fetch(`/api/connections/${c.otherUserId}`, { method: "DELETE" });
    await load();
  };

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-md">
        <Card><CardContent className="py-10 text-center space-y-3">
          <Users className="w-8 h-8 text-muted-foreground mx-auto" />
          <h3 className="font-serif text-xl">Sign in to manage your network</h3>
          <SignInButton mode="modal"><Button>Sign in</Button></SignInButton>
        </CardContent></Card>
      </div>
    );
  }

  const tabs = [
    { id: "accepted" as const, label: "Connected", count: accepted.length, icon: UserCheck },
    { id: "incoming" as const, label: "Pending invitations", count: incoming.length, icon: Clock },
    { id: "outgoing" as const, label: "Sent", count: outgoing.length, icon: Send },
  ];

  const rows = tab === "accepted" ? accepted : tab === "incoming" ? incoming : outgoing;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Network"
        title="Your network"
        descriptions={{
          default: "Manage your member connections — accept incoming invitations, send new ones, and message anyone you're connected with.",
          pe: "Your sourcing rolodex. Connections see what you publish — keep this tight enough that your signal isn't diluted.",
          vc: "Founders and operators in your network see your posts. Curate accordingly.",
          f500: "Peer benchmarking starts with peers. Connections gate the cohort comparisons your team relies on.",
          student: "Build the professional graph you're going to lean on for the next decade. Connect with classmates, professors, and operators.",
          professor: "Your students see your posts when they connect; useful as a public extension of your office hours.",
        }}
      />

      {/* Tab strip */}
      <div className="flex flex-wrap gap-2 border-b border-border/40">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
                tab === t.id
                  ? "border-accent text-accent"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
              {t.count > 0 && (
                <Badge variant={tab === t.id ? "default" : "outline"} className="text-[10px] py-0 px-1.5">
                  {t.count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">
          {tab === "accepted" && "No connections yet. Find members on /marketplace or via /member profiles."}
          {tab === "incoming" && "No pending invitations."}
          {tab === "outgoing" && "No outgoing requests."}
        </CardContent></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {rows.map(c => {
            const p = c.otherProfile;
            const initial = p?.displayName?.charAt(0).toUpperCase() ?? "?";
            return (
              <Card key={c.id}>
                <CardContent className="p-4 flex items-start gap-3">
                  {p?.avatarUrl ? (
                    <img src={p.avatarUrl} alt="" className="w-12 h-12 rounded-full border border-border shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center font-medium shrink-0">{initial}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    {p ? (
                      <Link href={`/member/${p.slug}`} className="font-medium text-sm hover:text-accent block truncate">
                        {p.displayName}
                      </Link>
                    ) : (
                      <span className="font-medium text-sm">Member</span>
                    )}
                    {p?.headline && <p className="text-[11px] text-muted-foreground truncate">{p.headline}</p>}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {tab === "accepted" && c.acceptedAt && `Connected ${new Date(c.acceptedAt).toISOString().slice(0, 10)}`}
                      {tab !== "accepted" && `Requested ${new Date(c.createdAt).toISOString().slice(0, 10)}`}
                    </div>
                    {/* Per-tab actions */}
                    <div className="flex items-center gap-1.5 mt-2">
                      {tab === "accepted" && (
                        <>
                          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                            <Link href={`/inbox/${c.otherUserId}`}><MessageCircle className="w-3 h-3 mr-1" /> Message</Link>
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-500 hover:text-rose-500" onClick={() => handleRemove(c)}>
                            Remove
                          </Button>
                        </>
                      )}
                      {tab === "incoming" && (
                        <>
                          <Button size="sm" className="h-7 text-xs" onClick={() => handleAccept(c)}>
                            <Check className="w-3 h-3 mr-1" /> Accept
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleDecline(c)}>
                            <X className="w-3 h-3 mr-1" /> Decline
                          </Button>
                        </>
                      )}
                      {tab === "outgoing" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => handleDecline(c)}>
                          Withdraw
                        </Button>
                      )}
                    </div>
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
