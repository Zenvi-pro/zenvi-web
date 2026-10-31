/**
 * Review of a rendered file, the way a finishing editor checks a deliverable
 * before it goes out: no black or frozen picture in the middle, a clean end
 * (a hold or an end card, never black), audio under the true-peak ceiling and
 * near the platform's loudness, and no shot used twice within a few seconds.
 *
 * The host's detectors (`MediaHost.inspectRender`, ffmpeg in the CLI) find
 * the stretches; the rules here turn them into problems an agent can fix.
 * Repeated shots are found by a difference hash of each shot's middle frame.
 */

import { cosine, NEAR_DUPLICATE, type Vector } from "../shots/vectors.js";
import type { RenderInspection, RenderInspectOptions, TimeRange } from "../tools/types.js";

/** Detector thresholds review_render_tool asks the host for. */
export const INSPECT_THRESHOLDS: Omit<RenderInspectOptions, "signal"> = {
  // Two frames at 30 fps: a one-frame dip is a flash cut's black, not a fault.
  blackMinSeconds: 0.06,
  blackPixel: 0.1,
  freezeMinSeconds: 0.5,
  freezeNoiseDb: -60,
  // scdet's default is 10; 9 also catches cuts between two shots of the same exposure and a different colour.
  sceneThreshold: 9,
  silenceDb: -50,
  silenceMinSeconds: 0.4,
};

/** Delivery targets (social platforms normalise to about -14 LUFS; a -1 dBTP ceiling survives their encoders). */
export interface DeliveryTargets {
  loudnessLufs: number;
  /** How far from `loudnessLufs` still passes, LU. */
  loudnessToleranceLu: number;
  truePeakMaxDb: number;
  /** A shot seen again sooner than this reads as a loop, seconds. */
  repeatWindowSeconds: number;
}

export const SOCIAL_TARGETS: DeliveryTargets = { loudnessLufs: -14, loudnessToleranceLu: 2, truePeakMaxDb: -1, repeatWindowSeconds: 3 };

/** Hamming distance (of 64 bits) at or under which two middle frames are the same shot. */
export const REPEAT_DISTANCE = 6;
/** Shots shorter than this are folded into the one before (a flash frame, a whip's blur). */
const MIN_SHOT_SECONDS = 0.12;
/** Black, frozen or silent stretches within this of the start or the end belong to it. */
const EDGE_SECONDS = 0.1;

export interface Shot {
  /** 1-based, in time order. */
  index: number;
  start: number;
  end: number;
  /** Where its representative frame is taken: the middle. */
  mid: number;
}

export type ProblemKind =
  | "ends_on_black"
  | "abrupt_end"
  | "opens_on_black"
  | "black_frames"
  | "frozen_picture"
  | "repeated_shot"
  | "near_duplicate_shots"
  | "true_peak"
  | "loudness"
  | "silent_audio"
  | "no_audio"
  | "audio_dropout"
  // The rhythm checks of a fast-cut edit (review/rhythm.ts).
  | "uniform_shot_lengths"
  | "static_shot"
  | "flat_brightness"
  | "flat_hue"
  | "cut_without_sound";

export interface Problem {
  kind: ProblemKind;
  /** "problem": fix before delivery; "warning": check it is intended. */
  severity: "problem" | "warning";
  /** Seconds in the file, when the problem has a place. */
  at?: number;
  message: string;
}

export type EndKind = "black" | "hold" | "final_shot" | "abrupt";

export interface EndVerdict {
  kind: EndKind;
  ok: boolean;
  /** How long the end lasts: the black, the hold, or the last shot. */
  seconds: number;
  message: string;
}

const r2 = (value: number): number => Math.round(value * 100) / 100;
const fmt = (value: number): string => `${r2(value).toFixed(2)}s`;
const overlaps = (a: TimeRange, b: TimeRange): boolean => a.start < b.end && b.start < a.end;

/** The file's shots from its cuts: very short ones (a flash, a whip) folded into the shot before. */
export function shotsFromCuts(cuts: readonly { time: number }[], duration: number): Shot[] {
  const starts = [0];
  for (const cut of [...cuts].sort((a, b) => a.time - b.time)) {
    if (cut.time - starts[starts.length - 1]! >= MIN_SHOT_SECONDS && duration - cut.time >= MIN_SHOT_SECONDS) starts.push(cut.time);
  }
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]! : duration;
    return { index: i + 1, start: r2(start), end: r2(end), mid: Math.round(((start + end) / 2) * 1000) / 1000 };
  });
}

