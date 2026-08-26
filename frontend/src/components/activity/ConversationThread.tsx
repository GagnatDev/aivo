import { type ReactElement, useCallback, useEffect, useState } from "react";
import { getJson } from "../../api/client.js";
import {
  formatTimestamp,
  mergeThreadEntries,
  ROLE_LABELS,
  type MessagesPage,
  type ThreadMessage,
  type TurnSummary,
} from "../../lib/activity.js";
import { ThreadSkeleton } from "../Skeleton.js";
import { TurnSummaryRow } from "./TurnSummaryRow.js";

const PAGE_SIZE = 50;

interface ThreadState {
  messages: ThreadMessage[];
  /** Per-turn observability records covering the pages loaded so far, oldest first. */
  turns: TurnSummary[];
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Windowed thread loader: newest page first, "Load older" pages backwards with
 * the API's `before` cursor and prepends (threads are unbounded — full history
 * retention, PRD §4.7).
 */
function useThread(conversationId: string) {
  const [state, setState] = useState<ThreadState>({
    messages: [],
    turns: [],
    hasMore: false,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ messages: [], turns: [], hasMore: false, loading: true, error: null });
    getJson<MessagesPage>(
      `/api/dashboard/conversations/${conversationId}/messages?limit=${PAGE_SIZE}`,
    )
      .then((page) => {
        if (cancelled) return;
        setState({
          messages: page.messages,
          turns: page.turns,
          hasMore: page.hasMore,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ messages: [], turns: [], hasMore: false, loading: false, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const loadOlder = useCallback(() => {
    setState((current) => {
      const oldest = current.messages[0];
      if (!oldest || current.loading) return current;
      getJson<MessagesPage>(
        `/api/dashboard/conversations/${conversationId}/messages?limit=${PAGE_SIZE}&before=${oldest.id}`,
      )
        .then((page) => {
          setState((s) => ({
            ...s,
            messages: [...page.messages, ...s.messages],
            // The API windows turns to the page it returned, so pages never overlap.
            turns: [...page.turns, ...s.turns],
            hasMore: page.hasMore,
            loading: false,
          }));
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setState((s) => ({ ...s, loading: false, error: message }));
        });
      return { ...current, loading: true };
    });
  }, [conversationId]);

  return { ...state, loadOlder };
}

function tokensNote(m: ThreadMessage): string | null {
  if (m.tokensIn == null && m.tokensOut == null) return null;
  return `${m.tokensIn ?? 0} in / ${m.tokensOut ?? 0} out tokens`;
}

/** A compact "name({args})" line per requested tool, args truncated so the row stays readable. */
function toolCallSummary(calls: NonNullable<ThreadMessage["toolCalls"]>): string {
  return calls
    .map((c) => {
      const args = c.arguments?.trim();
      return !args || args === "{}" ? c.name : `${c.name}(${args.slice(0, 120)})`;
    })
    .join(", ");
}

/**
 * The message body: an assistant turn that only requested tools has null content, so
 * render the structured tool calls; a tool-result row is labelled with the tool it
 * answers; everything else shows its text (or a muted placeholder when truly empty).
 */
function messageBody(m: ThreadMessage): ReactElement {
  if (m.content) return <>{m.content}</>;
  if (m.role === "assistant" && m.toolCalls?.length) {
    return <span className="thread-tool-calls">→ {toolCallSummary(m.toolCalls)}</span>;
  }
  return <span className="muted">(no content recorded)</span>;
}

/** One message row — role, timestamp, per-message tokens, body (A-2/A-3/A-4). */
function MessageRow({ message }: { message: ThreadMessage }) {
  const tokens = tokensNote(message);
  return (
    <li className={`thread-msg thread-${message.role}`}>
      <div className="thread-meta">
        <span className="thread-role">
          {ROLE_LABELS[message.role]}
          {message.role === "tool" && message.toolName ? `: ${message.toolName}` : ""}
        </span>
        <span>{formatTimestamp(message.createdAt)}</span>
        {tokens ? <span>{tokens}</span> : null}
      </div>
      <div className="thread-content">{messageBody(message)}</div>
    </li>
  );
}

/**
 * A-2/A-3/A-4: the message thread — roles, timestamps, token counts, tool calls
 * highlighted — interleaved with the per-turn observability records (A-6), which carry
 * the things no single message row can: round-trips, latency, and how the turn ended.
 */
export function ConversationThread({ conversationId }: { conversationId: string }) {
  const thread = useThread(conversationId);

  if (thread.error) return <div className="error-banner">{thread.error}</div>;
  if (thread.loading && thread.messages.length === 0) return <ThreadSkeleton />;
  if (thread.messages.length === 0) {
    return <p className="muted empty-state">No messages in this conversation yet.</p>;
  }

  // Entries are merged oldest-first (so the `before` cursor keys off messages[0]);
  // render newest-first so the latest message sits at the top. A turn's record is
  // written when the turn ends, so reversed it heads the messages it summarizes.
  const rendered = mergeThreadEntries(thread.messages, thread.turns).reverse();

  return (
    <div className="thread">
      <ol className="thread-list">
        {rendered.map((entry) =>
          entry.kind === "turn" ? (
            <TurnSummaryRow key={`turn-${entry.turn.id}`} turn={entry.turn} />
          ) : (
            <MessageRow key={entry.message.id} message={entry.message} />
          ),
        )}
      </ol>
      {thread.hasMore ? (
        <button
          type="button"
          className="refresh thread-older"
          disabled={thread.loading}
          onClick={thread.loadOlder}
        >
          {thread.loading ? "Loading…" : "Load older messages"}
        </button>
      ) : (
        <p className="muted thread-start">Start of recorded history</p>
      )}
    </div>
  );
}
