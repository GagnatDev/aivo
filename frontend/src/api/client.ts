import { auth } from "../auth/auth.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * GET a dashboard API resource as JSON through the auth client. A 401 after the
 * client's own refresh-retry means the session is gone — bounce through login and
 * never resolve (the navigation unloads the page).
 */
export async function getJson<T>(path: string): Promise<T> {
  const res = await auth.fetch(path, { headers: { Accept: "application/json" } });
  if (res.status === 401) {
    auth.login(window.location.pathname + window.location.search);
    return new Promise<T>(() => {});
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; reason?: string };
      message = body.reason ?? body.error ?? message;
    } catch {
      // Non-JSON error body — keep the status message.
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export interface Me {
  user: {
    id: string;
    displayName: string | null;
    isOwner: boolean;
  };
}

export function fetchMe(): Promise<Me> {
  return getJson<Me>("/api/dashboard/me");
}
