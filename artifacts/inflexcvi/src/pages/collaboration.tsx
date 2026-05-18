import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, Gavel, Plus, Check, Users, Send } from "lucide-react";

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

export default function Collaboration() {
  const [tab, setTab] = useState<"comments" | "decisions">("comments");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [selectedCapId, setSelectedCapId] = useState<number>(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [commentForm, setCommentForm] = useState({ authorName: "", authorRole: "CTO", body: "" });
  const [decisionForm, setDecisionForm] = useState({ decision: "invest", rationale: "", decidedBy: "", decidedByRole: "CEO", investmentUsdK: "", timelineMonths: "" });
  const sessionToken = localStorage.getItem("ce_session_token") ?? "";

  useEffect(() => {
    fetch(`${API_BASE}/capabilities`).then((r) => r.json()).then((caps) => {
      setCapabilities(caps);
      if (caps.length) setSelectedCapId(caps[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedCapId) return;
    loadComments();
    loadDecisions();
  }, [selectedCapId]);

  const loadComments = async () => {
    if (!selectedCapId) return;
    try {
      const res = await fetch(`${API_BASE}/collaboration/comments?targetType=capability&targetId=${selectedCapId}`);
      setComments(await res.json());
    } catch (err) { console.error(err); }
  };

  const loadDecisions = async () => {
    try {
      const url = selectedCapId
        ? `${API_BASE}/collaboration/decisions?capabilityId=${selectedCapId}`
        : `${API_BASE}/collaboration/decisions?sessionToken=${sessionToken}`;
      const res = await fetch(url);
      setDecisions(await res.json());
    } catch (err) { console.error(err); }
  };

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
  };

  const resolveComment = async (id: number, resolved: boolean) => {
    await fetch(`${API_BASE}/collaboration/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    await loadComments();
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
  };

  const ROLE_COLORS: Record<string, string> = {
    CEO: "bg-purple-500", CFO: "bg-emerald-500", CTO: "bg-blue-500", CIO: "bg-cyan-500",
    COO: "bg-amber-500", CMO: "bg-pink-500", CHRO: "bg-orange-500", CPO: "bg-indigo-500",
  };

  const DECISION_COLORS: Record<string, string> = {
    invest: "bg-emerald-500", hold: "bg-amber-500", divest: "bg-destructive", pivot: "bg-blue-500", kill: "bg-destructive",
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <Badge className="mb-2">Strategy</Badge>
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="h-px w-5 bg-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Strategy</span>
          </div>
          <h1 className="text-3xl font-serif tracking-tight">Strategy Decisions</h1>
          <p className="text-muted-foreground mt-1">Record executive invest / hold / divest decisions on capabilities, with rationale and discussion threads.</p>
        </div>
      </div>

      {/* Capability Selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Capability:</span>
        <select className="border rounded px-3 py-2 bg-background text-sm flex-1 max-w-md" value={selectedCapId} onChange={(e) => setSelectedCapId(Number(e.target.value))}>
          {capabilities.filter((c) => (c as any).isLeaf !== false).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
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
              <CardTitle className="flex items-center gap-2"><MessageCircle className="w-5 h-5" /> Discussion Thread</CardTitle>
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
              <p className="text-center text-muted-foreground py-8">No comments yet. Start the discussion!</p>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "decisions" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Gavel className="w-5 h-5" /> Strategy Decisions</CardTitle>
              <Button size="sm" onClick={() => setShowDecisionForm(!showDecisionForm)}><Plus className="w-4 h-4 mr-1" /> Record Decision</Button>
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
                      <span className="text-xs text-muted-foreground">• {new Date(d.createdAt).toLocaleDateString()}</span>
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
              <p className="text-center text-muted-foreground py-8">No decisions recorded. Use this to log strategic capability decisions.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
