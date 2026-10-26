/**
 * Zenvi FX catalog: footage effects libopenshot 1.0 does not have (zoom and
 * directional blur, echo trails, radial chromatic aberration, bloom, glitch,
 * pixel sort, halftone, dither, mirror, optical-flow slow motion, vignette,
 * light leaks), rendered by the host with an ffmpeg filtergraph
 * (`graph.ts`) and swapped in as linked media.
 *
 * An FX stack is an ordered list of effects; each has a 0-1 `amount` (how
 * strong, with a tasteful default), its own params (zod, defaults filled by
 * parsing) and an optional window in seconds of the clip. The engine owns
 * this contract so every surface validates the same way.
 */

import { z } from "zod";

export const FX_IDS = [
  "radial_blur",
  "directional_blur",
  "echo",
  "chromatic_aberration",
  "bloom",
  "glitch",
  "pixel_sort",
  "halftone",
  "dither",
  "mirror",
  "optical_flow_slowmo",
  "vignette",
  "light_leak",
] as const;
export type FxId = (typeof FX_IDS)[number];

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb")
  .transform((v) => v.toUpperCase());
const unit = (fallback: number, what: string) => z.number().min(0).max(1).default(fallback).describe(what);
const seed = z.number().int().min(0).max(1_000_000).default(7).describe("Random seed (same seed, same render).");

export const FX_PARAMS = {
  radial_blur: z.strictObject({
    center_x: unit(0.5, "Zoom centre, 0 left to 1 right."),
    center_y: unit(0.5, "Zoom centre, 0 top to 1 bottom."),
  }),
  directional_blur: z.strictObject({
    angle: z.number().min(0).max(360).default(0).describe("Blur direction in degrees (0 horizontal, 90 vertical)."),
  }),
  echo: z.strictObject({
    style: z
      .enum(["echo", "trails"])
      .default("echo")
      .describe("echo: the last frames fade over the current one (ghosted copies of the motion); trails: bright parts leave light streaks that decay."),
  }),
  chromatic_aberration: z.strictObject({
    center_x: unit(0.5, "Lens centre, 0 left to 1 right (no fringing there)."),
    center_y: unit(0.5, "Lens centre, 0 top to 1 bottom."),
  }),
  bloom: z.strictObject({
    threshold: unit(0.62, "Brightness above which light blooms (0-1)."),
    radius: unit(0.5, "Glow size, 0 tight to 1 wide."),
  }),
  glitch: z.strictObject({
    rate: z.number().min(0.2).max(12).default(2.5).describe("Glitch bursts per second."),
    seed,
  }),
  pixel_sort: z.strictObject({
    threshold: unit(0.55, "Pixels brighter than this are streaked (0-1)."),
    direction: z.enum(["down", "up", "right", "left"]).default("down").describe("Which way the bright pixels streak."),
  }),
  halftone: z.strictObject({
    cell: z.number().int().min(4).max(64).default(12).describe("Dot spacing in pixels at 1080p (scaled with the frame)."),
    ink: hex.default("#111111").describe("Dot colour, #rrggbb."),
    paper: hex.default("#F4EFE6").describe("Paper colour, #rrggbb."),
  }),
  dither: z.strictObject({
    colors: z.number().int().min(2).max(32).default(4).describe("Colours per frame (2 = 1-bit)."),
    pixel: z.number().int().min(1).max(12).default(2).describe("Dither pixel size at 1080p (scaled with the frame)."),
    pattern: z.enum(["bayer", "diffusion"]).default("bayer").describe("bayer: ordered crosshatch; diffusion: Floyd-Steinberg noise."),
    monochrome: z.boolean().default(false).describe("Dither the luma only (black and white)."),
  }),
  mirror: z.strictObject({
    mode: z
      .enum(["horizontal", "vertical", "quad", "kaleidoscope"])
      .default("horizontal")
      .describe("horizontal: left half mirrored to the right; vertical: top half to the bottom; quad: top-left quarter to all four; kaleidoscope: wedges around the centre."),
    segments: z.number().int().min(3).max(16).default(6).describe("kaleidoscope: number of wedges."),
  }),
  optical_flow_slowmo: z.strictObject({
    speed: z.number().min(0.1).max(0.9).optional().describe("Playback speed of the result (0.5 = half speed, twice as long). Default from amount: 1 / (1 + 3 × amount)."),
    method: z
      .enum(["flow", "blend"])
      .default("flow")
      .describe("flow: motion-compensated new frames (minterpolate, slow); blend: cross-faded frames (fast, softer)."),
  }),
  vignette: z.strictObject({
    softness: unit(0.6, "Edge falloff, 0 hard to 1 soft."),
  }),
  light_leak: z.strictObject({
    style: z.enum(["leak", "burn"]).default("leak").describe("leak: warm light drifting in from the edges; burn: a hot film burn that flares toward white."),
    color: hex.default("#FF7A2E").describe("Main leak colour, #rrggbb."),
    seed,
  }),
} as const satisfies Record<FxId, z.ZodObject>;

