/**
 * TASTE.md (zenvi-worktrees/.handoff/TASTE.md, 2026-10-04) as data: the
 * defaults Zenvi Link tools use when an argument is omitted, so a lazy call
 * still looks professional. Catalog descriptions and zod defaults read this
 * table, and the extension build injects it into the host scripts as
 * `ZenviLink.TASTE`, so each number lives in exactly one place.
 *
 * Where TASTE.md gives only a range, `default` is the value inside the range
 * a tool should use and `range` keeps the bounds for critique prompts.
 * Times are seconds; distances are fractions of the frame unless noted.
 */

/** cubic-bezier(x1, y1, x2, y2). */
export type Bezier = readonly [number, number, number, number];

/** Easing names every tool understands (TASTE §2). `hold` is a step change and has no curve. */
export const EASING_NAMES = ["smooth", "out", "entrance", "in", "exit", "in-out", "snap", "linear", "hold"] as const;
export type EasingName = (typeof EASING_NAMES)[number];

/** TASTE §2 control points. `out`/`entrance` and `in`/`exit` are aliases. */
export const EASINGS: { readonly [K in Exclude<EasingName, "hold">]: Bezier } = {
  smooth: [0.33, 0, 0.2, 1],
  out: [0.16, 1, 0.3, 1],
  entrance: [0.16, 1, 0.3, 1],
  in: [0.7, 0, 0.84, 0],
  exit: [0.7, 0, 0.84, 0],
  "in-out": [0.65, 0, 0.35, 1],
  snap: [0.2, 0, 0, 1],
  linear: [0, 0, 1, 1],
};

export const DEFAULT_EASING: EasingName = "smooth";

/** A default with the range TASTE.md allows. */
export interface Ranged {
  readonly default: number;
  readonly range: readonly [number, number];
}

export const TASTE = {
  /** TASTE §1. */
  timing: {
    /** UI-like micro motion (pop, nudge): 6–10 frames at 30 fps. */
    micro: { default: 0.27, range: [0.2, 0.35] } as Ranged,
    entrance: { default: 0.6, range: [0.5, 0.8] } as Ranged,
    /** Exits are faster than entrances. */
    exit: { default: 0.4, range: [0.35, 0.5] } as Ranged,
    /** Full-frame push, logo reveal. */
    bigMove: { default: 1.0, range: [0.8, 1.2] } as Ranged,
    stagger: { word: 0.06, line: 0.12, range: [0.04, 0.08] },
    /** Minimum on-screen hold for text: base + perWord × words. */
    textHold: { base: 1.5, perWord: 0.3 },
    lowerThird: { default: 5, range: [4, 6] } as Ranged,
    titleCard: { default: 3, range: [2.5, 4] } as Ranged,
    /** 0.5 s for cuts within a scene, 1.0 s for a time/place change. */
    crossDissolve: { default: 0.5, sceneChange: 1.0, range: [0.5, 1.0] },
    /** Dip to black/white: chapter breaks only. */
    dip: { default: 0.8, range: [0.6, 1.2] } as Ranged,
    audioFade: { in: 0.25, out: 1.0, outRange: [0.5, 1.5], musicEnd: 1.5 },
    /** J/L cut: lead the cut with sound. */
    jlLead: { default: 0.5, range: [0.25, 0.75] } as Ranged,
  },
  /** TASTE §2. */
  easing: {
    default: DEFAULT_EASING,
    curves: EASINGS,
    /** `back-out` overshoot: playful brands only, as an extra keyframe (not an expression). */
    overshoot: { max: 0.06, settle: 0.25 },
    /** After Effects KeyframeEase influence clamp, percent. */
    aeInfluence: { min: 0.1, max: 100 },
  },
  /** TASTE §3. Insets are fractions of each frame dimension. */
  layout: {
    actionSafe: 0.05,
    titleSafe: 0.1,
    /** 9:16 social: keep text out of the top 12 % (status/handle) and bottom 20 % (UI). */
    verticalTop: 0.12,
    verticalBottom: 0.2,
    gridColumns: 12,
    lowerThird: { baselineLandscape: 0.8, baselineVertical: 0.7, gapOfNameSize: 0.25 },
    /** Entrances travel 3–6 % of the frame width, not from off-screen. */
    slide: { default: 0.04, range: [0.03, 0.06] } as Ranged,
    scale: { entranceFrom: 0.92, holdPushTo: 1.04 },
    /** Ken Burns scale change over the shot, eased in-out. */
    kenBurns: { default: 0.04, range: [0.03, 0.06] } as Ranged,
  },
  /** TASTE §4. Pixel sizes are for a 1080-pixel short side; scale by min(width, height) / 1080. */
  type: {
    families: ["Inter", "SF Pro Display", "Helvetica Neue", "Arial"],
    /** PostScript names in order of preference (After Effects `TextDocument.font`). */
    postscript: {
      headline: ["Inter-Bold", "SFProDisplay-Bold", "HelveticaNeue-Bold", "Arial-BoldMT"],
      body: ["Inter-Regular", "SFProDisplay-Regular", "HelveticaNeue", "ArialMT"],
    },
    weights: { headline: [700, 800], body: [400, 500] },
    referenceShortSide: 1080,
    sizes: { headline: 96, title: 72, subtitle: 44, lowerThirdName: 54, lowerThirdRole: 34, caption: 42 },
    /** Fractions of an em (After Effects tracking is in 1/1000 em: multiply by 1000). */
    tracking: { headline: -0.015, headlineRange: [-0.02, -0.01], caps: 0.08, capsRange: [0.06, 0.1] },
    leading: { headline: 1.1, body: 1.3 },
    maxLineChars: 32,
    scrim: { default: 0.45, range: [0.35, 0.55] } as Ranged,
    shadow: { distance: 0, softness: 16, softnessRange: [12, 20], opacity: 0.4 },
    minContrast: 4.5,
  },
  /** TASTE §5. */
  color: {
    palette: { ink: "#0B0B0F", paper: "#F7F7F5", accent: "#FF5A36", secondary: "#2F6BFF" },
    /**
     * Lumetri-style adjustments, as deltas from neutral in Lumetri slider
     * units. `bw-contrast` saturation -100 means "saturation 0" (fully desaturated).
     */
    looks: {
      clean: { contrast: 5, vibrance: 5 },
      "warm-film": { temperature: 8, tint: 2, fade: 8, saturation: -6 },
      "teal-orange": { shadowTint: "teal", highlightTint: "orange", saturation: 6 },
      moody: { exposure: -0.3, contrast: 12, saturation: -15, vignette: -0.8 },
      "bw-contrast": { saturation: -100, contrast: 25 },
    },
    /** Looks apply at ≤ 60 % strength by default; skin must stay natural. */
    lookStrength: 0.6,
  },
  /** TASTE §6. */
  editing: {
    shotLength: { talkingHead: [4, 8], broll: [1.5, 3], socialHook: [0.8, 1.5] },
    endHold: { default: 0.75, range: [0.5, 1.0] } as Ranged,
  },
  audio: {
    dialoguePeakDb: [-12, -6],
    lufs: { social: -16, broadcast: -23 },
    musicUnderDialogueDb: [-24, -18],
    duck: { db: 8, dbRange: [6, 10], attack: 0.3, release: 0.6 },
  },
} as const;

export type Taste = typeof TASTE;

/** Look names (TASTE §5), in the order tools list them. */
export const LOOK_NAMES = ["clean", "warm-film", "teal-orange", "moody", "bw-contrast"] as const;
export type LookName = (typeof LOOK_NAMES)[number];
