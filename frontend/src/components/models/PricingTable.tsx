import { formatPerMtok, type ModelRow } from "../../lib/models.js";

/** M-1: the active model/pricing table — the web superset of Discord `!models`. */
export function PricingTable({ models }: { models: ModelRow[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Roles</th>
            <th>Capabilities</th>
            <th className="num">Input / Mtok</th>
            <th className="num">Cached in / Mtok</th>
            <th className="num">Output / Mtok</th>
            <th className="num">Audio / min</th>
            <th>Currency</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.modelId}>
              <td>{m.modelId}</td>
              <td>
                {m.roles.length > 0
                  ? m.roles.map((r) => (
                      <span className="tier-badge" key={`${r.capability}:${r.role}`}>
                        {r.capability} {r.role}
                      </span>
                    ))
                  : "—"}
              </td>
              <td>{m.capabilities.join(", ")}</td>
              <td className="num">{formatPerMtok(m.inputCentsPerMtok)}</td>
              <td className="num">
                {m.cachedInputCentsPerMtok != null ? formatPerMtok(m.cachedInputCentsPerMtok) : "—"}
              </td>
              <td className="num">{formatPerMtok(m.outputCentsPerMtok)}</td>
              <td className="num">
                {m.audioCentsPerMin != null ? formatPerMtok(m.audioCentsPerMin) : "—"}
              </td>
              <td>{m.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
