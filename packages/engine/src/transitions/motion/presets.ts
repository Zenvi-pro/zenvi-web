/**
 * Motion transition presets: whips, zoom punches, spins, glitches and
 * flashes made only of what libopenshot 1.0 renders (clip transform
 * keyframes plus the Shift, ColorShift, Pixelate, Blur and Brightness
 * effects), so Zenvi desktop plays them unchanged.
 *
 * A motion transition sits on a seamless cut (no overlap): the outgoing
 * clip's last frames accelerate out, the incoming clip's first frames
 * decelerate in, and the smear peaks on the cut. A plan here is pure numbers
 * per moving frame; ops/motion-transitions.ts splices it into the clips.
 *
 * Covering the frame: translation uses Shift, which wraps (an After Effects
 * Offset), so the picture never leaves the canvas; scale only grows (>= 1),
 * and rotation is paired with the smallest scale that still covers the
 * canvas at that angle. Timing and easing follow docs/TASTE.md: exits
 * `in` (0.70, 0, 0.84, 0), landings its mirror `out` (0.16, 1, 0.30, 1).
 *
 * The seam obeys the vector law of HeyGen HyperFrames' motion doctrine
 * (Apache-2.0, .claude/skills/motion-doctrine/SKILL.md, "The Vector Law"):
 * the incoming shot enters on the same axis, in the same direction, at the
 * speed the outgoing shot left (mirrored eases over the same number of
 * frames), mid-motion on both sides of the cut. On zoom seams the scale only
 * ever changes with one sign (a push is never answered by a pull); the side
 * that cannot move without uncovering the frame holds and carries the smear.
 * Smear is motion blur, so it follows speed: it peaks on the frames either
 * side of the cut.
 */

export const MOTION_TRANSITION_IDS = [
  "whip",
  "slide",
  "tilt",
  "zoom_in",
  "zoom_out",
  "zoom_through",
  "spin",
  "squash",
  "shake",
  "glitch",
  "flash_white",
  "flash_black",
  "flash_invert",
  "blur_dissolve",
] as const;
export type MotionTransitionId = (typeof MOTION_TRANSITION_IDS)[number];

export const MOTION_DIRECTIONS = ["left", "right", "up", "down", "cw", "ccw"] as const;
export type MotionDirection = (typeof MOTION_DIRECTIONS)[number];

export type SfxKind = "whoosh" | "hit" | "glitch";

/** Clip transform channels: `scale_*` multiply the clip's own curve, the rest add to it. */
export const TRANSFORM_CHANNELS = ["scale_x", "scale_y", "location_x", "location_y", "rotation"] as const;
export type TransformChannel = (typeof TRANSFORM_CHANNELS)[number];

/**
 * Effect channels (`Class.param`), in the order the effects are stacked:
 * Shift first so Blur smears its wrap seam, Brightness last so a flash
 * covers everything. Blur radii are fractions of the source width here
 * (pixels in the effect JSON).
 */
export const EFFECT_CHANNELS = [
  "Shift.x",
  "Shift.y",
  "ColorShift.red_x",
  "ColorShift.blue_x",
  "Pixelate.pixelization",
  "Blur.horizontal_radius",
  "Blur.vertical_radius",
  "Brightness.brightness",
  "Brightness.contrast",
] as const;
export type EffectChannel = (typeof EFFECT_CHANNELS)[number];

export type MotionChannel = TransformChannel | EffectChannel;

/** The value of each channel that leaves the picture untouched. */
export const MOTION_NEUTRAL: Readonly<Record<MotionChannel, number>> = {
  scale_x: 1,
  scale_y: 1,
  location_x: 0,
  location_y: 0,
  rotation: 0,
  "Shift.x": 0,
  "Shift.y": 0,
  "ColorShift.red_x": 0,
  "ColorShift.blue_x": 0,
  "Pixelate.pixelization": 0,
  "Blur.horizontal_radius": 0,
  "Blur.vertical_radius": 0,
  "Brightness.brightness": 0,
  // Brightness.cpp: factor = 259(c + 255) / (255(259 - c)) is 1 only at c = 0 (the class default 3 is not neutral).
  "Brightness.contrast": 0,
};