export type FxParams<F extends FxId = FxId> = z.output<(typeof FX_PARAMS)[F]>;

export interface FxInfo {
  id: FxId;
  title: string;
  summary: string;
  /** Amount when the caller gives none (TASTE: noticeable, not overcooked). */
  defaultAmount: number;
  /** The effect changes the clip's length (it cannot take a window). */
  retimes: boolean;
  /** Reads earlier frames (echo, trails): the window renders from up to this many seconds earlier. */
  lookbackSeconds: number;
}

export const FX_INFO: Readonly<Record<FxId, FxInfo>> = {
  radial_blur: { id: "radial_blur", title: "Zoom blur", summary: "Radial zoom blur out from a centre point, for punch-ins and zoom-through cuts.", defaultAmount: 0.5, retimes: false, lookbackSeconds: 0 },
  directional_blur: { id: "directional_blur", title: "Directional blur", summary: "Motion-style blur along one direction, for whips and fast pans.", defaultAmount: 0.5, retimes: false, lookbackSeconds: 0 },
  echo: { id: "echo", title: "Echo / trails", summary: "Ghosted copies of the motion (echo) or decaying light streaks (trails).", defaultAmount: 0.5, retimes: false, lookbackSeconds: 0.5 },
  chromatic_aberration: { id: "chromatic_aberration", title: "Chromatic aberration", summary: "Lens-style RGB fringing that grows toward the frame edges.", defaultAmount: 0.4, retimes: false, lookbackSeconds: 0 },
  bloom: { id: "bloom", title: "Bloom", summary: "Highlights glow and bleed into their surroundings.", defaultAmount: 0.5, retimes: false, lookbackSeconds: 0 },
  glitch: { id: "glitch", title: "Glitch", summary: "Seeded digital bursts: slices and blocks jump sideways with RGB splits.", defaultAmount: 0.5, retimes: false, lookbackSeconds: 0 },
  pixel_sort: { id: "pixel_sort", title: "Pixel sort", summary: "Bright pixels streak in one direction like a pixel sort (an approximation: a luma-keyed one-way smear, not a true per-row sort).", defaultAmount: 0.5, retimes: false, lookbackSeconds: 0 },
  halftone: { id: "halftone", title: "Halftone", summary: "Print-style dots at 45 degrees, sized by brightness, ink on paper.", defaultAmount: 1, retimes: false, lookbackSeconds: 0 },
  dither: { id: "dither", title: "Dither", summary: "Retro low-colour dither (ordered or error diffusion) with chunky pixels.", defaultAmount: 1, retimes: false, lookbackSeconds: 0 },
  mirror: { id: "mirror", title: "Mirror / kaleidoscope", summary: "Mirror the picture across the centre, into quarters, or into kaleidoscope wedges.", defaultAmount: 1, retimes: false, lookbackSeconds: 0 },
  optical_flow_slowmo: { id: "optical_flow_slowmo", title: "Optical-flow slow motion", summary: "Slow the clip down with interpolated in-between frames; the clip gets longer.", defaultAmount: 0.33, retimes: true, lookbackSeconds: 0 },
  vignette: { id: "vignette", title: "Vignette", summary: "Darken the corners to pull the eye to the centre.", defaultAmount: 0.5, retimes: false, lookbackSeconds: 0 },
  light_leak: { id: "light_leak", title: "Light leak / film burn", summary: "Procedural warm light leaks or a film burn washing over the footage (no stock assets).", defaultAmount: 0.6, retimes: false, lookbackSeconds: 0 },
};

export function isFxId(value: unknown): value is FxId {
  return typeof value === "string" && (FX_IDS as readonly string[]).includes(value);
}

/** One effect of a stack, parsed and complete. */
export interface FxEffect<F extends FxId = FxId> {
  effect: F;
  amount: number;
  params: FxParams<F>;
  /** Window, seconds from the clip's start (end exclusive); omitted = the whole clip. */
  start?: number;
  end?: number;
}

