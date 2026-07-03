import { formatDayTick } from "../../lib/usage.js";

export interface TooltipEntry {
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
}

export interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly TooltipEntry[];
  /** Format one entry's numeric value (money, tokens, …). */
  format: (value: number) => string;
}

/** Shared hover tooltip: day heading, then one swatch + label + value per series. */
export function ChartTooltip({ active, label, payload, format }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{formatDayTick(String(label))}</div>
      {payload.map((entry) => (
        <div key={String(entry.name)} className="chart-tooltip-row">
          <span className="swatch" style={{ background: entry.color }} />
          <span className="chart-tooltip-name">{String(entry.name)}</span>
          <span className="chart-tooltip-value">{format(Number(entry.value))}</span>
        </div>
      ))}
    </div>
  );
}
