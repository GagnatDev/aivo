import { DEGRADATION_META } from "../../lib/palette.js";
import type { UsageSummary } from "../../lib/usage.js";

/**
 * U-5 + U-6: budget config and the degradation state as stat tiles. Values stay
 * in ink tokens; the status chip pairs a glyph + label with its reserved color
 * so state never rides on color alone.
 */
export function SummaryCards({ summary }: { summary: UsageSummary }) {
  const status = DEGRADATION_META[summary.degradation.state];
  const ceiling = summary.monthlyCeiling;
  return (
    <div className="stat-grid">
      <div className="card stat-tile">
        <div className="stat-label">Today</div>
        <div className="stat-value">{summary.today.formatted}</div>
        {summary.dailySoftCap ? (
          <div className="stat-detail">soft cap {summary.dailySoftCap.formatted}</div>
        ) : (
          <div className="stat-detail">no daily soft cap</div>
        )}
      </div>
      <div className="card stat-tile">
        <div className="stat-label">Month to date</div>
        <div className="stat-value">{summary.monthToDate.formatted}</div>
        <div className="stat-detail">
          {ceiling
            ? `${Math.round(summary.pctOfCeiling)}% of ${ceiling.formatted} ceiling`
            : "no monthly ceiling set"}
        </div>
      </div>
      <div className="card stat-tile">
        <div className="stat-label">Budget state</div>
        <div className="stat-value status-chip" style={{ color: status.color }}>
          <span aria-hidden="true">{status.icon}</span> {status.label}
        </div>
        <div className="stat-detail">{summary.degradation.description}</div>
      </div>
      <div className="card stat-tile">
        <div className="stat-label">Approval gate</div>
        <div className="stat-value">
          {summary.approvalThreshold ? summary.approvalThreshold.formatted : "off"}
        </div>
        <div className="stat-detail">
          {summary.approvalThreshold
            ? "calls estimated above this ask first"
            : "no per-call approval threshold"}
        </div>
      </div>
    </div>
  );
}
