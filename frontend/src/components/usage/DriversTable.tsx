import type { UsageDrivers } from "../../lib/usage.js";

/** U-3: top spend drivers by (model, task type) — the page's table view. */
export function DriversTable({ drivers }: { drivers: UsageDrivers }) {
  if (drivers.drivers.length === 0) {
    return <p className="muted">No usage in this period.</p>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Task type</th>
            <th className="num">Calls</th>
            <th className="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          {drivers.drivers.map((d) => (
            <tr key={`${d.model}:${d.taskType}`}>
              <td>{d.model}</td>
              <td>{d.taskType}</td>
              <td className="num">{d.calls}</td>
              <td className="num">{d.cost.formatted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
