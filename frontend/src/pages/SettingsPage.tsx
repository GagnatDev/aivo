import { useState } from "react";
import { sendJson } from "../api/client.js";
import { useApi } from "../api/useApi.js";
import { CardGridSkeleton, InlineSkeleton } from "../components/Skeleton.js";
import { formatTimestamp } from "../lib/activity.js";
import {
  formatHour,
  formatInterval,
  type SettingsBundle,
  type UnforkedStatus,
} from "../lib/settings.js";

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

/**
 * The unforked (family meal planner) connection. The one deliberately
 * dashboard-managed setting: the API key is a secret, so it is registered
 * here — never pasted into Discord chat, where it would sit in the message
 * history and the LLM context. The key is created in unforked itself
 * (More → API keys) and verified against unforked before it is stored;
 * it is never displayed back.
 */
function UnforkedCard() {
  const status = useApi<UnforkedStatus>("/api/dashboard/unforked");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = status.data;

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendJson("/api/dashboard/unforked", "PUT", { apiKey: apiKey.trim() });
      setApiKey("");
      status.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect unforked? Aivo loses access until a new key is registered.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendJson("/api/dashboard/unforked", "DELETE");
      status.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Unforked meal planner</h2>
      {status.error ? <div className="error-banner">{status.error}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {!data && !status.error ? <InlineSkeleton lines={2} /> : null}

      {data && !data.configured ? (
        <p className="muted">
          Not available on this deployment (UNFORKED_BASE_URL is unset), so a key can't be
          registered yet.
        </p>
      ) : null}

      {data?.configured ? (
        <>
          <p className="muted overview-lines">
            {data.connected ? (
              <>
                Connected{data.ownerEmail ? ` as ${data.ownerEmail}` : ""}
                {data.keyName ? ` (key “${data.keyName}”)` : ""}
                <br />
                Key verified {data.verifiedAt ? formatTimestamp(data.verifiedAt) : "—"}
              </>
            ) : (
              <>Not connected — Aivo can't read meal plans, shopping lists or recipes yet.</>
            )}
          </p>
          <form className="settings-key-form" onSubmit={(e) => void register(e)}>
            <input
              className="settings-key-input"
              type="password"
              required
              placeholder="ufk_…"
              aria-label="unforked API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button type="submit" className="refresh" disabled={busy}>
              {data.connected ? "Replace key" : "Register key"}
            </button>
            {data.connected ? (
              <button
                type="button"
                className="refresh"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Disconnect
              </button>
            ) : null}
          </form>
          <p className="muted settings-note">
            Create the key in unforked (More → API keys) and register it here — deliberately not via
            Discord chat, so the secret never lands in the message history. Tick “Allow changes”
            when creating it if Aivo should be able to add shopping-list items from chat; read-only
            keys can only look things up.
          </p>
        </>
      ) : null}
    </div>
  );
}

/** Settings (M6) — see PRD §4.8, requirements S-1..S-5. Read-only except the unforked connection. */
export function SettingsPage() {
  const settings = useApi<SettingsBundle>("/api/dashboard/settings");
  const data = settings.data;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Most of this is changed by talking to Aivo in Discord — this page shows the current
            state. The unforked connection is the exception: its API key is registered here.
          </p>
        </div>
        <button type="button" className="refresh" onClick={() => settings.reload()}>
          Refresh
        </button>
      </div>

      {settings.error ? <div className="error-banner">{settings.error}</div> : null}
      {!data && !settings.error ? <CardGridSkeleton cards={5} lines={4} /> : null}

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

          <UnforkedCard />
        </div>
      ) : null}
    </section>
  );
}
