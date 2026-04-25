import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Handshake, Loader2, TrendingUp, TrendingDown, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = "/api";

type Capability = { id: number; name: string; industryId: number };
type TradeSignal = {
  id: number;
  capabilityId: number | null;
  industryId: number | null;
  capabilityName: string | null;
  industryName: string | null;
  signal: string;
  strength: number;
  ceQuadrant: string | null;
  streetQuadrant: string | null;
  spreadPct: number | null;
  rationale: string | null;
  resolved: boolean;
  outcome: string | null;
  createdAt: string;
};

function signalAccent(signal: string): string {
  if (signal === "long") return "bg-emerald-500/10 text-emerald-700 border-emerald-500/40";
  if (signal === "short") return "bg-rose-500/10 text-rose-700 border-rose-500/40";
  return "bg-muted text-muted-foreground";
}

export default function InvestorMatch() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [capId, setCapId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/capabilities`).then((r) => r.json()),
      fetch(`${API_BASE}/trade-signals`, { credentials: "include" }).then((r) => r.ok ? r.json() : []),
    ]).then(([caps, sigs]) => {
      const capList: Capability[] = Array.isArray(caps) ? caps : (caps.capabilities ?? []);
      setCapabilities(capList);
      setSignals(Array.isArray(sigs) ? sigs : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const selectedCap = useMemo(() => capabilities.find((c) => c.id === Number(capId)) ?? null, [capabilities, capId]);

  const matches = useMemo(() => {
    if (!selectedCap) return [];
    const haystack = selectedCap.name.toLowerCase();
    return signals.filter((s) => {
      if (s.capabilityId === selectedCap.id) return true;
      if (s.industryId === selectedCap.industryId) return true;
      const text = `${s.capabilityName ?? ""} ${s.rationale ?? ""}`.toLowerCase();
      return text.includes(haystack);
    }).sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
  }, [signals, selectedCap]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-7xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Capital · Investor Match</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Handshake className="w-8 h-8 text-primary" />
          Investor Match
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Pick the capability you're building. We surface PE/VC trade signals where the smart money is leaning in (or
          out) on that capability — and adjacent ones in the same industry.
        </p>
      </motion.div>

      <Card className="mb-6">
        <CardContent className="p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">Your capability</p>
          <Select value={capId} onValueChange={setCapId}>
            <SelectTrigger><SelectValue placeholder={capabilities.length ? "Pick the capability you're building" : "Loading…"} /></SelectTrigger>
            <SelectContent>
              {capabilities.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin opacity-50" />
            <p className="text-sm">Loading signals…</p>
          </CardContent>
        </Card>
      ) : !selectedCap ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Target className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-serif text-lg mb-1">Pick a capability above.</p>
            <p className="text-sm">{signals.length} live trade signals across the catalog.</p>
          </CardContent>
        </Card>
      ) : matches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p className="font-serif text-lg mb-1">No matching signals yet.</p>
            <p className="text-sm">Either no investor activity in this capability or signals haven't been generated. Check back soon.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {matches.length} matching {matches.length === 1 ? "signal" : "signals"} of {signals.length} total
          </p>
          {matches.map((s) => {
            const Icon = s.signal === "long" ? TrendingUp : TrendingDown;
            const verb = s.signal === "long" ? "is buying" : "is shorting";
            return (
              <Card key={s.id} className="hover:bg-muted/20 transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className={signalAccent(s.signal)}>
                          <Icon className="w-3 h-3 mr-1" />{s.signal.toUpperCase()}
                        </Badge>
                        <span className="text-sm">
                          <span className="font-medium">Smart money</span> {verb}{" "}
                          <span className="font-medium">{s.capabilityName ?? selectedCap.name}</span>
                          {s.industryName && <> in <span className="font-medium">{s.industryName}</span></>}
                        </span>
                      </div>
                      {s.rationale && <p className="text-sm text-muted-foreground mb-2">{s.rationale}</p>}
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {s.ceQuadrant && <Badge variant="outline" className="text-[10px]">CE: {s.ceQuadrant}</Badge>}
                        {s.streetQuadrant && <Badge variant="outline" className="text-[10px]">Street: {s.streetQuadrant}</Badge>}
                        {s.spreadPct !== null && (
                          <span className="text-muted-foreground font-mono">spread {s.spreadPct > 0 ? "+" : ""}{s.spreadPct.toFixed(1)}%</span>
                        )}
                        <span className="text-muted-foreground ml-auto">{new Date(s.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">Strength</p>
                      <p className="font-mono text-2xl font-semibold text-primary">{s.strength.toFixed(0)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