/** What callers send for one effect (amount, params, window optional). */
export const fxEffectInput = z.strictObject({
  effect: z.enum(FX_IDS).describe("Effect id (list_fx_tool lists them with their params)."),
  amount: z.number().min(0).max(1).optional().describe("Strength 0-1 (default per effect)."),
  params: z.record(z.string(), z.unknown()).optional().describe("The effect's params (list_fx_tool); omitted ones take their defaults."),
  start: z.number().min(0).optional().describe("Window start, seconds from the clip's start (default 0)."),
  end: z.number().min(0).optional().describe("Window end, seconds from the clip's start (default the clip's end)."),
});
export type FxEffectInput = z.input<typeof fxEffectInput>;

/** Most effects one clip may stack (each one is a filter chain in one ffmpeg run). */
export const MAX_FX_STACK = 8;

export type ParsedFxEffect = { ok: true; effect: FxEffect } | { ok: false; error: string };

/**
 * Validate and complete one effect: defaults filled, the window checked
 * against the clip's `duration` seconds (a window covering the whole clip
 * is dropped, so equal stacks compare equal).
 */
export function parseFxEffect(raw: unknown, duration: number): ParsedFxEffect {
  const shape = fxEffectInput.safeParse(raw);
  if (!shape.success) {
    const issue = shape.error.issues[0];
    return { ok: false, error: `${issue?.path.join(".") || "effect"}: ${issue?.message ?? "invalid"}` };
  }
  const { effect, amount, start, end } = shape.data;
  const info = FX_INFO[effect];
  const params = FX_PARAMS[effect].safeParse(shape.data.params ?? {});
  if (!params.success) {
    const issues = params.error.issues.map((i) => `${i.path.length > 0 ? i.path.join(".") : "params"}: ${i.message}`);
    return { ok: false, error: `${effect} params: ${issues.join("; ")}` };
  }
  const out: FxEffect = { effect, amount: amount ?? info.defaultAmount, params: params.data as FxParams };
  if (start !== undefined || end !== undefined) {
    if (info.retimes) return { ok: false, error: `${effect} changes the clip's length, so it applies to the whole clip (no start/end).` };
    const s = start ?? 0;
    const e = Math.min(end ?? duration, duration);
    if (s >= duration) return { ok: false, error: `${effect} starts at ${s}s, after the clip's end (${round(duration)}s).` };
    if (e - s < 0.04) return { ok: false, error: `${effect} window ${s}-${e}s is empty: end must be after start.` };
    if (s > 0 || e < duration) {
      out.start = round(s);
      out.end = round(e);
    }
  }
  return { ok: true, effect: out };
}

export type ParsedFxStack = { ok: true; effects: FxEffect[] } | { ok: false; error: string };

/** Validate a whole stack (at most one retiming effect, and it goes last). */
export function parseFxStack(raw: readonly unknown[], duration: number): ParsedFxStack {
  if (raw.length === 0) return { ok: false, error: "give at least one effect." };
  if (raw.length > MAX_FX_STACK) return { ok: false, error: `a clip takes at most ${MAX_FX_STACK} effects, got ${raw.length}.` };
  const effects: FxEffect[] = [];
  for (const [i, item] of raw.entries()) {
    const parsed = parseFxEffect(item, duration);
    if (!parsed.ok) return { ok: false, error: `effects[${i}]: ${parsed.error}` };
    effects.push(parsed.effect);
  }
  const retiming = effects.filter((e) => FX_INFO[e.effect].retimes);
  if (retiming.length > 1) return { ok: false, error: "only one optical_flow_slowmo per clip." };
  // Windows are in clip seconds before slow motion; it goes last so they mean what they say.
  if (retiming.length === 1 && !FX_INFO[effects[effects.length - 1]!.effect].retimes) {
    const at = effects.findIndex((e) => FX_INFO[e.effect].retimes);
    effects.push(...effects.splice(at, 1));
  }
  return { ok: true, effects };
}

/** The speed optical_flow_slowmo plays at (its `speed` param, else from the amount). */
export function slowmoSpeed(effect: FxEffect<"optical_flow_slowmo">): number {
  const speed = effect.params.speed ?? 1 / (1 + 3 * effect.amount);
  return Math.min(1, Math.max(0.1, round(speed, 4)));
}

/** How much longer the stack's render is than its source (1 unless it slows down). */
export function fxStretch(effects: readonly FxEffect[]): number {
  const slow = effects.find((e): e is FxEffect<"optical_flow_slowmo"> => e.effect === "optical_flow_slowmo");
  return slow ? 1 / slowmoSpeed(slow) : 1;
}

function round(value: number, digits = 3): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}
