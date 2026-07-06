import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TYPING_REFRESH_MS, withTyping } from "./typing.js";

describe("withTyping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the work result", async () => {
    const channel = { sendTyping: vi.fn().mockResolvedValue(undefined) };
    const result = await withTyping(channel, async () => "done");
    expect(result).toBe("done");
  });

  it("calls sendTyping immediately and on refresh while work runs", async () => {
    const channel = { sendTyping: vi.fn().mockResolvedValue(undefined) };
    let resolveWork!: () => void;
    const work = new Promise<string>((resolve) => {
      resolveWork = () => resolve("ok");
    });

    const pending = withTyping(channel, () => work);
    await vi.advanceTimersByTimeAsync(0);
    expect(channel.sendTyping).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS);
    expect(channel.sendTyping).toHaveBeenCalledTimes(2);

    resolveWork();
    await expect(pending).resolves.toBe("ok");
    expect(channel.sendTyping).toHaveBeenCalledTimes(2);
  });

  it("stops refreshing after work completes", async () => {
    const channel = { sendTyping: vi.fn().mockResolvedValue(undefined) };
    await withTyping(channel, async () => "done");

    await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS * 3);
    expect(channel.sendTyping).toHaveBeenCalledTimes(1);
  });

  it("clears the refresh interval when work throws", async () => {
    const channel = { sendTyping: vi.fn().mockResolvedValue(undefined) };
    await expect(
      withTyping(channel, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS * 3);
    expect(channel.sendTyping).toHaveBeenCalledTimes(1);
  });

  it("skips sendTyping when channel is null", async () => {
    const result = await withTyping(null, async () => 42);
    expect(result).toBe(42);
  });

  it("ignores sendTyping failures", async () => {
    const channel = { sendTyping: vi.fn().mockRejectedValue(new Error("rate limited")) };
    await expect(withTyping(channel, async () => "ok")).resolves.toBe("ok");
  });
});
