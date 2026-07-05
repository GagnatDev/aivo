import { useEffect, useMemo, useState } from "react";
import { useApi } from "../api/useApi.js";
import { MemoryList } from "../components/memory/MemoryList.js";
import type { MemoriesResponse, MemoryCategory } from "../lib/memory.js";

const CATEGORIES: Array<{ value: MemoryCategory | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "preference", label: "Preferences" },
  { value: "fact", label: "Facts" },
  { value: "context", label: "Context" },
];

/** Keystrokes settle this long before a search request fires. */
const SEARCH_DEBOUNCE_MS = 300;

/** Memory & Profiles (M3) — see PRD §4.5, requirements ME-1..ME-5. */
export function MemoryPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MemoryCategory | "">("");

  // Debounce typing into the query the API sees.
  useEffect(() => {
    const handle = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    const qs = params.toString();
    return `/api/dashboard/memories${qs ? `?${qs}` : ""}`;
  }, [query, category]);

  const memories = useApi<MemoriesResponse>(path);
  const data = memories.data;
  const filtering = query !== "" || category !== "";

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Memory &amp; Profiles</h1>
          <p className="muted">
            What Aivo remembers about you — inspectable, and editable from Discord ("forget that").
          </p>
        </div>
        <button type="button" className="refresh" onClick={() => memories.reload()}>
          Refresh
        </button>
      </div>

      {memories.error ? <div className="error-banner">{memories.error}</div> : null}

      {data ? (
        <p className="muted inject-hint">
          {data.injectedCount} of {data.activeCount} active memories are injected into Aivo's
          context each turn (pinned first, then newest; limit {data.injectLimit}). The rest stay
          reachable when Aivo searches its memory.
        </p>
      ) : null}

      <div className="memory-controls">
        <input
          type="search"
          className="memory-search"
          placeholder="Search memories…"
          aria-label="Search memories"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <fieldset className="seg-group">
          <legend className="visually-hidden">Category</legend>
          {CATEGORIES.map((c) => {
            const count = c.value === "" ? data?.activeCount : data?.categoryCounts[c.value];
            return (
              <button
                key={c.value}
                type="button"
                className={category === c.value ? "seg active" : "seg"}
                onClick={() => setCategory(c.value)}
              >
                {c.label}
                {count !== undefined ? <span className="seg-count">{count}</span> : null}
              </button>
            );
          })}
        </fieldset>
      </div>

      {data ? (
        data.memories.length > 0 ? (
          <MemoryList memories={data.memories} />
        ) : (
          <p className="muted empty-state">
            {filtering
              ? "No memories match — try a different search or category."
              : "Nothing remembered yet — tell Aivo something about yourself in #chat."}
          </p>
        )
      ) : (
        <p className="muted">Loading…</p>
      )}
    </section>
  );
}
