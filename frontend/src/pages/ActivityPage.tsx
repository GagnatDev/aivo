import { useEffect, useState } from "react";
import { useApi } from "../api/useApi.js";
import { ConversationThread } from "../components/activity/ConversationThread.js";
import { CHANNEL_LABELS, formatTimestamp, type Conversations } from "../lib/activity.js";

/** Activity Log (M5) — see PRD §4.7, requirements A-1..A-4. */
export function ActivityPage() {
  const conversations = useApi<Conversations>("/api/dashboard/conversations");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = conversations.data?.conversations;

  // Land on the most recently active conversation once the list arrives.
  useEffect(() => {
    if (selectedId === null && list && list.length > 0) {
      setSelectedId(list[0]!.id);
    }
  }, [selectedId, list]);

  const selected = list?.find((c) => c.id === selectedId);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Activity Log</h1>
          <p className="muted">
            Aivo's conversation history per channel — for debugging and trust, not billing.
          </p>
        </div>
        <button type="button" className="refresh" onClick={() => conversations.reload()}>
          Refresh
        </button>
      </div>

      {conversations.error ? <div className="error-banner">{conversations.error}</div> : null}

      {list ? (
        list.length > 0 ? (
          <>
            <fieldset className="seg-group activity-channels">
              <legend className="visually-hidden">Conversation</legend>
              {list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={selectedId === c.id ? "seg active" : "seg"}
                  onClick={() => setSelectedId(c.id)}
                >
                  {CHANNEL_LABELS[c.channel]}
                </button>
              ))}
            </fieldset>
            {selected ? (
              <p className="muted activity-last">
                Last activity {formatTimestamp(selected.lastMessageAt)}
              </p>
            ) : null}
            {selectedId ? (
              <div className="card chart-card">
                <ConversationThread conversationId={selectedId} />
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted empty-state">No conversations yet — say hi to Aivo in #chat.</p>
        )
      ) : (
        <p className="muted">Loading…</p>
      )}
    </section>
  );
}
