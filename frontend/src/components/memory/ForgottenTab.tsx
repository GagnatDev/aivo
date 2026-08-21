import { useApi } from "../../api/useApi.js";
import { formatMemoryDate, type ForgottenMemoriesResponse } from "../../lib/memory.js";
import { ListSkeleton } from "../Skeleton.js";

/** ME-8: the soft-delete audit trail — "forget that" is reversible, so show it. */
export function ForgottenTab() {
  const forgotten = useApi<ForgottenMemoriesResponse>("/api/dashboard/memories/forgotten");
  const data = forgotten.data;

  if (forgotten.error) return <div className="error-banner">{forgotten.error}</div>;
  if (!data) return <ListSkeleton />;
  if (data.memories.length === 0) {
    return <p className="muted empty-state">Nothing forgotten — every memory is still active.</p>;
  }

  return (
    <ul className="memory-list">
      {data.memories.map((m) => (
        <li key={m.id} className="card memory-row memory-forgotten">
          <p className="memory-content">{m.content}</p>
          <div className="memory-meta">
            {m.category ? <span className="memory-category">{m.category}</span> : null}
            <span>remembered {formatMemoryDate(m.createdAt)}</span>
            <span>forgotten {formatMemoryDate(m.forgottenAt)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
