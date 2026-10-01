/**
 * Timeline view geometry: seconds ↔ pixels, what is visible, ruler ticks,
 * zoom. Pure display math; timeline semantics (frames, snapping targets,
 * clip windows) come from `@zenvi/engine`.
 */
import type { Fraction } from "@zenvi/engine";
import { MAX_PX_PER_SECOND, MIN_PX_PER_SECOND } from "../session/uiStore";

export const HEADER_WIDTH = 176;
export const RULER_HEIGHT = 28;
/** Room after the last item so there is always somewhere to drop. */
export const TRAILING_SECONDS = 30;

export function timeToX(seconds: number, pxPerSecond: number): number {
  return seconds * pxPerSecond;
}

export function xToTime(x: number, pxPerSecond: number): number {
  return pxPerSecond > 0 ? x / pxPerSecond : 0;
}

export interface TimeRange {
  start: number;
  end: number;
}

/** The time range in view, widened by `overscanPx` on both sides. */
export function visibleRange(scrollLeft: number, width: number, pxPerSecond: number, overscanPx = 0): TimeRange {
  return {
    start: Math.max(0, xToTime(scrollLeft - overscanPx, pxPerSecond)),
    end: xToTime(scrollLeft + width + overscanPx, pxPerSecond),
  };
}

export function rangesOverlap(a: TimeRange, start: number, end: number): boolean {
  return end >= a.start && start <= a.end;
}

export interface RulerScale {
  /** Seconds between labelled ticks. */
  major: number;
  /** Seconds between small ticks. */
  minor: number;
  /** Labels include frames (sub-second zoom). */
  showFrames: boolean;
}

const SECOND_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const SUBSECOND_MINORS = [0.1, 0.2, 0.25, 0.5];
const FRAME_MAJORS = [1, 2, 5, 10, 15];
const FRAME_MINORS = [1, 2, 3, 5];
const MIN_LABEL_PX = 72;
const MIN_TICK_PX = 7;

function divides(major: number, minor: number): boolean {
  const ratio = major / minor;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6 * Math.max(1, ratio);
}

/**
 * Pick tick spacing so labels are at least ~72 px apart and ticks ~7 px.
 * Below a second, spacing is whole frames (exact at NTSC rates too).
 */
export function rulerScale(pxPerSecond: number, fps: Fraction): RulerScale {
  const frame = fps.den / fps.num;
  const frameMajors = FRAME_MAJORS.map((n) => n * frame).filter((s) => s < 1 - 1e-9);
  const major = [...frameMajors, ...SECOND_STEPS].find((s) => s * pxPerSecond >= MIN_LABEL_PX) ?? SECOND_STEPS[SECOND_STEPS.length - 1]!;
  const showFrames = major < 1 - 1e-9;
  const minors = showFrames ? FRAME_MINORS.map((n) => n * frame) : [...SUBSECOND_MINORS, ...SECOND_STEPS];
  const minor = minors.find((s) => s <= major && s * pxPerSecond >= MIN_TICK_PX && divides(major, s)) ?? major;
  return { major, minor, showFrames };
}

/**
 * Ruler label: "0:05", "1:02:03"; at frame zoom whole seconds keep the time
 * and the ticks between them show the frame within the second ("12f").
 */
export function rulerLabel(seconds: number, scale: RulerScale, fps: Fraction): string {
  const total = Math.max(0, seconds + 1e-6);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const base = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  if (!scale.showFrames) return base;
  const f = Math.round((total - Math.floor(total)) * (fps.num / fps.den));
  return f === 0 ? base : `${f}f`;
}

/** Tick times in [range.start, range.end], each flagged major or minor. */
export function rulerTicks(range: TimeRange, scale: RulerScale): { t: number; major: boolean }[] {
  const out: { t: number; major: boolean }[] = [];
  const first = Math.floor(range.start / scale.minor);
  const last = Math.ceil(range.end / scale.minor);
  const perMajor = Math.max(1, Math.round(scale.major / scale.minor));
  for (let i = Math.max(0, first); i <= last && out.length < 4000; i += 1) {
    out.push({ t: i * scale.minor, major: i % perMajor === 0 });
  }
  return out;
}

export function clampZoom(pxPerSecond: number): number {
  return Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pxPerSecond));
}

/** One zoom step (=, - keys and buttons): ×1.5 per step, like a smooth desktop zoom. */
export function zoomStep(pxPerSecond: number, direction: 1 | -1): number {
  return clampZoom(pxPerSecond * (direction > 0 ? 1.5 : 1 / 1.5));
}

/** Zoom so `duration` seconds fill `width` pixels (desktop "Zoom to Timeline", `\`). */
export function zoomToFit(duration: number, width: number): number {
  if (duration <= 0 || width <= 0) return clampZoom(100 / 15);
  return clampZoom((width * 0.94) / duration);
}

/** Slider position 0..1 ↔ zoom (logarithmic, so every step feels the same). */
export function zoomToSlider(pxPerSecond: number): number {
  const min = Math.log(MIN_PX_PER_SECOND);
  const max = Math.log(MAX_PX_PER_SECOND);
  return (Math.log(clampZoom(pxPerSecond)) - min) / (max - min);
}

export function sliderToZoom(value: number): number {
  const min = Math.log(MIN_PX_PER_SECOND);
  const max = Math.log(MAX_PX_PER_SECOND);
  return clampZoom(Math.exp(min + Math.min(1, Math.max(0, value)) * (max - min)));
}

/** Scroll offset that keeps `anchorTime` under viewport x `anchorX` after a zoom. */
export function anchoredScroll(anchorTime: number, anchorX: number, newPxPerSecond: number): number {
  return Math.max(0, anchorTime * newPxPerSecond - anchorX);
}

/** Total scrollable width for a timeline of `duration` seconds. */
export function contentWidth(duration: number, pxPerSecond: number, viewportWidth: number): number {
  return Math.max(viewportWidth, Math.ceil((duration + TRAILING_SECONDS) * pxPerSecond));
}

/** Which track row (index from the top) a y coordinate falls in, or -1. */
export function trackIndexAt(y: number, trackHeight: number, trackCount: number): number {
  if (y < 0) return -1;
  const index = Math.floor(y / trackHeight);
  return index < trackCount ? index : -1;
}
