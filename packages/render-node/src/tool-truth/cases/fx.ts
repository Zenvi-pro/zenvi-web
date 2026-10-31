/**
 * Generated matrix over Zenvi FX (engine fx/catalog.ts): every effect added
 * with apply_fx_tool changes the frame, and so does each of its params, its
 * amount and its window. The host renders FX through ffmpeg into linked
 * media, so the libopenshot oracle reads the rendered file like the desktop.
 */

import { FX_IDS, FX_INFO, FX_PARAMS, type FxId } from "@zenvi/engine";
import type { TruthCase } from "../harness.js";
import { A, BARS, down, param, PICTURE, type ToolSpec } from "./define.js";

/** zod v4 internals the matrix reads to pick a clearly different value (numbers: range; enums: options). */
interface ZodLike {
  def: { type: string; defaultValue?: unknown; innerType?: ZodLike; entries?: Record<string, string> };
  minValue?: number | null;
  maxValue?: number | null;
}

function unwrap(schema: ZodLike): ZodLike {
  return schema.def.type === "default" || schema.def.type === "optional" ? unwrap(schema.def.innerType!) : schema;
}

/** FX params that show nothing alone in a still frame of these fixtures, with why. */
export const FX_INERT: ReadonlyMap<string, string> = new Map([
  ["crt.pitch", "scanline spacing scales with the frame: every value is the 2 px floor on these 180 px fixtures"],
]);

/** Params both runs set so the one under test shows (`id.*` for every case of the effect). */
const FX_CONTEXT: Readonly<Record<string, Record<string, unknown>>> = {
  // At the default 2.5 bursts a second the probed frame may fall between bursts.
  "glitch.*": { rate: 12 },
  "mirror.segments": { mode: "kaleidoscope" },
};

/** Values where "far side of the default" is not a clear change. */
const FX_VALUES: Readonly<Record<string, unknown>> = {
  // Sizes are "at 1080p", scaled to the frame: 180 px fixtures need the top of the range.
  "dither.pixel": 12,
  // From the context's 12 bursts a second down to the minimum.
  "glitch.rate": 0.2,
  // rounded -> none only changes the corners; tv insets a 4:3 screen in a black bezel.
  "crt.bezel": "tv",
};

function changed(schema: ZodLike, current: unknown): unknown {
  const inner = unwrap(schema);
  switch (inner.def.type) {
    case "number": {
      const min = inner.minValue ?? 0;
      const max = inner.maxValue ?? 1;
      const value = typeof current === "number" ? current : min;
      const target = max - value >= value - min ? value + 0.6 * (max - value) : value - 0.6 * (value - min);
      return Number.isInteger(value) && Number.isInteger(min) && Number.isInteger(max) && max - min > 4 ? Math.round(target) : Number(target.toFixed(3));
    }
    case "enum":
      return Object.values(inner.def.entries ?? {}).find((v) => v !== current);
    case "boolean":
      return !current;
    case "string":
      return typeof current === "string" && current.startsWith("#") ? "#FF00FF" : undefined;
    default:
      return undefined;
  }
}

const spec: ToolSpec = { tool: "apply_fx_tool", args: { clip_id: A }, clips: BARS, probe: PICTURE };

export function fxCases(): TruthCase[] {
  const cases: TruthCase[] = [];
  for (const id of FX_IDS as readonly FxId[]) {
    // An effect at a cut needs the clip before it: apply_fx_tool refuses it and its own tool applies it (datamosh_cut_tool, BACKLOG).
    if (FX_INFO[id].atCut) continue;
    const schema = FX_PARAMS[id] as unknown as { shape: Record<string, ZodLike>; parse(v: unknown): Record<string, unknown> };
    const defaults = schema.parse({});
    const all = FX_CONTEXT[`${id}.*`] ?? {};
    const one = (params: Record<string, unknown>, extra: Record<string, unknown> = {}) => [{ effect: id, ...extra, params: { ...all, ...params } }];
    cases.push({ ...param(spec, "effects", one({}), { baseIsUncalled: true }), id: `apply_fx_tool effects=${id}` });
    const amount = FX_INFO[id].defaultAmount;
    cases.push({
      ...param(spec, "effects", one({}, { amount: amount > 0.5 ? 0.1 : 1 }), { base: one({}) }),
      id: `apply_fx_tool effects=${id}.amount`,
    });
    for (const [key, field] of Object.entries(schema.shape)) {
      const value = FX_VALUES[`${id}.${key}`] ?? changed(field, defaults[key]);
      if (value === undefined) continue;
      const inert = FX_INERT.get(`${id}.${key}`);
      const context = FX_CONTEXT[`${id}.${key}`] ?? {};
      cases.push({
        ...param(spec, "effects", one({ ...context, [key]: value }), { base: one(context) }),
        id: `apply_fx_tool effects=${id}.${key}`,
        inert,
      });
    }
  }
  return cases;
}

const update: ToolSpec = {
  tool: "update_fx_tool",
  args: { clip_id: A },
  clips: BARS,
  setup: [{ tool: "apply_fx_tool", args: { clip_id: A, effects: [{ effect: "bloom" }, { effect: "vignette" }] } }],
  needsChange: true,
};

export const FX_TOOL_CASES: readonly TruthCase[] = [
  param(update, "amount", 1, { with: { index: 1 }, expect: [down("luma")] }),
  param(update, "index", 1, { with: { amount: 1 }, base: 0 }),
  param(update, "params", { softness: 0 }, { with: { index: 1 } }),
  param(update, "start", 0.6, { with: { index: 1 } }),
  param(update, "end", 0.3, { with: { index: 1 } }),
  param(update, "whole_clip", true, { with: { index: 1 }, setup: [{ tool: "update_fx_tool", args: { clip_id: A, index: 1, start: 0.7 } }] }),
  param(update, "effects", [{ effect: "halftone" }]),
  param({ tool: "remove_fx_tool", args: { clip_id: A }, clips: BARS, setup: [{ tool: "apply_fx_tool", args: { clip_id: A, effects: [{ effect: "halftone" }] } }] }, "index", 0, {
    baseIsUncalled: true,
  }),
];
