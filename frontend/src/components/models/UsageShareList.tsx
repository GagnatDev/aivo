import { seriesColor } from "../../lib/palette.js";
import type { ModelShare } from "../../lib/models.js";

/**
 * M-4: per-model spend share as horizontal bars — reads at a glance on a phone
 * where a donut legend would not (PRD §5.5). Colors follow the same stable
 * alphabetical identity as the Usage page's grouped charts.
 */
export function UsageShareList({ shares }: { shares: ModelShare[] }) {
  return (
    <ul className="share-list">
      {shares.map((s) => (
        <li key={s.model} className="share-row">
          <div className="share-head">
            <span className="share-swatch" style={{ background: seriesColor(s.colorIndex) }} />
            <span className="share-model">{s.model}</span>
            <span className="share-figures">
              {s.cost.formatted} · {s.calls} {s.calls === 1 ? "call" : "calls"} ·{" "}
              {Math.round(s.share * 100)}%
            </span>
          </div>
          <div className="share-track">
            <div
              className="share-fill"
              style={{
                width: `${Math.max(s.share * 100, s.cost.cents > 0 ? 1 : 0)}%`,
                background: seriesColor(s.colorIndex),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
