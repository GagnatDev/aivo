import { useCallback, useEffect, useState } from "react";
import { getJson } from "./client.js";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Manual refresh (PRD §5.5 — manual refresh over websockets in v1). */
  reload: () => void;
}

/** Fetch a dashboard API resource; refetches whenever `path` changes. */
export function useApi<T>(path: string): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getJson<T>(path)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => load(), [load]);

  return { data, error, loading, reload: load };
}
