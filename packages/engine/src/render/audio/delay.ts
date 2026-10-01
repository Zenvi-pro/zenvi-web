/**
 * Delay and Echo, ported from libopenshot src/audio_effects/Delay.cpp:41-102
 * and Echo.cpp:43-105. Both keep a per-channel ring buffer of
 * `int(5.0f * sr) + 1` samples allocated on the first frame, read it with
 * linear interpolation at `write − time·sr`, and skip the sample (no output
 * change, no buffer write) when the read index equals the write index, which
 * is what a zero delay does. Delay is 100 % wet; Echo mixes and feeds back.
 * The interpolation, mix and feedback are fused multiply-adds on arm64.
 */

import type { AudioKernel } from "../types.js";
import { num } from "../kernels/params.js";
import { f32, fmaf } from "./float.js";

class RingState {
  /** Ring length, fixed by the first frame's sample rate. */
  readonly length: number;
  readonly buffers: Float32Array[] = [];
  write = 0;

  constructor(sampleRate: number) {
    const n = Math.trunc(f32(5 * f32(sampleRate))) + 1;
    this.length = n < 1 ? 1 : n;
  }

  /**
   * The ring of `channel`. libopenshot sizes the buffer for the first
   * frame's channel count and indexes past it for later extra channels
   * (undefined behavior); extra channels get their own zeroed ring here.
   */
  channel(channel: number): Float32Array {
    while (this.buffers.length <= channel) this.buffers.push(new Float32Array(this.length));
    return this.buffers[channel]!;
  }
}

function ringOf(state: Map<string, unknown>, key: string, sampleRate: number): RingState {
  const s = state.get(key);
  if (s instanceof RingState) return s;
  const fresh = new RingState(sampleRate);
  state.set(key, fresh);
  return fresh;
}

/**
 * Echo when `feedback`/`mix` are given, Delay otherwise. Per sample:
 * `rp = fmodf(w - d + N, N)`, `i = floorf(rp)`; when `i != w`,
 * `out = buf[i] + (rp - i)·(buf[i+1] - buf[i])` (fused), the output and the
 * stored value are written, then `w` advances. A delay longer than the ring
 * (over 5 s) makes libopenshot read before the buffer (undefined behavior);
 * the read position wraps into the ring instead.
 */
function runRing(channels: Float32Array[], ring: RingState, d: number, echo: { feedback: number; mix: number } | null): void {
  const n = ring.length;
  const nf = f32(n);
  let write = ring.write;
  for (let c = 0; c < channels.length; c += 1) {
    const data = channels[c]!;
    const buffer = ring.channel(c);
    write = ring.write;
    for (let s = 0; s < data.length; s += 1) {
      const input = data[s]!;
      let position = f32(f32(f32(write) - d) + nf) % nf;
      if (position < 0) position = f32(position + nf);
      let index = Math.floor(position);
      if (index >= n) index -= n;
      if (index !== write) {
        const fraction = f32(position - index);
        const d1 = buffer[index]!;
        const d2 = buffer[(index + 1) % n]!;
        const out = fmaf(fraction, f32(d2 - d1), d1);
        if (echo) {
          data[s] = fmaf(echo.mix, f32(out - input), input);
          buffer[write] = fmaf(out, echo.feedback, input);
        } else {
          // `in + (out - in)`: not exactly `out` in float.
          data[s] = f32(input + f32(out - input));
          buffer[write] = input;
        }
      }
      write += 1;
      if (write >= n) write -= n;
    }
  }
  ring.write = write;
}

/** libopenshot `Delay`: `delay_time` seconds (default 1); output = the delayed input. */
export const delay: AudioKernel = (channels, sampleRate, params, state) => {
  const d = f32(f32(num(params, "delay_time", 1)) * f32(sampleRate));
  runRing(channels, ringOf(state, "Delay", sampleRate), d, null);
};

/** libopenshot `Echo`: `echo_time` seconds (0.1), `feedback` (0.5), `mix` (0.5). */
export const echo: AudioKernel = (channels, sampleRate, params, state) => {
  const d = f32(f32(num(params, "echo_time", 0.1)) * f32(sampleRate));
  const feedback = f32(num(params, "feedback", 0.5));
  const mix = f32(num(params, "mix", 0.5));
  runRing(channels, ringOf(state, "Echo", sampleRate), d, { feedback, mix });
};
