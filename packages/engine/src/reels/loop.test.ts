import { describe, expect, it } from "vitest";
import { loopMusic, loopNote, onLoopedClock, segmentsBetween } from "./loop.js";
import type { MusicBeats } from "./plan.js";

/** `seconds` of music at 120 BPM from 0 (a bar every 2 s). */
function grid(seconds: number): MusicBeats {
  const beats = Array.from({ length: Math.floor(seconds * 2) + 1 }, (_, i) => i / 2);
  return { bpm: 120, beats, downbeats: beats.filter((_, i) => i % 4 === 0), beatEnergy: beats.map((_, i) => i / beats.length), duration: seconds };
}

describe("loopMusic", () => {
  it("leaves music that covers the reel alone", () => {
    expect(loopMusic(grid(40), 30)).toBeNull();
  });

  it("repeats the four-bar phrase before the last bar line so 26 s of music covers a 30 s reel and a bar more", () => {
    const loop = loopMusic(grid(26.3), 30)!;
    // Last bar line 26, missing 30 + 2 - 26.3 = 5.7 s: one 4-bar phrase (8 s) from 18.
    expect(loop.segments).toEqual([
      { at: 0, from: 0, to: 26 },
      { at: 26, from: 18, to: 26 },
      { at: 34, from: 26, to: 26.3 },
    ]);
    expect(loop.music.duration).toBeCloseTo(34.3, 6);
    expect(loop.repeats).toBe(1);
    // The grid keeps going at the tempo through the joint, bar lines included.
    expect(loop.music.beats.slice(50, 56)).toEqual([25, 25.5, 26, 26.5, 27, 27.5]);
    expect(loop.music.downbeats).toContain(26);
    expect(loop.music.downbeats).toContain(28);
    // The repeated beats carry the energy they had.
    expect(loop.music.beatEnergy![52]).toBeCloseTo(36 / 53, 6);
  });

  it("repeats as often as needed when the track is far too short, in whole bars when it has no phrase", () => {
    const loop = loopMusic(grid(6.5), 20)!;
    // Bar lines 0, 2, 4, 6: three bars, so whole bars; missing 15.5 s needs three bars (6 s) three times.
    expect(loop.loopSeconds).toBe(6);
    expect(loop.repeats).toBe(3);
    expect(loop.music.duration).toBeGreaterThanOrEqual(22);
  });

  it("counts the music from its first bar line: a long intro leaves a 30 s track short of a 30 s reel", () => {
    const base = grid(30);
    const late = { ...base, beats: base.beats.filter((t) => t >= 4), downbeats: base.downbeats.filter((t) => t >= 4) };
    const loop = loopMusic(late, 30)!;
    expect(loop).not.toBeNull();
    expect(loopNote(late, loop, 30)).toMatch(/^The music is 30 s \(26 s from its first bar line\), shorter than the 30 s asked/);
  });

  it("does nothing without bar lines", () => {
    expect(loopMusic({ bpm: 120, beats: [0, 0.5], downbeats: [0], duration: 5 }, 20)).toBeNull();
  });
});

describe("segmentsBetween and onLoopedClock", () => {
  const loop = loopMusic(grid(26.3), 30)!;
  it("cuts the stretches a bed from 4 s for 28 s plays, placed from 0", () => {
    expect(segmentsBetween(loop.segments, 4, 28)).toEqual([
      { at: 0, from: 4, to: 26 },
      { at: 22, from: 18, to: 24 },
    ]);
  });
  it("puts file times inside each stretch on the looped clock", () => {
    expect(onLoopedClock(loop.segments, [3, 20, 26.1])).toEqual([3, 20, 28, 34.1]);
  });
});
