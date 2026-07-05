import { formatMemoryDate, type MemoryItem } from "../../lib/memory.js";

/**
 * ME-1/ME-4: active memories in injection order (pinned first, then newest) —
 * the API sorts; this only renders. Card rows rather than a table so long
 * memory text wraps readably on phones (PRD §5.5).
 */
export function MemoryList({ memories }: { memories: MemoryItem[] }) {
  return (
    <ul className="memory-list">
      {memories.map((m) => (
        <li key={m.id} className="card memory-row">
          <p className="memory-content">{m.content}</p>
          <div className="memory-meta">
            {m.pinned ? <span className="memory-pin">★ pinned</span> : null}
            {m.category ? <span className="memory-category">{m.category}</span> : null}
            <span>{formatMemoryDate(m.createdAt)}</span>
            {m.source ? <span>via {m.source}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
