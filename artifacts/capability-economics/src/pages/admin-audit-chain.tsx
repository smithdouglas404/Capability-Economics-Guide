import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ExternalLink, RefreshCw, ShieldCheck, Loader2, CircleAlert, CircleSlash } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Audit Chain Explorer — admin-only view of every event that has been
 * (or attempted to be) anchored to Hedera. Each row carries the canonical
 * hash, anchor receipt, and a Verify link to HashScan.
 */

interface AuditEvent {
  id: number;
  eventType: string;
  relatedEntity: string | null;
  contextHash: string;
  contextSnapshot: Record<string, unknown>;
  anchorProvider: string | null;
  anchorTopicOrContractId: string | null;
  anchorSequenceNumber: number | null;
  anchorTxId: string | null;
  anchorConsensusTimestamp: string | null;
  anchorStatus: "pending" | "anchored" | "failed" | "skipped";
  anchorError: string | null;
  createdAt: string;
  anchoredAt: string | null;
  hashScanUrl: string | null;
}

interface ChainStatus {
  configured: boolean;
  provider: string;
  network: string;
  topicId: string | null;
}

const ADMIN_KEY_STORAGE = "ce.admin-key";

function adminHeaders(): Record<string, string> {
  try {
    const k = localStorage.getItem(ADMIN_KEY_STORAGE);
    return k ? { "X-Admin-Key": k, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  } catch {
    return { "Content-Type": "application/json" };
  }
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  admin_key_rotated: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  kyc_verification: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  marketplace_purchase: "bg-violet-500/15 text-violet-600 border-violet-500/30",
  security_violation: "bg-rose-500/15 text-rose-600 border-rose-500/30",
};

const STATUS_COLORS: Record<AuditEvent["anchorStatus"], string> = {
  anchored: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  pending: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  failed: "bg-rose-500/15 text-rose-600 border-rose-500/30",
  skipped: "bg-muted text-muted-foreground border-border/40",
};

export default function AdminAuditChainPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (filterType) qs.set("eventType", filterType);
      if (filterStatus) qs.set("status", filterStatus);
      qs.set("limit", "200");
      const res = await fetch(`/api/admin/audit-chain?${qs.toString()}`, { headers: adminHeaders() });
      if (res.status === 401) {
        setError("Admin key required — paste it at /admin/case-studies first.");
        setEvents([]);
        return;
      }
      if (!res.ok) { setError(`Load failed: HTTP ${res.status}`); setEvents([]); return; }
      const data = await res.json() as { chain: ChainStatus; events: AuditEvent[] };
      setChain(data.chain);
      setEvents(data.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterType, filterStatus]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6">
        <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" /> Admin home
        </Link>
        <h1 className="font-serif text-3xl tracking-tight flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-emerald-600" />
          Audit Chain Explorer
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl leading-relaxed">
          Every audit event flows here. Each row is anchored to Hedera Consensus Service (HCS) with a sequence number and consensus timestamp — verifiable independently on{" "}
          <a href="https://hashscan.io" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">HashScan</a>. No sensitive payloads are stored on chain; only sha256 hashes + minimal non-sensitive metadata.
        </p>
      </div>

      {/* Chain status banner */}
      {chain && (
        <Card className={`rounded-none mb-4 ${chain.configured ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/10"}`}>
          <CardContent className="p-4 flex items-center gap-3 text-sm">
            {chain.configured ? (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <strong>Hedera {chain.network}</strong> — audit chain is live on topic{" "}
                  <code className="font-mono text-xs">{chain.topicId}</code>.{" "}
                  <a
                    href={`https://hashscan.io/${chain.network}/topic/${chain.topicId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground inline-flex items-center gap-1"
                  >
                    Open in HashScan <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </>
            ) : (
              <>
                <CircleSlash className="w-4 h-4 text-amber-600 shrink-0" />
                <div>
                  Hedera not configured — events are recorded in Postgres with <strong>skipped</strong> status. Set <code className="font-mono text-xs">HEDERA_OPERATOR_ID</code>, <code className="font-mono text-xs">HEDERA_OPERATOR_KEY</code>, and <code className="font-mono text-xs">HEDERA_AUDIT_TOPIC_ID</code> on the api-server to start anchoring.
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Event:</span>
        {["", "admin_key_rotated", "kyc_verification", "marketplace_purchase", "security_violation"].map(t => (
          <Button
            key={t || "all"}
            size="sm"
            variant={filterType === t ? "default" : "outline"}
            className="rounded-none text-[11px] h-7"
            onClick={() => setFilterType(t)}
          >
            {t || "All"}
          </Button>
        ))}
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground ml-3">Status:</span>
        {["", "anchored", "pending", "failed", "skipped"].map(s => (
          <Button
            key={s || "all"}
            size="sm"
            variant={filterStatus === s ? "default" : "outline"}
            className="rounded-none text-[11px] h-7"
            onClick={() => setFilterStatus(s)}
          >
            {s || "All"}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="rounded-none text-[11px] h-7 ml-auto" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-4 border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2 rounded-none flex items-center gap-2">
          <CircleAlert className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <Card className="rounded-none border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Events ({events?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {events === null ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          ) : events.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No audit events match the current filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b border-border/40">
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Hash</th>
                    <th className="px-3 py-2">Seq #</th>
                    <th className="px-3 py-2">Verify</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <>
                      <tr
                        key={ev.id}
                        className="border-b border-border/40 hover:bg-muted/20 cursor-pointer"
                        onClick={() => setExpandedId(prev => prev === ev.id ? null : ev.id)}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{new Date(ev.createdAt).toISOString().replace("T", " ").slice(0, 19)}Z</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${EVENT_TYPE_COLORS[ev.eventType] ?? ""}`}>
                            {ev.eventType}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${STATUS_COLORS[ev.anchorStatus]}`}>
                            {ev.anchorStatus}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground" title={ev.contextHash}>
                          {ev.contextHash.slice(0, 12)}…
                        </td>
                        <td className="px-3 py-2 font-mono text-xs tabular-nums">{ev.anchorSequenceNumber ?? "—"}</td>
                        <td className="px-3 py-2">
                          {ev.hashScanUrl ? (
                            <a
                              href={ev.hashScanUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              HashScan <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                      {expandedId === ev.id && (
                        <tr className="border-b border-border/40 bg-muted/10">
                          <td colSpan={6} className="px-3 py-3">
                            <div className="grid lg:grid-cols-2 gap-4 text-xs">
                              <div>
                                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Context snapshot (anchored on chain)</div>
                                <pre className="bg-background border border-border/40 p-2 overflow-x-auto font-mono text-[11px] leading-relaxed">
{JSON.stringify(ev.contextSnapshot, null, 2)}
                                </pre>
                              </div>
                              <div className="space-y-2">
                                <div>
                                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Sha256 hash</div>
                                  <div className="font-mono text-[11px] break-all">{ev.contextHash}</div>
                                </div>
                                {ev.relatedEntity && (
                                  <div>
                                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Related entity</div>
                                    <div className="font-mono text-[11px]">{ev.relatedEntity}</div>
                                  </div>
                                )}
                                {ev.anchorTxId && (
                                  <div>
                                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Hedera tx id</div>
                                    <div className="font-mono text-[11px] break-all">{ev.anchorTxId}</div>
                                  </div>
                                )}
                                {ev.anchorConsensusTimestamp && (
                                  <div>
                                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Consensus timestamp</div>
                                    <div className="font-mono text-[11px]">{ev.anchorConsensusTimestamp}</div>
                                  </div>
                                )}
                                {ev.anchorError && (
                                  <div>
                                    <div className="font-mono text-[10px] uppercase tracking-wider text-rose-600 mb-0.5">Anchor error</div>
                                    <div className="font-mono text-[11px] text-rose-600">{ev.anchorError}</div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 text-xs text-muted-foreground space-y-1 max-w-3xl">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">How verification works</div>
        <p>
          The hash column is a sha256 of the canonical payload. Click <strong>HashScan</strong> on any anchored row to open the Hedera message — you'll see the same hash + the consensus timestamp, signed by the Hedera network. Reproduce the hash locally to prove the payload existed at that exact moment without ever sharing the original data on chain.
        </p>
      </div>
    </div>
  );
}
