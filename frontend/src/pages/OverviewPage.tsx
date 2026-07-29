import { Link } from "react-router-dom";
import { useApi } from "../api/useApi.js";
import { DigestFailureNote } from "../components/digests/DigestFailureNote.js";
import { DIGEST_STATUS_LABELS, formatShortDate, type Overview } from "../lib/overview.js";
import { DEGRADATION_META } from "../lib/palette.js";

const QUICK_LINKS = [
  { to: "/usage", title: "Usage & Budget", blurb: "Burn-down, daily spend, top drivers" },
  { to: "/memory", title: "Memory & Profiles", blurb: "Browse and search what Aivo remembers" },
  { to: "/digests", title: "Digests", blurb: "YouTube digest runs and picks" },
];

/** Overview (M4) — see PRD §4.2, requirements O-1..O-7. Composes M1–M3 data. */
export function OverviewPage() {
  const overview = useApi<Overview>("/api/dashboard/overview");
  const data = overview.data;
  const status = data ? DEGRADATION_META[data.spend.degradation.state] : null;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">Aivo at a glance — spend, budget state, memory, and health.</p>
        </div>
        <button type="button" className="refresh" onClick={() => overview.reload()}>
          Refresh
        </button>
      </div>

      {overview.error ? <div className="error-banner">{overview.error}</div> : null}
      {!data && !overview.error ? <p className="muted">Loading…</p> : null}

      {data && status ? (
        <>
          <div className="stat-grid">
            <div className="card stat-tile">
              <div className="stat-label">Today</div>
              <div className="stat-value">{data.spend.today.formatted}</div>
              <div className="stat-detail">LLM spend since midnight UTC</div>
            </div>
            <div className="card stat-tile">
              <div className="stat-label">Month to date</div>
              <div className="stat-value">{data.spend.monthToDate.formatted}</div>
              <div className="stat-detail">
                {data.spend.monthlyCeiling
                  ? `${Math.round(data.spend.pctOfCeiling)}% of ${data.spend.monthlyCeiling.formatted} ceiling`
                  : "no monthly ceiling set"}
              </div>
            </div>
            <div className="card stat-tile">
              <div className="stat-label">Budget state</div>
              <div className="stat-value status-chip" style={{ color: status.color }}>
                <span aria-hidden="true">{status.icon}</span> {status.label}
              </div>
              <div className="stat-detail">{data.spend.degradation.description}</div>
            </div>
            <div className="card stat-tile">
              <div className="stat-label">Memories</div>
              <div className="stat-value">{data.memory.activeCount}</div>
              <div className="stat-detail">
                {data.memory.lastWriteAt
                  ? `last write ${formatShortDate(data.memory.lastWriteAt)}`
                  : "nothing remembered yet"}
              </div>
            </div>
          </div>

          <div className="card-grid">
            <div className="card">
              <h2>Last digest</h2>
              {data.digest ? (
                <>
                  <p className="muted overview-lines">
                    {data.digest.runDate} — {DIGEST_STATUS_LABELS[data.digest.status]}
                    <br />
                    {data.digest.pickCount} {data.digest.pickCount === 1 ? "pick" : "picks"} · cost{" "}
                    {data.digest.cost.formatted}
                    {data.digest.deliveredAt
                      ? ` · delivered ${formatShortDate(data.digest.deliveredAt)}`
                      : ""}
                  </p>
                  <DigestFailureNote failure={data.digest.failure} />
                </>
              ) : (
                <p className="muted">No digest runs yet — connect YouTube and one will appear.</p>
              )}
            </div>
            <div className="card">
              <h2>Service health</h2>
              <ul className="health-list">
                <li>
                  <span className={`health-dot health-${data.health.db === "ok" ? "ok" : "bad"}`} />
                  Database {data.health.db === "ok" ? "reachable" : "unreachable"}
                </li>
                <li>
                  <span
                    className={`health-dot health-${
                      data.health.gateway === "connected"
                        ? "ok"
                        : data.health.gateway === "disconnected"
                          ? "bad"
                          : "unknown"
                    }`}
                  />
                  Discord gateway {data.health.gateway}
                </li>
              </ul>
            </div>
          </div>
        </>
      ) : null}

      <div className="card-grid">
        {QUICK_LINKS.map((link) => (
          <Link key={link.to} to={link.to} className="card card-link">
            <h2>{link.title}</h2>
            <p>{link.blurb}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
