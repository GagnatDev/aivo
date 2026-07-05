import { useState } from "react";
import { useApi } from "../api/useApi.js";
import { formatTimestamp } from "../lib/activity.js";
import { formatHour, formatInterval, type SettingsBundle } from "../lib/settings.js";

/** Persona snippets longer than this start collapsed (S-2). */
const PERSONA_SNIPPET_CHARS = 240;

function PersonaPrompt({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsToggle = prompt.length > PERSONA_SNIPPET_CHARS;
  const shown = expanded || !needsToggle ? prompt : `${prompt.slice(0, PERSONA_SNIPPET_CHARS)}…`;
  return (
    <>
      <p className="settings-persona">{shown}</p>
      {needsToggle ? (
        <button type="button" className="row-link" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : "Show full prompt"}
        </button>
      ) : null}
    </>
  );
}

/** Settings (M6) — see PRD §4.8, requirements S-1..S-5. Read-only by design. */
export function SettingsPage() {
  const settings = useApi<SettingsBundle>("/api/dashboard/settings");
  const data = settings.data;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Everything here is changed by talking to Aivo in Discord — this page only shows the
            current state.
          </p>
        </div>
        <button type="button" className="refresh" onClick={() => settings.reload()}>
          Refresh
        </button>
      </div>

      {settings.error ? <div className="error-banner">{settings.error}</div> : null}
      {!data && !settings.error ? <p className="muted">Loading…</p> : null}

      {data ? (
        <div className="card-grid">
          <div className="card">
            <h2>Digest schedule</h2>
            <p className="muted overview-lines">
              Delivers at {formatHour(data.digest.hour)} {data.digest.timezone},{" "}
              {formatInterval(data.digest.intervalDays)}
              <br />
              Up to {data.digest.cap} picks per digest
              <br />
              {data.digest.proactivity.enabled
                ? data.digest.proactivity.pausedUntil
                  ? `Paused until ${formatTimestamp(data.digest.proactivity.pausedUntil)}`
                  : "Proactive delivery on"
                : "Turned off until further notice"}
            </p>
            <p className="muted settings-note">Change via Discord: “deliver the digest at 8”.</p>
          </div>

          <div className="card">
            <h2>Model tier</h2>
            <p className="muted overview-lines">
              Preference: <strong>{data.modelTier}</strong>
              <br />
              Budget degradation can force the cheap tier — see Models.
            </p>
            <p className="muted settings-note">Change via Discord: “use the premium model”.</p>
          </div>

          <div className="card">
            <h2>Budget caps</h2>
            <p className="muted overview-lines">
              Monthly ceiling: {data.budget.monthlyCeiling?.formatted ?? "not set"}
              <br />
              Daily soft cap: {data.budget.dailySoftCap?.formatted ?? "not set"}
              <br />
              Approval above: {data.budget.approvalThreshold?.formatted ?? "not set"}
              <br />
              Alerts at {data.budget.alertThresholds.join("% / ")}% of ceiling
            </p>
            <p className="muted settings-note">
              Change via Discord: “set the monthly budget to €20”. Spend lives on the{" "}
              <a href="/usage">Usage page</a>.
            </p>
          </div>

          <div className="card">
            <h2>Persona</h2>
            {data.personaPrompt ? (
              <PersonaPrompt prompt={data.personaPrompt} />
            ) : (
              <p className="muted">No persona prompt set — Aivo uses its default voice.</p>
            )}
            <p className="muted settings-note">Change via Discord: “be more concise”.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
