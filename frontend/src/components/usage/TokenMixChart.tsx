import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, seriesColor } from "../../lib/palette.js";
import { formatDayTick, formatTokensTick, type TokenMixPoint } from "../../lib/usage.js";
import { ChartTooltip } from "./ChartTooltip.js";

export interface TokenMixChartProps {
  points: TokenMixPoint[];
}

/**
 * U-4: daily tokens in vs tokens out, plus the cached share of tokens in — three
 * fixed-slot series on one token axis, with a legend. Cached is a subset of tokens in,
 * so it always runs at or under that line; it is also dashed so it never reads by
 * color alone.
 */
export function TokenMixChart({ points }: TokenMixChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={points} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
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
          tickFormatter={formatTokensTick}
          tick={{ fill: CHART.axisText, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          content={<ChartTooltip format={(v) => formatTokensTick(v)} />}
          cursor={{ stroke: CHART.referenceLine, strokeWidth: 1 }}
        />
        <Legend
          formatter={(value: string) => <span className="legend-label">{value}</span>}
          iconType="circle"
          iconSize={9}
          // Keep the drawing order (in → cached → out) so the cached subset sits next
          // to its total, instead of Recharts' default alphabetical sort.
          itemSorter={null}
        />
        <Line
          name="Tokens in"
          type="monotone"
          dataKey="tokensIn"
          stroke={seriesColor(0)}
          strokeWidth={2}
          strokeLinecap="round"
          dot={false}
          activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
        />
        <Line
          name="Cached in"
          type="monotone"
          dataKey="tokensCached"
          stroke={seriesColor(2)}
          strokeWidth={2}
          strokeDasharray="6 4"
          strokeLinecap="round"
          dot={false}
          activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
        />
        <Line
          name="Tokens out"
          type="monotone"
          dataKey="tokensOut"
          stroke={seriesColor(1)}
          strokeWidth={2}
          strokeLinecap="round"
          dot={false}
          activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
