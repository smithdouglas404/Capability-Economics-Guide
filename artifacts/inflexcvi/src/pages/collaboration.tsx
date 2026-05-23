/**
 * /collaboration — team strategy workspace.
 *
 * Capability-aware overlay added in the social/collab wave:
 *  - "Boards" sidebar lists every capability the team has actively
 *    commented or recorded a decision against (one board per capability).
 *    Selecting a board scopes the comment + decision panes to that cap.
 *  - Roster card shows everyone who's contributed to this team (distinct
 *    name + role tuple) so you can see who's actually in the room.
 *  - "Recent activity" rail streams the latest 40 comments + decisions
 *    across all boards, capability-tagged, newest first.
 *
 * Existing flows (comment composer, decision recorder, resolve toggle)
 * are unchanged — this is purely additive.
 */
import { useEffect, useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, Gavel, Plus, Check, Send, LayoutGrid, Users, Activity, Tag } from "lucide-react";

const API_BASE = "/api";

const ROLES = ["CEO", "CFO", "CTO", "CIO", "COO", "CMO", "CHRO", "CPO"];
const DECISIONS = ["invest", "hold", "divest", "pivot", "kill"];

type Comment = {
  id: number;
  targetType: string;
  targetId: number;
  authorRole: string;
  authorName: string;
  body: string;
  parentCommentId: number | null;
  resolved: boolean;
  createdAt: string;
};

type Decision = {
  id: number;
  capabilityId: number | null;
  capabilityName: string | null;
  decision: string;
  rationale: string;
  decidedBy: string;
  decidedByRole: string;
  investmentUsdK: number | null;
  timelineMonths: number | null;
  createdAt: string;
};

type Capability = { id: number; name: string };

type Board = {
  capabilityId: number;
  name: string;
  slug: string | null;
  commentCount: number;
  decisionCount: number;
  lastActivity: string;
};

type RosterMember = { name: string; role: string };

type ActivityItem = {
  kind: "comment" | "decision";
  id: number;
  capabilityId: number | null;
  capabilityName: string | null;
  capabilitySlug: string | null;
  authorName: string;
  authorRole: string;
  body: string;
  decision: string | null;
  resolved: boolean;
  createdAt: string;
};

const ROLE_COLORS: Record<string, string> = {
  CEO: "bg-purple-500", CFO: "bg-emerald-500", CTO: "bg-blue-500", CIO: "bg-cyan-500",
  COO: "bg-amber-500", CMO: "bg-pink-500", CHRO: "bg-orange-500", CPO: "bg-indigo-500",
};

const DECISION_COLORS: Record<string, string> = {
  invest: "bg-emerald-500", hold: "bg-amber-500", divest: "bg-destructive", pivot: "bg-blue-500", kill: "bg-destructive",
};

