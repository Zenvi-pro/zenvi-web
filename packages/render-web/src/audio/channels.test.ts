import { describe, expect, it } from "vitest";
import type { AudioSegment } from "@zenvi/engine/render";
import { frameSampleOffset, samplesPerFrame } from "@zenvi/engine";
import { audioFrameAt, frameBlocks, routeChannels, toTimelineChannels, windowEnd } from "./channels.js";
import { segmentPiece } from "./schedule.js";

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

const NTSC = { num: 30000, den: 1001 };

describe("audioFrameAt", () => {
  it("finds the frame on libopenshot's sample grid, not the video frame at that time", () => {
    // Frame 2 starts at sample 1600 (1601.6 rounded down to a multiple of 2 channels), before 1001/30000 s.
    expect(frameSampleOffset(2, NTSC, 48000, 2)).toBe(1600);
    expect(audioFrameAt(1599, 48000, NTSC, 2)).toBe(1);
    expect(audioFrameAt(1600, 48000, NTSC, 2)).toBe(2);
    expect(audioFrameAt(0, 48000, NTSC, 2)).toBe(1);
    for (const frame of [3, 100, 1799, 54000]) {
      const first = frameSampleOffset(frame, NTSC, 48000, 2);
      expect(audioFrameAt(first, 48000, NTSC, 2)).toBe(frame);
      expect(audioFrameAt(first - 1, 48000, NTSC, 2)).toBe(frame - 1);
    }
  });
});

describe("frameBlocks", () => {
  it("gives a segment that starts on the audio grid whole frames from its first sample", () => {
    // planAudio puts segment starts at frameSampleOffset(f) / sampleRate; at
    // 29.97 fps that is before the video frame's start time.
    const start = frameSampleOffset(2, NTSC, 48000, 2) / 48000;
    const blocks = frameBlocks(start, 4000, 48000, NTSC, 2);
    expect(blocks[0]).toEqual([0, samplesPerFrame(2, NTSC, 48000, 2)]);
    expect(blocks.every(([a, b]) => b - a > 1)).toBe(true);
  });

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

describe("windowEnd", () => {
  it("ends windows on audio frame boundaries, within the limit, at least one frame long", () => {
    const end = windowEnd(0, 1, 10, 48000, NTSC, 2);
    // 30 frames end at 1.001 s; the boundary at or before 1 s starts frame 30.
    expect(end * 48000).toBe(frameSampleOffset(30, NTSC, 48000, 2));
    expect(windowEnd(9.5, 1, 10, 48000, NTSC, 2)).toBe(10);
    const tiny = windowEnd(0.0101, 0.001, 10, 48000, NTSC, 2);
    expect(tiny * 48000).toBe(frameSampleOffset(2, NTSC, 48000, 2));
  });

  it("covers a range with contiguous, frame-aligned windows whose pieces are contiguous", () => {
    const segment: AudioSegment = { clipId: "C", fileId: "F", path: "a.wav", timelineStart: 0.2, sourceStart: 2, duration: 4, rate: 1, gain: [], effects: [] };
    const bounds = [0.21];
    while (bounds.at(-1)! < 4.2) bounds.push(windowEnd(bounds.at(-1)!, 0.7, 4.2, 48000, NTSC, 2));
    const pieces = bounds.slice(1).map((to, i) => segmentPiece(segment, bounds[i]!, to, 48000)!);
    for (let i = 1; i < pieces.length; i += 1) expect(pieces[i]!.startFrame).toBe(pieces[i - 1]!.endFrame);
    for (const to of bounds.slice(1, -1)) {
      const sample = Math.round(to * 48000);
      expect(frameSampleOffset(audioFrameAt(sample, 48000, NTSC, 2), NTSC, 48000, 2)).toBe(sample);
      // Blocks of a window that starts here begin with a whole frame.
      expect(frameBlocks(to, 4000, 48000, NTSC, 2)[0]![1]).toBe(samplesPerFrame(audioFrameAt(sample, 48000, NTSC, 2), NTSC, 48000, 2));
    }
  });
});
