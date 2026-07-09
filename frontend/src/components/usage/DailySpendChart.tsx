import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, seriesColor } from "../../lib/palette.js";
import { formatCentsTick, formatDayTick, type PivotedSeries } from "../../lib/usage.js";
import { ChartTooltip } from "./ChartTooltip.js";

export interface DailySpendChartProps {
  pivot: PivotedSeries;
}

/**
 * U-2: daily spend columns — a single series for the plain total, stacked by
 * model/task type when grouped. Colors are assigned by the group's position in
 * the stable alphabetical order (identity), never by spend rank. Stacked
 * segments are separated by a 2px surface-colored gap (stroke), not borders.
 */
export function DailySpendChart({ pivot }: DailySpendChartProps) {
  const grouped = pivot.groups.length > 1 || pivot.groups[0] !== "total";

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={pivot.rows} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
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
        />
        <Tooltip
          content={<ChartTooltip format={formatCentsTick} />}
          cursor={{ fill: "rgba(255, 255, 255, 0.05)" }}
        />
        {grouped ? (
          <Legend
            formatter={(value: string) => <span className="legend-label">{value}</span>}
            iconType="circle"
            iconSize={9}
          />
        ) : null}
        {pivot.groups.map((group, i) => (
          <Bar
            key={group}
            name={group === "total" ? "Spend" : group}
            dataKey={group}
            stackId="spend"
            fill={seriesColor(i)}
            stroke={CHART.surface}
            strokeWidth={grouped ? 1 : 0}
            maxBarSize={24}
            radius={i === pivot.groups.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
