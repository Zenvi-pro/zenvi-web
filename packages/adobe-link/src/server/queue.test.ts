import { describe, expect, test } from "vitest";
import { queueModule } from "../testing/link-server.js";

const { CallQueue } = queueModule;

function deferred<T = string>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("CallQueue", () => {
  test("runs one call at a time, first in first out", async () => {
    const queue = new CallQueue();
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const job = (name: string, ms: number) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      log.push(`start ${name}`);
      await sleep(ms);
      log.push(`end ${name}`);
      running -= 1;
      return name;
    };
    const results = await Promise.all([queue.run("a", 1000, job("a", 20)), queue.run("b", 1000, job("b", 5)), queue.run("c", 1000, job("c", 1))]);
    expect(results.map((r) => [r.kind, r.value])).toEqual([["done", "a"], ["done", "b"], ["done", "c"]]);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(maxRunning).toBe(1);
    expect(queue.idle).toBe(true);
  });

  test("a failing call reports the error and the queue moves on", async () => {
    const queue = new CallQueue();
    const [failed, next] = await Promise.all([
      queue.run("a", 1000, async () => {
        throw new Error("boom");
      }),
      queue.run("b", 1000, async () => "ok"),
    ]);
    expect(failed.kind).toBe("error");
    expect((failed.error as Error).message).toBe("boom");
    expect(next).toMatchObject({ kind: "done", value: "ok" });
  });

  test("a timed-out call keeps the queue blocked until it really returns", async () => {
    const queue = new CallQueue({ busyAfterMs: 60_000 });
    const stuck = deferred();
    const order: string[] = [];
    const first = queue.run("stuck", 40, () => stuck.promise);
    const second = queue.run("next", 5_000, async () => {
      order.push("next ran");
      return "next";
    });
    expect((await first).kind).toBe("timeout");
    await sleep(30);
    expect(order).toEqual([]);
    stuck.resolve("late");
    expect(await second).toMatchObject({ kind: "done", value: "next" });
    expect(order).toEqual(["next ran"]);
  });

  test("while a call has run longer than busyAfterMs, new calls are turned away at once", async () => {
    const queue = new CallQueue({ busyAfterMs: 30 });
    const stuck = deferred();
    void queue.run("ae_render", 20, () => stuck.promise);
    await sleep(60);
    const busy = await queue.run("ae_get_state", 1000, async () => "never");
    expect(busy.kind).toBe("busy");
    expect(busy.running?.label).toBe("ae_render");
    stuck.resolve("done");
    await sleep(0);
    expect(await queue.run("ae_get_state", 1000, async () => "now")).toMatchObject({ kind: "done", value: "now" });
  });

  test("a call that waits past its timeout never runs", async () => {
    const queue = new CallQueue({ busyAfterMs: 60_000 });
    const slow = deferred();
    let ran = false;
    void queue.run("slow", 5_000, () => slow.promise);
    const waiting = await queue.run("quick", 30, async () => {
      ran = true;
      return "x";
    });
    expect(waiting.kind).toBe("expired");
    expect(waiting.running?.label).toBe("slow");
    slow.resolve("done");
    await sleep(10);
    expect(ran).toBe(false);
    expect(queue.idle).toBe(true);
  });
});
