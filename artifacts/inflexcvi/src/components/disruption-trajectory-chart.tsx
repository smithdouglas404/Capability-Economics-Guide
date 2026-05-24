/**
 * <DisruptionTrajectoryChart trajectory={[...]} crossoverMonth={N} />
 *
 * Renders the time-series output of /api/disruption-simulator/run:
 *   - Two lines: incumbent CVI (red, declining) + entrant strength (emerald,
 *     rising)
 *   - Vertical reference marker at the crossover month + label "Crossover @ M9"
 *   - Optional second axis: cumulative dollars disrupted (muted dotted line)
 *   - Tooltip shows month + both line values + cumulative $ at risk
 *
 * Separate component so the /disruption-simulator page can compose it next
 * to the cascade radar + defender-options panel.
 */
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend, CartesianGrid } from "recharts";

interface TrajectoryPoint {
  month: number;
  entrantStrength: number;
  incumbentCvi: number;
  entrantMarketShare: number;
  cumulativeDollarsDisruptedMm: number;
}

export function DisruptionTrajectoryChart({
  trajectory,
  crossoverMonth,
}: {
  trajectory: TrajectoryPoint[];
  crossoverMonth: number | null;
}) {
  if (trajectory.length === 0) {
    return (
      <div className="border border-border/60 p-6 text-center text-sm text-muted-foreground">
        No trajectory data — run the simulator above.
      </div>
    );
  }

  return (
    <div className="w-full" style={{ height: 360 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={trajectory} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
          <XAxis
            dataKey="month"
            label={{ value: "Month", position: "insideBottom", offset: -5, className: "text-[10px]" }}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            yAxisId="left"
            domain={[0, 100]}
            label={{ value: "Score (0-100)", angle: -90, position: "insideLeft", className: "text-[10px]" }}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            label={{ value: "$ MM disrupted", angle: 90, position: "insideRight", className: "text-[10px]" }}
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 0, fontSize: 11 }}
            labelFormatter={(label) => `Month ${label}`}
            formatter={(value: number, name: string) => {
              if (name === "Cumulative $ MM") return [`$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}M`, name];
              return [value.toFixed(1), name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="incumbentCvi"
            name="Incumbent CVI"
            stroke="rgb(244 63 94)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="entrantStrength"
            name="Entrant strength"
            stroke="rgb(16 185 129)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cumulativeDollarsDisruptedMm"
            name="Cumulative $ MM"
            stroke="rgb(120 113 108)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
          />
          {crossoverMonth !== null && (
            <ReferenceLine
              yAxisId="left"
              x={crossoverMonth}
              stroke="rgb(245 158 11)"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              label={{ value: `Crossover M${crossoverMonth}`, position: "top", className: "text-[10px]", fill: "rgb(245 158 11)" }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface CascadePoint {
  capabilityId: number;
  capabilityName: string;
  baselineCvi: number;
  finalCvi: number;
  deltaPct: number;
}

export function DisruptionCascadeList({ cascade }: { cascade: CascadePoint[] }) {
  if (cascade.length === 0) {
    return (
      <div className="border border-border/60 p-4 text-sm text-muted-foreground">
        No second-order cascade — the target capabilities have no dependents in our graph, or the projected decay is below the 0.5% display threshold.
      </div>
    );
  }
  return (
    <ul className="space-y-1.5">
      {cascade.map((c) => (
        <li key={c.capabilityId} className="flex items-center justify-between gap-2 text-xs border-b border-border/40 pb-1.5">
          <span className="truncate flex-1">{c.capabilityName}</span>
          <span className="font-mono tabular-nums text-muted-foreground">{c.baselineCvi.toFixed(0)}</span>
          <span className="font-mono text-muted-foreground">→</span>
          <span className="font-mono tabular-nums">{c.finalCvi.toFixed(0)}</span>
          <span className={`font-mono tabular-nums w-14 text-right ${c.deltaPct < -10 ? "text-rose-500" : c.deltaPct < -5 ? "text-amber-500" : "text-muted-foreground"}`}>
            {c.deltaPct > 0 ? "+" : ""}{c.deltaPct.toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
