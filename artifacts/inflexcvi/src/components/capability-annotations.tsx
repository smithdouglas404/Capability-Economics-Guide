import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageSquare,
  AlertOctagon,
  FlagTriangleRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  Send,
  CornerDownRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useUser, useAuth } from "@clerk/react";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { SyntheticAgentBadge, isSyntheticAgent, personaDisplayForClerkId } from "@/components/synthetic-agent-badge";

const API_BASE = "/api";
const EDIT_WINDOW_MS = 10 * 60 * 1000;

type Kind = "note" | "dispute" | "source_flag";
type Status = "open" | "resolved" | "dismissed";

interface Annotation {
  id: number;
  capabilityId: number;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  kind: Kind;
  body: string;
  targetSourceTriangulationId: number | null;
  parentAnnotationId: number | null;
  status: Status;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AnnotationsResp {
  capabilityId: number;
  annotations: Annotation[];
  summary: {
    total: number;
    openDisputes: number;
    openSourceFlags: number;
    notes: number;
  };
}

const KIND_LABEL: Record<Kind, string> = {
  note: "Note",
  dispute: "Dispute",
  source_flag: "Source flag",
};

const KIND_ICON: Record<Kind, typeof MessageSquare> = {
  note: MessageSquare,
  dispute: AlertOctagon,
  source_flag: FlagTriangleRight,
};

const KIND_TONE: Record<Kind, string> = {
  note: "bg-muted/50 text-foreground border-border/60",
  dispute: "bg-rose-500/15 text-rose-500 border-rose-500/40",
  source_flag: "bg-amber-500/15 text-amber-500 border-amber-500/40",
};

const STATUS_TONE: Record<Status, string> = {
  open: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  resolved: "bg-sky-500/15 text-sky-500 border-sky-500/40",
  dismissed: "bg-muted text-muted-foreground border-border/60",
};

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.round((now - d) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

interface Props {
  capabilityId: number;
  /** Optional: when provided, the "Source flag" tab is preselected and the flag is linked to this triangulation row. */
  targetSourceTriangulationId?: number | null;
  className?: string;
}

export function CapabilityAnnotations({ capabilityId, targetSourceTriangulationId, className }: Props) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { isAdmin } = useIsAdmin();
  const [data, setData] = useState<AnnotationsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Kind>(targetSourceTriangulationId ? "source_flag" : "note");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const authedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const token = await getToken();
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
    });
  }, [getToken]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const resp = await authedFetch(`${API_BASE}/capabilities/${capabilityId}/annotations`);
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${resp.status}`);
      }
      setData(await resp.json() as AnnotationsResp);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load annotations");
    } finally {
      setLoading(false);
    }
  }, [authedFetch, capabilityId]);

  useEffect(() => {
    load();
  }, [load]);

  const roots = useMemo(() => {
    if (!data) return [] as Annotation[];
    return data.annotations.filter(a => !a.parentAnnotationId && !a.deletedAt);
  }, [data]);

  const repliesByParent = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    if (!data) return m;
    for (const a of data.annotations) {
      if (a.parentAnnotationId && !a.deletedAt) {
        const list = m.get(a.parentAnnotationId) ?? [];
        list.push(a);
        m.set(a.parentAnnotationId, list);
      }
    }
    for (const list of m.values()) list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return m;
  }, [data]);

  async function submitRoot() {
    if (!body.trim() || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      const resp = await authedFetch(`${API_BASE}/capabilities/${capabilityId}/annotations`, {
        method: "POST",
        body: JSON.stringify({
          kind: tab,
          body: body.trim(),
          targetSourceTriangulationId: tab === "source_flag" ? targetSourceTriangulationId ?? null : null,
        }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${resp.status}`);
      }
      setBody("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to post");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply(parentId: number) {
    if (!replyBody.trim() || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      const resp = await authedFetch(`${API_BASE}/capabilities/${capabilityId}/annotations`, {
        method: "POST",
        body: JSON.stringify({
          kind: "note",
          body: replyBody.trim(),
          parentAnnotationId: parentId,
        }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${resp.status}`);
      }
      setReplyBody("");
      setReplyingTo(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to reply");
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveAnnotation(id: number, status: "resolved" | "dismissed") {
    setSubmitting(true);
    setErr(null);
    try {
      const resp = await authedFetch(`${API_BASE}/capabilities/${capabilityId}/annotations/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${resp.status}`);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteAnnotation(id: number) {
    if (!confirm("Delete this annotation? Authors and admins can delete; the audit log preserves a record.")) return;
    setSubmitting(true);
    setErr(null);
    try {
      const resp = await authedFetch(`${API_BASE}/capabilities/${capabilityId}/annotations/${id}`, {
        method: "DELETE",
      });
      if (!resp.ok && resp.status !== 204) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${resp.status}`);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setSubmitting(false);
    }
  }

  function canEdit(a: Annotation): boolean {
    return !!user && a.userId === user.id && Date.now() - new Date(a.createdAt).getTime() < EDIT_WINDOW_MS;
  }
  function canDelete(a: Annotation): boolean {
    return !!user && (a.userId === user.id || isAdmin);
  }

  return (
    <Card className={`rounded-none border-border/60 ${className ?? ""}`}>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-serif text-lg tracking-tight">Analyst notes</h3>
            {data && (
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground ml-2">
                {data.summary.total} total · {data.summary.openDisputes} open disputes · {data.summary.openSourceFlags} flags
              </span>
            )}
          </div>
        </div>

        {!user ? (
          <p className="text-sm text-muted-foreground">Sign in to leave a note or dispute this score.</p>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)}>
            <TabsList className="rounded-none">
              <TabsTrigger value="note" className="rounded-none font-mono text-[11px] uppercase tracking-[0.18em]">
                Note
              </TabsTrigger>
              <TabsTrigger value="dispute" className="rounded-none font-mono text-[11px] uppercase tracking-[0.18em]">
                Dispute score
              </TabsTrigger>
              <TabsTrigger value="source_flag" className="rounded-none font-mono text-[11px] uppercase tracking-[0.18em]">
                Flag source
              </TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="mt-3 space-y-2">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={
                  tab === "dispute"
                    ? "Why do you think this CVI score is wrong? Cite evidence or reasoning."
                    : tab === "source_flag"
                      ? "Which source is unreliable / outdated / methodologically flawed?"
                      : "Add a note — context, caveats, internal annotation."
                }
                rows={3}
                maxLength={4000}
                className="rounded-none font-sans text-sm"
              />
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {body.length} / 4000
                </span>
                <Button
                  size="sm"
                  variant="default"
                  onClick={submitRoot}
                  disabled={!body.trim() || submitting}
                  className="rounded-none font-mono text-[11px] uppercase tracking-[0.18em]"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
                  Post {KIND_LABEL[tab]}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {err && (
          <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-3 py-2 text-sm font-mono">
            {err}
          </div>
        )}

        {loading && !data && (
          <div className="text-sm text-muted-foreground py-4 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading annotations…
          </div>
        )}

        {data && roots.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground py-2">No annotations yet. Be the first to add one.</p>
        )}

        <div className="space-y-3">
          {roots.map(a => {
            const Icon = KIND_ICON[a.kind];
            const replies = repliesByParent.get(a.id) ?? [];
            return (
              <div key={a.id} className="border border-border/40 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Icon className="w-3.5 h-3.5 mt-0.5 text-muted-foreground" />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-[0.12em] ${KIND_TONE[a.kind]}`}>
                        {KIND_LABEL[a.kind]}
                      </Badge>
                      <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-[0.12em] ${STATUS_TONE[a.status]}`}>
                        {a.status}
                      </Badge>
                      <span className="text-sm font-medium truncate">{a.userDisplayName ?? a.userEmail ?? a.userId.slice(0, 12)}</span>
                      {isSyntheticAgent(a.userId) && (
                        <SyntheticAgentBadge personaDisplay={personaDisplayForClerkId(a.userId)} size="sm" />
                      )}
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {relativeTime(a.createdAt)}
                      </span>
                      {a.targetSourceTriangulationId && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          → source #{a.targetSourceTriangulationId}
                        </span>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">{a.body}</p>
                    {a.status !== "open" && a.resolutionNote && (
                      <p className="text-sm text-muted-foreground italic">
                        Resolution: {a.resolutionNote}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setReplyingTo(replyingTo === a.id ? null : a.id); setReplyBody(""); }}
                        className="rounded-none font-mono text-[10px] uppercase tracking-[0.18em] h-7 px-2"
                      >
                        <CornerDownRight className="w-3 h-3 mr-1" />
                        Reply
                      </Button>
                      {isAdmin && a.status === "open" && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => resolveAnnotation(a.id, "resolved")}
                            disabled={submitting}
                            className="rounded-none font-mono text-[10px] uppercase tracking-[0.18em] h-7 px-2 text-sky-500"
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Resolve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => resolveAnnotation(a.id, "dismissed")}
                            disabled={submitting}
                            className="rounded-none font-mono text-[10px] uppercase tracking-[0.18em] h-7 px-2 text-muted-foreground"
                          >
                            <XCircle className="w-3 h-3 mr-1" />
                            Dismiss
                          </Button>
                        </>
                      )}
                      {canDelete(a) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteAnnotation(a.id)}
                          disabled={submitting}
                          className="rounded-none font-mono text-[10px] uppercase tracking-[0.18em] h-7 px-2 text-rose-500"
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Delete
                        </Button>
                      )}
                      {canEdit(a) && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          Edit window {Math.max(0, Math.round((EDIT_WINDOW_MS - (Date.now() - new Date(a.createdAt).getTime())) / 60000))}m
                        </span>
                      )}
                    </div>

                    {replies.length > 0 && (
                      <div className="border-l-2 border-border/40 pl-3 mt-2 space-y-2">
                        {replies.map(r => (
                          <div key={r.id} className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{r.userDisplayName ?? r.userEmail ?? r.userId.slice(0, 12)}</span>
                              {isSyntheticAgent(r.userId) && (
                                <SyntheticAgentBadge personaDisplay={personaDisplayForClerkId(r.userId)} size="sm" />
                              )}
                              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                {relativeTime(r.createdAt)}
                              </span>
                              {canDelete(r) && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => deleteAnnotation(r.id)}
                                  disabled={submitting}
                                  className="rounded-none font-mono text-[10px] uppercase tracking-[0.18em] h-6 px-2 text-rose-500"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                            <p className="text-sm whitespace-pre-wrap break-words">{r.body}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {replyingTo === a.id && (
                      <div className="space-y-2 pt-2">
                        <Textarea
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          placeholder="Reply…"
                          rows={2}
                          maxLength={4000}
                          className="rounded-none font-sans text-sm"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setReplyingTo(null); setReplyBody(""); }}
                            className="rounded-none font-mono text-[10px] uppercase tracking-[0.18em] h-7 px-2"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => submitReply(a.id)}
                            disabled={!replyBody.trim() || submitting}
                            className="rounded-none font-mono text-[10px] uppercase tracking-[0.18em] h-7 px-2"
                          >
                            {submitting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Send className="w-3 h-3 mr-1" />}
                            Reply
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
