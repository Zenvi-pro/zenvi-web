import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE, detectBeats } from "@zenvi/engine";
import { decodePcm } from "./analyze.js";

/**
 * Real music through the real decoder. The tracks are Freesound loops from the
 * Zenvi Motion bench, which are not committed (their licences differ): point
 * ZENVI_BENCH_MUSIC_DIR at a folder with them to run this. The expected tempo
 * of each is the one its length says: a loop is a whole number of bars.
 */
const DIR = process.env.ZENVI_BENCH_MUSIC_DIR;
const LOOPS = [
  { file: "freesound_625530.mp3", seconds: 20.571429, beats: 48 }, // 140 BPM
  { file: "freesound_553829.mp3", seconds: 35.555556, beats: 64 }, // 108 BPM
];

describe.skipIf(!DIR || !LOOPS.every((l) => existsSync(path.join(DIR, l.file))))("beats of bench music loops", () => {
  for (const loop of LOOPS) {
    const truth = (loop.beats * 60) / loop.seconds;
    it(`${loop.file}: ${truth.toFixed(0)} BPM, beats on a regular grid`, async () => {
      const { samples, sampleRate } = await decodePcm(path.join(DIR!, loop.file), { sampleRate: BEAT_SAMPLE_RATE });
      const result = detectBeats(samples, sampleRate);
      expect(Math.abs(result.bpm - truth)).toBeLessThan(truth * 0.015);
      expect(result.confidence).toBeGreaterThan(0.5);
      const gaps = result.beats.slice(1).map((b, i) => b.timeSec - result.beats[i]!.timeSec);
      const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
      expect(gaps.filter((g) => Math.abs(g - median) < 0.08 * median).length / gaps.length).toBeGreaterThan(0.9);
    });
  }
});
