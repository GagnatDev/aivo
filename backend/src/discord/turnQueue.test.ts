import { describe, expect, it } from "vitest";
import { TurnQueue, turnKey } from "./turnQueue.js";

/** A promise plus its out-of-band resolvers, for step-by-step task control. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every already-settled promise callback run. */
async function flush(): Promise<void> {
  await new Promise((res) => setTimeout(res, 0));
}

describe("TurnQueue", () => {
  it("serializes tasks with the same key", async () => {
    const queue = new TurnQueue();
    const first = deferred();
    const started: string[] = [];

    const p1 = queue.run("a", async () => {
      started.push("first");
      await first.promise;
      return "one";
    });
    const p2 = queue.run("a", async () => {
      started.push("second");
      return "two";
    });

    await flush();
    // The second task must not start while the first is still running.
    expect(started).toEqual(["first"]);

    first.resolve();
    expect(await p1).toBe("one");
    expect(await p2).toBe("two");
    expect(started).toEqual(["first", "second"]);
  });

  it("runs tasks with different keys concurrently", async () => {
    const queue = new TurnQueue();
    const blocker = deferred();
    const started: string[] = [];

    void queue.run("a", async () => {
      started.push("a");
      await blocker.promise;
    });
    const other = queue.run("b", async () => {
      started.push("b");
    });

    await other;
    // "b" finished while "a" was still blocked — no cross-key serialization.
    expect(started).toEqual(["a", "b"]);
    blocker.resolve();
  });

  it("propagates a task's rejection to its caller without blocking the next task", async () => {
    const queue = new TurnQueue();
    const boom = new Error("boom");

    const failing = queue.run("a", async () => {
      throw boom;
    });
    const following = queue.run("a", async () => "recovered");

    await expect(failing).rejects.toBe(boom);
    expect(await following).toBe("recovered");
  });

  it("drops a key's entry once its chain drains", async () => {
    const queue = new TurnQueue();
    await queue.run("a", async () => {});
    await flush();
    expect(queue.size).toBe(0);
  });
});

describe("turnKey", () => {
  it("distinguishes both the author and the channel", () => {
    expect(turnKey("user-1", "chan-1")).toBe(turnKey("user-1", "chan-1"));
    expect(turnKey("user-1", "chan-1")).not.toBe(turnKey("user-2", "chan-1"));
    expect(turnKey("user-1", "chan-1")).not.toBe(turnKey("user-1", "chan-2"));
  });
});
