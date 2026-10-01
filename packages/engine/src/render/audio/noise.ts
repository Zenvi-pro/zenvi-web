/**
 * Noise, ported from libopenshot src/audio_effects/Noise.cpp:46-65:
 *
 *     y = x·(1 − (1 + L)/100) + x·0.0001·(rand() % 100 + 1)·L,  L = int(level)
 *
 * (multiplicative noise: the gain is uniform over 100 steps in
 * [1 − (1+L)/100 + 0.0001·L, 1 − (1+L)/100 + 0.01·L]). The first term is
 * float, the second double, the last multiply-add is fused in double, and
 * the double result is then rounded to float.
 *
 * Parity divergence: libopenshot calls `srand(time(NULL))` at the start of
 * every frame, so its noise depends on the wall clock, and every frame
 * rendered within the same second repeats the same draws (a buzz at the frame
 * rate). This kernel keeps one libc-compatible generator per effect
 * instance, seeded with `fnv1a32(id)` on the first block and never reseeded:
 * deterministic, and different for each effect. `noiseBlock` with a
 * generator seeded by the desktop's `time(NULL)` reproduces libopenshot
 * exactly (the parity test does that).
 */

import type { AudioKernel } from "../types.js";
import { num, str } from "../kernels/params.js";
import { f32, f32Fma64 } from "./float.js";
import { fnv1a32, LibcRand } from "./libc-rand.js";

/** One frame of `Noise::GetFrame` with integer level `level`, drawing from `rand`. */
export function noiseBlock(channels: Float32Array[], level: number, rand: LibcRand): void {
  const keep = f32(f32(f32(f32(level) + 1) / -100) + 1);
  for (const data of channels) {
    for (let i = 0; i < data.length; i += 1) {
      const x = data[i]!;
      const scaled = (x * 0.0001) * ((rand.next() % 100) + 1);
      data[i] = f32Fma64(scaled, level, f32(keep * x));
    }
  }
}

/** libopenshot `Noise` with a per-instance generator (see the module comment). */
export const noise: AudioKernel = (channels, _sampleRate, params, state) => {
  let rand = state.get("Noise");
  if (!(rand instanceof LibcRand)) {
    rand = new LibcRand(fnv1a32(str(params, "id", "")));
    state.set("Noise", rand);
  }
  noiseBlock(channels, Math.trunc(num(params, "level", 30)), rand as LibcRand);
};
