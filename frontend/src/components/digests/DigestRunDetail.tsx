import { useApi } from "../../api/useApi.js";
import {
  DIGEST_STATUS_META,
  formatConfidence,
  formatDuration,
  formatReleaseAt,
  partitionDigestItems,
  summarizeFeedback,
  videoUrl,
  type DigestDetail,
  type DigestItem,
} from "../../lib/digests.js";
import { formatShortDate } from "../../lib/overview.js";
import { DigestFailureNote } from "./DigestFailureNote.js";

function PickCard({ item, upcoming = false }: { item: DigestItem; upcoming?: boolean }) {
  const confidence = formatConfidence(item.confidence);
  const duration = !upcoming && item.video ? formatDuration(item.video.durationSeconds) : null;
  const releaseAt = upcoming && item.video ? formatReleaseAt(item.video.publishedAt) : null;
  return (
    <li className={`card digest-pick${upcoming ? " digest-pick-upcoming" : ""}`}>
      <div className="digest-pick-head">
        {!upcoming && item.rank != null ? <span className="digest-rank">#{item.rank}</span> : null}
        {upcoming ? <span className="digest-rank digest-upcoming-badge">Soon</span> : null}
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
            {releaseAt ? <span>Releases {releaseAt}</span> : null}
            {!upcoming && item.video ? (
              <span>{formatShortDate(item.video.publishedAt)}</span>
            ) : null}
            {confidence ? <span>confidence {confidence}</span> : null}
          </div>
        </div>
      </div>
      {upcoming ? <p className="digest-upcoming-note">Not released yet</p> : null}
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
 * Still-unreleased picks (premieres / scheduled uploads) sit below the rest.
 */
export function DigestRunDetail({ id }: { id: string }) {
  const detail = useApi<DigestDetail>(`/api/dashboard/digests/${id}`);
  const data = detail.data;

  if (detail.error) return <div className="error-banner">{detail.error}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  const status = DIGEST_STATUS_META[data.run.status];
  const feedback = summarizeFeedback(data.feedback);
  const { released, upcoming } = partitionDigestItems(data.picks);
  return (
    <>
      <DigestFailureNote failure={data.run.failure} />
      <div className="stat-grid">
        <div className="card stat-tile">
          <div className="stat-label">Status</div>
          <div className="stat-value status-chip" style={{ color: status.color }}>
            <span aria-hidden="true">{status.icon}</span> {status.label}
          </div>
          <div className="stat-detail">
            {data.run.deliveredAt
              ? `delivered ${formatShortDate(data.run.deliveredAt)}`
              : data.run.status === "failed"
                ? "the run did not complete"
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
        <div className="card stat-tile">
          <div className="stat-label">Your feedback</div>
          <div className="stat-value digest-feedback">{feedback ?? "—"}</div>
          <div className="stat-detail">
            {feedback ? "reactions on this run's picks" : "no reactions on this run yet"}
          </div>
        </div>
      </div>

      <div className="card chart-card">
        <h2>Picks</h2>
        <p className="muted">Ranked by the stage-2 relevance filter.</p>
        {released.length > 0 ? (
          <ul className="digest-pick-list">
            {released.map((item) => (
              <PickCard key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <p className="muted">
            {upcoming.length > 0 ? "No released picks in this run." : "No picks in this run."}
          </p>
        )}
      </div>

      {upcoming.length > 0 ? (
        <div className="card chart-card">
          <h2>Coming up — not released yet</h2>
          <p className="muted">Premieres and scheduled uploads, earliest first.</p>
          <ul className="digest-pick-list">
            {upcoming.map((item) => (
              <PickCard key={item.id} item={item} upcoming />
            ))}
          </ul>
        </div>
      ) : null}

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
