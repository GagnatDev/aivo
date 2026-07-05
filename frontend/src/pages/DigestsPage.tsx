import { useState } from "react";
import { useApi } from "../api/useApi.js";
import { DigestRunDetail } from "../components/digests/DigestRunDetail.js";
import { DigestRunList } from "../components/digests/DigestRunList.js";
import type { DigestRuns } from "../lib/digests.js";

/** Digest History (M5) — see PRD §4.6, requirements D-1..D-3. Owner only. */
export function DigestsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const runs = useApi<DigestRuns>("/api/dashboard/digests");
  const data = runs.data;
  const selected = data?.runs.find((r) => r.id === selectedId);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Digest History</h1>
          <p className="muted">
            {selected
              ? `Run ${selected.runDate} — picks, rejects, and cost.`
              : "YouTube digest runs: what was picked, what was filtered, and what it cost."}
          </p>
        </div>
        {selected ? (
          <button type="button" className="refresh" onClick={() => setSelectedId(null)}>
            ← All runs
          </button>
        ) : (
          <button type="button" className="refresh" onClick={() => runs.reload()}>
            Refresh
          </button>
        )}
      </div>

      {runs.error ? <div className="error-banner">{runs.error}</div> : null}

      {selected ? (
        <DigestRunDetail id={selected.id} />
      ) : data ? (
        data.runs.length > 0 ? (
          <div className="card chart-card">
            <DigestRunList runs={data.runs} onSelect={setSelectedId} />
          </div>
        ) : (
          <p className="muted empty-state">
            No digest runs yet — connect YouTube and the daily digest will land here.
          </p>
        )
      ) : (
        <p className="muted">Loading…</p>
      )}
    </section>
  );
}
