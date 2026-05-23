import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Download, FileSpreadsheet, Database, Lock, Mail, CheckCircle2 } from "lucide-react";
import { Layout } from "@/components/layout";

const API_BASE = "/api";

type Dataset = { id: string; label: string; description: string };
type ScheduledExportFormat = "markdown" | "csv";
type ScheduledExportScope = "watchlist" | "portfolio" | "all";
type ScheduledExportSubscription = {
  id: number;
  userId: string;
  active: boolean;
  frequency: "weekly";
  format: ScheduledExportFormat;
  scope: ScheduledExportScope;
  lastSentAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

const TIER_RANK: Record<string, number> = {
  discovery: 0,
  briefing: 1,
  console: 2,
  ledger: 2,
  workbench: 2,
  platform: 3,
};

export default function ExportsPage() {
  const { getToken } = useAuth();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [tier, setTier] = useState<string>("discovery");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // Scheduled-export ("email me a weekly digest") state.
  const [subs, setSubs] = useState<ScheduledExportSubscription[]>([]);
  const [scope, setScope] = useState<ScheduledExportScope>("all");
  const [format, setFormat] = useState<ScheduledExportFormat>("markdown");
  const [scheduledBusy, setScheduledBusy] = useState(false);
  const [scheduledNotice, setScheduledNotice] = useState<string | null>(null);

  const activeSub = subs.find(s => s.active) ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken().catch(() => null);
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const [dRes, bRes, sRes] = await Promise.all([
          fetch(`${API_BASE}/exports/datasets`, { headers }),
          fetch(`${API_BASE}/credits/balance`, { headers }),
          fetch(`${API_BASE}/me/scheduled-exports`, { headers }),
        ]);
        if (!cancelled && dRes.ok) {
          const j = await dRes.json() as { datasets: Dataset[] };
          setDatasets(j.datasets);
        }
        if (!cancelled && bRes.ok) {
          const j = await bRes.json() as { tierSlug?: string };
          if (j.tierSlug) setTier(j.tierSlug);
        }
        if (!cancelled && sRes.ok) {
          const j = await sRes.json() as { subscriptions: ScheduledExportSubscription[] };
          setSubs(j.subscriptions);
          const first = j.subscriptions.find(s => s.active);
          if (first) {
            setScope(first.scope);
            setFormat(first.format);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  const userRank = TIER_RANK[tier] ?? 0;
  const canCsv = userRank >= 1;
  const canParquet = userRank >= 3;

  const download = async (id: string, dlFormat: "csv" | "parquet") => {
    setBusy(`${id}.${dlFormat}`);
    try {
      const token = await getToken().catch(() => null);
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/exports/${id}.${dlFormat}`, { headers });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        alert(`Download failed (${res.status}): ${body.slice(0, 200)}`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const m = cd.match(/filename="?([^";]+)"?/);
      const filename = m?.[1] ?? `${id}.${dlFormat}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  };

  async function toggleScheduled(next: boolean): Promise<void> {
    setScheduledBusy(true);
    setScheduledNotice(null);
    try {
      const token = await getToken().catch(() => null);
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      if (next) {
        const res = await fetch(`${API_BASE}/me/scheduled-exports`, {
          method: "POST",
          headers,
          body: JSON.stringify({ frequency: "weekly", format, scope }),
        });
        if (!res.ok) {
          setScheduledNotice(`Failed to enable weekly digest (${res.status})`);
          return;
        }
        const j = await res.json() as { subscription: ScheduledExportSubscription };
        setSubs(prev => {
          const without = prev.filter(p => p.id !== j.subscription.id);
          return [j.subscription, ...without];
        });
        setScheduledNotice("Weekly export digest enabled. First delivery within 7 days.");
      } else if (activeSub) {
        const res = await fetch(`${API_BASE}/me/scheduled-exports/${activeSub.id}`, {
          method: "DELETE",
          headers,
        });
        if (!res.ok) {
          setScheduledNotice(`Failed to cancel (${res.status})`);
          return;
        }
        setSubs(prev => prev.map(p => p.id === activeSub.id ? { ...p, active: false } : p));
        setScheduledNotice("Weekly export digest cancelled.");
      }
    } finally {
      setScheduledBusy(false);
    }
  }

  async function applyScheduledChanges(): Promise<void> {
    if (!activeSub) {
      void toggleScheduled(true);
      return;
    }
    if (activeSub.scope === scope && activeSub.format === format) {
      setScheduledNotice("No changes to apply.");
      return;
    }
    setScheduledBusy(true);
    setScheduledNotice(null);
    try {
      const token = await getToken().catch(() => null);
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      // Cancel the existing row + create a fresh one with the new shape.
      // POST is idempotent on (frequency, format, scope) so this is safe.
      await fetch(`${API_BASE}/me/scheduled-exports/${activeSub.id}`, { method: "DELETE", headers });
      const res = await fetch(`${API_BASE}/me/scheduled-exports`, {
        method: "POST",
        headers,
        body: JSON.stringify({ frequency: "weekly", format, scope }),
      });
      if (!res.ok) {
        setScheduledNotice(`Failed to update (${res.status})`);
        return;
      }
      const j = await res.json() as { subscription: ScheduledExportSubscription };
      setSubs(prev => [j.subscription, ...prev.filter(p => p.id !== activeSub.id && p.id !== j.subscription.id)]);
      setScheduledNotice("Schedule preferences updated.");
    } finally {
      setScheduledBusy(false);
    }
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-serif">Data exports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Point-in-time snapshots of CE datasets. Each download is tagged with a
            reproducible <code className="text-xs">snapshotId</code> (returned in
            the <code className="text-xs">X-Snapshot-Id</code> response header and
            embedded in the filename). CSV is available to Briefing+; Parquet is
            available to Platform / Data License customers.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Your tier: <span className="font-mono">{tier}</span>
          </p>
        </div>

        <Card className="rounded-none border-primary/30" data-testid="card-scheduled-exports">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" />
              Email me a weekly digest
            </CardTitle>
            <CardDescription className="text-xs">
              Receive a weekly snapshot of these datasets in your notifications inbox.
              We deliver as a member notification today; email delivery follows once SMTP is wired up.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={!!activeSub}
                disabled={scheduledBusy}
                onCheckedChange={(checked) => void toggleScheduled(checked)}
                data-testid="switch-scheduled-export"
              />
              <span className="text-sm">
                {activeSub ? "Subscribed" : "Not subscribed"}
              </span>
              {activeSub?.lastSentAt && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Last sent {new Date(activeSub.lastSentAt).toLocaleDateString()}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Scope</label>
                <Select value={scope} onValueChange={(v) => setScope(v as ScheduledExportScope)}>
                  <SelectTrigger className="rounded-none" data-testid="select-scope">
                    <SelectValue placeholder="Select scope" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tracked industries</SelectItem>
                    <SelectItem value="watchlist">My watchlist only</SelectItem>
                    <SelectItem value="portfolio">My portfolio only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Format</label>
                <Select value={format} onValueChange={(v) => setFormat(v as ScheduledExportFormat)}>
                  <SelectTrigger className="rounded-none" data-testid="select-format">
                    <SelectValue placeholder="Select format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="markdown">Markdown summary</SelectItem>
                    <SelectItem value="csv">CSV (full payload)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none w-full"
                  disabled={scheduledBusy}
                  onClick={() => void applyScheduledChanges()}
                  data-testid="button-apply-scheduled"
                >
                  {scheduledBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  {activeSub ? "Apply changes" : "Subscribe"}
                </Button>
              </div>
            </div>

            {scheduledNotice && (
              <p className="text-xs text-muted-foreground italic" data-testid="text-scheduled-notice">{scheduledNotice}</p>
            )}
            {activeSub?.lastError && (
              <p className="text-xs text-rose-600">
                Last delivery failed: {activeSub.lastError}
              </p>
            )}
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading datasets…
          </div>
        ) : (
          <div className="grid gap-4">
            {datasets.map(ds => (
              <Card key={ds.id} className="rounded-none" data-testid={`card-dataset-${ds.id}`}>
                <CardHeader>
                  <CardTitle className="text-base font-serif flex items-center gap-2">
                    <Database className="w-4 h-4 text-primary" />
                    {ds.label}
                  </CardTitle>
                  <CardDescription className="text-xs">{ds.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-none"
                    disabled={!canCsv || busy === `${ds.id}.csv`}
                    onClick={() => download(ds.id, "csv")}
                    data-testid={`button-csv-${ds.id}`}
                  >
                    {busy === `${ds.id}.csv` ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-2" />}
                    CSV
                    {!canCsv && <Lock className="w-3 h-3 ml-2" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-none"
                    disabled={!canParquet || busy === `${ds.id}.parquet`}
                    onClick={() => download(ds.id, "parquet")}
                    data-testid={`button-parquet-${ds.id}`}
                  >
                    {busy === `${ds.id}.parquet` ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                    Parquet
                    {!canParquet && <Lock className="w-3 h-3 ml-2" />}
                  </Button>
                  {!canCsv && (
                    <span className="text-xs text-muted-foreground">CSV requires Briefing tier or higher.</span>
                  )}
                  {canCsv && !canParquet && (
                    <span className="text-xs text-muted-foreground">Parquet requires Platform / Data License.</span>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