/** How the file ends: on black (bad), on a hold or an end card / a settled final shot (good), or cut off mid-motion. */
export function endVerdict(inspection: RenderInspection, shots: readonly Shot[]): EndVerdict {
  const { duration, fps } = inspection;
  const frame = 1 / Math.max(1, fps);
  // blackdetect's last black_end is the last frame's start time.
  const endBlack = inspection.black.find((b) => b.end >= duration - 3 * frame);
  // A fade of a few frames to black is a finish; a quarter second of black is a dead end.
  if (endBlack && endBlack.end - endBlack.start >= 0.25 - 1e-6) {
    const seconds = r2(duration - endBlack.start);
    return { kind: "black", ok: false, seconds, message: `ends on ${fmt(seconds)} of black from ${fmt(endBlack.start)}` };
  }
  const hold = inspection.frozen.find((f) => f.end >= duration - 3 * frame && !inspection.black.some((b) => overlaps(b, f)));
  if (hold && hold.end - hold.start >= 0.4) {
    const seconds = r2(duration - hold.start);
    return { kind: "hold", ok: true, seconds, message: `ends on a ${fmt(seconds)} hold` };
  }
  const last = shots[shots.length - 1];
  const lastSeconds = last ? r2(last.end - last.start) : r2(duration);
  if (lastSeconds >= 1.0) {
    return { kind: "final_shot", ok: true, seconds: lastSeconds, message: `ends on a ${fmt(lastSeconds)} final shot` };
  }
  return {
    kind: "abrupt",
    ok: false,
    seconds: lastSeconds,
    message: `ends ${fmt(lastSeconds)} into a moving shot: no hold or end card for the viewer to land on`,
  };
}

