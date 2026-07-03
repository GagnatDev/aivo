import type { Db } from "../db/kysely.js";
import type { Stage2Decision, TranscriptStatus } from "../db/schema.enums.js";

export interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  description: string;
  duration_seconds: number | null;
  published_at: Date;
  thumbnail_url: string | null;
  stage1_score: number | null;
  transcript_status: TranscriptStatus;
  stage2_decision: Stage2Decision | null;
  summary: string | null;
  why: string | null;
}

const VIDEO_COLUMNS = [
  "id",
  "channel_id",
  "title",
  "description",
  "duration_seconds",
  "published_at",
  "thumbnail_url",
  "stage1_score",
  "transcript_status",
  "stage2_decision",
  "summary",
  "why",
] as const;

export interface DiscoveredVideoInput {
  id: string;
  channelId: string;
  title: string;
  description: string;
  durationSeconds: number | null;
  publishedAt: Date;
  thumbnailUrl: string | null;
}

export interface Stage2Result {
  transcriptStatus: TranscriptStatus;
  decision: Stage2Decision;
  summary: string | null;
  why: string | null;
}

/** Candidate videos discovered from subscriptions, carrying both filter stages. */
export class VideoRepository {
  constructor(private readonly db: Db) {}

  /** Cache newly-discovered videos; an already-known id keeps its filter results. */
  async upsertDiscovered(videos: DiscoveredVideoInput[]): Promise<void> {
    if (videos.length === 0) return;
    await this.db
      .insertInto("videos")
      .values(
        videos.map((v) => ({
          id: v.id,
          channel_id: v.channelId,
          title: v.title,
          description: v.description,
          duration_seconds: v.durationSeconds,
          published_at: v.publishedAt,
          thumbnail_url: v.thumbnailUrl,
        })),
      )
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
  }

  /**
   * The digest-candidate window: videos published after `since` from channels that are
   * still subscribed and not muted, newest first, capped so one prolific day can't blow
   * up the stage-1 prompt.
   */
  listCandidatesSince(since: Date, limit: number): Promise<VideoRow[]> {
    return this.db
      .selectFrom("videos")
      .innerJoin("youtube_channels", "youtube_channels.id", "videos.channel_id")
      .select(VIDEO_COLUMNS.map((c) => `videos.${c}` as const))
      .where("videos.published_at", ">", since)
      .where("youtube_channels.subscribed", "=", true)
      .where("youtube_channels.muted", "=", false)
      .orderBy("videos.published_at", "desc")
      .limit(limit)
      .execute() as Promise<VideoRow[]>;
  }

  /** Record stage-1 metadata scores for a batch of videos. */
  async saveStage1Scores(scores: Array<{ id: string; score: number }>, at: Date): Promise<void> {
    for (const { id, score } of scores) {
      await this.db
        .updateTable("videos")
        .set({ stage1_score: score, stage1_at: at })
        .where("id", "=", id)
        .execute();
    }
  }

  /** Record a video's stage-2 verdict (decision + TL;DW summary + "why"). */
  async saveStage2(id: string, result: Stage2Result): Promise<void> {
    await this.db
      .updateTable("videos")
      .set({
        transcript_status: result.transcriptStatus,
        stage2_decision: result.decision,
        summary: result.summary,
        why: result.why,
      })
      .where("id", "=", id)
      .execute();
  }

  /** Fetch a set of videos by id (order not guaranteed). */
  findByIds(ids: string[]): Promise<VideoRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.selectFrom("videos").select(VIDEO_COLUMNS).where("id", "in", ids).execute();
  }

  /** Channel titles keyed by channel id, for rendering digest entries. */
  async channelTitles(channelIds: string[]): Promise<Map<string, string>> {
    if (channelIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom("youtube_channels")
      .select(["id", "title"])
      .where("id", "in", channelIds)
      .execute();
    return new Map(rows.map((r) => [r.id, r.title]));
  }
}