/**
 * Brightness contrast whose factor is -1 (259(c + 255) = -255(259 - c)):
 * v -> 256 - v, a negative. Outside the desktop slider's ±128, but
 * libopenshot does not clamp keyframe values (Brightness.cpp:58-62), and a
 * stepped invert frame needs no in-between: keyframes are only read at
 * whole frames.
 */
export const INVERT_CONTRAST = -33022;

export type MotionFrameValues = Partial<Record<MotionChannel, number>>;

export interface MotionTransitionSidePlan {
  /** Values per moving frame, nearest the cut last (outgoing) or first (incoming). */
  frames: MotionFrameValues[];
}

export interface MotionSfxCuePlan {
  kind: SfxKind;
  /** Start, in frames relative to the cut (negative: before it). */
  offset: number;
  /** Length in frames. */
  frames: number;
}

export interface MotionTransitionPlan {
  preset: MotionTransitionId;
  direction: MotionDirection | null;
  intensity: number;
  /** Moving frames in all (outgoing + incoming). */
  frames: number;
  out: MotionTransitionSidePlan;
  in: MotionTransitionSidePlan;
  sfx: MotionSfxCuePlan[];
}

export interface MotionTransitionPlanInput {
  preset: MotionTransitionId;
  /** Moving frames in all (>= 2); default the preset's length at `fps`. */
  frames?: number;
  fps: number;
  /** Resolved direction (`auto` is resolved by the caller); default the preset's. */
  direction?: MotionDirection;
  /** 0.25-2, default 1: scales travel, zoom, blur and flash strength. */
  intensity?: number;
  /** Canvas width / height (spin and shake cover the canvas while rotated). */
  aspect: number;
  /** zoom_through: the point to fly into, 0-1 from the top-left. Default the centre. */
  focus?: { x: number; y: number };
}

export interface MotionPresetInfo {
  id: MotionTransitionId;
  title: string;
  description: string;
  /** Default moving frames at 30 fps (docs/TASTE.md). */
  frames30: number;
  directions: readonly MotionDirection[];
  defaultDirection: MotionDirection | null;
  sfx: readonly SfxKind[];
}

type Side = "out" | "in";

interface SideContext {
  side: Side;
  /** Moving frame index: 0 is the first frame of the side (furthest from the cut on the outgoing side). */
  k: number;
  /** Moving frames on this side. */
  n: number;
  /** Eased amount: 0 at rest, 1 at the cut. */
  a: number;
  /** Speed this frame relative to the speed across the cut (1 next to the cut): what motion blur follows. */
  v: number;
  dir: MotionDirection | null;
  intensity: number;
  aspect: number;
  focus: { x: number; y: number };
}

interface PresetDef extends MotionPresetInfo {
  frame(ctx: SideContext): MotionFrameValues;
  /** Incoming side peaks on its first frame (flashes) instead of continuing the outgoing motion. */
  peakOnIn?: boolean;
  /** SFX cues; default one cue of the first kind over the whole window. */
  cues?(nOut: number, nIn: number): MotionSfxCuePlan[];
}

/** CSS cubic-bezier(x1, y1, x2, y2) at progress `u`. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const bx = (t: number): number => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t: number): number => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < u) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) / 2);
}

/** docs/TASTE.md `in` / exit: accelerates into the cut. */
export const easeIn = (u: number): number => cubicBezier(0.7, 0, 0.84, 0, u);
/** docs/TASTE.md `out` / entrance: fast off the cut, settles slowly. */
export const easeOut = (u: number): number => cubicBezier(0.16, 1, 0.3, 1, u);

/** Smallest scale at which a canvas-sized picture rotated by `degrees` still covers the canvas. */
export function rotationCoverScale(degrees: number, aspect: number): number {
  const t = (Math.abs(degrees) * Math.PI) / 180;
  const k = Math.max(aspect, 1 / aspect);
  return Math.abs(Math.cos(t)) + k * Math.abs(Math.sin(t));
}

interface Axis {
  axis: "x" | "y";
  sign: 1 | -1;
}

/** Content moves left/up for negative Shift (Shift.cpp moves pixel (r, c) to (r + dy, c + dx)). */
function axisOf(dir: MotionDirection | null): Axis {
  if (dir === "right") return { axis: "x", sign: 1 };
  if (dir === "up") return { axis: "y", sign: -1 };
  if (dir === "down") return { axis: "y", sign: 1 };
  return { axis: "x", sign: -1 };
}

