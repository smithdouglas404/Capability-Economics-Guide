import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Globe2, ArrowUp, ArrowDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const API_BASE = "/api";

type Capability = { id: number; name: string; slug: string; industryId: number; parentCapabilityId?: number | null };
type Industry = { id: number; name: string };
type Component = { capabilityId: number; industryId: number; consensusScore: number; velocity: number; confidence: number };

function barColor(score: number): string {
  if (score >= 60) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-rose-500";
}

export default function CrossIndustryPage() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [pickedName, setPickedName] = useState<string>("");

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/capabilities`).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/industries`).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/cei/components`).then(r => r.json()).catch(() => []),
    ]).then(([cRes, iRes, kRes]) => {
      setCapabilities(cRes.capabilities ?? cRes ?? []);
      setIndustries(iRes.industries ?? iRes ?? []);
      setComponents(Array.isArray(kRes) ? kRes : (kRes.components ?? []));
    });
  }, []);

  const indById = useMemo(() => new Map(industries.map(i => [i.id, i.name])), [industries]);

  const uniqueNames = useMemo(() => {
    const set = new Map<string, string>();
    for (const c of capabilities) {
      if (c.parentCapabilityId !== null && c.parentCapabilityId !== undefined) continue;
      const key = c.name.trim().toLowerCase();
      if (!set.has(key)) set.set(key, c.name);
    }
    return Array.from(set.values()).sort();
  }, [capabilities]);

  const rows = useMemo(() => {
    if (!pickedName) return [];
    const target = pickedName.trim().toLowerCase();
    const idsOfName = new Set(
      capabilities.filter(c => c.name.trim().toLowerCase() === target).map(c => c.id)
    );
    return components
      .filter(c => idsOfName.has(c.capabilityId))
      .map(c => ({
        industryId: c.industryId,
        industryName: indById.get(c.industryId) ?? `Industry ${c.industryId}`,
        score: c.consensusScore,
        velocity: c.velocity,
      }))
      .sort((a, b) => b.score - a.score);
  }, [pickedName, capabilities, components, indById]);

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Academic · Cross-Industry</p>
        <h1 className="font-serif text-4xl tracking-tight mb-2 flex items-center gap-3">
          <Globe2 className="w-8 h-8 text-primary" />
          Cross-Industry View
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Pick one capability and see its consensus score across every industry where it has been measured.
          Useful for teaching diffusion, maturity gaps, and where a capability is mature vs. emerging.
        </p>
      </motion.div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Choose capability</CardTitle>
          <CardDescription>Capability names are matched across industries.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={pickedName} onValueChange={setPickedName}>
            <SelectTrigger data-testid="capability-select"><SelectValue placeholder="Select a capability…" /></SelectTrigger>
            <SelectContent className="max-h-96">
              {uniqueNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {pickedName && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-lg">{pickedName}</CardTitle>
            <CardDescription>
              {rows.length === 0 ? "No CEI components found across industries yet." : `Across ${rows.length} ${rows.length === 1 ? "industry" : "industries"}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {rows.map(r => (
                <div key={r.industryId} className="flex items-center gap-3" data-testid={`bar-${r.industryId}`}>
                  <div className="w-40 text-sm shrink-0 truncate">{r.industryName}</div>
                  <div className="flex-1 h-6 bg-muted/40 rounded relative overflow-hidden">
                    <div
                      className={`h-full ${barColor(r.score)} transition-all`}
                      style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }}
                    />
                  </div>
                  <div className="w-20 text-right font-mono text-sm shrink-0 inline-flex items-center justify-end gap-1">
                    {r.velocity > 0.001 && <ArrowUp className="w-3 h-3 text-emerald-600" />}
                    {r.velocity < -0.001 && <ArrowDown className="w-3 h-3 text-rose-600" />}
                    {r.score.toFixed(0)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
