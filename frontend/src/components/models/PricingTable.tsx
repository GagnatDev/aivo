import { formatPerMtok, type ModelRow } from "../../lib/models.js";

/** M-1: the active model/pricing table — the web superset of Discord `!models`. */
export function PricingTable({ models }: { models: ModelRow[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Tier role</th>
            <th className="num">Input / Mtok</th>
            <th className="num">Output / Mtok</th>
            <th>Currency</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.modelId}>
              <td>{m.modelId}</td>
              <td>{m.tierRole ? <span className="tier-badge">{m.tierRole}</span> : "—"}</td>
              <td className="num">{formatPerMtok(m.inputCentsPerMtok)}</td>
              <td className="num">{formatPerMtok(m.outputCentsPerMtok)}</td>
              <td>{m.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
