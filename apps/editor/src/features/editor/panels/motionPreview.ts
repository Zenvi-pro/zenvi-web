/**
 * Hover previews of the motion transitions: the engine's own per-frame plan
 * (`planMotionTransition`, what the tool writes as keyframes) played on two
 * stand-in shots with CSS. Close, not exact: the blur is an SVG Gaussian
 * (libopenshot's is a box blur) and Pixelate is left out.
 */
import { INVERT_CONTRAST, MOTION_NEUTRAL, planMotionTransition, type MotionDirection, type MotionFrameValues, type MotionTransitionId } from "@zenvi/engine";

export interface PreviewFrame {
  /** Which shot is on screen. */
  shot: "a" | "b";
  /** CSS transform of the shot (location is a fraction of the frame, rotation degrees clockwise). */
  transform: string;
  /** Shift's wrap-around offset, fraction of the width (the shot is a repeating background). */
  shiftX: number;
  shiftY: number;
  /** Gaussian deviations, fraction of the width. */
  blurX: number;
  blurY: number;
  /** RGB split offsets, fraction of the width. */
  redX: number;
  blueX: number;
  /** White (> 0) or black (< 0) wash, -1..1. */
  wash: number;
  invert: boolean;
}

function frameOf(shot: "a" | "b", v: MotionFrameValues): PreviewFrame {
  const get = (k: keyof typeof MOTION_NEUTRAL) => v[k] ?? MOTION_NEUTRAL[k];
  const transform = `translate(${get("location_x") * 100}%, ${get("location_y") * 100}%) rotate(${get("rotation")}deg) scale(${get("scale_x")}, ${get("scale_y")})`;
  return {
    shot,
    transform,
    shiftX: get("Shift.x"),
    shiftY: get("Shift.y"),
    blurX: get("Blur.horizontal_radius"),
    blurY: get("Blur.vertical_radius"),
    redX: get("ColorShift.red_x"),
    blueX: get("ColorShift.blue_x"),
    wash: Math.max(-1, Math.min(1, get("Brightness.brightness"))),
    invert: get("Brightness.contrast") <= INVERT_CONTRAST / 2,
  };
}

export const REST_FRAME_A: PreviewFrame = frameOf("a", {});
export const REST_FRAME_B: PreviewFrame = frameOf("b", {});

/** Frames before the move and after it, at the preview rate, so the cut reads. */
const HOLD_BEFORE = 8;
const HOLD_AFTER = 14;

/** One loop of the preview: shot A at rest, the move across the cut, shot B at rest. */
export function previewFrames(preset: MotionTransitionId, direction: MotionDirection | undefined, fps: number): PreviewFrame[] {
  const plan = planMotionTransition({ preset, fps, aspect: 16 / 9, ...(direction ? { direction } : {}) });
  return [
    ...Array.from({ length: HOLD_BEFORE }, () => REST_FRAME_A),
    ...plan.out.frames.map((f) => frameOf("a", f)),
    ...plan.in.frames.map((f) => frameOf("b", f)),
    ...Array.from({ length: HOLD_AFTER }, () => REST_FRAME_B),
  ];
}

/** The still a tile shows: the outgoing shot at full motion (a flash: the incoming one at its peak). */
export function peakFrame(preset: MotionTransitionId, direction: MotionDirection | undefined, fps: number): PreviewFrame {
  const plan = planMotionTransition({ preset, fps, aspect: 16 / 9, ...(direction ? { direction } : {}) });
  if (preset.startsWith("flash_")) return frameOf("b", plan.in.frames[0] ?? {});
  return frameOf("a", plan.out.frames.at(-1) ?? {});
}
