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
 * GET a dashboard API resource as JSON. A same-origin request the sidecar
 * authenticates by injecting identity headers; a 401 means the session is gone
 * (the sidecar returns 401 for an XHR rather than redirecting it) — bounce through
 * a full page load and never resolve (the navigation unloads the page).
 */
export async function getJson<T>(path: string): Promise<T> {
  const res = await auth.fetch(path, { headers: { Accept: "application/json" } });
  if (res.status === 401) {
    auth.login();
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

/**
 * Send a mutating dashboard request (PUT/DELETE) with an optional JSON body.
 * Same 401 semantics as getJson: bounce through login and never resolve.
 * Returns the parsed JSON body, or undefined for a 204.
 */
export async function sendJson<T>(
  path: string,
  method: "PUT" | "POST" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await auth.fetch(path, {
    method,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401) {
    auth.login();
    return new Promise<T>(() => {});
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const parsed = (await res.json()) as { error?: string; reason?: string };
      message = parsed.reason ?? parsed.error ?? message;
    } catch {
      // Non-JSON error body — keep the status message.
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Download an authenticated resource (the CSV export) as a browser file save.
 * A same-origin fetch carries the session cookie so the sidecar authenticates it;
 * the blob is handed to a temporary object-URL anchor for the save.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await auth.fetch(path);
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
  const name =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
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