export default function Collaboration() {
  const [tab, setTab] = useState<"comments" | "decisions">("comments");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [selectedCapId, setSelectedCapId] = useState<number>(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [commentForm, setCommentForm] = useState({ authorName: "", authorRole: "CTO", body: "" });
  const [decisionForm, setDecisionForm] = useState({ decision: "invest", rationale: "", decidedBy: "", decidedByRole: "CEO", investmentUsdK: "", timelineMonths: "" });
  const sessionToken = typeof window !== "undefined" ? (localStorage.getItem("ce_session_token") ?? "") : "";

  useEffect(() => {
    fetch(`${API_BASE}/capabilities`).then((r) => r.json()).then((caps) => {
      setCapabilities(caps);
      if (caps.length) setSelectedCapId(caps[0].id);
    }).catch(() => {});
  }, []);

  const loadBoards = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const r = await fetch(`${API_BASE}/collaboration/boards?sessionToken=${encodeURIComponent(sessionToken)}`);
      const d = await r.json() as { boards: Board[]; members: RosterMember[] };
      setBoards(d.boards ?? []);
      setRoster(d.members ?? []);
    } catch (err) { console.error(err); }
  }, [sessionToken]);

  const loadActivity = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const r = await fetch(`${API_BASE}/collaboration/activity?sessionToken=${encodeURIComponent(sessionToken)}`);
      const d = await r.json() as { activity: ActivityItem[] };
      setActivity(d.activity ?? []);
    } catch (err) { console.error(err); }
  }, [sessionToken]);

  useEffect(() => { void loadBoards(); void loadActivity(); }, [loadBoards, loadActivity]);

  const loadComments = useCallback(async () => {
    if (!selectedCapId) return;
    try {
      const url = new URL(`${API_BASE}/collaboration/comments`, window.location.origin);
      url.searchParams.set("targetType", "capability");
      url.searchParams.set("targetId", String(selectedCapId));
      if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
      const res = await fetch(url.toString().replace(window.location.origin, ""));
      setComments(await res.json());
    } catch (err) { console.error(err); }
  }, [selectedCapId, sessionToken]);

  const loadDecisions = useCallback(async () => {
    try {
      const url = new URL(`${API_BASE}/collaboration/decisions`, window.location.origin);
      if (selectedCapId) url.searchParams.set("capabilityId", String(selectedCapId));
      if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
      const res = await fetch(url.toString().replace(window.location.origin, ""));
      setDecisions(await res.json());
    } catch (err) { console.error(err); }
  }, [selectedCapId, sessionToken]);

  useEffect(() => {
    if (!selectedCapId) return;
    void loadComments();
    void loadDecisions();
  }, [selectedCapId, loadComments, loadDecisions]);

  const addComment = async () => {
    if (!commentForm.body || !commentForm.authorName) return;
    await fetch(`${API_BASE}/collaboration/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "capability",
        targetId: selectedCapId,
        authorRole: commentForm.authorRole,
        authorName: commentForm.authorName,
        sessionToken,
        body: commentForm.body,
      }),
    });
    setCommentForm((f) => ({ ...f, body: "" }));
    setShowCommentForm(false);
    await loadComments();
    void loadBoards();
    void loadActivity();
  };

  const resolveComment = async (id: number, resolved: boolean) => {
    await fetch(`${API_BASE}/collaboration/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved, sessionToken }),
    });
    await loadComments();
    void loadActivity();
  };

  const addDecision = async () => {
    if (!decisionForm.rationale || !decisionForm.decidedBy) return;
    await fetch(`${API_BASE}/collaboration/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilityId: selectedCapId || null,
        sessionToken,
        decision: decisionForm.decision,
        rationale: decisionForm.rationale,
        decidedBy: decisionForm.decidedBy,
        decidedByRole: decisionForm.decidedByRole,
        investmentUsdK: decisionForm.investmentUsdK ? Number(decisionForm.investmentUsdK) : null,
        timelineMonths: decisionForm.timelineMonths ? Number(decisionForm.timelineMonths) : null,
      }),
    });
    setDecisionForm((f) => ({ ...f, rationale: "", investmentUsdK: "", timelineMonths: "" }));
    setShowDecisionForm(false);
    await loadDecisions();
    void loadBoards();
    void loadActivity();
  };

  const selectedBoard = useMemo(() => boards.find(b => b.capabilityId === selectedCapId) ?? null, [boards, selectedCapId]);
  const sortedCaps = useMemo(() => capabilities.filter(c => (c as { isLeaf?: boolean }).isLeaf !== false), [capabilities]);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Strategy</span>
          </div>
          <h1 className="text-3xl font-serif tracking-tight">Team collaboration</h1>
          <p className="text-muted-foreground mt-1">Capability-scoped boards, executive decisions, and a roster of who's in the room. Discussion is grouped by the capability it concerns.</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[260px_minmax(0,1fr)_280px] gap-5">
        {/* ── LEFT: Boards ─────────────────────────────────────────── */}
        <div className="space-y-4 order-2 lg:order-1">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-accent" />
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Boards</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 pb-3">
              {boards.length === 0 ? (
                <p className="text-xs text-muted-foreground italic px-1">No boards yet — start a discussion on any capability below.</p>
              ) : (
                boards.map(b => {
                  const isActive = b.capabilityId === selectedCapId;
                  return (
                    <button
                      key={b.capabilityId}
                      onClick={() => setSelectedCapId(b.capabilityId)}
                      className={`w-full text-left px-2 py-1.5 rounded-sm transition-colors ${
                        isActive ? "bg-accent/10 border border-accent/40" : "hover:bg-muted/40 border border-transparent"
                      }`}
                    >
                      <div className="text-sm font-medium truncate">{b.name}</div>
                      <div className="text-[10px] text-muted-foreground inline-flex items-center gap-2 mt-0.5">
                        <span className="inline-flex items-center gap-0.5"><MessageCircle className="w-2.5 h-2.5" />{b.commentCount}</span>
                        <span className="inline-flex items-center gap-0.5"><Gavel className="w-2.5 h-2.5" />{b.decisionCount}</span>
                        <span>· {new Date(b.lastActivity).toLocaleDateString()}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-accent" />
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Members ({roster.length})</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 pb-3">
              {roster.length === 0 ? (
                <p className="text-xs text-muted-foreground italic px-1">No participants yet.</p>
              ) : (
                roster.slice(0, 10).map((m, idx) => (
                  <div key={`${m.name}-${m.role}-${idx}`} className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-full ${ROLE_COLORS[m.role] ?? "bg-muted"} flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
                      {m.role.slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{m.name}</div>
                      <div className="text-[10px] text-muted-foreground">{m.role}</div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── CENTER: active board ────────────────────────────────── */}
        <div className="space-y-4 order-1 lg:order-2">
          {/* Capability selector — switches the active board */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Capability</span>
            <select
              className="border rounded px-3 py-2 bg-background text-sm flex-1 min-w-[200px] max-w-md"
              value={selectedCapId}
              onChange={(e) => setSelectedCapId(Number(e.target.value))}
            >
              {sortedCaps.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {selectedBoard && (
              <Badge variant="outline" className="text-[10px]">
                <Tag className="w-2.5 h-2.5 mr-1" />
                Board · {selectedBoard.commentCount} comments · {selectedBoard.decisionCount} decisions
              </Badge>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            <Button variant={tab === "comments" ? "default" : "outline"} onClick={() => setTab("comments")}>
              <MessageCircle className="w-4 h-4 mr-2" /> Discussion ({comments.length})
            </Button>
            <Button variant={tab === "decisions" ? "default" : "outline"} onClick={() => setTab("decisions")}>
              <Gavel className="w-4 h-4 mr-2" /> Decisions ({decisions.length})
            </Button>
          </div>

          {tab === "comments" && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><MessageCircle className="w-5 h-5" /> Discussion thread</CardTitle>
                  <Button size="sm" onClick={() => setShowCommentForm(!showCommentForm)}><Plus className="w-4 h-4 mr-1" /> Comment</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {showCommentForm && (
                  <div className="border rounded-none p-3 space-y-2 bg-muted/30">
                    <div className="flex gap-2">
                      <Input placeholder="Your name" value={commentForm.authorName} onChange={(e) => setCommentForm({ ...commentForm, authorName: e.target.value })} className="flex-1" />
                      <select className="border rounded px-2 py-1 bg-background text-sm" value={commentForm.authorRole} onChange={(e) => setCommentForm({ ...commentForm, authorRole: e.target.value })}>
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Input placeholder="Your comment..." value={commentForm.body} onChange={(e) => setCommentForm({ ...commentForm, body: e.target.value })} className="flex-1" onKeyDown={(e) => e.key === "Enter" && addComment()} />
                      <Button onClick={addComment}><Send className="w-4 h-4" /></Button>
                    </div>
                  </div>
                )}

                {comments.length > 0 ? (
                  comments.map((c) => (
                    <div key={c.id} className={`flex gap-3 p-3 rounded-none border ${c.resolved ? "opacity-50" : ""}`}>
                      <div className={`w-8 h-8 rounded-full ${ROLE_COLORS[c.authorRole] ?? "bg-muted"} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                        {c.authorRole.slice(0, 2)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{c.authorName}</span>
                          <Badge variant="outline" className="text-xs">{c.authorRole}</Badge>
                          <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                          {c.resolved && <Badge className="text-xs bg-emerald-500">Resolved</Badge>}
                        </div>
                        <p className="text-sm mt-1">{c.body}</p>
                        <Button size="sm" variant="ghost" className="text-xs mt-1" onClick={() => resolveComment(c.id, !c.resolved)}>
                          {c.resolved ? "Reopen" : <><Check className="w-3 h-3 mr-1" /> Resolve</>}
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm italic text-muted-foreground text-center py-8">No comments yet. Start the discussion on this board.</p>
                )}
              </CardContent>
            </Card>
          )}

          {tab === "decisions" && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Gavel className="w-5 h-5" /> Strategy decisions</CardTitle>
                  <Button size="sm" onClick={() => setShowDecisionForm(!showDecisionForm)}><Plus className="w-4 h-4 mr-1" /> Record decision</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {showDecisionForm && (
                  <div className="border rounded-none p-3 space-y-2 bg-muted/30">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <select className="border rounded px-2 py-1 bg-background text-sm" value={decisionForm.decision} onChange={(e) => setDecisionForm({ ...decisionForm, decision: e.target.value })}>
                        {DECISIONS.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                      </select>
                      <Input placeholder="Decided by" value={decisionForm.decidedBy} onChange={(e) => setDecisionForm({ ...decisionForm, decidedBy: e.target.value })} />
                      <select className="border rounded px-2 py-1 bg-background text-sm" value={decisionForm.decidedByRole} onChange={(e) => setDecisionForm({ ...decisionForm, decidedByRole: e.target.value })}>
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <Input type="number" placeholder="Investment ($K)" value={decisionForm.investmentUsdK} onChange={(e) => setDecisionForm({ ...decisionForm, investmentUsdK: e.target.value })} />
                    </div>
                    <Input placeholder="Rationale..." value={decisionForm.rationale} onChange={(e) => setDecisionForm({ ...decisionForm, rationale: e.target.value })} />
                    <div className="flex gap-2">
                      <Button onClick={addDecision}>Record</Button>
                      <Button variant="outline" onClick={() => setShowDecisionForm(false)}>Cancel</Button>
                    </div>
                  </div>
                )}

                {decisions.length > 0 ? (
                  decisions.map((d) => (
                    <div key={d.id} className="flex items-start gap-3 p-3 rounded-none border">
                      <Badge className={`${DECISION_COLORS[d.decision] ?? "bg-muted"} text-white shrink-0`}>{d.decision.toUpperCase()}</Badge>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {d.capabilityName && <span className="font-medium text-sm">{d.capabilityName}</span>}
                          <span className="text-xs text-muted-foreground">by {d.decidedBy} ({d.decidedByRole})</span>
                          <span className="text-xs text-muted-foreground">· {new Date(d.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-sm mt-1">{d.rationale}</p>
                        <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                          {d.investmentUsdK && <span>Investment: ${d.investmentUsdK}K</span>}
                          {d.timelineMonths && <span>Timeline: {d.timelineMonths} months</span>}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm italic text-muted-foreground text-center py-8">No decisions recorded on this board.</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── RIGHT: Activity rail ───────────────────────────────── */}
        <div className="order-3">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-accent" />
                <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Recent activity</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pb-3 max-h-[800px] overflow-y-auto">
              {activity.length === 0 ? (
                <p className="text-xs text-muted-foreground italic px-1">No team activity yet.</p>
              ) : (
                activity.map((a) => (
                  <div
                    key={`${a.kind}-${a.id}`}
                    className="border-l-2 pl-3 py-1 cursor-pointer hover:bg-muted/20 -mx-3 px-3 rounded-sm transition-colors"
                    style={{ borderColor: a.kind === "decision" ? "var(--accent)" : "rgba(115,115,115,0.4)" }}
                    onClick={() => a.capabilityId && setSelectedCapId(a.capabilityId)}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {a.kind === "decision" ? (
                        <Badge className={`text-[9px] ${DECISION_COLORS[a.decision ?? ""] ?? "bg-muted"} text-white px-1 py-0`}>
                          {(a.decision ?? "").toUpperCase()}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] px-1 py-0">{a.authorRole}</Badge>
                      )}
                      <span className="text-[11px] font-medium">{a.authorName}</span>
                    </div>
                    {a.capabilityName && (
                      <div className="text-[10px] text-accent mt-0.5 inline-flex items-center gap-1">
                        <Tag className="w-2.5 h-2.5" />{a.capabilityName}
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{a.body}</p>
                    <div className="text-[9px] text-muted-foreground mt-0.5">{new Date(a.createdAt).toLocaleString()}</div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