/** A 64-bit difference hash of an image (RGBA or premultiplied over black), as 16 hex digits. */
export function differenceHash(image: { width: number; height: number; data: ArrayLike<number> }): string {
  const W = 9;
  const H = 8;
  const grey = new Float64Array(W * H);
  const counts = new Float64Array(W * H);
  const { width, height, data } = image;
  for (let y = 0; y < height; y += 1) {
    const cy = Math.min(H - 1, Math.floor((y * H) / height));
    for (let x = 0; x < width; x += 1) {
      const cx = Math.min(W - 1, Math.floor((x * W) / width));
      const i = (y * width + x) * 4;
      grey[cy * W + cx]! += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      counts[cy * W + cx]! += 1;
    }
  }
  let hex = "";
  for (let y = 0; y < H; y += 1) {
    let byte = 0;
    for (let x = 0; x < 8; x += 1) {
      const a = grey[y * W + x]! / Math.max(1, counts[y * W + x]!);
      const b = grey[y * W + x + 1]! / Math.max(1, counts[y * W + x + 1]!);
      byte = (byte << 1) | (a > b ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** A frame this much one flat or smoothly shaded ground (a type card, a graphic) is not compared as footage. */
const GROUND_SHARE = 0.7;
/** Neighbouring pixels closer than this (0-255 grey) are smooth ground; footage has grain and texture. */
const SMOOTH_STEP = 3;
// Measured: strobe cards on a vignetted ground 0.74-0.77, stock footage at most 0.57.
const SMOOTH_SHARE = 0.7;

/**
 * Whether an image is a graphic on a ground, not footage: at least
 * GROUND_SHARE of its pixels within a few levels of the commonest grey, or
 * SMOOTH_SHARE of them no different from their right and lower neighbours
 * (a vignette, a gradient). Two centred words on the same ground hash alike;
 * they are not the same footage.
 */
export function flatGround(image: { width: number; height: number; data: ArrayLike<number> }): boolean {
  const { width, height, data } = image;
  const n = width * height;
  if (n === 0) return false;
  const grey = new Float64Array(n);
  const bins = new Float64Array(64);
  for (let k = 0; k < n; k += 1) {
    grey[k] = 0.299 * data[k * 4]! + 0.587 * data[k * 4 + 1]! + 0.114 * data[k * 4 + 2]!;
    bins[Math.min(63, Math.floor(grey[k]! / 4))]! += 1;
  }
  let best = 0;
  for (let b = 0; b < 64; b += 1) best = Math.max(best, (bins[b - 1] ?? 0) + bins[b]! + (bins[b + 1] ?? 0));
  if (best / n >= GROUND_SHARE) return true;
  let smooth = 0;
  for (let y = 0; y + 1 < height; y += 1)
    for (let x = 0; x + 1 < width; x += 1) {
      const k = y * width + x;
      if (Math.abs(grey[k]! - grey[k + 1]!) < SMOOTH_STEP && Math.abs(grey[k]! - grey[k + width]!) < SMOOTH_STEP) smooth += 1;
    }
  return smooth / Math.max(1, (width - 1) * (height - 1)) >= SMOOTH_SHARE;
}

/** Bits that differ between two difference hashes. */
export function hashDistance(a: string, b: string): number {
  let bits = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 2) {
    let x = Number.parseInt(a.slice(i, i + 2), 16) ^ Number.parseInt(b.slice(i, i + 2), 16);
    while (x) {
      bits += x & 1;
      x >>= 1;
    }
  }
  return bits;
}

export interface RepeatGroup {
  /** Shot indexes that show the same picture, in time order. */
  shots: number[];
  /** Shortest time between two of them (start to start), seconds. */
  minGapSeconds: number;
}

/**
 * Shots that show the same picture: middle frames within REPEAT_DISTANCE,
 * not counting neighbours (two halves of one shot split by a false cut).
 * A flat frame (black, a solid card) has no structure to compare and is left
 * out, and so is a frame that is mostly one flat ground (`graphic`: type on a card).
 */
export function repeatedShots(shots: readonly Shot[], hashes: readonly (string | null)[], graphic: readonly boolean[] = []): RepeatGroup[] {
  const parent = shots.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const usable = (h: string | null | undefined): h is string => Boolean(h) && h !== "0000000000000000" && h !== "ffffffffffffffff";
  for (let i = 0; i < shots.length; i += 1) {
    for (let j = i + 2; j < shots.length; j += 1) {
      const a = hashes[i];
      const b = hashes[j];
      if (graphic[i] || graphic[j]) continue;
      if (usable(a) && usable(b) && hashDistance(a, b) <= REPEAT_DISTANCE) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  shots.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  const out: RepeatGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let minGap = Infinity;
    for (let k = 1; k < members.length; k += 1) minGap = Math.min(minGap, shots[members[k]!]!.start - shots[members[k - 1]!]!.start);
    out.push({ shots: members.map((i) => shots[i]!.index), minGapSeconds: r2(minGap) });
  }
  return out.sort((a, b) => a.shots[0]! - b.shots[0]!);
}

/** Every problem in the file, in time order (then the audio-wide ones). */
export function renderProblems(
  inspection: RenderInspection,
  shots: readonly Shot[],
  repeats: readonly RepeatGroup[],
  end: EndVerdict,
  targets: DeliveryTargets = SOCIAL_TARGETS,
  looks?: readonly (Vector | null)[],
): Problem[] {
  const { duration } = inspection;
  const timed: Problem[] = [];
  const tail = (range: TimeRange): boolean => range.end >= duration - EDGE_SECONDS;
  const frame = 1 / Math.max(1, inspection.fps);
  for (const black of inspection.black) {
    const length = r2(black.end - black.start);
    // One black frame is a flash cut's or a whip's, not a hole.
    if (length < 1.5 * frame) continue;
    if (black.start <= EDGE_SECONDS) {
      if (length >= 0.5)
        timed.push({ kind: "opens_on_black", severity: "problem", at: 0, message: `opens on ${fmt(length)} of black: the hook must be on screen at once` });
    } else if (tail(black)) {
      if (end.kind !== "black")
        timed.push({ kind: "black_frames", severity: "warning", at: r2(black.start), message: `fades to black over the last ${fmt(length)}` });
    } else {
      // A dip of a few frames reads as a transition; longer is a hole in the picture.
      timed.push({
        kind: "black_frames",
        severity: length >= 0.25 ? "problem" : "warning",
        at: r2(black.start),
        message: `${fmt(length)} of black at ${fmt(black.start)}–${fmt(black.end)}${length < 0.25 ? " (a dip to black: check it is a transition)" : ""}`,
      });
    }
  }
  for (const frozen of inspection.frozen) {
    if (tail(frozen) || inspection.black.some((b) => overlaps(b, frozen))) continue;
    timed.push({
      kind: "frozen_picture",
      severity: "warning",
      at: r2(frozen.start),
      message: `picture frozen ${fmt(frozen.start)}–${fmt(frozen.end)} (${fmt(frozen.end - frozen.start)}): a still or a stalled clip`,
    });
  }
  const byIndex = new Map(shots.map((s) => [s.index, s]));
  for (const group of repeats) {
    const first = byIndex.get(group.shots[0]!)!;
    const close = group.minGapSeconds < targets.repeatWindowSeconds;
    timed.push({
      kind: "repeated_shot",
      severity: close ? "problem" : "warning",
      at: first.start,
      message:
        `the same shot appears ${group.shots.length} times (shots ${group.shots.map((i) => `#${i}`).join(", ")} at ${group.shots.map((i) => fmt(byIndex.get(i)!.start)).join(", ")})` +
        (close ? `, again after only ${fmt(group.minGapSeconds)}: use more footage` : ""),
    });
  }
  if (inspection.hasAudio) {
    for (const silence of inspection.silences) {
      if (silence.start <= EDGE_SECONDS || tail(silence)) continue;
      timed.push({ kind: "audio_dropout", severity: "warning", at: r2(silence.start), message: `audio drops out ${fmt(silence.start)}–${fmt(silence.end)}` });
    }
  }
  // Back-to-back shots that look the same (shot embeddings of each shot's middle frame): the cut reads as a jump.
  if (looks) {
    for (let i = 1; i < shots.length; i += 1) {
      const a = looks[i - 1];
      const b = looks[i];
      if (!a || !b) continue;
      const similarity = cosine(a, b);
      if (similarity < NEAR_DUPLICATE) continue;
      timed.push({
        kind: "near_duplicate_shots",
        severity: "warning",
        at: r2(shots[i]!.start),
        message: `shots ${shots[i - 1]!.index} and ${shots[i]!.index} look almost the same (similarity ${similarity.toFixed(2)}): the cut at ${fmt(shots[i]!.start)} reads as a jump, not a new shot`,
      });
    }
  }
  if (!end.ok)
    timed.push({
      kind: end.kind === "black" ? "ends_on_black" : "abrupt_end",
      severity: "problem",
      at: r2(Math.max(0, duration - end.seconds)),
      message: end.message,
    });
  timed.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

  const audio: Problem[] = [];
  const loud = inspection.loudness;
  if (!inspection.hasAudio) audio.push({ kind: "no_audio", severity: "warning", message: "the file has no audio track" });
  else if (!loud || loud.integratedLufs === null) audio.push({ kind: "silent_audio", severity: "problem", message: "the audio track is silent" });
  else {
    if (loud.truePeakDb !== null && loud.truePeakDb > targets.truePeakMaxDb) {
      const clips = loud.truePeakDb > 0;
      audio.push({
        kind: "true_peak",
        severity: clips ? "problem" : "warning",
        message:
          `true peak ${clips ? "+" : ""}${loud.truePeakDb.toFixed(1)} dBTP is over the ${targets.truePeakMaxDb.toFixed(1)} dBTP ceiling` +
          (clips ? ": it clips; master the audio" : ": the platforms' encoders can push it over 0"),
      });
    }
    const off = loud.integratedLufs - targets.loudnessLufs;
    if (Math.abs(off) > targets.loudnessToleranceLu) {
      audio.push({
        kind: "loudness",
        severity: "warning",
        message: `${loud.integratedLufs.toFixed(1)} LUFS is ${Math.abs(off).toFixed(1)} LU ${off > 0 ? "louder" : "quieter"} than the ${targets.loudnessLufs} LUFS target`,
      });
    }
  }
  return [...timed, ...audio];
}

/**
 * The shots a contact sheet shows, at most `maxTiles - 1` spread evenly
 * (every repeated shot's first and second appearance kept), and the end.
 */
export function sheetShots(shots: readonly Shot[], repeats: readonly RepeatGroup[], maxTiles: number): Shot[] {
  const room = Math.max(1, maxTiles - 1);
  if (shots.length <= room) return [...shots];
  const keep = new Set<number>(repeats.flatMap((g) => g.shots.slice(0, 2)));
  const step = shots.length / room;
  for (let k = 0; keep.size < room && k < room; k += 1) keep.add(shots[Math.min(shots.length - 1, Math.floor(k * step + step / 2))]!.index);
  return shots.filter((s) => keep.has(s.index)).slice(0, room);
}
