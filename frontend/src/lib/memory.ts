// Types mirroring the dashboard memories API (backend routes/dashboard/memories.ts).

export type MemoryCategory = "preference" | "fact" | "context";

export interface MemoryItem {
  id: string;
  category: string | null;
  content: string;
  source: string | null;
  pinned: boolean;
  createdAt: string;
}

export interface MemoriesResponse {
  memories: MemoryItem[];
  activeCount: number;
  injectedCount: number;
  injectLimit: number;
  categoryCounts: Record<string, number>;
  query: string | null;
  category: MemoryCategory | null;
}

export interface ForgottenMemoryItem extends MemoryItem {
  forgottenAt: string;
}

export interface ForgottenMemoriesResponse {
  memories: ForgottenMemoryItem[];
}

// Types mirroring the dashboard profiles API (backend routes/dashboard/profiles.ts).

export interface ProfileVersion {
  id: string;
  version: number;
  body: string;
  isCurrent: boolean;
  createdAt: string;
}

export interface ProfileResponse {
  kind: "youtube_interest" | "mail_importance";
  current: ProfileVersion | null;
  versions: ProfileVersion[];
}

/** "Jun 5, 2026" for a memory's created timestamp. */
export function formatMemoryDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