const PAN = ["left", "right", "up", "down"] as const;
const TILT = ["up", "down"] as const;
const SPIN = ["cw", "ccw"] as const;

/**
 * Shift wraps, so an offset picture has a hard seam where its edges meet;
 * the smear must cover it while it is on screen (a slide on real footage
 * showed it on the landing frames). Blur follows speed, but never drops
 * below what the offset needs.
 */
function seamBlur(ctx: SideContext): number {
  return Math.max(ctx.v, Math.min(1, 4 * ctx.a));
}

/** Wrap travel: 0.5 frame on each side lands the incoming picture where the outgoing one left off. */
function travel(ctx: SideContext, distance: number, blur: number): MotionFrameValues {
  const { axis, sign } = axisOf(ctx.dir);
  const s = ctx.side === "out" ? sign : -sign;
  const out: MotionFrameValues = {
    [axis === "x" ? "Shift.x" : "Shift.y"]: s * distance * ctx.a,
    [axis === "x" ? "Blur.horizontal_radius" : "Blur.vertical_radius"]: blur * ctx.intensity * seamBlur(ctx),
  };
  return out;
}

function zoom(ctx: SideContext, outAmount: number, inAmount: number, blur: number): MotionFrameValues {
  const scale = 1 + (ctx.side === "out" ? outAmount : inAmount) * ctx.intensity * ctx.a;
  const radius = blur * ctx.intensity * ctx.v;
  return { scale_x: scale, scale_y: scale, "Blur.horizontal_radius": radius, "Blur.vertical_radius": radius };
}

/** Deterministic jitter (no RNG: the same call always writes the same keyframes). */
const JITTER_X = [0.9, -0.7, 0.45, -1, 0.8, -0.35, 1, -0.6, 0.3, -0.85, 0.65, -0.5];
const JITTER_Y = [-0.55, 0.85, -1, 0.4, -0.75, 1, -0.3, 0.6, -0.9, 0.5, -0.65, 0.8];
const JITTER_R = [0.6, -1, 0.75, -0.4, 0.9, -0.8, 0.35, -0.6, 1, -0.5, 0.7, -0.9];

/** Glitch beats per frame, cut outward: RGB split, block offset, pixelation. */
const GLITCH = [
  { rgb: 1, shift: 0.09, pix: 0.55 },
  { rgb: 0.7, shift: -0.14, pix: 0 },
  { rgb: 1, shift: 0.05, pix: 0.4 },
  { rgb: 0.45, shift: -0.06, pix: 0 },
  { rgb: 0.8, shift: 0.11, pix: 0.5 },
];

function windowCue(kind: SfxKind) {
  return (nOut: number, nIn: number): MotionSfxCuePlan[] => [{ kind, offset: -nOut, frames: nOut + nIn }];
}

function cutCue(kind: SfxKind, frames = 3) {
  return (): MotionSfxCuePlan[] => [{ kind, offset: 0, frames }];
}

