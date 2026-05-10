import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, FileSpreadsheet, Database, Lock } from "lucide-react";
import { Layout } from "@/components/layout";

import { MobileNotice } from "@/components/mobile";
const API_BASE = "/api";

type Dataset = { id: string; label: string; description: string };

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken().catch(() => null);
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const [dRes, bRes] = await Promise.all([
          fetch(`${API_BASE}/exports/datasets`, { headers }),
          fetch(`${API_BASE}/credits/balance`, { headers }),
        ]);
        if (!cancelled && dRes.ok) {
          const j = await dRes.json() as { datasets: Dataset[] };
          setDatasets(j.datasets);
        }
        if (!cancelled && bRes.ok) {
          const j = await bRes.json() as { tierSlug?: string };
          if (j.tierSlug) setTier(j.tierSlug);
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

  const download = async (id: string, format: "csv" | "parquet") => {
    setBusy(`${id}.${format}`);
    try {
      const token = await getToken().catch(() => null);
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}/exports/${id}.${format}`, { headers });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        alert(`Download failed (${res.status}): ${body.slice(0, 200)}`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const m = cd.match(/filename="?([^";]+)"?/);
      const filename = m?.[1] ?? `${id}.${format}`;
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

  return (
    <Layout>
      <MobileNotice />
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
