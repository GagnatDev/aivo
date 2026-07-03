import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, DEGRADATION_META, seriesColor } from "../../lib/palette.js";
import {
  type BurnDownPoint,
  formatCentsTick,
  formatDayTick,
  type UsageSummary,
} from "../../lib/usage.js";
import { ChartTooltip } from "./ChartTooltip.js";

export interface BurnDownChartProps {
  points: BurnDownPoint[];
  summary: UsageSummary;
}

/**
 * U-1: cumulative month-to-date spend against the monthly ceiling, with hairline
 * reference lines at the configured alert thresholds. Single series — the title
 * carries identity, so there is no legend box.
 */
export function BurnDownChart({ points, summary }: BurnDownChartProps) {
  const ceiling = summary.monthlyCeiling?.cents ?? null;
  const thresholds = ceiling ? summary.alertThresholds.filter((pct) => pct > 0 && pct < 100) : [];
  const yMax = Math.max(ceiling ?? 0, ...points.map((p) => p.cumulativeCents));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={points} margin={{ top: 12, right: 56, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={formatDayTick}
          tick={{ fill: CHART.axisText, fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: CHART.baseline }}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={formatCentsTick}
          tick={{ fill: CHART.axisText, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={52}
          domain={[0, Math.ceil(yMax * 1.08)]}
        />
        <Tooltip
          content={<ChartTooltip format={formatCentsTick} />}
          cursor={{ stroke: CHART.referenceLine, strokeWidth: 1 }}
        />
        {thresholds.map((pct) => (
          <ReferenceLine
            key={pct}
            y={(ceiling! * pct) / 100}
            stroke={CHART.referenceLine}
            strokeWidth={1}
            label={{
              value: `${pct}%`,
              position: "right",
              fill: CHART.axisText,
              fontSize: 11,
            }}
          />
        ))}
        {ceiling != null ? (
          <ReferenceLine
            y={ceiling}
            stroke={DEGRADATION_META.over_ceiling.color}
            strokeWidth={1}
            label={{
              value: "ceiling",
              position: "right",
              fill: CHART.axisText,
              fontSize: 11,
            }}
          />
        ) : null}
        <Line
          name="Spent"
          type="monotone"
          dataKey="cumulativeCents"
          stroke={seriesColor(0)}
          strokeWidth={2}
          strokeLinecap="round"
          dot={false}
          activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