const PRESETS: readonly PresetDef[] = [
  {
    id: "whip",
    title: "Whip pan",
    description: "A fast camera whip: the picture flies off in the direction with a directional smear and lands on the next shot.",
    frames30: 8,
    directions: PAN,
    defaultDirection: "left",
    sfx: ["whoosh"],
    frame: (ctx) => travel(ctx, 0.5, 0.075),
  },
  {
    id: "slide",
    title: "Slide / push",
    description: "A smooth push: the picture slides along the direction with a light smear, like a camera dolly between shots.",
    frames30: 12,
    directions: PAN,
    defaultDirection: "left",
    sfx: ["whoosh"],
    frame: (ctx) => travel(ctx, 0.5, 0.035),
  },
  {
    id: "tilt",
    title: "Tilt pan",
    description: "A camera tilt: the picture tilts up (or down) past the cut with a vertical smear and a slight roll about the camera's pivot; the next shot arrives on the same move and settles level.",
    frames30: 10,
    directions: TILT,
    defaultDirection: "up",
    sfx: ["whoosh"],
    frame: (ctx) => {
      const values = travel({ ...ctx, dir: ctx.dir === "down" ? "down" : "up" }, 0.5, 0.06);
      // The roll keeps one sign of change across the cut (the vector law): out rolls towards +r, in arrives from -r.
      const roll = (ctx.side === "out" ? 1 : -1) * 3 * Math.min(1.5, ctx.intensity) * ctx.a;
      const scale = rotationCoverScale(roll, ctx.aspect) * 1.002;
      return { ...values, rotation: roll, scale_x: scale, scale_y: scale };
    },
  },
  {
    id: "zoom_in",
    title: "Zoom punch in",
    description: "Crash zoom into the cut: the outgoing shot punches in with a blur, the next one lands composed as the smear clears (a push, never answered by a pull).",
    frames30: 7,
    directions: [],
    defaultDirection: null,
    sfx: ["whoosh", "hit"],
    frame: (ctx) => zoom(ctx, 0.6, 0, 0.025),
    cues: (nOut, nIn) => [
      { kind: "whoosh", offset: -nOut, frames: nOut + nIn },
      { kind: "hit", offset: 0, frames: 3 },
    ],
  },
  {
    id: "zoom_out",
    title: "Zoom punch out",
    description: "Pull-back punch (an arrival): the outgoing shot smears out, the next one arrives zoomed in and snaps back to full frame.",
    frames30: 7,
    directions: [],
    defaultDirection: null,
    sfx: ["whoosh", "hit"],
    frame: (ctx) => zoom(ctx, 0, 0.6, 0.025),
    cues: (nOut, nIn) => [
      { kind: "whoosh", offset: -nOut, frames: nOut + nIn },
      { kind: "hit", offset: 0, frames: 3 },
    ],
  },
  {
    id: "zoom_through",
    title: "Zoom through",
    description: "Fly into a point of the outgoing shot (focus_x/focus_y, default the centre) and come out of the next one.",
    frames30: 10,
    directions: [],
    defaultDirection: null,
    sfx: ["whoosh"],
    frame: (ctx) => {
      const amount = ctx.side === "out" ? 2 : 0;
      const scale = 1 + amount * ctx.intensity * ctx.a;
      const radius = 0.03 * ctx.intensity * ctx.v;
      const values: MotionFrameValues = { scale_x: scale, scale_y: scale, "Blur.horizontal_radius": radius, "Blur.vertical_radius": radius };
      if (ctx.side === "out") {
        // Keep the focus point still while scaling about the centre: |offset| <= (scale - 1) / 2 keeps the edges covered.
        values.location_x = (ctx.focus.x - 0.5) * (1 - scale);
        values.location_y = (ctx.focus.y - 0.5) * (1 - scale);
      }
      return values;
    },
  },
  {
    id: "spin",
    title: "Spin",
    description: "The picture spins out with a blur and the next shot spins in, scaled so the frame stays covered.",
    frames30: 12,
    directions: SPIN,
    defaultDirection: "cw",
    sfx: ["whoosh"],
    frame: (ctx) => {
      const sign = ctx.dir === "ccw" ? -1 : 1;
      const degrees = (ctx.side === "out" ? 1 : -1) * sign * Math.min(90, 60 * ctx.intensity) * ctx.a;
      const scale = rotationCoverScale(degrees, ctx.aspect) * (1 + 0.04 * ctx.a) * 1.002;
      const radius = 0.035 * ctx.intensity * ctx.v;
      return { rotation: degrees, scale_x: scale, scale_y: scale, "Blur.horizontal_radius": radius, "Blur.vertical_radius": radius };
    },
  },
  {
    id: "squash",
    title: "Squash and stretch",
    description: "The outgoing shot stretches as it shoots off along the direction; the next one lands squashed and springs back.",
    frames30: 8,
    directions: PAN,
    defaultDirection: "left",
    sfx: ["whoosh"],
    frame: (ctx) => {
      const { axis, sign } = axisOf(ctx.dir);
      const along = axis === "x" ? "scale_x" : "scale_y";
      const across = axis === "x" ? "scale_y" : "scale_x";
      const s = ctx.side === "out" ? sign : -sign;
      const values: MotionFrameValues = {
        [axis === "x" ? "Shift.x" : "Shift.y"]: s * 0.25 * ctx.a,
        [axis === "x" ? "Blur.horizontal_radius" : "Blur.vertical_radius"]: 0.045 * ctx.intensity * seamBlur(ctx),
      };
      values[along] = 1 + (ctx.side === "out" ? 0.7 : 0) * ctx.intensity * ctx.a;
      values[across] = 1 + (ctx.side === "out" ? 0 : 0.35) * ctx.intensity * ctx.a;
      return values;
    },
  },
  {
    id: "shake",
    title: "Shake cut",
    description: "An impact shake that builds into the cut and rattles out of the next shot (scaled up to keep the frame covered).",
    frames30: 8,
    directions: [],
    defaultDirection: null,
    sfx: ["hit"],
    frame: (ctx) => {
      // Index from the cut outward so both sides start their rattle at the cut.
      const j = ctx.side === "out" ? ctx.n - 1 - ctx.k : ctx.n + ctx.k;
      const amp = 0.035 * ctx.intensity * ctx.a;
      const lx = amp * JITTER_X[j % JITTER_X.length]!;
      const ly = amp * JITTER_Y[j % JITTER_Y.length]!;
      const r = 40 * amp * JITTER_R[j % JITTER_R.length]!;
      const scale = rotationCoverScale(r, ctx.aspect) * (1 + 2 * Math.max(Math.abs(lx), Math.abs(ly))) * 1.002;
      const radius = 0.008 * ctx.intensity * ctx.a;
      return { location_x: lx, location_y: ly, rotation: r, scale_x: scale, scale_y: scale, "Blur.horizontal_radius": radius, "Blur.vertical_radius": radius };
    },
    cues: cutCue("hit"),
  },
  {
    id: "glitch",
    title: "Glitch cut",
    description: "A digital glitch on the cut: RGB split, block offsets and pixelation flicker for a few frames.",
    frames30: 5,
    directions: [],
    defaultDirection: null,
    sfx: ["glitch"],
    peakOnIn: true,
    frame: (ctx) => {
      const j = ctx.side === "out" ? ctx.n - 1 - ctx.k : ctx.k;
      const beat = GLITCH[(ctx.side === "out" ? 2 * j + 1 : 2 * j) % GLITCH.length]!;
      // Glitches flicker rather than ease: full strength on every frame but the outermost.
      const g = Math.min(1, ctx.intensity) * (ctx.a > 0.15 ? 1 : 0.5);
      return {
        "ColorShift.red_x": 0.03 * ctx.intensity * beat.rgb * g,
        "ColorShift.blue_x": -0.03 * ctx.intensity * beat.rgb * g,
        "Shift.x": beat.shift * Math.min(2, ctx.intensity) * g,
        "Pixelate.pixelization": Math.min(0.7, beat.pix * ctx.intensity) * g,
      };
    },
    cues: windowCue("glitch"),
  },
  {
    id: "flash_white",
    title: "White flash",
    description: "A bright white flash frame on the cut that decays into the next shot.",
    frames30: 3,
    directions: [],
    defaultDirection: null,
    sfx: ["hit"],
    peakOnIn: true,
    frame: (ctx) => ({ "Brightness.brightness": Math.min(1, ctx.intensity) * ctx.a, "Brightness.contrast": 0 }),
    cues: cutCue("hit"),
  },
  {
    id: "flash_black",
    title: "Black flash",
    description: "A dip to black for a couple of frames on the cut, a hard punctuation.",
    frames30: 3,
    directions: [],
    defaultDirection: null,
    sfx: ["hit"],
    peakOnIn: true,
    frame: (ctx) => ({ "Brightness.brightness": -Math.min(1, ctx.intensity) * ctx.a, "Brightness.contrast": 0 }),
    cues: cutCue("hit"),
  },
  {
    id: "flash_invert",
    title: "Invert flash",
    description: "Negative frames on the cut (the frames either side of it invert), a graphic flash.",
    frames30: 3,
    directions: [],
    defaultDirection: null,
    sfx: ["hit"],
    peakOnIn: true,
    frame: (ctx) =>
      ctx.a > 0.75
        ? { "Brightness.brightness": 0, "Brightness.contrast": INVERT_CONTRAST }
        : { "Brightness.brightness": 0.35 * Math.min(1, ctx.intensity) * ctx.a, "Brightness.contrast": 0 },
    cues: cutCue("hit"),
  },
  {
    id: "blur_dissolve",
    title: "Blur dissolve",
    description: "Defocus through the cut: the outgoing shot blurs out with a slight push and the next one pulls into focus.",
    frames30: 10,
    directions: [],
    defaultDirection: null,
    sfx: ["whoosh"],
    frame: (ctx) => {
      const radius = 0.05 * ctx.intensity * ctx.a;
      // A slow push out of the outgoing shot; the incoming one only pulls focus (no counter-zoom).
      const scale = 1 + (ctx.side === "out" ? 0.04 : 0) * ctx.intensity * ctx.a;
      return { scale_x: scale, scale_y: scale, "Blur.horizontal_radius": radius, "Blur.vertical_radius": radius };
    },
  },
];

const BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

function info(p: PresetDef): MotionPresetInfo {
  return { id: p.id, title: p.title, description: p.description, frames30: p.frames30, directions: p.directions, defaultDirection: p.defaultDirection, sfx: p.sfx };
}

export function listMotionTransitions(): MotionPresetInfo[] {
  return PRESETS.map(info);
}

export function getMotionTransition(id: string): MotionPresetInfo | undefined {
  const p = BY_ID.get(id as MotionTransitionId);
  return p ? info(p) : undefined;
}

export function isMotionTransitionId(id: string): id is MotionTransitionId {
  return BY_ID.has(id as MotionTransitionId);
}

/** The preset's default moving frames at `fps` (never fewer than 2). */
export function defaultFrames(preset: MotionTransitionId, fps: number): number {
  return Math.max(2, Math.round((BY_ID.get(preset)!.frames30 * fps) / 30));
}

/**
 * Frames on each side of the cut. Moves are mirrored, so both sides get the
 * same length (the incoming side's last frame is its landing, at rest);
 * flashes and glitches give the incoming side the larger share.
 */
export function splitFrames(frames: number, mirrored = true): { out: number; in: number } {
  if (mirrored) {
    const half = Math.max(1, Math.round(frames / 2));
    return { out: half, in: half };
  }
  const out = Math.max(1, Math.min(frames - 1, Math.round(frames * 0.4)));
  return { out, in: frames - out };
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;

/** A deterministic plan for one cut. */
export function planMotionTransition(input: MotionTransitionPlanInput): MotionTransitionPlan {
  const def = BY_ID.get(input.preset);
  if (!def) throw new Error(`unknown motion transition ${input.preset}`);
  const frames = Math.max(2, Math.round(input.frames ?? defaultFrames(input.preset, input.fps)));
  const intensity = Math.min(2, Math.max(0.25, input.intensity ?? 1));
  const dir = def.directions.length === 0 ? null : input.direction && def.directions.includes(input.direction) ? input.direction : def.defaultDirection;
  const focus = { x: Math.min(1, Math.max(0, input.focus?.x ?? 0.5)), y: Math.min(1, Math.max(0, input.focus?.y ?? 0.5)) };
  const split = splitFrames(frames, !def.peakOnIn);
  // Outgoing: rest at k = -1, full at its last frame. Incoming (mirrored): the same path backwards, one
  // frame past the cut, so it enters mid-flight at the speed the outgoing shot left with and lands at rest
  // on its last frame. Flashes peak on the incoming side's first frame instead.
  const amount = (s: Side, k: number, n: number): number =>
    s === "out" ? (k < 0 ? 0 : easeIn((k + 1) / n)) : def.peakOnIn ? 1 - k / n : k < 0 ? 1 : easeIn((n - 1 - k) / n);
  const cutStep = Math.max(1e-9, 1 - easeIn((split.out - 1) / split.out));
  const side = (s: Side, n: number): MotionTransitionSidePlan => {
    const list: MotionFrameValues[] = [];
    for (let k = 0; k < n; k += 1) {
      const a = amount(s, k, n);
      const v = Math.min(1, Math.abs(a - amount(s, k - 1, n)) / cutStep);
      const values = def.frame({ side: s, k, n, a, v, dir, intensity, aspect: input.aspect, focus });
      const rounded: MotionFrameValues = {};
      for (const [ch, v] of Object.entries(values) as [MotionChannel, number][]) rounded[ch] = round6(v);
      list.push(rounded);
    }
    return { frames: list };
  };
  return {
    preset: def.id,
    direction: dir,
    intensity,
    frames: split.out + split.in,
    out: side("out", split.out),
    in: side("in", split.in),
    sfx: (def.cues ?? windowCue(def.sfx[0]!))(split.out, split.in),
  };
}
