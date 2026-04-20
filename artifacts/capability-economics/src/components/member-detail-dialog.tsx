import { useCallback, useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowUpRight, ArrowDownRight, Bitcoin, Building2, CheckCircle2, Coins, Copy, CreditCard,
  Download, FileText, Key, KeyRound, Loader2, LogIn, Mail, PauseCircle, PlayCircle,
  RotateCcw, ShieldCheck, Sparkles, Trash2, User, XCircle, IdCard,
} from "lucide-react";

const API_BASE = "/api";

type Tier = {
  id: number;
  slug: string;
  name: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
};

type Membership = {
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

type CreditAccount = {
  userId: string;
  balance: number;
  monthlyAllocation: number;
  tierSlug: string;
  lastTopUpAt: string;
};

type CreditTransaction = {
  id: number;
  userId: string;
  amount: number;
  type: string;
  description: string;
  operationEndpoint: string | null;
  balanceAfter: number;
  createdAt: string;
};

type MemberSummary = {
  userId: string;
  currentMembership: Membership | null;
  allMemberships: Membership[];
  creditAccount: CreditAccount | null;
  transactions: CreditTransaction[];
};

type ApiKey = {
  id: number;
  userId: string;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: string | null;
};

const fmtMoney = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

const PaymentMethodIcon = ({ method }: { method: Membership["paymentMethod"] }) => {
  if (method === "card") return <CreditCard className="w-4 h-4 text-emerald-600" />;
  if (method === "invoice") return <FileText className="w-4 h-4 text-amber-600" />;
  return <Bitcoin className="w-4 h-4 text-orange-600" />;
};
const methodLabel = (m: Membership["paymentMethod"]) =>
  m === "card" ? "Credit Card" : m === "invoice" ? "Invoice" : "Crypto";

function StatusPill({ status }: { status: Membership["status"] }) {
  const map: Record<Membership["status"], { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }> = {
    active: { label: "Active", className: "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20", Icon: CheckCircle2 },
    pending: { label: "Pending", className: "bg-amber-500/10 text-amber-700 border border-amber-500/20", Icon: PauseCircle },
    rejected: { label: "Rejected", className: "bg-red-500/10 text-red-700 border border-red-500/20", Icon: XCircle },
    cancelled: { label: "On Hold", className: "bg-slate-500/10 text-slate-700 border border-slate-500/20", Icon: PauseCircle },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${s.className}`}>
      <s.Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

type Props = {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutated?: () => void;
};

export default function MemberDetailDialog({ userId, open, onOpenChange, onMutated }: Props) {
  const [summary, setSummary] = useState<MemberSummary | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);

  // Change-tier form
  const [changeTierId, setChangeTierId] = useState<string>("");

  // Grant credits form
  const [grantAmount, setGrantAmount] = useState<string>("");
  const [grantDescription, setGrantDescription] = useState<string>("");

  // Hold reason
  const [holdReason, setHoldReason] = useState<string>("");

  // Refund form
  const [refundAmount, setRefundAmount] = useState<string>("");

  // API keys
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyLabel, setNewKeyLabel] = useState<string>("");
  const [lastIssuedKey, setLastIssuedKey] = useState<{ raw: string; label: string } | null>(null);

  const fetchSummary = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [sRes, tRes, kRes] = await Promise.all([
        fetch(`${API_BASE}/admin/members/${encodeURIComponent(userId)}`, { credentials: "include" }),
        fetch(`${API_BASE}/membership/tiers/all`, { credentials: "include" }),
        fetch(`${API_BASE}/admin/api-keys?userId=${encodeURIComponent(userId)}`, { credentials: "include" }),
      ]);
      if (!sRes.ok) throw new Error(`Summary: ${sRes.status}`);
      setSummary(await sRes.json());
      if (tRes.ok) setTiers(await tRes.json());
      if (kRes.ok) {
        const kJson = await kRes.json();
        setApiKeys(kJson.keys ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open && userId) {
      void fetchSummary();
      setChangeTierId("");
      setGrantAmount("");
      setGrantDescription("");
      setHoldReason("");
      setRefundAmount("");
      setNewKeyLabel("");
      setLastIssuedKey(null);
    }
  }, [open, userId, fetchSummary]);

  const current = summary?.currentMembership ?? null;

  const action = async (key: string, run: () => Promise<Response>) => {
    setActioning(key);
    try {
      const res = await run();
      if (!res.ok) throw new Error(await res.text());
      await fetchSummary();
      onMutated?.();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActioning(null);
    }
  };

  const changeTier = () => {
    if (!current || !changeTierId) return;
    return action("change-tier", () =>
      fetch(`${API_BASE}/admin/memberships/${current.id}/change-tier`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierId: Number(changeTierId), syncCredits: true }),
      }),
    );
  };

  const hold = () => {
    if (!current) return;
    return action("hold", () =>
      fetch(`${API_BASE}/admin/memberships/${current.id}/hold`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: holdReason || undefined }),
      }),
    );
  };

  const reactivate = () => {
    if (!current) return;
    return action("reactivate", () =>
      fetch(`${API_BASE}/admin/memberships/${current.id}/reactivate`, {
        method: "POST",
        credentials: "include",
      }),
    );
  };

  const grantCredits = () => {
    if (!userId || !grantAmount) return;
    const amount = Number(grantAmount);
    if (!Number.isFinite(amount) || amount === 0) return;
    return action("grant-credits", () =>
      fetch(`${API_BASE}/admin/members/${encodeURIComponent(userId)}/credits/grant`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, description: grantDescription || "Admin grant" }),
      }),
    ).then(() => { setGrantAmount(""); setGrantDescription(""); });
  };

  const refund = () => {
    if (!current) return;
    const amountCents = refundAmount ? Math.round(Number(refundAmount) * 100) : undefined;
    if (refundAmount && (!Number.isFinite(amountCents) || amountCents! <= 0)) return;
    if (!confirm(`Refund ${refundAmount ? `$${refundAmount}` : "the full amount"} via Stripe?`)) return;
    return action("refund", () =>
      fetch(`${API_BASE}/admin/memberships/${current.id}/refund`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(amountCents ? { amountCents } : {}),
      }),
    ).then(() => setRefundAmount(""));
  };

  const impersonate = async () => {
    if (!userId) return;
    setActioning("impersonate");
    try {
      const res = await fetch(`${API_BASE}/admin/members/${encodeURIComponent(userId)}/impersonate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { url: string | null; token: string };
      if (json.url) window.open(json.url, "_blank", "noopener");
      else alert(`Actor token issued: ${json.token}. Paste it into Clerk sign-in as __clerk_ticket param within 60 seconds.`);
    } catch (e) {
      alert(`Impersonation failed: ${(e as Error).message}`);
    } finally {
      setActioning(null);
    }
  };

  const issueApiKey = async () => {
    if (!userId || !newKeyLabel.trim()) return;
    setActioning("issue-key");
    try {
      const res = await fetch(`${API_BASE}/admin/api-keys`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, label: newKeyLabel.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { raw: string; label: string };
      setLastIssuedKey({ raw: json.raw, label: json.label });
      setNewKeyLabel("");
      await fetchSummary();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActioning(null);
    }
  };

  const revokeApiKey = async (id: number) => {
    if (!confirm("Revoke this API key? The holder will lose access immediately.")) return;
    setActioning(`revoke-${id}`);
    try {
      const res = await fetch(`${API_BASE}/admin/api-keys/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchSummary();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setActioning(null);
    }
  };

  const copyKey = (raw: string) => {
    void navigator.clipboard.writeText(raw);
  };

  const displayName = current?.userName ?? current?.userEmail ?? userId ?? "—";
  const displayEmail = current?.userEmail;
  const entity = current ? `${current.entityType === "company" ? "🏢" : "👤"} ${current.entityName}` : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <User className="w-5 h-5 text-primary" />
            {displayName}
            {current && <StatusPill status={current.status} />}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-3 text-xs">
            {displayEmail && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> {displayEmail}</span>}
            <span className="inline-flex items-center gap-1"><IdCard className="w-3 h-3" /> <code className="font-mono">{userId}</code></span>
            {current && <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" /> {entity}</span>}
          </DialogDescription>
        </DialogHeader>

        {loading && <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
        {error && <div className="p-3 border-l-4 border-red-500 bg-red-50 dark:bg-red-950/30 text-sm">{error}</div>}

        {!loading && summary && (
          <>
            {/* Stat row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatTile label="Tier" value={current?.tier?.name ?? "—"} icon={ShieldCheck} />
              <StatTile label="Credits" value={summary.creditAccount?.balance.toLocaleString() ?? "0"} icon={Sparkles} sub={`${summary.creditAccount?.monthlyAllocation.toLocaleString() ?? 0}/mo`} />
              <StatTile label="Payment" value={current ? methodLabel(current.paymentMethod) : "—"} icon={CreditCard} sub={current?.paymentStatus ?? ""} />
              <StatTile label="Since" value={current ? fmtDate(current.approvedAt ?? current.requestedAt).split(",")[0] : "—"} icon={CheckCircle2} />
            </div>

            <Tabs defaultValue="membership" className="mt-4">
              <TabsList className="rounded-none">
                <TabsTrigger value="membership" className="rounded-none">Membership</TabsTrigger>
                <TabsTrigger value="credits" className="rounded-none">Credits</TabsTrigger>
                <TabsTrigger value="access" className="rounded-none">Access</TabsTrigger>
                <TabsTrigger value="history" className="rounded-none">History</TabsTrigger>
              </TabsList>

              {/* ── Membership tab ── */}
              <TabsContent value="membership" className="space-y-4 mt-4">
                {!current ? (
                  <div className="text-muted-foreground text-sm p-4">This user has no membership record.</div>
                ) : (
                  <>
                    <Card className="rounded-none">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-serif flex items-center gap-2">
                          <ArrowUpRight className="w-4 h-4 text-primary" />
                          Change tier
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col md:flex-row gap-2 items-stretch md:items-end">
                        <div className="flex-1">
                          <Label htmlFor="new-tier">New tier</Label>
                          <Select value={changeTierId} onValueChange={setChangeTierId}>
                            <SelectTrigger id="new-tier" className="rounded-none">
                              <SelectValue placeholder={`Current: ${current.tier?.name ?? "—"}`} />
                            </SelectTrigger>
                            <SelectContent>
                              {tiers.filter(t => t.id !== current.tierId).map(t => (
                                <SelectItem key={t.id} value={String(t.id)}>
                                  {t.name}
                                  {t.annualPriceCents != null ? ` — $${(t.annualPriceCents / 100).toLocaleString()}/yr` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground mt-1">Credit balance allocation is synced automatically.</p>
                        </div>
                        <Button
                          onClick={changeTier}
                          disabled={!changeTierId || actioning === "change-tier"}
                          className="rounded-none"
                        >
                          {actioning === "change-tier" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
                          <span className="ml-2">Apply Change</span>
                        </Button>
                      </CardContent>
                    </Card>

                    <Card className="rounded-none">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-serif flex items-center gap-2">
                          {current.status === "cancelled" ? <PlayCircle className="w-4 h-4 text-primary" /> : <PauseCircle className="w-4 h-4 text-primary" />}
                          Account access
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {current.status === "cancelled" ? (
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm text-muted-foreground">This account is on hold. Reactivating restores access without a new payment.</p>
                            <Button onClick={reactivate} disabled={actioning === "reactivate"} className="rounded-none">
                              {actioning === "reactivate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                              <span className="ml-2">Reactivate</span>
                            </Button>
                          </div>
                        ) : current.status === "active" ? (
                          <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-end">
                            <div className="flex-1">
                              <Label htmlFor="hold-reason">Hold reason (internal note)</Label>
                              <Input
                                id="hold-reason"
                                placeholder="e.g. Payment bounced, awaiting new invoice"
                                value={holdReason}
                                onChange={e => setHoldReason(e.target.value)}
                                className="rounded-none"
                              />
                            </div>
                            <Button
                              onClick={hold}
                              disabled={actioning === "hold"}
                              variant="outline"
                              className="rounded-none border-amber-300 text-amber-700 hover:bg-amber-50"
                            >
                              {actioning === "hold" ? <Loader2 className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />}
                              <span className="ml-2">Put on Hold</span>
                            </Button>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">Status is {current.status}. Only active members can be placed on hold; only on-hold members can be reactivated.</p>
                        )}
                      </CardContent>
                    </Card>

                    {current.paymentMethod === "card" && current.paymentStatus === "paid" && (
                      <Card className="rounded-none">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-serif flex items-center gap-2">
                            <RotateCcw className="w-4 h-4 text-primary" />
                            Refund (Stripe)
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col md:flex-row gap-2 items-stretch md:items-end">
                          <div className="flex-1">
                            <Label htmlFor="refund-amount">Partial amount in USD (blank = refund full)</Label>
                            <Input
                              id="refund-amount"
                              type="number"
                              step="0.01"
                              placeholder={fmtMoney(current.paymentAmountCents)}
                              value={refundAmount}
                              onChange={e => setRefundAmount(e.target.value)}
                              className="rounded-none font-mono"
                            />
                          </div>
                          <Button
                            variant="outline"
                            className="rounded-none border-orange-300 text-orange-700 hover:bg-orange-50"
                            onClick={refund}
                            disabled={actioning === "refund"}
                          >
                            {actioning === "refund" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                            <span className="ml-2">Issue Refund</span>
                          </Button>
                        </CardContent>
                      </Card>
                    )}

                    <Card className="rounded-none">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-serif flex items-center justify-between gap-2">
                          <span>Current membership details</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-none h-7"
                            asChild
                          >
                            <a href={`${API_BASE}/admin/memberships/${current.id}/invoice.pdf`} target="_blank" rel="noopener">
                              <Download className="w-3.5 h-3.5" />
                              <span className="ml-1">Invoice PDF</span>
                            </a>
                          </Button>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm space-y-1.5">
                        <Row label="Requested">{fmtDate(current.requestedAt)}</Row>
                        <Row label="Approved">{fmtDate(current.approvedAt)}{current.approvedBy ? ` by ${current.approvedBy}` : ""}</Row>
                        <Row label="Payment method"><PaymentMethodIcon method={current.paymentMethod} /><span className="ml-1">{methodLabel(current.paymentMethod)}</span></Row>
                        <Row label="Payment status">{current.paymentStatus}</Row>
                        <Row label="Reference">{current.paymentRef ?? "—"}</Row>
                        <Row label="Amount">{fmtMoney(current.paymentAmountCents)}</Row>
                        <Row label="Entity">{current.entityName} ({current.entityType})</Row>
                        <Row label="Industry">{current.entityIndustry ?? "—"}</Row>
                        <Row label="Size">{current.entitySize ?? "—"}</Row>
                        <Row label="Role">{current.entityRole ?? "—"}</Row>
                        {current.rejectionReason && <Row label="Rejection reason">{current.rejectionReason}</Row>}
                        {current.notes && (
                          <div className="pt-2 border-t">
                            <div className="text-xs text-muted-foreground mb-1">Notes</div>
                            <pre className="text-xs bg-muted/50 p-2 whitespace-pre-wrap font-mono">{current.notes}</pre>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                )}
              </TabsContent>

              {/* ── Credits tab ── */}
              <TabsContent value="credits" className="space-y-4 mt-4">
                <Card className="rounded-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-serif flex items-center gap-2">
                      <Coins className="w-4 h-4 text-primary" />
                      Grant or deduct credits
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2 items-end">
                      <div>
                        <Label htmlFor="grant-amount">Amount (negative to deduct)</Label>
                        <Input
                          id="grant-amount"
                          type="number"
                          placeholder="100"
                          value={grantAmount}
                          onChange={e => setGrantAmount(e.target.value)}
                          className="rounded-none font-mono"
                        />
                      </div>
                      <div>
                        <Label htmlFor="grant-desc">Description (shown in transactions)</Label>
                        <Input
                          id="grant-desc"
                          placeholder="e.g. Goodwill credit, referral bonus"
                          value={grantDescription}
                          onChange={e => setGrantDescription(e.target.value)}
                          className="rounded-none"
                        />
                      </div>
                      <Button onClick={grantCredits} disabled={!grantAmount || actioning === "grant-credits"} className="rounded-none">
                        {actioning === "grant-credits" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
                        <span className="ml-2">Apply</span>
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Current balance: <span className="font-mono font-semibold">{summary.creditAccount?.balance.toLocaleString() ?? 0}</span>
                      {" · "}Monthly allocation: <span className="font-mono">{summary.creditAccount?.monthlyAllocation.toLocaleString() ?? 0}</span>
                    </p>
                  </CardContent>
                </Card>

                <Card className="rounded-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-serif">Recent transactions ({summary.transactions.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {summary.transactions.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">No transactions yet.</div>
                    ) : (
                      <div className="max-h-[400px] overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="border-b bg-muted/50 sticky top-0">
                            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                              <th className="px-3 py-2">When</th>
                              <th className="px-3 py-2">Type</th>
                              <th className="px-3 py-2">Description</th>
                              <th className="px-3 py-2 text-right">Δ</th>
                              <th className="px-3 py-2 text-right">Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.transactions.map(t => (
                              <tr key={t.id} className="border-b hover:bg-muted/20">
                                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                                <td className="px-3 py-2 text-xs font-mono">{t.type}</td>
                                <td className="px-3 py-2 text-xs">{t.description}</td>
                                <td className={`px-3 py-2 text-right font-mono text-xs ${t.amount >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                  {t.amount >= 0 ? (
                                    <span className="inline-flex items-center gap-0.5"><ArrowUpRight className="w-3 h-3" />+{t.amount.toLocaleString()}</span>
                                  ) : (
                                    <span className="inline-flex items-center gap-0.5"><ArrowDownRight className="w-3 h-3" />{t.amount.toLocaleString()}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-xs">{t.balanceAfter.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── Access tab ── */}
              <TabsContent value="access" className="space-y-4 mt-4">
                <Card className="rounded-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-serif flex items-center gap-2">
                      <LogIn className="w-4 h-4 text-primary" />
                      Sign in as this user
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      Creates a 60-second Clerk actor token and opens a session as this user in a new tab. Actions performed while impersonating are logged with your admin ID as the actor.
                    </p>
                    <Button onClick={impersonate} disabled={actioning === "impersonate"} className="rounded-none shrink-0">
                      {actioning === "impersonate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                      <span className="ml-2">Impersonate</span>
                    </Button>
                  </CardContent>
                </Card>

                <Card className="rounded-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-serif flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-primary" />
                      API Keys
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-end">
                      <div className="flex-1">
                        <Label htmlFor="new-key-label">Issue a new key — label (e.g. "Staging integration")</Label>
                        <Input
                          id="new-key-label"
                          placeholder="Integration name"
                          value={newKeyLabel}
                          onChange={e => setNewKeyLabel(e.target.value)}
                          className="rounded-none"
                        />
                      </div>
                      <Button onClick={issueApiKey} disabled={!newKeyLabel.trim() || actioning === "issue-key"} className="rounded-none">
                        {actioning === "issue-key" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                        <span className="ml-2">Issue</span>
                      </Button>
                    </div>

                    {lastIssuedKey && (
                      <div className="p-3 border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-sm">
                        <div className="font-medium mb-1">New key for "{lastIssuedKey.label}" — copy now, it won't be shown again:</div>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 px-2 py-1 bg-background font-mono text-xs break-all">{lastIssuedKey.raw}</code>
                          <Button size="sm" variant="outline" onClick={() => copyKey(lastIssuedKey.raw)} className="rounded-none">
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}

                    {apiKeys.length === 0 ? (
                      <div className="text-sm text-muted-foreground text-center py-4">No API keys issued.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="border-b bg-muted/30">
                            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                              <th className="px-3 py-2">Label</th>
                              <th className="px-3 py-2">Prefix</th>
                              <th className="px-3 py-2">Last used</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {apiKeys.map(k => (
                              <tr key={k.id} className="border-b">
                                <td className="px-3 py-2 text-sm font-medium">{k.label}</td>
                                <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{k.prefix}…</td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : "—"}</td>
                                <td className="px-3 py-2">
                                  {k.revokedAt ? (
                                    <span className="text-xs text-red-700">Revoked {fmtDate(k.revokedAt)}</span>
                                  ) : (
                                    <span className="text-xs text-emerald-700">Active</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {!k.revokedAt && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 rounded-none border-red-300 text-red-700 hover:bg-red-50"
                                      onClick={() => revokeApiKey(k.id)}
                                      disabled={actioning === `revoke-${k.id}`}
                                    >
                                      {actioning === `revoke-${k.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                      <span className="ml-1">Revoke</span>
                                    </Button>
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

              {/* ── History tab ── */}
              <TabsContent value="history" className="mt-4">
                <Card className="rounded-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-serif">All membership records ({summary.allMemberships.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {summary.allMemberships.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">No membership records.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="border-b bg-muted/50">
                            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                              <th className="px-3 py-2">Requested</th>
                              <th className="px-3 py-2">Tier</th>
                              <th className="px-3 py-2">Method</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2">Payment</th>
                              <th className="px-3 py-2 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.allMemberships.map(m => (
                              <tr key={m.id} className="border-b hover:bg-muted/20">
                                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.requestedAt)}</td>
                                <td className="px-3 py-2 text-xs font-medium">{m.tier?.name ?? `#${m.tierId}`}</td>
                                <td className="px-3 py-2 text-xs">
                                  <span className="inline-flex items-center gap-1">
                                    <PaymentMethodIcon method={m.paymentMethod} />
                                    {methodLabel(m.paymentMethod)}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-xs"><StatusPill status={m.status} /></td>
                                <td className="px-3 py-2 text-xs font-mono">{m.paymentStatus}</td>
                                <td className="px-3 py-2 text-right text-xs font-mono">{fmtMoney(m.paymentAmountCents)}</td>
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatTile({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className="rounded-none">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Icon className="w-3 h-3" /> {label}
        </div>
        <div className="text-lg font-serif mt-1">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-muted-foreground min-w-[120px]">{label}</span>
      <span className="text-sm text-right break-all flex items-center">{children}</span>
    </div>
  );
}
