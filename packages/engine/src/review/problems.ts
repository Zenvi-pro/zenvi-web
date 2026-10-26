/**
 * What is wrong with an edit, from what review_edit_tool measured: the
 * timeline's structure, where cuts fall against the music, the mix, and the
 * brightness of the sampled frames. Limits follow docs/TASTE.md (section 6,
 * editing rhythm; section 3, safe areas) and the 38 reference reels: a hype
 * edit holds nothing for 2 s, and cuts land on a beat or a hit.
 */

import type { BeatAlignment, MixReview, PaceLimits, PaceProfile, ReviewProblem, Severity, TextBox, TimelineReview } from "./types.js";

export const PACE_LIMITS: Readonly<Record<PaceProfile, PaceLimits>> = {
  fast: { maxHold: 1.5, minCutsPerSecond: 0.8, maxSilence: 0.6 },
  medium: { maxHold: 3.5, minCutsPerSecond: 0.3, maxSilence: 1.5 },
  slow: { maxHold: 8, minCutsPerSecond: 0.1, maxSilence: 3 },
};

/** Mean luma of a tile at or above this is a white flash frame; at or below the next, black. */
export const FLASH_LUMA = 0.85;
export const BLACK_LUMA = 0.02;
/** A black frame has nothing lit either: dark footage with a bright subject has a higher peak. */
export const BLACK_PEAK = 0.12;
/** A flash frame is shorter than this, seconds. */
export const FLASH_MAX_SECONDS = 0.5;

/** Mixes outside this window (LUFS) are off for short-form video; platforms normalise to about -14. */
const LUFS_RANGE: readonly [number, number] = [-23, -9];
const PEAK_LIMIT_DB = -0.5;
const MAX_PROBLEMS = 12;

const t = (seconds: number): string => `${seconds.toFixed(2)}s`;
const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** A sampled frame: where, its brightness, and the shot it belongs to. */
export interface SampledFrame {
  seconds: number;
  luma: number;
  /** Brightness 99 % of the pixels are at or below. */
  peak: number;
  shot: number;
  /** The shot's clip is fading (opacity below 1) here: a dark frame is the fade, not a fault. */
  fading?: boolean;
}

export interface ProblemInput {
  review: TimelineReview;
  pace: PaceProfile;
  /** Cuts against the music; null when there is no audio to track. */
  alignment?: BeatAlignment | null;
  /** The measured mix; null when the host cannot render audio. */
  mix?: MixReview | null;
  frames?: readonly SampledFrame[];
  textBoxes?: readonly TextBox[];
  frame: { width: number; height: number };
}

/** Cuts against the nearest beat or onset. */
export function alignCuts(cuts: readonly number[], beats: readonly number[], onsets: readonly number[], bpm: number, fps: number): BeatAlignment {
  const tolerance = Math.max(0.04, 1.5 / fps);
  const nearest = (times: readonly number[], at: number): number | undefined =>
    times.reduce<number | undefined>((best, x) => (best === undefined || Math.abs(x - at) < Math.abs(best - at) ? x : best), undefined);
  const hits = [...beats, ...onsets];
  let onBeat = 0;
  let onTransient = 0;
  const misses: BeatAlignment["misses"] = [];
  for (const time of cuts) {
    const beat = nearest(beats, time);
    if (beat !== undefined && Math.abs(beat - time) <= tolerance) onBeat += 1;
    const hit = nearest(hits, time);
    if (hit !== undefined && Math.abs(hit - time) <= tolerance) onTransient += 1;
    else if (hit !== undefined) misses.push({ time, offset: Math.round((time - hit) * 1000) / 1000, nearest: hit });
  }
  misses.sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset));
  const n = Math.max(1, cuts.length);
  return { bpm: Math.round(bpm * 10) / 10, onBeat: Math.round((onBeat / n) * 100) / 100, onTransient: Math.round((onTransient / n) * 100) / 100, tolerance: Math.round(tolerance * 1000) / 1000, misses };
}

/** Title-safe insets as fractions of the frame (docs/TASTE.md section 3): vertical 9:16 also keeps off the platform UI. */
export function safeInsets(width: number, height: number): { left: number; right: number; top: number; bottom: number } {
  return width / height < 0.7 ? { left: 0.1, right: 0.1, top: 0.12, bottom: 0.2 } : { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 };
}

/**
 * What a sampled frame can be marked as: a frame of a short shot is a flash
 * when bright (a white or black flash cut is deliberate), a frame of a longer
 * shot that is not fading is a black frame when dark (a white product shot or
 * a fade from black is not).
 */
export function tileMark(frame: Pick<SampledFrame, "shot" | "fading">, review: TimelineReview): "flash" | "black" | undefined {
  const shot = review.shots.find((s) => s.index === frame.shot);
  if (shot !== undefined && shot.duration <= FLASH_MAX_SECONDS) return "flash";
  return frame.fading ? undefined : "black";
}

