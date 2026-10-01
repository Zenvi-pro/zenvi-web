/**
 * Displacement Map, ported from libopenshot src/effects/Displace.cpp:26-233.
 * A map image (`map_reader`, legacy `reader`) is stretched to the frame with
 * Qt smooth scaling (Displace.cpp:150-153). Its premultiplied gray level goes
 * through the Mask-style brightness/contrast table, is optionally inverted,
 * and is faded toward neutral by the map's alpha. The result offsets a
 * bilinear sample of the original frame by `m * (horizontal * W,
 * vertical * H) * strength`, with `m = (p - 127.5) / 127.5`. `replace_image`
 * outputs the processed map instead.
 *
 * The planner decides which frame of a video map to load:
 * `floor(max(0, n-1) / host_fps * map_fps) + 1`, clamped
 * (Displace.cpp:115-131). The kernel reads `ctx.images.get(path)` as given.
 *
 * Float math follows the arm64 build: `sample = fmaf(m, amount, x)` and the
 * bilinear taps `fmaf(p00, 1-tx, tx*p10)` / `fmaf(top, 1-ty, bottom*ty)` are
 * fused (checked in the disassembly), then `lroundf`.
 */

import { roundHalfAway } from "../../model/rounding.js";
import { clampU8, clonePremul, type PremulImage } from "../pixels.js";
import { scaledPremul } from "./image-cache.js";
import { fmaf } from "../qt/fma.js";
import type { KernelContext } from "../types.js";
import { bool, num, readerPath } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;
const MIN_CONTRAST_DIVISOR = f32(0.00001);

/**
 * The map reader's path. A present `map_reader` wins over the legacy `reader`
 * key, even when it is `{}` (which clears the map), like Displace.cpp:282-289.
 */
export function displaceMapPath(params: Params): string | undefined {
  if (params.map_reader !== undefined) return readerPath(params, "map_reader");
  return readerPath(params, "reader");
}

/** C `fminf` / `fmaxf`: a NaN operand yields the other one. */
function cfmin(a: number, b: number): number {
  return a < b || b !== b ? a : b;
}

function cfmax(a: number, b: number): number {
  return a > b || b !== b ? a : b;
}

/** adjusted_gray[g] (Displace.cpp:186-194): `clamp_u8(int(fmaf(cf, g + b_adj - 128, 128)))`. */
function grayTable(brightness: number, contrast: number): Uint8Array {
  const brightnessAdj = Math.trunc(255 * brightness);
  const c = f32(contrast);
  const divisor = f32(20 - c);
  const factor = f32(20 / (MIN_CONTRAST_DIVISOR < divisor ? divisor : MIN_CONTRAST_DIVISOR));
  const table = new Uint8Array(256);
  for (let g = 0; g < 256; g += 1) table[g] = clampU8(Math.trunc(fmaf(factor, g + brightnessAdj - 128, 128)));
  return table;
}

/** Displace::GetFrame (Displace.cpp:164-233). */
function displaceKernel(image: PremulImage, params: Params, ctx: KernelContext): void {
  const path = displaceMapPath(params);
  if (!path) return;
  const source = ctx.images.get(path);
  const width = image.width;
  const height = image.height;
  if (!source || source.width <= 0 || source.height <= 0 || width <= 0 || height <= 0) return;
  const map = scaledPremul(source, width, height, ctx.imageSizes?.[path]).data;

  const strength = f32(num(params, "strength", 1));
  const xAmount = f32(f32(f32(num(params, "horizontal", 0.05)) * width) * strength);
  const yAmount = f32(f32(f32(num(params, "vertical", 0)) * height) * strength);
  const adjusted = grayTable(num(params, "brightness", 0), num(params, "contrast", 0));
  const invert = bool(params, "invert", false);
  const replace = bool(params, "replace_image", false);

  const original = clonePremul(image).data;
  const out = image.data;
  const maxX = f32(width - 1);
  const maxY = f32(height - 1);
  for (let i = 0; i < width * height; i += 1) {
    const idx = i * 4;
    const gray = (map[idx]! * 11 + map[idx + 1]! * 16 + map[idx + 2]! * 5) >> 5;
    let processed = adjusted[gray]!;
    if (invert) processed = 255 - processed;
    // Transparent map areas fade to neutral; C++ integer division truncates toward zero.
    processed = 128 + Math.trunc(((processed - 128) * map[idx + 3]!) / 255);
    if (replace) {
      const v = clampU8(processed);
      out[idx] = v;
      out[idx + 1] = v;
      out[idx + 2] = v;
      out[idx + 3] = 255;
      continue;
    }
    const signed = f32(f32(processed - 127.5) / 127.5);
    const px = i % width;
    const py = (i - px) / width;
    // sample_bilinear (Displace.cpp:43-62), same weights for all four channels.
    const x = cfmax(0, cfmin(fmaf(signed, xAmount, px), maxX));
    const y = cfmax(0, cfmin(fmaf(signed, yAmount, py), maxY));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const tx = f32(x - x0);
    const ty = f32(y - y0);
    const itx = f32(1 - tx);
    const ity = f32(1 - ty);
    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;
    for (let c = 0; c < 4; c += 1) {
      const top = fmaf(original[i00 + c]!, itx, f32(tx * original[i10 + c]!));
      const bottom = fmaf(original[i01 + c]!, itx, f32(tx * original[i11 + c]!));
      out[idx + c] = clampU8(roundHalfAway(fmaf(top, ity, f32(bottom * ty))));
    }
  }
}

export const displace: KernelSpec = { type: "Displace", supported: true, run: displaceKernel };
