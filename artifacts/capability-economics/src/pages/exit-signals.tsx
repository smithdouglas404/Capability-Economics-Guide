import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { TrendingDown, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const apiBase = import.meta.env.VITE_API_URL || "";

type MoatItem = {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  moatScore: number;
  tier: string;
  halfLifeMonths: number | null;
  rationale: string | null;
};

type MoatResp = { items: MoatItem[]; coverage: { scored: number; totalCapabilities: number } };

function decayClass(months: number | null): string {
  if (months == null) return "text-muted-foreground";
  if (months < 6) return "text-rose-600";
  if (months < 12) return "text-amber-600";
  return "text-emerald-600";
}

function decayLabel(months: number | null): string {
  if (months == null) return "unknown";
  if (months < 6) return "rapid";
  if (months < 12) return "decaying";
  return "stable";
}

export default function ExitSignals() {
  const [items, setItems] = useState<MoatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(12);

  useEffect(() => {
    setLoading(true);
    fetch(`${apiBase}/api/alpha/moat`)
      .then(r => r.json())
      .then((d: MoatResp) => { setItems(d.items ?? []); setLoading(false); })
      .catch(e => { setErr(e instanceof Error ? e.message : String(e)); setLoading(false); });
  }, []);

  const candidates = useMemo(() => {
    return items
      .filter(i => i.halfLifeMonths != null && i.halfLifeMonths < threshold)
      .sort((a, b) => (a.halfLifeMonths ?? 99) - (b.halfLifeMonths ?? 99));
  }, [items, threshold]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Deal Flow · Exit Signals</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <TrendingDown className="w-8 h-8 text-primary" />
          Exit Signals
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Capabilities whose moat half-life is decaying past your threshold — investments worth exiting before the value erodes.
        </p>
      </motion.div>

      <Card className="mb-6">
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div>
            <Label htmlFor="threshold" className="text-xs uppercase tracking-wider text-muted-foreground">Half-life threshold (months)</Label>
            <Input
              id="threshold"
              type="number"
              min={1}
              max={60}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 12))}
              className="w-24 mt-1"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-mono text-foreground">{candidates.length}</span> capabilities below {threshold}-month half-life
          </div>
        </CardContent>
      </Card>

      {err && <div className="text-sm text-red-600 mb-4">{err}</div>}

      {loading ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
            <p className="text-sm">Scanning moat decay…</p>
          </CardContent>
        </Card>
      ) : candidates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <TrendingDown className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-serif text-lg mb-1">No exit signals triggered</p>
            <p className="text-sm">Lower the threshold to find more candidates.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {candidates.map((c) => (
            <Card key={c.capabilityId} className="border-rose-500/30">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium truncate">{c.capabilityName}</h3>
                    <Badge variant="outline" className="text-xs">{c.industryName}</Badge>
                    <Badge variant="outline" className="text-rose-600 border-rose-500/50 text-xs">
                      <AlertTriangle className="w-3 h-3 mr-1" />Sell signal triggered
                    </Badge>
                  </div>
                  {c.rationale && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{c.rationale}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Moat</div>
                  <div className="font-mono text-lg">{c.moatScore}</div>
                  <div className="text-xs text-muted-foreground capitalize">{c.tier}</div>
                </div>
                <div className="text-right shrink-0 border-l border-border pl-4">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Half-life</div>
                  <div className={`font-mono text-lg ${decayClass(c.halfLifeMonths)}`}>
                    {c.halfLifeMonths ?? "—"}<span className="text-xs ml-1">mo</span>
                  </div>
                  <div className={`text-xs capitalize ${decayClass(c.halfLifeMonths)}`}>{decayLabel(c.halfLifeMonths)}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
