import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle, Bitcoin, Building2, CheckCircle2, Clock, CreditCard, FileText, Loader2,
  RefreshCw, ShieldCheck, User, XCircle,
} from "lucide-react";

const API_BASE = "/api";

type Tier = {
  id: number;
  name: string;
  slug: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
};

export type Payment = {
  id: number;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  tierId: number;
  entityType: "company" | "individual";
  entityName: string;
  entityIndustry: string | null;
  entitySize: string | null;
  entityRole: string | null;
  paymentMethod: "card" | "invoice" | "crypto";
  paymentStatus: string;
  paymentRef: string | null;
  paymentAmountCents: number | null;
  status: "pending" | "active" | "rejected" | "cancelled";
  notes: string | null;
  rejectionReason: string | null;
  requestedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  tier: Tier | null;
};

export type PaymentSummary = {
  total: number;
  byStatus: Record<string, number>;
  byPayment: Record<string, number>;
  pendingRevenueCents: number;
  activeRevenueCents: number;
};

const fmtMoney = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : "—";

const PaymentMethodIcon = ({ method }: { method: Payment["paymentMethod"] }) => {
  if (method === "card") return <CreditCard className="w-4 h-4 text-emerald-600" />;
  if (method === "invoice") return <FileText className="w-4 h-4 text-amber-600" />;
  return <Bitcoin className="w-4 h-4 text-orange-600" />;
};

const methodLabel = (m: Payment["paymentMethod"]) =>
  m === "card" ? "Credit Card" : m === "invoice" ? "Invoice" : "Crypto";

