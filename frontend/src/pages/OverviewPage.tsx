import { Link } from "react-router-dom";
import type { Me } from "../api/client.js";
import { useApi } from "../api/useApi.js";

/** Home page. KPI widgets arrive with M4 (they compose M1–M3 data); M0 ships the
 * authenticated shell with quick links (PRD O-7). */
export function OverviewPage() {
  const me = useApi<Me>("/api/dashboard/me");

  return (
    <section>
      <h1>Overview</h1>
      <p className="muted">
        {me.data
          ? `Signed in as ${me.data.user.displayName ?? me.data.user.id}.`
          : "At-a-glance health and KPIs."}
      </p>
      <div className="card-grid">
        <Link className="card card-link" to="/usage">
          <h2>Usage &amp; Budget</h2>
          <p>LLM spend, burn-down vs. ceiling, top drivers.</p>
        </Link>
        <Link className="card card-link" to="/memory">
          <h2>Memory &amp; Profiles</h2>
          <p>What aivo remembers, searchable.</p>
        </Link>
        <Link className="card card-link" to="/digests">
          <h2>Digests</h2>
          <p>YouTube digest runs and their cost.</p>
        </Link>
      </div>
    </section>
  );
}
