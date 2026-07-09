import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api/useApi.js";
import { PricingTable } from "../components/models/PricingTable.js";
import { TierCards } from "../components/models/TierCards.js";
import { UsageShareList } from "../components/models/UsageShareList.js";
import { buildShares, type ModelsOverview, type ModelsUsage } from "../lib/models.js";
import { rangeToWindow, type UsageRange } from "../lib/usage.js";

const RANGES: Array<{ value: UsageRange; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "mtd", label: "MTD" },
];

/** Models & Pricing (M2) — see PRD §4.4, requirements M-1..M-6. */
export function ModelsPage() {
  const [range, setRange] = useState<UsageRange>("mtd");
  // Snapshot the clock per refresh so query strings are stable across renders.
  const [now, setNow] = useState(() => new Date());

  const usagePath = useMemo(() => {
    const { from } = rangeToWindow(range, now);
    return `/api/dashboard/models/usage?since=${encodeURIComponent(from.toISOString())}`;
  }, [range, now]);

  const overview = useApi<ModelsOverview>("/api/dashboard/models");
  const usage = useApi<ModelsUsage>(usagePath);

  const shares = useMemo(() => (usage.data ? buildShares(usage.data) : null), [usage.data]);
  const error = overview.error ?? usage.error;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Models &amp; Pricing</h1>
          <p className="muted">
            Configured models, tier roles, and usage share. Changes stay in Discord for v1.
          </p>
        </div>
        <button
          type="button"
          className="refresh"
          onClick={() => {
            setNow(new Date());
            overview.reload();
          }}
        >
          Refresh
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {overview.data ? <TierCards overview={overview.data} /> : null}

      <div className="card chart-card">
        <h2>Active models</h2>
        <p className="muted">
          Prices in cents per 1,000,000 tokens. Cost per call = (tokens in × input price + tokens
          out × output price) ÷ 1,000,000.
        </p>
        {overview.data ? (
          <PricingTable models={overview.data.models} />
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>

      <div className="card chart-card">
        <div className="chart-controls">
          <h2>Usage share</h2>
          <fieldset className="seg-group">
            <legend className="visually-hidden">Date range</legend>
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                className={range === r.value ? "seg active" : "seg"}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </fieldset>
        </div>
        {shares && shares.length > 0 ? (
          <UsageShareList shares={shares} />
        ) : usage.loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <p className="muted empty-state">No usage in this range — start a chat in #chat.</p>
        )}
        <p className="muted models-footnote">
          Full spend breakdown lives on <Link to="/usage">Usage &amp; Budget</Link>.
        </p>
      </div>
    </section>
  );
}
