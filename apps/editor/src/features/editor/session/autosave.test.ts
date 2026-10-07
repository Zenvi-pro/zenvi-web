// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver, type SaveState } from "./autosave";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(save = vi.fn(async () => undefined), opts: { delayMs?: number; maxWaitMs?: number } = {}) {
  const saver = new Autosaver({ save, delayMs: 500, maxWaitMs: 2000, retryMs: 1000, ...opts });
  const states: SaveState[] = [];
  saver.subscribe((s) => states.push(s.state));
  return { saver, save, states };
}

describe("Autosaver", () => {
  it("debounces bursts of changes into one save", async () => {
    const { saver, save } = setup();
    saver.notify();
    await vi.advanceTimersByTimeAsync(200);
    saver.notify();
    await vi.advanceTimersByTimeAsync(200);
    saver.notify();
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledOnce();
    expect(saver.current.state).toBe("saved");
  });

  it("saves at least every maxWait during continuous edits", async () => {
    const { saver, save } = setup();
    for (let t = 0; t < 2400; t += 100) {
      saver.notify();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("never overlaps saves and saves again for changes made during a save", async () => {
    let release!: () => void;
    let calls = 0;
    const save = vi.fn(() => {
      calls += 1;
      return calls === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    });
    const { saver } = setup(save);
    saver.notify();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    saver.notify();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.current.state).toBe("dirty");
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(saver.current.state).toBe("saved");
  });

  it("flush saves immediately and waits", async () => {
    const { saver, save } = setup();
    saver.notify();
    await saver.flush();
    expect(save).toHaveBeenCalledOnce();
    expect(saver.current.state).toBe("saved");
    await saver.flush();
    expect(save).toHaveBeenCalledOnce();
  });

  it("reports errors and retries with backoff", async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error("QuotaExceededError");
    });
    const { saver, states } = setup(save);
    saver.notify();
    await vi.advanceTimersByTimeAsync(500);
    expect(saver.current).toMatchObject({ state: "error", error: "QuotaExceededError" });
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(saver.current.state).toBe("saved");
    expect(states).toEqual(["dirty", "saving", "error", "saving", "saved"]);
  });

  it("stops after dispose", async () => {
    const { saver, save } = setup();
    saver.notify();
    saver.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });
});
