import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Bitcoin, Building2, CheckCircle2, CreditCard, FileText, Loader2, PauseCircle,
  RefreshCw, Search, User, Users, XCircle,
} from "lucide-react";
import MemberDetailDialog from "@/components/member-detail-dialog";

const API_BASE = "/api";

type Tier = {
  id: number;
  name: string;
  slug: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
};

type Payment = {
  id: number;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  tierId: number;
  entityType: "company" | "individual";
  entityName: string;
  paymentMethod: "card" | "invoice" | "crypto";
  paymentStatus: string;
  status: "pending" | "active" | "rejected" | "cancelled";
  requestedAt: string;
  approvedAt: string | null;
  tier: Tier | null;
};

const methodIcon = (m: Payment["paymentMethod"]) => {
  if (m === "card") return <CreditCard className="w-3.5 h-3.5 text-emerald-600" />;
  if (m === "invoice") return <FileText className="w-3.5 h-3.5 text-amber-600" />;
  return <Bitcoin className="w-3.5 h-3.5 text-orange-600" />;
};

const statusBadge = (s: Payment["status"]) => {
  const map = {
    active: { label: "Active", cls: "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20", Icon: CheckCircle2 },
    pending: { label: "Pending", cls: "bg-amber-500/10 text-amber-700 border border-amber-500/20", Icon: PauseCircle },
    rejected: { label: "Rejected", cls: "bg-red-500/10 text-red-700 border border-red-500/20", Icon: XCircle },
    cancelled: { label: "On Hold", cls: "bg-slate-500/10 text-slate-700 border border-slate-500/20", Icon: PauseCircle },
  }[s];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${map.cls}`}>
      <map.Icon className="w-3 h-3" />
      {map.label}
    </span>
  );
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

type Props = {
  onMutated?: () => void;
};

export default function MembersList({ onMutated }: Props) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Payment["status"]>("all");
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/payments?status=all`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setPayments(json.payments ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // Show only the most-recent record per userId so the list reads like a member
  // roster, not a payment log. Click-through to the dialog reveals full history.
  const latestByUser = useMemo(() => {
    const map = new Map<string, Payment>();
    for (const p of payments) {
      const existing = map.get(p.userId);
      if (!existing || new Date(p.requestedAt) > new Date(existing.requestedAt)) {
        map.set(p.userId, p);
      }
    }
    return Array.from(map.values());
  }, [payments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return latestByUser.filter(p => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (p.userName ?? "").toLowerCase().includes(q) ||
        (p.userEmail ?? "").toLowerCase().includes(q) ||
        p.userId.toLowerCase().includes(q) ||
        p.entityName.toLowerCase().includes(q) ||
        (p.tier?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [latestByUser, search, statusFilter]);

  return (
    <>
      <Card className="rounded-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              Members ({filtered.length}{filtered.length !== latestByUser.length ? ` of ${latestByUser.length}` : ""})
            </CardTitle>
            <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading} className="rounded-none">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
          <div className="flex flex-col md:flex-row gap-2 mt-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, user ID, entity, or tier..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 rounded-none"
              />
            </div>
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="md:w-[180px] rounded-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="cancelled">On Hold</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              {loading ? "Loading..." : "No members match the current filter."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5">Name / Email</th>
                    <th className="px-4 py-2.5">Entity</th>
                    <th className="px-4 py-2.5">Tier</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Payment</th>
                    <th className="px-4 py-2.5">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr
                      key={p.userId}
                      className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setOpenUserId(p.userId)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{p.userName ?? p.userEmail ?? p.userId.slice(0, 16)}</div>
                        {p.userEmail && p.userName && (
                          <div className="text-xs text-muted-foreground">{p.userEmail}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {p.entityType === "company"
                            ? <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                            : <User className="w-3.5 h-3.5 text-muted-foreground" />}
                          <span className="text-xs">{p.entityName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">{p.tier?.name ?? `#${p.tierId}`}</td>
                      <td className="px-4 py-3">{statusBadge(p.status)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          {methodIcon(p.paymentMethod)}
                          <span className="font-mono">{p.paymentStatus}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(p.approvedAt ?? p.requestedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <MemberDetailDialog
        userId={openUserId}
        open={!!openUserId}
        onOpenChange={(o) => { if (!o) setOpenUserId(null); }}
        onMutated={() => { void fetchAll(); onMutated?.(); }}
      />
    </>
  );
}
