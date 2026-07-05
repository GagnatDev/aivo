import { useApi } from "../../api/useApi.js";
import {
  DIGEST_STATUS_META,
  formatConfidence,
  formatDuration,
  videoUrl,
  type DigestDetail,
  type DigestItem,
} from "../../lib/digests.js";
import { formatShortDate } from "../../lib/overview.js";

function PickCard({ item }: { item: DigestItem }) {
  const confidence = formatConfidence(item.confidence);
  const duration = item.video ? formatDuration(item.video.durationSeconds) : null;
  return (
    <li className="card digest-pick">
      <div className="digest-pick-head">
        {item.rank != null ? <span className="digest-rank">#{item.rank}</span> : null}
        <div className="digest-pick-title">
          {item.video ? (
            <a href={videoUrl(item.video.id)} target="_blank" rel="noreferrer">
              {item.video.title}
            </a>
          ) : (
            <span className="muted">video no longer cached</span>
          )}
          <div className="digest-pick-meta">
            {item.video?.channelTitle ? <span>{item.video.channelTitle}</span> : null}
            {duration ? <span>{duration}</span> : null}
            {item.video ? <span>{formatShortDate(item.video.publishedAt)}</span> : null}
            {confidence ? <span>confidence {confidence}</span> : null}
          </div>
        </div>
      </div>
      {item.video?.summary ? <p className="digest-summary">{item.video.summary}</p> : null}
      {item.video?.why ? (
        <p className="digest-why">
          <span className="muted">Why: </span>
          {item.video.why}
        </p>
      ) : null}
    </li>
  );
}

/**
 * D-2/D-3: one run drilled open — header stats, ranked picks with the video
 * metadata the Discord message shows, and the rejected list with reasons.
 */
export function DigestRunDetail({ id }: { id: string }) {
  const detail = useApi<DigestDetail>(`/api/dashboard/digests/${id}`);
  const data = detail.data;

  if (detail.error) return <div className="error-banner">{detail.error}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  const status = DIGEST_STATUS_META[data.run.status];
  return (
    <>
      <div className="stat-grid">
        <div className="card stat-tile">
          <div className="stat-label">Status</div>
          <div className="stat-value status-chip" style={{ color: status.color }}>
            <span aria-hidden="true">{status.icon}</span> {status.label}
          </div>
          <div className="stat-detail">
            {data.run.deliveredAt
              ? `delivered ${formatShortDate(data.run.deliveredAt)}`
              : "not delivered"}
          </div>
        </div>
        <div className="card stat-tile">
          <div className="stat-label">Run cost</div>
          <div className="stat-value">{data.run.cost.formatted}</div>
          <div className="stat-detail">LLM spend rolled up from the ledger</div>
        </div>
        <div className="card stat-tile">
          <div className="stat-label">Covers</div>
          <div className="stat-value">{formatShortDate(data.run.coversSince)} →</div>
          <div className="stat-detail">videos published since the previous run</div>
        </div>
      </div>

      <div className="card chart-card">
        <h2>Picks</h2>
        <p className="muted">Ranked by the stage-2 relevance filter.</p>
        {data.picks.length > 0 ? (
          <ul className="digest-pick-list">
            {data.picks.map((item) => (
              <PickCard key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <p className="muted">No picks in this run.</p>
        )}
      </div>

      <div className="card chart-card">
        <h2>Rejected</h2>
        <p className="muted">Filtered out, with the reason — so you can audit the taste.</p>
        {data.rejects.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Video</th>
                  <th>Channel</th>
                  <th className="num">Confidence</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.rejects.map((item) => (
                  <tr key={item.id}>
                    <td className="digest-reject-title">
                      {item.video ? (
                        <a href={videoUrl(item.video.id)} target="_blank" rel="noreferrer">
                          {item.video.title}
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{item.video?.channelTitle ?? "—"}</td>
                    <td className="num">{formatConfidence(item.confidence) ?? "—"}</td>
                    <td className="digest-reject-reason">{item.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Nothing was rejected in this run.</p>
        )}
      </div>
    </>
  );
}
