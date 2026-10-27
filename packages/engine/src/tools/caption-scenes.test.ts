import { describe, expect, it } from "vitest";
import type { Clip } from "../model/types.js";
import { sceneWindows } from "./caption-scenes.js";

const clip = (position: number, seconds: number): Clip => ({ position, start: 0, end: seconds }) as unknown as Clip;

describe("sceneWindows", () => {
  it("cuts the range at every cut, then into stretches of at most a second", () => {
    expect(sceneWindows([clip(0, 1.5), clip(1.5, 0.5)], 0, 2)).toEqual([[0, 0.75], [0.75, 1.5], [1.5, 2]]);
  });

  it("falls back to equal stretches past 32 of them, and to none for an empty range", () => {
    const many = sceneWindows([clip(0, 100)], 0, 100);
    expect(many).toHaveLength(32);
    expect(many[0]).toEqual([0, 100 / 32]);
    expect(sceneWindows([], 3, 3)).toEqual([]);
  });
});
