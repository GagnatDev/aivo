import type { CSSProperties, ReactNode } from "react";

type SkeletonProps = {
  className?: string;
  width?: string | number;
  height?: string | number;
  /** Pill / circle shape for avatars or chips. */
  round?: boolean;
  style?: CSSProperties;
};

/** Single shimmering bone — compose into layout skeletons below. */
export function Skeleton({ className = "", width, height, round, style }: SkeletonProps) {
  const merged: CSSProperties = {
    width: width ?? undefined,
    height: height ?? undefined,
    borderRadius: round ? 999 : undefined,
    ...style,
  };
  return <span className={`skeleton ${className}`.trim()} style={merged} aria-hidden="true" />;
}

type AnnounceProps = {
  /** Emit a screen-reader status (skip when nesting skeletons). */
  announce?: boolean;
};

function Status() {
  return (
    <span className="visually-hidden" role="status">
      Loading
    </span>
  );
}

function times(n: number, render: (i: number) => ReactNode) {
  return Array.from({ length: n }, (_, i) => render(i));
}

/** Four stat tiles — Overview, Usage summary, Models tiers, Digest detail. */
export function StatGridSkeleton({
  count = 4,
  announce = true,
}: { count?: number } & AnnounceProps) {
  return (
    <div className="stat-grid" aria-busy="true">
      {announce ? <Status /> : null}
      {times(count, (i) => (
        <div key={i} className="card stat-tile">
          <Skeleton width="40%" height={12} />
          <Skeleton width="55%" height={28} style={{ margin: "0.45rem 0" }} />
          <Skeleton width="70%" height={11} />
        </div>
      ))}
    </div>
  );
}

/** Card grid used by Overview health/digest and Settings. */
export function CardGridSkeleton({
  cards = 4,
  lines = 3,
  announce = true,
}: { cards?: number; lines?: number } & AnnounceProps) {
  return (
    <div className="card-grid" aria-busy="true">
      {announce ? <Status /> : null}
      {times(cards, (i) => (
        <div key={i} className="card">
          <Skeleton width="45%" height={16} style={{ marginBottom: "0.75rem" }} />
          {times(lines, (j) => (
            <Skeleton
              key={j}
              width={j === lines - 1 ? "55%" : "90%"}
              height={12}
              style={{ marginBottom: "0.45rem" }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Chart area placeholder (Usage daily spend / burn-down / token mix). */
export function ChartSkeleton({
  height = 220,
  announce = true,
}: { height?: number } & AnnounceProps) {
  return (
    <div className="skeleton-chart" aria-busy="true" style={{ minHeight: height }}>
      {announce ? <Status /> : null}
      <Skeleton className="skeleton-chart-plot" height={height - 28} />
      <div className="skeleton-chart-axis">
        {times(6, (i) => (
          <Skeleton key={i} width={28} height={10} />
        ))}
      </div>
    </div>
  );
}

/** Data table rows — digests list, drivers, pricing. */
export function TableSkeleton({
  rows = 5,
  cols = 4,
  announce = true,
}: { rows?: number; cols?: number } & AnnounceProps) {
  return (
    <div className="table-scroll" aria-busy="true">
      {announce ? <Status /> : null}
      <table className="data-table skeleton-table">
        <thead>
          <tr>
            {times(cols, (i) => (
              <th key={i}>
                <Skeleton width={`${50 + ((i * 17) % 30)}%`} height={12} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times(rows, (r) => (
            <tr key={r}>
              {times(cols, (c) => (
                <td key={c}>
                  <Skeleton width={`${40 + (((r + c) * 13) % 45)}%`} height={12} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Stacked list cards — memories, forgotten, digest picks. */
export function ListSkeleton({
  rows = 4,
  lines = 2,
  announce = true,
}: { rows?: number; lines?: number } & AnnounceProps) {
  return (
    <ul className="memory-list" aria-busy="true">
      {announce ? <Status /> : null}
      {times(rows, (i) => (
        <li key={i} className="card memory-row">
          {times(lines, (j) => (
            <Skeleton
              key={j}
              width={j === lines - 1 ? "65%" : "92%"}
              height={13}
              style={{ marginBottom: "0.4rem" }}
            />
          ))}
          <div className="memory-meta" style={{ marginTop: "0.55rem" }}>
            <Skeleton width={72} height={11} />
            <Skeleton width={96} height={11} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Horizontal share bars — Models usage share. */
export function ShareListSkeleton({
  rows = 3,
  announce = true,
}: { rows?: number } & AnnounceProps) {
  return (
    <ul className="share-list" aria-busy="true">
      {announce ? <Status /> : null}
      {times(rows, (i) => (
        <li key={i} className="share-row">
          <div className="share-head">
            <Skeleton round width={12} height={12} />
            <Skeleton width="35%" height={12} />
            <Skeleton width="30%" height={11} style={{ marginLeft: "auto" }} />
          </div>
          <div className="share-track">
            <Skeleton height={8} width={`${70 - i * 18}%`} style={{ display: "block" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Activity conversation thread messages. */
export function ThreadSkeleton({ rows = 5, announce = true }: { rows?: number } & AnnounceProps) {
  return (
    <div className="thread" aria-busy="true">
      {announce ? <Status /> : null}
      <ol className="thread-list">
        {times(rows, (i) => (
          <li key={i} className="thread-msg">
            <div className="thread-meta">
              <Skeleton width={64} height={11} />
              <Skeleton width={110} height={11} />
            </div>
            <div className="thread-content">
              <Skeleton width="88%" height={13} style={{ marginBottom: "0.35rem" }} />
              <Skeleton width={i % 2 === 0 ? "62%" : "74%"} height={13} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Channel / conversation segment chips. */
export function SegGroupSkeleton({
  count = 3,
  announce = true,
}: { count?: number } & AnnounceProps) {
  return (
    <div className="seg-group activity-channels" aria-busy="true">
      {announce ? <Status /> : null}
      {times(count, (i) => (
        <span key={i} className="seg" style={{ display: "inline-flex", alignItems: "center" }}>
          <Skeleton width={56 + i * 8} height={12} />
        </span>
      ))}
    </div>
  );
}

/** Profile body card. */
export function ProfileSkeleton({ announce = true }: AnnounceProps = {}) {
  return (
    <div aria-busy="true">
      {announce ? <Status /> : null}
      <div className="card chart-card">
        <Skeleton width="55%" height={18} style={{ marginBottom: "0.5rem" }} />
        <Skeleton width="40%" height={12} style={{ marginBottom: "1rem" }} />
        {times(6, (i) => (
          <Skeleton
            key={i}
            width={i === 5 ? "48%" : "95%"}
            height={12}
            style={{ marginBottom: "0.4rem" }}
          />
        ))}
      </div>
    </div>
  );
}

/** Compact inline block for small card sections (e.g. Unforked status). */
export function InlineSkeleton({ lines = 2, announce = true }: { lines?: number } & AnnounceProps) {
  return (
    <div aria-busy="true">
      {announce ? <Status /> : null}
      {times(lines, (i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? "50%" : "85%"}
          height={12}
          style={{ marginBottom: "0.4rem", display: "block" }}
        />
      ))}
    </div>
  );
}
