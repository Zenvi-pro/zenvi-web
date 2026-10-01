import { describe, expect, it } from "vitest";
import { samplesPerFrame } from "@zenvi/engine";
import { frameBlocks, routeChannels, toTimelineChannels } from "./channels.js";

const ch = (...values: number[]) => Float32Array.from(values);

describe("toTimelineChannels", () => {
  it("copies mono to every channel, averages stereo to mono, keeps matching layouts", () => {
    const mono = ch(1, 2);
    expect(toTimelineChannels([mono], 2).map((c) => [...c])).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect([...toTimelineChannels([ch(1, 3), ch(3, 5)], 1)[0]!]).toEqual([2, 4]);
    const stereo = [ch(1), ch(2)];
    expect(toTimelineChannels(stereo, 2)).toEqual(stereo);
    expect(toTimelineChannels([ch(1), ch(2), ch(3)], 2).map((c) => [...c])).toEqual([[1], [2]]);
  });
});

describe("routeChannels (channel_filter / channel_mapping)", () => {
  const stereo = [ch(1, 1), ch(2, 2)];
  it("passes channels through without filter or mapping", () => {
    expect(routeChannels(stereo, 2).map((c) => [...c])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });
  it("keeps only the filtered channel, in place", () => {
    expect(routeChannels(stereo, 2, 1).map((c) => [...c])).toEqual([
      [0, 0],
      [2, 2],
    ]);
  });
  it("adds every mixed channel into the mapped one", () => {
    expect(routeChannels(stereo, 2, undefined, 0).map((c) => [...c])).toEqual([
      [3, 3],
      [0, 0],
    ]);
    expect(routeChannels(stereo, 2, 0, 1).map((c) => [...c])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe("frameBlocks", () => {
  it("splits at libopenshot's per-frame sample counts (29.97 fps at 48 kHz)", () => {
    const fps = { num: 30000, den: 1001 };
    const sizes = [1, 2, 3, 4, 5, 6].map((f) => samplesPerFrame(f, fps, 48000, 2));
    const total = sizes.reduce((a, b) => a + b, 0);
    const blocks = frameBlocks(0, total, 48000, fps, 2);
    expect(blocks.map(([a, b]) => b - a)).toEqual(sizes);
  });

  it("starts with the rest of the frame when the buffer starts mid-frame, and ends with what is left", () => {
    const fps = { num: 30, den: 1 };
    const blocks = frameBlocks(0.01, 3000, 48000, fps, 2);
    expect(blocks[0]).toEqual([0, 1600 - 480]);
    expect(blocks[1]).toEqual([1120, 2720]);
    expect(blocks.at(-1)).toEqual([2720, 3000]);
  });
});
