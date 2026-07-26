import { describe, expect, it } from "vitest";
import { buildMemoryBlock } from "./memoryContext.js";
import type { MemoryRow } from "../storage/memoryRepository.js";

/** A memory row, newest-first order being the caller's responsibility. */
function memory(content: string, opts: { pinned?: boolean; category?: string } = {}): MemoryRow {
  return {
    id: content,
    user_id: "u1",
    category: opts.category ?? null,
    content,
    source: "chat",
    pinned: opts.pinned ?? false,
    created_at: new Date(0),
    forgotten_at: null,
  };
}

describe("buildMemoryBlock", () => {
  it("injects nothing when there are no memories", () => {
    expect(buildMemoryBlock([], { limit: 20, queryText: "hei" })).toEqual({
      block: null,
      hiddenCount: 0,
    });
  });

  it("keeps the stable pinned-then-newest order while everything fits", () => {
    const memories = [memory("newest"), memory("older"), memory("pinned", { pinned: true })];

    // Two different questions produce the same block — the prompt prefix stays cacheable.
    const first = buildMemoryBlock(memories, { limit: 20, queryText: "what about dinner?" });
    const second = buildMemoryBlock(memories, { limit: 20, queryText: "anything else?" });

    expect(first.hiddenCount).toBe(0);
    expect(first.block).toBe(second.block);
    expect(first.block).toBe("What you remember about this user:\n- pinned\n- newest\n- older");
  });

  it("ranks the non-pinned slice by keyword overlap once the cap bites", () => {
    const memories = [
      memory("drives an electric car"),
      memory("allergic to shellfish"),
      memory("works from home on Fridays"),
    ];

    const { block } = buildMemoryBlock(memories, {
      limit: 1,
      queryText: "can you eat shellfish at the party?",
    });

    // Recency alone would have injected the newest fact; relevance picks the one the
    // question is actually about.
    expect(block).toContain("allergic to shellfish");
    expect(block).not.toContain("electric car");
  });

  it("never drops a pinned memory to make room for a relevant one", () => {
    const memories = [
      memory("allergic to shellfish"),
      memory("household of four", { pinned: true }),
    ];

    const { block } = buildMemoryBlock(memories, { limit: 1, queryText: "shellfish?" });

    expect(block).toContain("household of four");
    expect(block).not.toContain("shellfish");
  });

  it("falls back to newest-first when the question shares no keywords", () => {
    const memories = [memory("newest"), memory("older")];

    const { block } = buildMemoryBlock(memories, { limit: 1, queryText: "ok" });

    expect(block).toContain("newest");
  });

  it("tells the model how many facts are hidden and how to reach them", () => {
    const memories = [memory("a"), memory("b"), memory("c")];

    const { block, hiddenCount } = buildMemoryBlock(memories, { limit: 1, queryText: "hei" });

    expect(hiddenCount).toBe(2);
    expect(block).toMatch(/2 more remembered facts are not shown/i);
    expect(block).toMatch(/search/i);
  });

  it("matches an inflected Norwegian word against the stored form", () => {
    const memories = [
      memory("liker sterk mat"),
      memory("har påminnelse om tannlegen"),
      memory("bor i Oslo"),
    ];

    // "påminnelsen" vs the stored "påminnelse": exact overlap would miss it, the tool
    // gate's matching rules don't.
    const { block } = buildMemoryBlock(memories, {
      limit: 1,
      queryText: "hva var påminnelsen min?",
    });

    expect(block).toContain("påminnelse om tannlegen");
  });
});
