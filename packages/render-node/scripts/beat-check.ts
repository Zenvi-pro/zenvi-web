/**
 * Listen to a beat grid: write the first seconds of a music file with a tick
 * on every detected beat (a higher, longer one on each downbeat), and print
 * what the detector concluded. A grid that is on the music sounds like a
 * metronome locked to it; a half/double-time or off-grid one is obvious in
 * seconds.
 *
 *   npx tsx packages/render-node/scripts/beat-check.ts <music> <out.wav> [--bpm N] [--seconds N]
 *
 * --bpm tracks at that tempo instead of estimating one (what detect_beats_tool's
 * bpm argument does).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BEAT_SAMPLE_RATE, detectBeats } from "@zenvi/engine";
import { resolveBinary } from "../src/ffmpeg/binaries.js";
import { decodePcm } from "../src/audio/analyze.js";

const [music, out, ...rest] = process.argv.slice(2);
if (!music || !out) {
  console.error("usage: beat-check.ts <music> <out.wav> [--bpm N] [--seconds N]");
  process.exit(2);
}
const flag = (name: string): number | undefined => {
  const i = rest.indexOf(name);
  return i >= 0 ? Number(rest[i + 1]) : undefined;
};
const bpm = flag("--bpm");
const seconds = flag("--seconds") ?? 30;

const { samples, sampleRate } = await decodePcm(music, { sampleRate: BEAT_SAMPLE_RATE, maxSeconds: 600 });
const result = detectBeats(samples, sampleRate, bpm ? { bpm } : {});
console.log(
  JSON.stringify({ bpm: result.bpm, confidence: result.confidence, foldedFrom: result.foldedFrom, alternatives: result.alternatives, beatsPerBar: result.beatsPerBar, barConfidence: result.barConfidence, beats: result.beats.length }),
);

// Ticks on a silent bed the length of the excerpt.
const ticks = new Float32Array(Math.round(seconds * sampleRate));
const downbeats = new Set(result.downbeats.map((d) => d.timeSec));
for (const { timeSec } of result.beats) {
  const accent = downbeats.has(timeSec);
  const start = Math.round(timeSec * sampleRate);
  const hz = accent ? 1600 : 1000;
  const length = Math.round((accent ? 0.06 : 0.03) * sampleRate);
  for (let k = 0; k < length && start + k < ticks.length; k += 1) ticks[start + k] = 0.8 * Math.exp(-k / (length / 4)) * Math.sin((2 * Math.PI * hz * k) / sampleRate);
}
const dir = mkdtempSync(path.join(tmpdir(), "beat-check-"));
try {
  const raw = path.join(dir, "ticks.f32");
  writeFileSync(raw, Buffer.from(ticks.buffer));
  const run = spawnSync(
    resolveBinary("ffmpeg"),
    ["-y", "-v", "error", "-t", String(seconds), "-i", music, "-f", "f32le", "-ar", String(sampleRate), "-ac", "1", "-i", raw, "-filter_complex", "[0:a]aformat=channel_layouts=stereo,volume=0.7[m];[1:a]aformat=channel_layouts=stereo[t];[m][t]amix=inputs=2:normalize=0:duration=first", out],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(run.stderr);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`wrote ${out}`);
