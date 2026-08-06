import { useState } from "react";
import { useApi } from "../../api/useApi.js";
import { formatTimestamp } from "../../lib/activity.js";
import { diffLines } from "../../lib/diff.js";
import type { ProfileResponse, ProfileVersion } from "../../lib/memory.js";
import { ProfileSkeleton } from "../Skeleton.js";

function VersionDiff({ from, to }: { from: ProfileVersion; to: ProfileVersion }) {
  return (
    <div className="profile-diff">
      <p className="muted">
        v{from.version} → v{to.version}
      </p>
      <pre className="profile-diff-body">
        {diffLines(from.body, to.body).map((line, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity beyond position
            key={index}
            className={`diff-line diff-${line.kind}`}
          >
            {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}
            {line.text}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}

/**
 * ME-6/ME-7: the current YouTube interest profile and its version history, with
 * a line diff against the previous version — how feedback evolved Aivo's taste.
 */
export function ProfileTab() {
  const profile = useApi<ProfileResponse>("/api/dashboard/profiles/youtube_interest");
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const data = profile.data;

  if (profile.error) return <div className="error-banner">{profile.error}</div>;
  if (!data) return <ProfileSkeleton />;
  if (!data.current) {
    return (
      <p className="muted empty-state">
        No interest profile yet — it forms once the YouTube digest runs and you react to picks.
      </p>
    );
  }

  const selected = data.versions.find((v) => v.version === selectedVersion) ?? data.current;
  const previous = data.versions.find((v) => v.version === selected.version - 1);

  return (
    <>
      <div className="card chart-card">
        <h2>
          YouTube interest profile <span className="tier-badge">v{selected.version}</span>
        </h2>
        <p className="muted">
          {selected.isCurrent ? "Current version" : "Historical version"} · written{" "}
          {formatTimestamp(selected.createdAt)}
        </p>
        <pre className="profile-body">{selected.body}</pre>
      </div>

      {data.versions.length > 1 ? (
        <div className="card chart-card">
          <div className="chart-controls">
            <h2>History</h2>
            <fieldset className="seg-group">
              <legend className="visually-hidden">Version</legend>
              {data.versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={selected.version === v.version ? "seg active" : "seg"}
                  onClick={() => setSelectedVersion(v.version)}
                >
                  v{v.version}
                </button>
              ))}
            </fieldset>
          </div>
          {previous ? (
            <VersionDiff from={previous} to={selected} />
          ) : (
            <p className="muted">v{selected.version} is the first version — nothing to diff.</p>
          )}
        </div>
      ) : null}
    </>
  );
}
