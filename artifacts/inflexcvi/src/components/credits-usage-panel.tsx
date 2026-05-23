import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDownToLine, ArrowUpFromLine, Coins, RefreshCw, Sparkles, TrendingUp, Zap } from "lucide-react";

const API_BASE = "/api";

interface BalanceResponse {
  balance: number;
  monthlyAllocation: number;
  tierSlug: string;
  lastTopUpAt: string | null;
  creditCosts: Record<string, number>;
  blockSize: number;
  blockPriceCents: number;
  canPurchase: boolean;
  lowBalance: boolean;
}

interface Transaction {
  id: number;
  userId: string;
  amount: number;
  type: "allocation" | "purchase" | "debit" | "refund" | string;
  description: string;
  operationEndpoint: string | null;
  balanceAfter: number;
  createdAt: string;
}

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const fmtCount = (n: number) => n.toLocaleString();

const TYPE_STYLES: Record<string, { label: string; cls: string }> = {
  allocation: { label: "Allocation", cls: "bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400" },
  purchase: { label: "Purchase", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400" },
  debit: { label: "Debit", cls: "bg-muted text-muted-foreground border-border" },
  refund: { label: "Refund", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400" },
};

const OPERATION_LABELS: Record<string, string> = {
  ASSESSMENT: "Assessments",
  RESEARCH_QUERY: "Research queries",
  TRIANGULATION: "Source triangulation",
  BENCHMARK_DISCOVERY: "Benchmark discovery",
  VCR_CYCLE: "VCR cycles",
  INVESTMENT_THESIS: "Investment thesis",
  NL_QUERY: "NL query",
  NL_QUERY_RAG: "NL query (RAG)",
  ENRICHMENT_FULL: "Capability enrichment",
  CSUITE_PERSPECTIVES: "C-suite perspectives",
  TRADE_SIGNAL: "Trade signals",
};

const TIER_LABELS: Record<string, string> = {
  discovery: "Discovery",
  payg: "Pay-as-you-go",
  briefing: "Briefing",
  console: "The Console",
  platform: "Platform",
};

/**
 * Bucket a transaction into a human-readable operation key. Falls back to the
 * raw operationEndpoint (or "Other" when null) so nothing is dropped.
 */
function operationKey(t: Transaction): string {
  if (t.operationEndpoint) {
    const upper = t.operationEndpoint.toUpperCase().replace(/[\s/-]/g, "_");
    if (OPERATION_LABELS[upper]) return upper;
    return t.operationEndpoint;
  }
  // Heuristic: match the description prefix against known operation keys.
  const desc = t.description?.toLowerCase() ?? "";
  for (const [key, label] of Object.entries(OPERATION_LABELS)) {
    if (desc.includes(label.toLowerCase()) || desc.includes(key.toLowerCase())) {
      return key;
    }
  }
  return "OTHER";
}

export default function CreditsUsagePanel() {
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const [bRes, tRes] = await Promise.all([
        fetch(`${API_BASE}/credits/balance`, { credentials: "include" }),
        fetch(`${API_BASE}/credits/transactions?limit=100`, { credentials: "include" }),
      ]);
      if (bRes.ok) setBalance(await bRes.json());
      if (tRes.ok) setTxns(await tRes.json());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  // 30-day spend breakdown by operation (debits only, count of |amount|).
  const breakdown = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const buckets = new Map<string, { spent: number; calls: number }>();
    for (const t of txns) {
      if (t.type !== "debit") continue;
      if (new Date(t.createdAt).getTime() < cutoff) continue;
      const key = operationKey(t);
      const prev = buckets.get(key) ?? { spent: 0, calls: 0 };
      buckets.set(key, { spent: prev.spent + Math.abs(t.amount), calls: prev.calls + 1 });
    }
    const total = Array.from(buckets.values()).reduce((a, b) => a + b.spent, 0);
    return Array.from(buckets.entries())
      .map(([key, v]) => ({
        key,
        label: OPERATION_LABELS[key] ?? key,
        spent: v.spent,
        calls: v.calls,
        sharePct: total > 0 ? (v.spent / total) * 100 : 0,
        costPerCall: balance?.creditCosts?.[key] ?? null,
      }))
      .sort((a, b) => b.spent - a.spent);
  }, [txns, balance]);

  const totalSpent30d = breakdown.reduce((a, b) => a + b.spent, 0);
  const totalCalls30d = breakdown.reduce((a, b) => a + b.calls, 0);

  const purchasedLast30d = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return txns
      .filter(t => (t.type === "purchase" || t.type === "allocation") && new Date(t.createdAt).getTime() >= cutoff)
      .reduce((a, t) => a + t.amount, 0);
  }, [txns]);

  if (loading && !balance) {
    return (
      <Card className="rounded-none">
        <CardHeader>
          <CardTitle className="text-base font-serif">Credits &amp; Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground italic">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (!balance) return null;

  const balanceTone =
    balance.balance <= 10 ? "text-destructive" :
    balance.balance <= 50 ? "text-amber-600" : "text-foreground";

  const tierName = TIER_LABELS[balance.tierSlug] ?? balance.tierSlug;

  return (
    <Card className="rounded-none">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base font-serif flex items-center gap-2">
            <Coins className="w-4 h-4 text-primary" />
            Credits &amp; Usage
          </CardTitle>
          <CardDescription>Live balance, last 30 days of activity, and per-operation breakdown.</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={refreshing} className="rounded-none">
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Top metrics row */}
        <div className="grid sm:grid-cols-3 gap-3">
          <MetricBlock
            label="Current balance"
            value={fmtCount(balance.balance)}
            tone={balanceTone}
            sub={balance.lowBalance ? "Running low" : "credits"}
            icon={Sparkles}
          />
          <MetricBlock
            label="Monthly allocation"
            value={fmtCount(balance.monthlyAllocation)}
            sub={`${tierName} tier`}
            icon={TrendingUp}
          />
          <MetricBlock
            label="Spent last 30 days"
            value={fmtCount(totalSpent30d)}
            sub={`${fmtCount(totalCalls30d)} operations`}
            icon={Zap}
          />
        </div>

        {/* Low-balance banner */}
        {balance.lowBalance && (
          <div className="border border-destructive/30 bg-destructive/[0.06] px-4 py-3 text-sm flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive mb-1">
                Low balance
              </div>
              <div>You have {balance.balance} credits left. Top up or upgrade to keep using paid operations.</div>
            </div>
            <div className="flex gap-2">
              <Button asChild className="rounded-none">
                <a href="/membership">Top up</a>
              </Button>
              <Button asChild variant="outline" className="rounded-none">
                <a href="/membership">Upgrade plan</a>
              </Button>
            </div>
          </div>
        )}

        {/* CTAs (always present) */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild variant="outline" className="rounded-none">
            <a href="/membership">
              <ArrowUpFromLine className="w-4 h-4 mr-2" />
              Top up credits
            </a>
          </Button>
          <Button asChild variant="outline" className="rounded-none">
            <a href="/membership">
              <ArrowDownToLine className="w-4 h-4 mr-2" />
              Upgrade plan
            </a>
          </Button>
          {balance.lastTopUpAt && (
            <span className="font-mono text-xs text-muted-foreground">
              Last top-up: {fmtDateTime(balance.lastTopUpAt)}
            </span>
          )}
          <span className="font-mono text-xs text-muted-foreground ml-auto">
            +{fmtCount(purchasedLast30d)} credits added last 30d
          </span>
        </div>

        {/* 30-day breakdown */}
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Spend breakdown — last 30 days
          </h3>
          {breakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No paid operations in the last 30 days.</p>
          ) : (
            <div className="space-y-1.5">
              {breakdown.map(row => (
                <div key={row.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="truncate">{row.label}</span>
                      {row.costPerCall !== null && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {row.costPerCall === 0 ? "free" : `${row.costPerCall}/call`}
                        </span>
                      )}
                    </div>
                    <div className="h-1.5 bg-muted rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-primary/70"
                        style={{ width: `${Math.max(2, row.sharePct)}%` }}
                      />
                    </div>
                  </div>
                  <span className="font-mono tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                    {fmtCount(row.calls)} ops
                  </span>
                  <span className="font-mono tabular-nums whitespace-nowrap min-w-[3.5rem] text-right">
                    {fmtCount(row.spent)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent transactions */}
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Recent transactions
          </h3>
          {txns.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No credit activity yet.</p>
          ) : (
            <div className="border border-border max-h-[26rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-[10rem]">When</TableHead>
                    <TableHead className="w-[6rem]">Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right w-[5rem]">Amount</TableHead>
                    <TableHead className="text-right w-[5rem]">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txns.map(t => {
                    const style = TYPE_STYLES[t.type] ?? { label: t.type, cls: "bg-muted text-muted-foreground border-border" };
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDateTime(t.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`rounded-none font-mono text-[10px] uppercase tracking-wider ${style.cls}`}>
                            {style.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="truncate max-w-[20rem]">{t.description}</div>
                          {t.operationEndpoint && (
                            <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[20rem]">
                              {t.operationEndpoint}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className={`text-right font-mono tabular-nums ${t.amount < 0 ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-400"}`}>
                          {t.amount > 0 ? "+" : ""}{fmtCount(t.amount)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {fmtCount(t.balanceAfter)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricBlock({
  label, value, sub, tone, icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="border border-border p-4">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </div>
      <div className={`font-mono text-3xl tabular-nums tracking-tight ${tone ?? "text-foreground"}`}>
        {value}
      </div>
      {sub && <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
