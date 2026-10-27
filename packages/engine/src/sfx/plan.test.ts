import { describe, expect, it } from "vitest";
import { musicClimax } from "./plan.js";

describe("musicClimax", () => {
  it("finds the downbeat where the loudness jumps, and nothing in flat music", () => {
    const beats = Array.from({ length: 40 }, (_, i) => ({ time: i * 0.5, energy: i < 20 ? 0.3 : 0.95 }));
    const downbeats = beats.filter((_, i) => i % 4 === 0).map((b) => b.time);
    expect(musicClimax(beats, downbeats, 20)).toBe(10);
    expect(musicClimax(beats.map((b) => ({ ...b, energy: 0.6 })), downbeats, 20)).toBeNull();
  });
});
