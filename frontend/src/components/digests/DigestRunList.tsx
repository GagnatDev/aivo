import { DIGEST_STATUS_META, type DigestRunSummary } from "../../lib/digests.js";
import { formatShortDate } from "../../lib/overview.js";

/** D-1: the run history table — date, status, picks/rejects, cost, delivery. */
export function DigestRunList({
  runs,
  onSelect,
}: {
  runs: DigestRunSummary[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Run date</th>
            <th>Status</th>
            <th className="num">Picks</th>
            <th className="num">Rejects</th>
            <th className="num">Cost</th>
            <th>Delivered</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const status = DIGEST_STATUS_META[run.status];
            return (
              <tr key={run.id}>
                <td>
                  <button type="button" className="row-link" onClick={() => onSelect(run.id)}>
                    {run.runDate}
                  </button>
                </td>
                <td>
                  <span style={{ color: status.color }}>
                    <span aria-hidden="true">{status.icon}</span> {status.label}
                  </span>
                </td>
                <td className="num">{run.pickCount}</td>
                <td className="num">{run.rejectCount}</td>
                <td className="num">{run.cost.formatted}</td>
                <td>{run.deliveredAt ? formatShortDate(run.deliveredAt) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
