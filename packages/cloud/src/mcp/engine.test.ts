import { describe, expect, it } from "vitest";
import { overBudgetText } from "./engine.js";

describe("overBudgetText", () => {
  it("names the call budget when its timeout stopped the tool, and stays out of the way otherwise", async () => {
    const timedOut = AbortSignal.timeout(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(overBudgetText("build_reel_tool", timedOut)).toMatch(/^Error: build_reel_tool ran past the time one call may take .*nothing changed/);

    const disconnected = new AbortController();
    disconnected.abort();
    expect(overBudgetText("build_reel_tool", disconnected.signal)).toBeUndefined();
    expect(overBudgetText("build_reel_tool", new AbortController().signal)).toBeUndefined();
  });
});