function SummaryStat({
  label, value, icon: Icon, color,
}: { label: string; value: number | string; icon: React.ComponentType<{ className?: string }>; color: string }) {
  return (
    <Card className="rounded-none">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Icon className={`w-3.5 h-3.5 ${color}`} />
          {label}
        </div>
        <div className="text-2xl font-serif mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

export function usePaymentApprovalsData() {
  const [tab, setTab] = useState<"pending" | "active" | "rejected" | "all">("pending");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/admin/payments?status=${tab}`, { credentials: "include" }),
        fetch(`${API_BASE}/admin/payments/summary`, { credentials: "include" }),
      ]);
      if (!pRes.ok) throw new Error(`Payments: ${pRes.status}`);
      if (!sRes.ok) throw new Error(`Summary: ${sRes.status}`);
      const pJson = await pRes.json();
      const sJson = await sRes.json();
      setPayments(pJson.payments ?? []);
      setSummary(sJson);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  return { tab, setTab, payments, summary, loading, error, refetch: fetchAll };
}

type Props = {
  showHeader?: boolean;
  /** Called after any successful approve/reject/comp so the parent can refetch other views */
  onChange?: () => void;
};

export default function PaymentApprovals({ showHeader = true, onChange }: Props) {
  const { tab, setTab, payments, summary, loading, error, refetch } = usePaymentApprovalsData();
  const [actioning, setActioning] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Payment | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const approve = async (id: number) => {
    setActioning(id);
    try {
      const res = await fetch(`${API_BASE}/admin/payments/${id}/approve`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      await refetch();
      onChange?.();
    } catch (e) {
      alert(`Approve failed: ${(e as Error).message}`);
    } finally {
      setActioning(null);
    }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    setActioning(rejectTarget.id);
    try {
      const res = await fetch(`${API_BASE}/admin/payments/${rejectTarget.id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason || "No reason provided" }),
      });
      if (!res.ok) throw new Error(await res.text());
      setRejectTarget(null);
      setRejectReason("");
      await refetch();
      onChange?.();
    } catch (e) {
      alert(`Reject failed: ${(e as Error).message}`);
    } finally {
      setActioning(null);
    }
  };

  return (
    <div>
      {showHeader && (
        <header className="mb-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
            <h2 className="font-serif text-2xl flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-primary" />
              Payment Approvals
            </h2>
            <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            Review pending invoice and crypto requests. Card payments auto-approve when Stripe confirms. Crypto will auto-approve via NOWPayments when the webhook fires.
          </p>
        </header>
      )}

      {error && (
        <div className="mb-4 p-3 border-l-4 border-red-500 bg-red-50 dark:bg-red-950/30 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <SummaryStat label="Pending" value={summary.byStatus.pending ?? 0} icon={Clock} color="text-amber-600" />
          <SummaryStat label="Active" value={summary.byStatus.active ?? 0} icon={CheckCircle2} color="text-emerald-600" />
          <SummaryStat label="Rejected" value={summary.byStatus.rejected ?? 0} icon={XCircle} color="text-red-600" />
          <SummaryStat label="Pending Rev" value={fmtMoney(summary.pendingRevenueCents)} icon={Clock} color="text-amber-600" />
          <SummaryStat label="Booked Rev" value={fmtMoney(summary.activeRevenueCents)} icon={CheckCircle2} color="text-emerald-600" />
        </div>
      )}

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList className="rounded-none">
          <TabsTrigger value="pending" className="rounded-none">
            Pending {summary?.byStatus.pending ? <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 text-xs">{summary.byStatus.pending}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="active" className="rounded-none">Active</TabsTrigger>
          <TabsTrigger value="rejected" className="rounded-none">Rejected</TabsTrigger>
          <TabsTrigger value="all" className="rounded-none">All</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card className="rounded-none">
            <CardHeader>
              <CardTitle className="text-base font-serif">
                {tab === "pending" ? "Awaiting Verification" : tab === "active" ? "Active Memberships" : tab === "rejected" ? "Rejected Requests" : "All Requests"}
              </CardTitle>
              <CardDescription>
                {tab === "pending"
                  ? "Invoice and crypto requests need manual approval before access is granted."
                  : `${payments.length} record${payments.length === 1 ? "" : "s"}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground text-sm">
                  No {tab === "all" ? "" : tab + " "}requests.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2.5">Requester</th>
                        <th className="px-4 py-2.5">Entity</th>
                        <th className="px-4 py-2.5">Tier</th>
                        <th className="px-4 py-2.5">Method</th>
                        <th className="px-4 py-2.5">Reference</th>
                        <th className="px-4 py-2.5 text-right">Amount</th>
                        <th className="px-4 py-2.5">Submitted</th>
                        <th className="px-4 py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map(p => (
                        <tr key={p.id} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium">{p.userName ?? p.userEmail ?? p.userId.slice(0, 12)}</div>
                            {p.userEmail && p.userName && (
                              <div className="text-xs text-muted-foreground">{p.userEmail}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {p.entityType === "company"
                                ? <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                                : <User className="w-3.5 h-3.5 text-muted-foreground" />}
                              <span>{p.entityName}</span>
                            </div>
                            {p.entityIndustry && (
                              <div className="text-xs text-muted-foreground">{p.entityIndustry}{p.entitySize ? ` · ${p.entitySize}` : ""}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">{p.tier?.name ?? `#${p.tierId}`}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <PaymentMethodIcon method={p.paymentMethod} />
                              <span>{methodLabel(p.paymentMethod)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{p.paymentRef ?? "—"}</td>
                          <td className="px-4 py-3 text-right font-mono">{fmtMoney(p.paymentAmountCents)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(p.requestedAt)}</td>
                          <td className="px-4 py-3 text-right">
                            {p.status === "pending" ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 rounded-none border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                  onClick={() => approve(p.id)}
                                  disabled={actioning === p.id}
                                >
                                  {actioning === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                  <span className="ml-1">Approve</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 rounded-none border-red-300 text-red-700 hover:bg-red-50"
                                  onClick={() => { setRejectTarget(p); setRejectReason(""); }}
                                  disabled={actioning === p.id}
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span className="ml-1">Reject</span>
                                </Button>
                              </div>
                            ) : p.status === "active" ? (
                              <div className="flex items-center justify-end gap-1 text-xs text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Approved {p.approvedBy ? `by ${p.approvedBy}` : ""}</span>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1 text-xs text-red-700" title={p.rejectionReason ?? ""}>
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Rejected</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!rejectTarget} onOpenChange={open => { if (!open) setRejectTarget(null); }}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle>Reject membership request?</DialogTitle>
            <DialogDescription>
              {rejectTarget && (
                <>
                  This will deny <strong>{rejectTarget.userName ?? rejectTarget.userEmail ?? rejectTarget.userId}</strong>'s
                  request for <strong>{rejectTarget.tier?.name}</strong> via <strong>{methodLabel(rejectTarget.paymentMethod)}</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Reason (shown to user)"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            className="rounded-none"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} className="rounded-none">Cancel</Button>
            <Button variant="destructive" onClick={reject} disabled={actioning === rejectTarget?.id} className="rounded-none">
              {actioning === rejectTarget?.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
