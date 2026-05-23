import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, Play, Loader2, TrendingDown, TrendingUp, Link as LinkIcon } from "lucide-react";
import { Link } from "wouter";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

const API_BASE = "/api";

interface Industry { id: number; name: string; slug: string }

interface ForecastResponse {
  industryId: number;
  industryName: string;
  shockType: string;
  shockMagnitude: number;
  sentimentDirection: "positive" | "negative" | "neutral";
  baselineCviCurrent: number;
  months: Array<{ month: number; baselineCvi: number; shockedCvi: number }>;
}

// Curated shock presets. The free-form `shockType` string flows through to the
// backend and into the synthetic MacroEvent's eventType field — it's purely a
// label for downstream attribution; the engine math is driven by severity +
// direction + decayDays, not by the type string itself.
const SHOCK_PRESETS: Array<{ value: string; label: string; defaultMagnitude: number; direction: "positive" | "negative" | "neutral"; blurb: string }> = [
  { value: "interest_rate_rise", label: "Interest rates rise 200bps", defaultMagnitude: 5, direction: "negative", blurb: "Cost of capital up, valuations compress." },
  { value: "ai_displacement_accel", label: "AI displacement accelerates 30%", defaultMagnitude: 7, direction: "negative", blurb: "Routine labor capabilities lose half-life." },
  { value: "regulatory_tightening", label: "Major regulatory tightening", defaultMagnitude: 6, direction: "negative", blurb: "Compliance burden, slower throughput." },
  { value: "macro_shock_war", label: "Geopolitical conflict / supply shock", defaultMagnitude: 8, direction: "negative", blurb: "Sector-wide volatility spike." },
  { value: "tech_breakthrough", label: "Positive tech breakthrough", defaultMagnitude: 5, direction: "positive", blurb: "Capabilities re-rated upward." },
  { value: "demand_surge", label: "Demand surge / sector tailwind", defaultMagnitude: 4, direction: "positive", blurb: "Revenue exposure expands." },
];

export default function Simulation() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industryId, setIndustryId] = useState<number | null>(null);
  const [shockKey, setShockKey] = useState<string>(SHOCK_PRESETS[0].value);
  const [magnitude, setMagnitude] = useState<number>(SHOCK_PRESETS[0].defaultMagnitude);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/industries`).then(r => r.json()).then((d: Industry[]) => {
      setIndustries(d ?? []);
      if (d?.length && industryId == null) setIndustryId(d[0].id);
    }).catch(() => {});
  }, []);

  const preset = SHOCK_PRESETS.find(p => p.value === shockKey) ?? SHOCK_PRESETS[0];

  function pickPreset(value: string) {
    const p = SHOCK_PRESETS.find(x => x.value === value);
    setShockKey(value);
    if (p) setMagnitude(p.defaultMagnitude);
  }

  async function run() {
    if (!industryId) return;
    setLoading(true);
    setErr(null);
    setForecast(null);
    try {
      const r = await fetch(`${API_BASE}/simulation/forecast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industryId,
          shockType: shockKey,
          shockMagnitude: magnitude,
          sentimentDirection: preset.direction,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      setForecast(await r.json() as ForecastResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Forecast failed");
    } finally {
      setLoading(false);
    }
  }

  const terminalDelta = forecast
    ? forecast.months[forecast.months.length - 1].shockedCvi - forecast.months[forecast.months.length - 1].baselineCvi
    : 0;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      <div>
        <div className="inline-flex items-center gap-2 mb-2">
          <span className="h-px w-5 bg-accent" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">Scenario engine</span>
        </div>
        <h1 className="text-3xl font-serif tracking-tight">12-month forward simulation</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Project the industry's CVI trajectory under a hypothetical shock. Uses the same Bayesian
          posterior + GDP-weighted rollup as the live CVI engine — the shock injects a synthetic
          macro event that decays over twelve months.
        </p>
        <Link href="/whatif" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-2">
          <LinkIcon className="w-3 h-3" /> See instead: capability-level what-if
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 rounded-none border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FlaskConical className="w-5 h-5" /> Configure shock</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="sim-industry">Industry</Label>
              <select
                id="sim-industry"
                value={industryId ?? ""}
                onChange={e => setIndustryId(Number(e.target.value))}
                className="w-full h-9 px-2 text-sm border border-input bg-background rounded-none"
              >
                {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>

            <div>
              <Label htmlFor="sim-shock">Shock type</Label>
              <select
                id="sim-shock"
                value={shockKey}
                onChange={e => pickPreset(e.target.value)}
                className="w-full h-9 px-2 text-sm border border-input bg-background rounded-none"
              >
                {SHOCK_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <p className="text-xs text-muted-foreground mt-1">{preset.blurb}</p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Magnitude</Label>
                <span className="font-mono text-sm tabular-nums">{magnitude.toFixed(1)} / 10</span>
              </div>
              <Slider value={[magnitude]} min={0} max={10} step={0.5} onValueChange={([v]) => setMagnitude(v)} />
              <div className="flex justify-between text-[10px] uppercase font-mono tracking-wider text-muted-foreground mt-1">
                <span>mild</span><span>severe</span>
              </div>
            </div>

            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Direction: <span className={preset.direction === "positive" ? "text-emerald-500" : preset.direction === "negative" ? "text-rose-500" : ""}>{preset.direction}</span>
            </div>

            <Button onClick={run} disabled={loading || !industryId} className="w-full rounded-none">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              Run 12-month forecast
            </Button>

            {err && <div className="border border-rose-500/40 bg-rose-500/10 text-rose-500 px-3 py-2 text-sm font-mono">{err}</div>}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {forecast ? (
            <>
              <Card className="rounded-none border-border/60">
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Industry</div>
                      <div className="font-serif text-xl">{forecast.industryName}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Terminal Δ (mo 12)</div>
                      <div className={`font-mono text-2xl tabular-nums inline-flex items-center gap-1 ${terminalDelta >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                        {terminalDelta >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                        {terminalDelta >= 0 ? "+" : ""}{terminalDelta.toFixed(1)}
                      </div>
                    </div>
                    <Badge variant="outline" className="rounded-none">
                      {forecast.shockType} · mag {forecast.shockMagnitude.toFixed(1)}
                    </Badge>
                  </div>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={forecast.months} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                        <XAxis dataKey="month" tickFormatter={m => `mo ${m}`} tick={{ fontSize: 11 }} />
                        <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 0, fontFamily: "monospace", fontSize: 12 }}
                          formatter={(value: number) => value.toFixed(1)}
                          labelFormatter={(m) => `Month ${m}`}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <ReferenceLine y={forecast.baselineCviCurrent} stroke="var(--muted-foreground)" strokeDasharray="2 4" opacity={0.4} />
                        <Line type="monotone" dataKey="baselineCvi" name="Baseline CVI" stroke="hsl(244 47% 50%)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="shockedCvi" name="Shocked CVI" stroke="hsl(0 72% 51%)" strokeWidth={2} dot={false} strokeDasharray="5 3" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="rounded-none border-border/60">
              <CardContent className="py-16 text-center text-muted-foreground">
                <FlaskConical className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="text-sm">Configure a shock and run a forecast to see the 12-month CVI trajectory.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