/** The sampled frames that are white flashes (short shots) and the ones that are black. */
export function flashAndBlack(frames: readonly SampledFrame[], review: TimelineReview): { flashes: number[]; black: number[] } {
  const flashes: number[] = [];
  const black: number[] = [];
  for (const frame of frames) {
    const mark = tileMark(frame, review);
    if (mark === "flash" && frame.luma >= FLASH_LUMA) flashes.push(frame.seconds);
    else if (mark === "black" && frame.luma <= BLACK_LUMA && frame.peak <= BLACK_PEAK) black.push(frame.seconds);
  }
  const unique = (xs: number[]): number[] => [...new Set(xs.map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);
  return { flashes: unique(flashes), black: unique(black) };
}

export function findProblems(input: ProblemInput): ReviewProblem[] {
  const { review, pace, alignment, mix, frame } = input;
  const limits = PACE_LIMITS[pace];
  const out: ReviewProblem[] = [];
  const add = (problem: ReviewProblem): void => {
    out.push(problem);
  };
  const last = review.shots[review.shots.length - 1];

  // Holes in the picture.
  for (const gap of review.empty) {
    if (gap.title && gap.end - gap.start <= 4) continue;
    // A sliver at the very end is a trimming slip, not a black flash in the middle of the cut.
    const tail = gap.end >= review.range.end - 1e-6 && gap.end - gap.start < 0.5;
    add({
      code: "empty-frames",
      severity: tail ? "low" : "high",
      at: gap.start,
      until: gap.end,
      message: `Nothing is on screen from ${t(gap.start)} to ${t(gap.end)}${gap.title ? " except a title on black" : ""}.`,
      fix: "Fill the gap with footage (move the neighbours together or add a clip). At the end of the timeline, trim the music or the last clip so the picture and the timeline end together.",
    });
  }

  // Holds: a shot that stays on screen longer than the pace allows.
  const allowed = (shot: { index: number }): number => (last && shot.index === last.index ? limits.maxHold + 1 : limits.maxHold);
  const long = review.shots.filter((s) => s.duration > allowed(s) + 1e-6).sort((a, b) => b.duration - a.duration);
  if (long.length > 0) {
    const worst = long[0]!;
    const times = long.map((s) => s.start).sort((a, b) => a - b);
    add({
      code: "long-hold",
      severity: long.length >= 3 || worst.duration > limits.maxHold * 2 ? "high" : "medium",
      at: worst.start,
      until: worst.end,
      times: times.slice(0, 8),
      message: `${long.length} shot${long.length === 1 ? " holds" : "s hold"} longer than ${limits.maxHold} s (longest ${worst.duration.toFixed(2)} s at ${t(worst.start)}, ${worst.name}).`,
      fix: `Cut ${worst.name} shorter (trim_clip_tool or split_clip_tool), or cut to another shot partway through; keep shots under ${limits.maxHold} s for this pace.`,
    });
  }

  // Pace overall.
  if (review.shots.length >= 3 && review.cutsPerSecond < limits.minCutsPerSecond) {
    add({
      code: "slow-pace",
      severity: "medium",
      at: review.range.start,
      until: review.range.end,
      message: `${review.cutsPerSecond.toFixed(2)} cuts per second (median shot ${review.stats.median.toFixed(2)} s); this pace wants at least ${limits.minCutsPerSecond}.`,
      fix: "Use more, shorter shots; split long ones and cut on the beat. Pass pace=medium or pace=slow to review_edit_tool if the slower pace is intended.",
    });
  }

  const stills = review.shots.filter((s) => s.kind === "image" && !s.moves);
  if (review.shots.length >= 3 && stills.length / review.shots.length >= 0.7) {
    add({
      code: "stills-without-motion",
      severity: "medium",
      at: stills[0]!.start,
      times: stills.map((s) => s.start).slice(0, 8),
      message: `${stills.length} of ${review.shots.length} shots are still images with no camera move.`,
      fix: "Give each still a slow push or pan (set_clip_property_tool scale/location keyframes) or swap in video.",
    });
  }

  // The same footage again and again.
  const byFile = new Map<string, typeof review.shots>();
  for (const shot of review.shots) byFile.set(shot.fileId, [...(byFile.get(shot.fileId) ?? []), shot]);
  for (const [, uses] of byFile) {
    if (uses.length < 3) continue;
    const overlaps = uses.flatMap((a, i) =>
      uses.slice(i + 1).filter((b) => {
        const shared = Math.min(a.sourceEnd, b.sourceEnd) - Math.max(a.sourceStart, b.sourceStart);
        return shared > 0.5 * Math.min(a.sourceEnd - a.sourceStart, b.sourceEnd - b.sourceStart);
      }),
    );
    if (overlaps.length >= 2) {
      add({
        code: "repeated-footage",
        severity: "low",
        at: uses[0]!.start,
        times: uses.map((s) => s.start).slice(0, 8),
        message: `${uses[0]!.name} shows the same part of its source ${uses.length} times.`,
        fix: "Use a different part of the clip or another clip for the repeats.",
      });
    }
  }

  // Cuts against the music.
  if (alignment && review.cuts.length >= 4 && alignment.onTransient < 0.5 && pace !== "slow") {
    const worst = alignment.misses.slice(0, 5);
    add({
      code: "cuts-off-beat",
      severity: "medium",
      at: worst[0]?.time ?? review.range.start,
      times: worst.map((m) => m.time),
      message: `Only ${Math.round(alignment.onTransient * 100)}% of cuts land on a beat or hit (within ${Math.round(alignment.tolerance * 1000)} ms${alignment.bpm ? `; ${alignment.bpm} BPM` : "; hits only, no steady beat"}). Worst: ${worst.map((m) => `${t(m.time)} (${m.offset > 0 ? "+" : ""}${Math.round(m.offset * 1000)} ms)`).join(", ")}.`,
      fix: "Move those cuts to the nearest beat or onset (detect_beats_tool gives the times), or rebuild the cut with build_reel_tool.",
    });
  }

  // Sound.
  const silent = mix ? mix.silences : review.silentGaps;
  if (review.audioClips === 0 && (!mix || mix.lufs === null)) {
    add({
      code: "silent-edit",
      severity: "high",
      at: review.range.start,
      until: review.range.end,
      message: "The edit has no sound.",
      fix: "Add music and sound effects (search_freesound_music_tool, import_stock_media_tool).",
    });
  } else {
    const gaps = silent.filter((g) => g.end - g.start > limits.maxSilence);
    if (gaps.length > 0) {
      const worst = gaps.reduce((m, g) => (g.end - g.start > m.end - m.start ? g : m));
      add({
        code: "silent-stretch",
        severity: gaps.length >= 3 || worst.end - worst.start > limits.maxSilence * 3 ? "high" : "medium",
        at: worst.start,
        until: worst.end,
        times: gaps.map((g) => g.start).slice(0, 8),
        message: `${gaps.length} stretch${gaps.length === 1 ? "" : "es"} with ${mix ? "no sound" : "no audio clip"} longer than ${limits.maxSilence} s (longest ${t(worst.start)}-${t(worst.end)}).`,
        fix: "Extend or add music, or put a sound effect or ambience under the gap.",
      });
    }
  }
  if (mix?.lufs != null && (mix.lufs < LUFS_RANGE[0] || mix.lufs > LUFS_RANGE[1])) {
    add({
      code: mix.lufs < LUFS_RANGE[0] ? "mix-too-quiet" : "mix-too-loud",
      severity: "medium",
      at: review.range.start,
      until: review.range.end,
      message: `The mix measures ${mix.lufs.toFixed(1)} LUFS; short-form video plays at about -14.`,
      fix: mix.lufs < LUFS_RANGE[0] ? "Raise the music and effects (set_clip_volume_tool)." : "Lower the loudest tracks (set_clip_volume_tool).",
    });
  }
  if (mix?.peakDb != null && mix.peakDb > PEAK_LIMIT_DB) {
    add({
      code: "mix-clips",
      severity: "medium",
      at: review.range.start,
      until: review.range.end,
      message: `The mix peaks at ${mix.peakDb.toFixed(1)} dBFS and may clip.`,
      fix: "Lower the loudest clips or the music by a few dB.",
    });
  }

  // Frames.
  if (input.frames) {
    const { black } = flashAndBlack(input.frames, review);
    const covered = (s: number): boolean => review.empty.some((g) => s >= g.start - 0.05 && s <= g.end + 0.05);
    const dark = black.filter((s) => !covered(s));
    if (dark.length > 0) {
      add({
        code: "black-frame",
        severity: "high",
        at: dark[0]!,
        times: dark.slice(0, 8),
        message: `Black frame${dark.length === 1 ? "" : "s"} at ${dark.slice(0, 5).map(t).join(", ")}.`,
        fix: "Check what is under the playhead there: a clip that is too dark, a missing file, or an opacity at 0.",
      });
    }
  }

  // Text.
  if (input.textBoxes && input.textBoxes.length > 0) {
    const inset = safeInsets(frame.width, frame.height);
    const slack = 0.02;
    const bad = new Map<string, { box: TextBox; off: boolean }>();
    for (const box of input.textBoxes) {
      const off = box.x0 < 0 || box.y0 < 0 || box.x1 > 1 || box.y1 > 1;
      const outside = box.x0 < inset.left - slack || box.x1 > 1 - inset.right + slack || box.y0 < inset.top - slack || box.y1 > 1 - inset.bottom + slack;
      if (off || outside) bad.set(box.clipId, { box, off: off || bad.get(box.clipId)?.off === true });
    }
    for (const [clipId, { off }] of bad) {
      const title = review.titleClips.find((c) => c.clipId === clipId);
      add({
        code: off ? "text-off-frame" : "text-outside-safe",
        severity: off ? "high" : "low",
        at: title?.start ?? review.range.start,
        until: title?.end,
        message: `Text of clip ${clipId} ${off ? "runs past the edge of the frame" : "sits outside the title-safe area"} (estimated from the title's SVG).`,
        fix: "Shorten or shrink the text, or move the title toward the centre (set_clip_property_tool location, or add_title_tool font size).",
      });
    }
  }

  out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.at - b.at);
  return out.slice(0, MAX_PROBLEMS);
}
