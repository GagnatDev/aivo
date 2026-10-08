import { useMemo, useState } from "react";
import { downloadFile } from "../api/client.js";
import { useApi } from "../api/useApi.js";
import { ChartSkeleton, StatGridSkeleton, TableSkeleton } from "../components/Skeleton.js";
import { BurnDownChart } from "../components/usage/BurnDownChart.js";
import { DailySpendChart } from "../components/usage/DailySpendChart.js";
import { DriversTable } from "../components/usage/DriversTable.js";
import { SummaryCards } from "../components/usage/SummaryCards.js";
import { TokenMixChart } from "../components/usage/TokenMixChart.js";
import {
  buildBurnDown,
  buildTokenMix,
  cacheHitRatio,
  listUtcDays,
  pivotBuckets,
  rangeToWindow,
  type UsageDrivers,
  type UsageRange,
  type UsageSeries,
  type UsageSummary,
} from "../lib/usage.js";

const RANGES: Array<{ value: UsageRange; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "mtd", label: "MTD" },
];

const GROUPINGS = [
  { value: "", label: "Total" },
  { value: "model", label: "By model" },
  { value: "task_type", label: "By task type" },
] as const;

/** Usage & Budget (M1) — see PRD §4.3, requirements U-1..U-6. */
export function UsagePage() {
  const [range, setRange] = useState<UsageRange>("mtd");
  const [groupBy, setGroupBy] = useState<"" | "model" | "task_type">("");
  // Snapshot the clock per refresh so query strings are stable across renders
  // (a live `new Date()` here would re-trigger every fetch on every render).
  const [now, setNow] = useState(() => new Date());

  const timeWindow = useMemo(() => rangeToWindow(range, now), [range, now]);
  const seriesPath = useMemo(() => {
    const params = new URLSearchParams({
      from: timeWindow.from.toISOString(),
      to: timeWindow.to.toISOString(),
    });
    if (groupBy) params.set("groupBy", groupBy);
    return `/api/dashboard/usage/series?${params}`;
  }, [timeWindow, groupBy]);
  const burnDownPath = useMemo(() => {
    const mtd = rangeToWindow("mtd", now);
    const params = new URLSearchParams({
      from: mtd.from.toISOString(),
      to: mtd.to.toISOString(),
    });
    return `/api/dashboard/usage/series?${params}`;
  }, [now]);
  const driversPath = useMemo(
    () => `/api/dashboard/usage/drivers?since=${encodeURIComponent(timeWindow.from.toISOString())}`,
    [timeWindow],
  );

  const summary = useApi<UsageSummary>("/api/dashboard/usage/summary");
  const series = useApi<UsageSeries>(seriesPath);
  const burnDownSeries = useApi<UsageSeries>(burnDownPath);
  const drivers = useApi<UsageDrivers>(driversPath);

  const rangeDays = useMemo(() => listUtcDays(timeWindow.from, timeWindow.to), [timeWindow]);
  const pivot = useMemo(
    () => (series.data ? pivotBuckets(series.data.buckets, rangeDays) : null),
    [series.data, rangeDays],
  );
  const tokenMix = useMemo(
    () => (series.data ? buildTokenMix(series.data.buckets, rangeDays) : null),
    [series.data, rangeDays],
  );
  const cacheRatio = useMemo(() => (tokenMix ? cacheHitRatio(tokenMix) : null), [tokenMix]);
  const burnDown = useMemo(() => {
    if (!burnDownSeries.data || !summary.data) return null;
    const mtd = rangeToWindow("mtd", now);
    return buildBurnDown(burnDownSeries.data.buckets, listUtcDays(mtd.from, mtd.to));
  }, [burnDownSeries.data, summary.data, now]);

  const error = summary.error ?? series.error ?? burnDownSeries.error ?? drivers.error;
  const hasUsage = (series.data?.buckets.length ?? 0) > 0;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Usage &amp; Budget</h1>
          <p className="muted">LLM spend from the ledger — summed live, never a stored rollup.</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="refresh"
            onClick={() => {
              // U-8: the export mirrors the chart's current date range.
              const params = new URLSearchParams({
                from: timeWindow.from.toISOString(),
                to: timeWindow.to.toISOString(),
              });
              void downloadFile(`/api/dashboard/usage/export.csv?${params}`, "aivo-usage.csv");
            }}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="refresh"
            onClick={() => {
              setNow(new Date());
              summary.reload();
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {summary.data ? <SummaryCards summary={summary.data} /> : null}
      {!summary.data && !summary.error ? <StatGridSkeleton /> : null}

      {summary.data && burnDown ? (
        <div className="card chart-card">
          <h2>Month-to-date burn-down</h2>
          <p className="muted">Cumulative spend vs. the monthly ceiling and alert thresholds.</p>
          <BurnDownChart points={burnDown} summary={summary.data} />
        </div>
      ) : !summary.error && (summary.loading || burnDownSeries.loading) ? (
        <div className="card chart-card">
          <h2>Month-to-date burn-down</h2>
          <p className="muted">Cumulative spend vs. the monthly ceiling and alert thresholds.</p>
          <ChartSkeleton />
        </div>
      ) : null}

      <div className="card chart-card">
        <div className="chart-controls">
          <h2>Daily spend</h2>
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
          <fieldset className="seg-group">
            <legend className="visually-hidden">Group by</legend>
            {GROUPINGS.map((g) => (
              <button
                key={g.value}
                type="button"
                className={groupBy === g.value ? "seg active" : "seg"}
                onClick={() => setGroupBy(g.value)}
              >
                {g.label}
              </button>
            ))}
          </fieldset>
        </div>
        {pivot && hasUsage ? (
          <DailySpendChart pivot={pivot} />
        ) : series.loading ? (
          <ChartSkeleton />
        ) : (
          <p className="muted empty-state">No usage yet — start a chat in #chat.</p>
        )}
      </div>

      {tokenMix && hasUsage ? (
        <div className="card chart-card">
          <h2>Token mix</h2>
          <p className="muted">
            Tokens in vs. tokens out per day; "cached in" is the part of tokens in served from the
            provider's prompt cache, billed at the cheaper cached price.
          </p>
          {cacheRatio != null ? (
            <p className="cache-headline">
              <span className="cache-headline-value">{Math.round(cacheRatio * 100)}%</span> of input
              tokens cached in this range
            </p>
          ) : null}
          <TokenMixChart points={tokenMix} />
        </div>
      ) : series.loading ? (
        <div className="card chart-card">
          <h2>Token mix</h2>
          <p className="muted">Tokens in vs. tokens out per day (informational, not billing).</p>
          <ChartSkeleton height={180} />
        </div>
      ) : null}

      <div className="card chart-card">
        <h2>Top spend drivers</h2>
        <p className="muted">Grouped by model and task type since the start of the range.</p>
        {drivers.data ? (
          <DriversTable drivers={drivers.data} />
        ) : drivers.error ? null : (
          <TableSkeleton rows={5} cols={4} />
        )}
      </div>
    </section>
  );
}
