import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw } from "lucide-react";

type Tenant = { kind: "user" | "session" | "ip"; tenantId: string; count: number };

export default function ApiVolumePanel() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [redisOn, setRedisOn] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/api-volume", { credentials: "include" });
      if (r.ok) {
        const j = await r.json() as { tenants: Tenant[]; redis: boolean };
        setTenants(j.tenants);
        setRedisOn(j.redis);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="w-5 h-5" /> Per-tenant API volume
          <span className="text-xs font-normal text-muted-foreground ml-2">trailing 24h · top 50</span>
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading} data-testid="button-refresh-api-volume">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {!redisOn ? (
          <p className="text-sm text-muted-foreground">
            Redis is not connected, so per-tenant counters are not being recorded. Set
            <code className="mx-1 px-1 py-0.5 bg-muted text-xs">REDIS_URL</code> on the API server to enable rate limiting + volume tracking.
          </p>
        ) : tenants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No traffic recorded in the last 24 hours.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Kind</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Tenant</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground uppercase">Calls (24h)</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => (
                  <tr key={`${t.kind}:${t.tenantId}`} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-xs">{t.kind}</td>
                    <td className="px-3 py-2 font-mono text-xs truncate max-w-[420px]">{t.tenantId}</td>
                    <td className="px-3 py-2 text-right font-mono">{t.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
